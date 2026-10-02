// Pure helpers for the Trade Calculator, which prices trades with the values fitted from
// completed market trades (market_values; see scripts/lib/tradeFit.ts for how they are made).

export interface CalcAsset {
  key: string;        // "p:<sleeper id>" | "pk:<years ahead>:<round>"
  label: string;
  sub?: string;       // position / team, or pick note
  value: number;
  nTrades: number;
  baseline?: number | null; // VORP + age baseline (players only)
  meta?: { playerId?: string; position?: string | null; team?: string | null; age?: number | null; rank?: string; pickKey?: string };
}

export type FairTier = 'even' | 'close' | 'edge' | 'lop';

export const TIER_LABEL: Record<FairTier, string> = { even: 'Dead even', close: 'Close', edge: 'Clear winner', lop: 'Lopsided' };

/** Same thresholds as the fitted trade scores: gap as a share of the bigger side. */
/** Weight multiplier per additional asset on a side, richest first (1 = plain sum). Learned by the fit. */
export interface Depth { players: number; picks: number }
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

export function assess(receive: CalcAsset[], send: CalcAsset[], depth: Depth = NO_DEPTH) {
  const recv = sideTotal(receive, depth);
  const sent = sideTotal(send, depth);
  const big = Math.max(recv, sent);
  const diffPct = big > 0 ? (Math.abs(recv - sent) / big) * 100 : 0;
  const tier: FairTier = diffPct <= 10 ? 'even' : diffPct <= 25 ? 'close' : diffPct <= 50 ? 'edge' : 'lop';
  return { recv, sent, gap: recv - sent, diffPct, tier, winner: recv === sent ? null : recv > sent ? ('you' as const) : ('them' as const) };
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
): CalcAsset[] {
  const need = Math.abs(gap);
  if (need < 1) return [];
  const base = sideTotal(side, depth);
  return pool
    .filter((a) => !taken.has(a.key) && a.nTrades >= minTrades)
    .map((a) => ({ a, add: sideTotal([...side, a], depth) - base }))
    .sort((x, y) => Math.abs(x.add - need) - Math.abs(y.add - need))
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
