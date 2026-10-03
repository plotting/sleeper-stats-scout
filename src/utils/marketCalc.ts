// Pure helpers for the Trade Calculator, which prices trades with the values fitted from
// completed market trades (market_values; see scripts/lib/tradeFit.ts for how they are made).

export interface CalcAsset {
  key: string;        // "p:<sleeper id>" | "pk:<years ahead>:<round>"
  label: string;
  sub?: string;       // position / team, or pick note
  value: number;
  nTrades: number;
  baseline?: number | null; // VORP + age baseline (players only)
  meta?: { change?: number | null; playerId?: string; position?: string | null; team?: string | null; age?: number | null; rank?: string; pickKey?: string; priceKey?: string };
}

export type FairTier = 'even' | 'close' | 'edge' | 'lop';

export const TIER_LABEL: Record<FairTier, string> = { even: 'Dead even', close: 'Close', edge: 'Clear winner', lop: 'Lopsided' };

/** Same thresholds as the fitted trade scores: gap as a share of the bigger side. */
/** Weight multiplier per additional asset on a side, richest first (1 = plain sum). Learned by the fit. */
export interface Depth {
  players: number;
  picks: number;
  /** Consolidation premium by shape ("many-few", e.g. "2-1" → 1.48): the side with fewer pieces is worth this much more than its plain sum. */
  premium?: Map<string, number>;
}
export const NO_DEPTH: Depth = { players: 1, picks: 1 };

/**
 * A side's worth with the depth discount: the richest player counts fully, the next ×ρ, then ×ρ², …
 * (only so many fit in a lineup and someone gets cut); picks the same with their own ρ.
 */
export function sideTotal(assets: CalcAsset[], depth: Depth = NO_DEPTH): number {
  let total = 0;
  for (const picks of [false, true]) {
    const rho = picks ? depth.picks : depth.players;
    const vals = assets.filter((a) => a.key.startsWith('pk:') === picks).map((a) => a.value).sort((x, y) => y - x);
    let w = 1;
    for (const v of vals) { total += w * v; w *= rho; }
  }
  return total;
}

/** Both sides' totals with the consolidation premium applied to the side with fewer pieces (equal counts: no adjustment). */
export function adjustedTotals(receive: CalcAsset[], send: CalcAsset[], depth: Depth = NO_DEPTH) {
  let recv = sideTotal(receive, depth);
  let sent = sideTotal(send, depth);
  let premium: { side: 'recv' | 'sent'; m: number; shape: string } | null = null;
  if (receive.length !== send.length) {
    const many = Math.max(receive.length, send.length), few = Math.min(receive.length, send.length);
    const shape = `${many}-${few}`;
    const m = depth.premium?.get(shape);
    if (m && m > 0 && few > 0) {
      const side = receive.length < send.length ? ('recv' as const) : ('sent' as const);
      if (side === 'recv') recv *= m; else sent *= m;
      premium = { side, m, shape };
    }
  }
  return { recv, sent, premium };
}

export function assess(receive: CalcAsset[], send: CalcAsset[], depth: Depth = NO_DEPTH) {
  const { recv, sent, premium } = adjustedTotals(receive, send, depth);
  const big = Math.max(recv, sent);
  const diffPct = big > 0 ? (Math.abs(recv - sent) / big) * 100 : 0;
  const tier: FairTier = diffPct <= 10 ? 'even' : diffPct <= 25 ? 'close' : diffPct <= 50 ? 'edge' : 'lop';
  return { recv, sent, gap: recv - sent, diffPct, tier, premium, winner: recv === sent ? null : recv > sent ? ('you' as const) : ('them' as const) };
}

const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

/**
 * Picks you can trade today. Fitted pick keys are relative to the trade's calendar year, so
 * after the draft (June on) this year's class is gone and the next three are offered.
 */
export const PICK_TIER_LABELS = { early: 'Early', mid: 'Mid', late: 'Late' } as const;

export function pickOptions(now: Date, values: Map<string, { value: number; n_trades: number }>): CalcAsset[] {
  const year = now.getUTCFullYear();
  const first = now.getUTCMonth() >= 5 ? 1 : 0;
  const out: CalcAsset[] = [];
  for (let offset = first; offset <= first + 2; offset++) {
    for (let round = 1; round <= 5; round++) {
      const key = `pk:${offset}:${round}`;
      const v = values.get(key);
      if (!v) continue;
      out.push({ key, label: `${year + offset} ${ordinal(round)}`, sub: 'Pick', value: v.value, nTrades: v.n_trades, meta: { pickKey: `${year + offset}-${round}` } });
      // slot tiers (from how early / mid / late picks actually turned out), when the fit has them
      for (const tier of Object.keys(PICK_TIER_LABELS) as Array<keyof typeof PICK_TIER_LABELS>) {
        const t = values.get(`${key}:${tier}`);
        if (t) out.push({ key: `${key}:${tier}`, label: `${year + offset} ${PICK_TIER_LABELS[tier]} ${ordinal(round)}`, sub: 'Pick', value: t.value, nTrades: v.n_trades });
      }
    }
  }
  return out;
}

/**
 * Assets that would even the trade out when added to `side` (the side that is behind). Each candidate is
 * judged by what it actually adds to that side after the depth discount, so a 2,000 player added to a
 * side that already has three is worth less than a 2,000 player added to an empty one.
 */
export function suggestToEven(
  gap: number, pool: CalcAsset[], taken: Set<string>, side: CalcAsset[], depth: Depth = NO_DEPTH, minTrades = 3, limit = 4,
  /** With the other side given, candidates are judged on the premium-adjusted gap (adding a piece can change which side gets the premium). */
  ctx?: { other: CalcAsset[]; sideIsRecv: boolean },
): CalcAsset[] {
  const need = Math.abs(gap);
  if (need < 1) return [];
  const base = sideTotal(side, depth);
  return pool
    .filter((a) => !taken.has(a.key) && a.nTrades >= minTrades)
    .map((a) => {
      if (!ctx) return { a, miss: Math.abs(sideTotal([...side, a], depth) - base - need) };
      const t = ctx.sideIsRecv ? adjustedTotals([...side, a], ctx.other, depth) : adjustedTotals(ctx.other, [...side, a], depth);
      return { a, miss: Math.abs(t.recv - t.sent) };
    })
    .sort((x, y) => x.miss - y.miss)
    .slice(0, limit)
    .map((x) => x.a);
}

/**
 * Value at a given VORP weight: 0 = what the market pays, 1 = what recent VORP + age imply
 * (geometric blend). Players with no trades only have the VORP baseline; picks are market-only.
 */
export function effectiveValue(a: Pick<CalcAsset, 'key' | 'value' | 'nTrades' | 'baseline'>, vorpWeight: number): number {
  const b = a.baseline;
  if (b == null || !a.key.startsWith('p:')) return a.value;
  if (a.nTrades === 0) return b;
  const w = Math.min(1, Math.max(0, vorpWeight));
  return Math.exp((1 - w) * Math.log(a.value) + w * Math.log(b));
}

/** Key of a traded pick in the fit: years ahead of the trade's calendar year (0-3) and round (1-5). Matches scripts/lib/tradeFit.ts. */
export function pickKeyFor(season: number, round: number, tradedAt: string): string {
  const offset = Math.min(3, Math.max(0, season - new Date(tradedAt).getUTCFullYear()));
  return `pk:${offset}:${Math.min(5, Math.max(1, round))}`;
}

/** Re-scales player and pick values so the most valuable player (10+ trades) is `top`; other keys are untouched. */
export function normalizeTop(values: Map<string, { value: number; n_trades: number }>, top = 10000): void {
  let max = 0;
  for (const [key, v] of values) if (key.startsWith('p:') && v.n_trades >= 10) max = Math.max(max, v.value);
  if (max <= 0) return;
  const k = top / max;
  for (const [key, v] of values) if (key.startsWith('p:') || key.startsWith('pk:')) values.set(key, { ...v, value: v.value * k });
}

// ── Verdict ──────────────────────────────────────────────────────────────────────────────────

export interface Verdict {
  segment: number;            // 0 = Smash for you ... 3 = Even ... 6 = Robbery against you
  label: string;              // short name of the active segment
  headline: string;           // e.g. "Clear win for you"
  tone: 'win' | 'even' | 'lose';
}

/** Seven steps from "Smash" to "Robbery" by the gap as a share of the bigger side (same 10 / 25 / 50% cut-offs as the fairness tiers). */
export function verdictOf(recv: number, sent: number): Verdict {
  const big = Math.max(recv, sent);
  const s = big > 0 ? (recv - sent) / big : 0; // + = you come out ahead
  const a = Math.abs(s);
  if (a <= 0.1) return { segment: 3, label: 'Even', headline: 'Fair deal', tone: 'even' };
  const step = a <= 0.25 ? 1 : a <= 0.5 ? 2 : 3; // 1 = small edge, 2 = clear, 3 = lopsided
  if (s > 0) {
    return { segment: 3 - step, label: ['Win', 'Clear win', 'Smash'][step - 1], headline: ['Win for you', 'Clear win for you', 'Smash — you win big'][step - 1], tone: 'win' };
  }
  return { segment: 3 + step, label: ['Lose', 'Clear loss', 'Robbery'][step - 1], headline: ['You lose a little', 'Clear loss for you', 'Robbery — they win big'][step - 1], tone: 'lose' };
}

// ── Aging ────────────────────────────────────────────────────────────────────────────────────

/** Cross-sectional value-by-age curve for a position: ln(value) = c + b1·a + b2·a², a = (age − 26) / 5. */
export interface AgeCurve { b1: number; b2: number }

/** How much a player's value changes going from `age` to `age + years` along the curve (clamped to sane limits). */
export function ageFactor(curve: AgeCurve | null | undefined, age: number | null | undefined, years: number): number {
  if (!curve || age == null || years === 0) return 1;
  const a = (x: number) => (Math.min(36, Math.max(20, x)) - 26) / 5;
  const f = (x: number) => curve.b1 * a(x) + curve.b2 * a(x) ** 2;
  return Math.min(1.6, Math.max(0.15, Math.exp(f(age + years) - f(age))));
}

/** Value of an asset `years` from now: players follow their position's age curve; picks stay flat. */
export function projectValue(asset: CalcAsset, years: number, curves: Map<string, AgeCurve>): number {
  const m = asset.meta;
  if (!m?.playerId || years === 0) return asset.value;
  return asset.value * ageFactor(curves.get(m.position ?? ''), m.age, years);
}

export function trend(gaps: number[]): 'Always ahead' | 'Always behind' | 'Flips' {
  const nonZero = gaps.filter((g) => Math.abs(g) > 1);
  if (nonZero.length === 0) return 'Always ahead';
  if (nonZero.every((g) => g > 0)) return 'Always ahead';
  if (nonZero.every((g) => g < 0)) return 'Always behind';
  return 'Flips';
}

// ── Durability ───────────────────────────────────────────────────────────────────────────────

export interface Durability { avgMissed: number; seasons: number; score: number; label: 'Ironman' | 'Durable' | 'Some risk' | 'Injury-prone' }

/** Games missed per season over a player's NFL seasons (seasons with no stats between his first and last count as fully missed). */
export function durabilityOf(rows: Array<{ year: number; games_played: number }>, currentYear: number): Durability | null {
  const done = rows.filter((r) => r.year < currentYear); // this season is still being played
  if (done.length === 0) return null;
  const first = Math.min(...done.map((r) => r.year));
  const last = Math.max(...done.map((r) => r.year));
  let missed = 0;
  for (let y = first; y <= last; y++) {
    const len = y >= 2021 ? 17 : 16;
    const played = done.find((r) => r.year === y)?.games_played ?? 0;
    missed += Math.max(0, len - played);
  }
  const seasons = last - first + 1;
  const avgMissed = missed / seasons;
  const label = avgMissed <= 1.5 ? 'Ironman' : avgMissed <= 3 ? 'Durable' : avgMissed <= 5 ? 'Some risk' : 'Injury-prone';
  return { avgMissed, seasons, score: Math.max(0, Math.round(100 - 15 * avgMissed)), label };
}

// ── Share links ──────────────────────────────────────────────────────────────────────────────

export interface ShareState { receive: string[]; send: string[]; format?: string; vorp?: number; pick?: number }

export function encodeShare(s: ShareState): string {
  const p = new URLSearchParams();
  if (s.receive.length) p.set('r', s.receive.join(','));
  if (s.send.length) p.set('s', s.send.join(','));
  if (s.format) p.set('f', s.format);
  if (s.vorp != null) p.set('v', String(s.vorp));
  if (s.pick != null) p.set('k', String(s.pick));
  return p.toString();
}

export function decodeShare(search: string): ShareState {
  const p = new URLSearchParams(search);
  const list = (k: string) => (p.get(k) ?? '').split(',').filter((x) => /^(p:\d+|pk:[0-3]:[1-5](:(early|mid|late))?)$/.test(x));
  const num = (k: string) => { const v = Number(p.get(k)); return p.has(k) && Number.isFinite(v) ? v : undefined; };
  const f = p.get('f');
  return { receive: list('r'), send: list('s'), format: f === '1qb' || f === 'sf' ? f : undefined, vorp: num('v'), pick: num('k') };
}

// ── Outcome range ────────────────────────────────────────────────────────────────────────────

/** Next-season change in ln(value) for a position and age group (percentiles) with breakout / bust odds. Fitted with the values. */
export interface Outcome { p10: number; p50: number; p90: number; up: number; down: number; n: number }

export const ageBucketOf = (age: number): 'young' | 'prime' | 'vet' => (age <= 24 ? 'young' : age <= 28 ? 'prime' : 'vet');

export interface Range { ceiling: number; expected: number; floor: number; up: number; down: number; n: number }

/** Where a player's value could be entering next season: 90th / 50th / 10th percentile outcomes (capped at 10,000). */
export function outcomeRange(a: CalcAsset, vol: Map<string, Outcome>): Range | null {
  const m = a.meta;
  if (!m?.playerId || !m.position || m.age == null) return null;
  const o = vol.get(`${m.position}:${ageBucketOf(m.age)}`);
  if (!o) return null;
  const at = (x: number) => Math.min(10000, a.value * Math.exp(x));
  return { ceiling: at(o.p90), expected: at(o.p50), floor: at(o.p10), up: o.up, down: o.down, n: o.n };
}

/** "WR4": the position rank a value would have among the valued players of that position. */
export function rankEquivalent(entries: CalcAsset[], position: string, value: number): string {
  let above = 0;
  for (const e of entries) if (e.meta?.playerId && e.meta.position === position && e.value > value) above++;
  return `${position}${above + 1}`;
}

/** Value change from an earlier day, in percent, for every asset valued in both (null when it was not valued then or was near zero). */
export function valueChanges(now: Map<string, number>, then: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, v] of now) {
    const before = then.get(key);
    if (before != null && before >= 100) out.set(key, ((v - before) / before) * 100);
  }
  return out;
}

/** Whole days between two YYYY-MM-DD dates. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

export interface Offer { assets: CalcAsset[]; total: number; need: number; diffPct: number }

/**
 * Packages of 1–3 assets from `pool` that match a single `target` asset (within `tol`), closest and simplest first.
 * A multi-piece package has to cover the target plus the consolidation premium for that shape, so a 2-for-1 is
 * judged against the target's value × the 2-1 premium. Tiny pieces are ignored so a real asset is not padded with scraps.
 */
export function findOffers(target: number, pool: CalcAsset[], depth: Depth = NO_DEPTH, tol = 0.1, limit = 3, maxPieces = 3): Offer[] {
  if (target <= 0) return [];
  const cands = pool.filter((a) => a.value >= Math.max(150, target * 0.1)).sort((x, y) => y.value - x.value).slice(0, 30);
  const found: Array<Offer & { score: number }> = [];
  const consider = (assets: CalcAsset[]) => {
    const total = sideTotal(assets, depth);
    const need = target * (assets.length > 1 ? (depth.premium?.get(`${assets.length}-1`) ?? 1) : 1);
    const diffPct = (Math.abs(total - need) / need) * 100;
    if (diffPct <= tol * 100) found.push({ assets, total, need, diffPct, score: diffPct + 4 * (assets.length - 1) });
  };
  for (let i = 0; i < cands.length; i++) {
    consider([cands[i]]);
    if (maxPieces < 2) continue;
    for (let j = i + 1; j < cands.length; j++) {
      consider([cands[i], cands[j]]);
      if (maxPieces < 3) continue;
      for (let k = j + 1; k < cands.length; k++) consider([cands[i], cands[j], cands[k]]);
    }
  }
  return found.sort((x, y) => x.score - y.score).slice(0, limit).map(({ assets, total, need, diffPct }) => ({ assets, total, need, diffPct }));
}
