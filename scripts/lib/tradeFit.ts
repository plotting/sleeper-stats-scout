// Fits a value to every player and pick from the completed trades in the market database.
//
// Idea: managers accept trades they think are roughly even, so we look for values that make
// the two sides of as many trades as possible balance. Each asset has a log-value θ. A side is
// worth its assets' values added up, but with a depth discount: the richest player counts fully,
// the next ×ρ, then ×ρ², … (you can only start so many, and someone gets cut), and the same for
// picks with their own ρ. We minimise (log sideA − log sideB)² over all trades with a small ridge
// toward a prior so rarely-seen assets stay sensible. ρ is a setting, not something the fit learns:
// every trade is balanced by construction, so values that are all equal with ρ = 0 would explain
// the data just as well (the spread of values and ρ trade off and trades alone can't separate them).
// fitAndReport therefore reports how lopsided each trade shape looks under the chosen ρ so it can
// be calibrated. Values are rescaled so the most valuable player (10+ trades) is 10,000.

import type { Asset, TradeRow } from './tradeMarket';
import { premiumMultiplier, premiumWeight } from '../../src/utils/consolidation';

export type AssetKey = string; // "p:<sleeper id>" | "pk:<years ahead>:<round>"

export interface FitTrade {
  id: number | string;
  a: AssetKey[];
  b: AssetKey[];
  weight?: number; // how much this trade counts (e.g. similarity of its league's lineup to ours)
}

/** Pick keys are relative to the trade date so every draft class shares one curve. */
export function pickKey(season: number, round: number, tradedAt: string): AssetKey {
  const offset = Math.min(3, Math.max(0, season - new Date(tradedAt).getUTCFullYear()));
  return `pk:${offset}:${Math.min(5, Math.max(1, round))}`;
}

/** Two-sided trades without FAAB become a fit row; everything else is skipped. */
export function toFitTrade(t: Pick<TradeRow, 'sides' | 'traded_at'> & { id: number | string }, weight = 1): FitTrade | null {
  if (t.sides.length !== 2) return null;
  const keys = (g: Asset[]): AssetKey[] | null => {
    const out: AssetKey[] = [];
    for (const a of g) {
      if ('b' in a) return null;
      out.push('p' in a ? `p:${a.p}` : pickKey(a.k[0], a.k[1], t.traded_at));
    }
    return out;
  };
  const a = keys(t.sides[0].g);
  const b = keys(t.sides[1].g);
  if (!a || !b || a.length === 0 || b.length === 0) return null;
  return { id: t.id, a, b, weight };
}

/** Rough prior before any trade has been seen. */
export function priorValue(key: AssetKey): number {
  if (key.startsWith('pk:')) {
    const [, offset, round] = key.split(':').map(Number);
    return 1000 * Math.pow(0.45, round - 1) * Math.pow(0.7, offset);
  }
  return 300;
}

export interface FitOptions {
  iterations?: number;
  learningRate?: number;
  ridge?: number;
  /** Trades whose sides differ by more than this (in log terms) pull with a capped force (Huber), so outliers can't drag values. */
  huber?: number;
  /** Depth discount per extra asset on a side (default: none). A setting, see the header. */
  depth?: Depth;
  /** Log-value each asset is shrunk toward (default: a flat prior for players, a round curve for picks). */
  priors?: Map<AssetKey, number>;
}

/** Weight multiplier for each additional asset on a side, richest first (1 = no discount). */
export interface Depth { players: number; picks: number }
export const NO_DEPTH: Depth = { players: 1, picks: 1 };

/** Side total with the depth discount: richest player ×1, next ×ρ, then ×ρ², …; picks likewise with their own ρ. */
export function sideTotalDepth(items: Array<{ value: number; pick: boolean }>, depth: Depth): number {
  let total = 0;
  for (const isPick of [false, true]) {
    const rho = isPick ? depth.picks : depth.players;
    const vals = items.filter((x) => x.pick === isPick).map((x) => x.value).sort((x, y) => y - x);
    let w = 1;
    for (const v of vals) { total += w * v; w *= rho; }
  }
  return total;
}

/** Cleaner trades say more about values: 1-for-1 counts fully, bigger trades less (more going on in them). */
export function shapeWeight(aCount: number, bCount: number): number {
  const extra = Math.abs(aCount - bCount) + Math.max(0, Math.min(aCount, bCount) - 1);
  return Math.pow(0.8, extra); // 1-1: 1, 2-1: 0.8, 2-2: 0.8, 3-1: 0.64, 4-1: 0.51, 3-2: 0.64 ...
}

/** Trades lose weight as they age (half-life in days): values drift as players break out or fade. */
export function recencyWeight(tradedAt: string, now: Date, halfLifeDays: number): number {
  const days = Math.max(0, (now.getTime() - new Date(tradedAt).getTime()) / 86_400_000);
  return Math.pow(0.5, days / halfLifeDays);
}

/**
 * Recent VORP per season, annualised: each of the last three seasons (50/30/20) is scaled to a full
 * 17 games and weighted by how much of that season has been played, so a season that is only a few
 * games old can't drag a player down.
 */
export function recentAnnualVorp(seasons: Array<{ yearsAgo: number; vorp: number; seasonGames: number }>): number | null {
  const base = [0.5, 0.3, 0.2];
  let num = 0, den = 0;
  for (const s of seasons) {
    if (s.yearsAgo < 0 || s.yearsAgo > 2 || s.seasonGames <= 0) continue;
    const reliability = Math.min(1, s.seasonGames / 17);
    const w = base[s.yearsAgo] * reliability;
    num += w * s.vorp * (17 / s.seasonGames);
    den += w;
  }
  return den > 0 ? num / den : null;
}

/** The most valuable player (10+ trades) is worth this, like the 0-10,000 scale other trade tools use. */
export const TOP_PLAYER_SCALE = 10000;

/** Fits values for a given depth discount. */
export function fitCore(trades: FitTrade[], opts: FitOptions = {}): { values: Map<AssetKey, number>; depth: Depth } {
  const iterations = opts.iterations ?? 2500;
  const lr = opts.learningRate ?? 0.05;
  const ridge = opts.ridge ?? 0.005;
  const depthSetting = opts.depth ?? NO_DEPTH;
  const huber = opts.huber ?? 0.6;

  const index = new Map<AssetKey, number>();
  const keys: AssetKey[] = [];
  const idx = (k: AssetKey) => {
    let i = index.get(k);
    if (i === undefined) { i = keys.length; index.set(k, i); keys.push(k); }
    return i;
  };
  // Each side is kept as two lists (players, picks) that are re-sorted richest-first every iteration.
  const split = (side: AssetKey[]) => ({ pl: side.filter((k) => !k.startsWith('pk:')).map(idx), pk: side.filter((k) => k.startsWith('pk:')).map(idx) });
  const rows = trades.map((t) => ({ a: split(t.a), b: split(t.b), w: t.weight ?? 1 }));
  const n = keys.length;
  const prior = keys.map((k) => opts.priors?.get(k) ?? Math.log(priorValue(k)));
  const P = Float64Array.from(prior); // log-values
  const m = new Float64Array(n);
  const v2 = new Float64Array(n);
  const grad = new Float64Array(n);
  const val = new Float64Array(n);
  const byValueDesc = (x: number, y: number) => val[y] - val[x];

  const rhoP = depthSetting.players, rhoK = depthSetting.picks;
  // Sorts the side richest-first and returns its discounted total.
  const evalSide = (side: { pl: number[]; pk: number[] }): number => {
    if (side.pl.length > 1) side.pl.sort(byValueDesc);
    if (side.pk.length > 1) side.pk.sort(byValueDesc);
    let S = 0, c = 1;
    for (const i of side.pl) { S += c * val[i]; c *= rhoP; }
    c = 1;
    for (const i of side.pk) { S += c * val[i]; c *= rhoK; }
    return S;
  };
  const addGrad = (side: { pl: number[]; pk: number[] }, factor: number) => {
    let c = 1;
    for (const i of side.pl) { grad[i] += factor * c * val[i]; c *= rhoP; }
    c = 1;
    for (const i of side.pk) { grad[i] += factor * c * val[i]; c *= rhoK; }
  };

  for (let it = 1; it <= iterations; it++) {
    for (let i = 0; i < n; i++) { val[i] = Math.exp(P[i]); grad[i] = 2 * ridge * (P[i] - prior[i]); }
    for (const r of rows) {
      const SA = evalSide(r.a);
      const SB = evalSide(r.b);
      const raw = Math.log(SA) - Math.log(SB); // log of side A over side B
      const d = Math.max(-huber, Math.min(huber, raw)) * r.w; // capped, then weighted
      addGrad(r.a, (2 * d) / SA);
      addGrad(r.b, (-2 * d) / SB);
    }
    const b1 = 0.9, b2 = 0.999;
    for (let i = 0; i < n; i++) {
      m[i] = b1 * m[i] + (1 - b1) * grad[i];
      v2[i] = b2 * v2[i] + (1 - b2) * grad[i] * grad[i];
      P[i] -= (lr * (m[i] / (1 - Math.pow(b1, it)))) / (Math.sqrt(v2[i] / (1 - Math.pow(b2, it))) + 1e-8);
    }
  }
  for (let i = 0; i < n; i++) val[i] = Math.exp(P[i]);

  // Scale so the most valuable player (10+ trades) is TOP_PLAYER_SCALE; fall back to the nearest 1st-round pick.
  const appearances = new Float64Array(n);
  for (const r of rows) for (const i of [...r.a.pl, ...r.a.pk, ...r.b.pl, ...r.b.pk]) appearances[i]++;
  let topX = 0;
  keys.forEach((k, i) => { if (k.startsWith('p:') && appearances[i] >= 10) topX = Math.max(topX, val[i]); });
  let scale = 1;
  if (topX > 0) {
    scale = TOP_PLAYER_SCALE / topX;
  } else {
    for (let off = 0; off <= 3; off++) {
      const i = index.get(`pk:${off}:1`);
      if (i !== undefined) { scale = priorValue(`pk:${off}:1`) / val[i]; break; }
    }
  }
  const out = new Map<AssetKey, number>();
  keys.forEach((k, i) => out.set(k, val[i] * scale));
  // Assets in the priors that never appear in a trade are valued from their prior alone.
  for (const [k, p] of opts.priors ?? []) if (!index.has(k)) out.set(k, Math.exp(p) * scale);
  return { values: out, depth: depthSetting };
}

/** Fits values (top player scaled to 10,000). Returns value per asset key. */
export function fitValues(trades: FitTrade[], opts: FitOptions = {}): Map<AssetKey, number> {
  return fitCore(trades, opts).values;
}

// ── VORP prior: players are shrunk toward a value implied by recent VORP and age ──────────────

export interface PlayerFeature { vorp: number; age: number | null; position?: string | null }

/** Regression row: intercept, ln(1 + recent VORP), age and age² (centred at 26, in 5-year units). */
export function featureRow(f: PlayerFeature): number[] {
  const a = ((f.age ?? 26) - 26) / 5;
  return [1, Math.log(1 + Math.max(0, f.vorp)), a, a * a];
}

/** Weighted least squares via the normal equations (tiny ridge keeps them solvable). */
export function olsWeighted(X: number[][], y: number[], w: number[]): number[] {
  const k = X[0].length;
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (let r = 0; r < X.length; r++) {
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) A[i][j] += w[r] * X[r][i] * X[r][j];
      A[i][k] += w[r] * X[r][i] * y[r];
    }
  }
  for (let i = 0; i < k; i++) A[i][i] += 1e-6;
  for (let i = 0; i < k; i++) {
    let piv = i;
    for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    [A[i], A[piv]] = [A[piv], A[i]];
    for (let r = 0; r < k; r++) {
      if (r === i) continue;
      const f = A[r][i] / A[i][i];
      for (let c = i; c <= k; c++) A[r][c] -= f * A[i][c];
    }
  }
  return A.map((row, i) => row[k] / row[i]);
}

export interface VorpPriorInfo {
  r2: number;
  players: number;
  slope: number;
  /** % the market pays above (+) or below (-) what recent VORP + age imply, by position (players with 5+ trades). */
  marketVsVorp: Record<string, number>;
}

/**
 * Two passes: fit values freely, regress the log-values of well-traded players on VORP and age,
 * then refit with every player shrunk toward their regression value (so players with few trades
 * take their VORP-implied value, and players with none are valued from VORP alone).
 */
export function fitWithFeatures(
  trades: FitTrade[], feats: Map<AssetKey, PlayerFeature>, opts: FitOptions = {},
): { values: Map<AssetKey, number>; depth: Depth; info: VorpPriorInfo | null; baseline: Map<AssetKey, number>; predictValue: ((f: PlayerFeature) => number) | null } {
  const firstFit = fitCore(trades, opts);
  const first = firstFit.values;
  const counts = new Map<AssetKey, number>();
  for (const t of trades) for (const k of [...t.a, ...t.b]) counts.set(k, (counts.get(k) ?? 0) + 1);

  const X: number[][] = [], y: number[] = [], w: number[] = [];
  const noFeat: number[] = [], noFeatW: number[] = [];
  for (const [k, v] of first) {
    if (!k.startsWith('p:')) continue;
    const n = counts.get(k) ?? 0;
    const f = feats.get(k);
    if (n < 5) continue;
    if (f) { X.push(featureRow(f)); y.push(Math.log(v)); w.push(Math.min(n, 40)); }
    else { noFeat.push(Math.log(v)); noFeatW.push(Math.min(n, 40)); }
  }
  if (X.length < 30) return { values: first, depth: firstFit.depth, info: null, baseline: new Map(), predictValue: null };

  const beta = olsWeighted(X, y, w);
  const pred = (f: PlayerFeature) => featureRow(f).reduce((s, x, i) => s + x * beta[i], 0);
  const wsum = w.reduce((a, b) => a + b, 0);
  const ybar = y.reduce((s, v, i) => s + v * w[i], 0) / wsum;
  let ssRes = 0, ssTot = 0;
  y.forEach((v, i) => { ssRes += w[i] * (v - X[i].reduce((s, x, j) => s + x * beta[j], 0)) ** 2; ssTot += w[i] * (v - ybar) ** 2; });
  const unmatched = noFeat.length >= 5
    ? noFeat.reduce((s, v, i) => s + v * noFeatW[i], 0) / noFeatW.reduce((a, b) => a + b, 0)
    : ybar;

  const priors = new Map<AssetKey, number>();
  for (const [k, v] of first) {
    if (!k.startsWith('p:')) priors.set(k, Math.log(v));
    else priors.set(k, feats.has(k) ? pred(feats.get(k)!) : unmatched);
  }
  for (const [k, f] of feats) if (!priors.has(k)) priors.set(k, pred(f));

  const values = fitCore(trades, { ...opts, ridge: opts.ridge ?? 0.4, priors, depth: firstFit.depth }).values;

  // The pure VORP baseline for every player with features, on the same scale as the fitted values
  // (offset = how far the fitted values of well-traded players sit from the regression line, on average).
  let offNum = 0, offDen = 0;
  const resid = new Map<string, { sum: number; w: number }>();
  const keysWithFeat = [...feats.keys()].filter((k) => (counts.get(k) ?? 0) >= 5 && values.has(k));
  for (const k of keysWithFeat) {
    const f = feats.get(k)!;
    const w = Math.min(counts.get(k)!, 40);
    const r = Math.log(values.get(k)!) - pred(f);
    offNum += w * r; offDen += w;
    const pos = f.position ?? '?';
    const e = resid.get(pos) ?? { sum: 0, w: 0 };
    e.sum += w * r; e.w += w; resid.set(pos, e);
  }
  const offset = offDen > 0 ? offNum / offDen : 0;
  const baseline = new Map<AssetKey, number>();
  for (const [k, f] of feats) baseline.set(k, Math.exp(pred(f) + offset));
  const marketVsVorp: Record<string, number> = {};
  for (const [pos, e] of resid) {
    if (pos !== '?' && e.w >= 100) marketVsVorp[pos] = Math.round((Math.exp(e.sum / e.w - offset) - 1) * 100);
  }
  const predictValue = (f: PlayerFeature) => Math.exp(pred(f) + offset);
  return { values, depth: firstFit.depth, baseline, predictValue, info: { r2: ssTot > 0 ? 1 - ssRes / ssTot : 0, players: X.length, slope: beta[1], marketVsVorp } };
}

export type FairTier = 'even' | 'close' | 'edge' | 'lop';

export interface TradeScore { valA: number; valB: number; diffPct: number; tier: FairTier }

/** Gap between the sides as a share of the bigger one; null if any asset has no value. */
/** Multiplier for the side with fewer pieces: the measured premium for the shape ("many-few" → ratio), scaled by how much lesser the many side's pieces are. */
export function premiumFor(premium: Map<string, number> | undefined, aVals: number[], bVals: number[]): { side: 'a' | 'b'; m: number } | null {
  if (!premium || aVals.length === bVals.length) return null;
  const aFew = aVals.length < bVals.length;
  const base = premium.get(`${Math.max(aVals.length, bVals.length)}-${Math.min(aVals.length, bVals.length)}`);
  if (!base || base <= 0) return null;
  const m = premiumMultiplier(base, Math.max(...(aFew ? bVals : aVals)), Math.max(...(aFew ? aVals : bVals)));
  return m > 1 ? { side: aFew ? 'a' : 'b', m } : null;
}

export function scoreTrade(t: FitTrade, values: Map<AssetKey, number>, fallbackToPrior = false, depth: Depth = NO_DEPTH, premium?: Map<string, number>): TradeScore | null {
  const side = (keys: AssetKey[]) => {
    const xs: Array<{ value: number; pick: boolean }> = [];
    for (const k of keys) {
      const x = values.get(k) ?? (fallbackToPrior ? priorValue(k) : undefined);
      if (x === undefined) return null;
      xs.push({ value: x, pick: k.startsWith('pk:') });
    }
    return { total: sideTotalDepth(xs, depth), vals: xs.map((x) => x.value) };
  };
  const sa = side(t.a);
  const sb = side(t.b);
  if (sa === null || sb === null) return null;
  let valA = sa.total;
  let valB = sb.total;
  const adj = premiumFor(premium, sa.vals, sb.vals);
  if (adj) { if (adj.side === 'a') valA *= adj.m; else valB *= adj.m; }
  const diffPct = (Math.abs(valA - valB) / Math.max(valA, valB)) * 100;
  return { valA, valB, diffPct, tier: diffPct <= 10 ? 'even' : diffPct <= 25 ? 'close' : diffPct <= 50 ? 'edge' : 'lop' };
}

export interface FitReport {
  trades: number;
  assets: number;
  inSampleMeanGap: number;
  priorMeanGap: number;
  holdoutMeanGap: number | null;
  holdoutCoverage: number | null; // share of held-out trades whose assets were all seen in training
  vorp: VorpPriorInfo | null;      // how well recent VORP + age explain player values
  depth: Depth;                    // the depth discount used (a setting)
  /** For trades with different asset counts: how much more the bigger side is worth than the smaller one, on average (%), by shape. */
  shapeBias: Record<string, { n: number; pct: number }>;
  tiers: Record<FairTier, number>;
}

// Mean, not median: the prior values every player alike, so most 1-for-1 trades look perfectly even.
const mean = (xs: number[], ws?: number[]) => {
  if (xs.length === 0) return NaN;
  const w = ws ?? xs.map(() => 1);
  const total = w.reduce((a, b) => a + b, 0);
  return total > 0 ? xs.reduce((a, x, i) => a + x * w[i], 0) / total : NaN;
};

/** Fit on everything (values and depth discounts together), plus a 5-fold check on unseen trades. */
export function fitAndReport(
  trades: FitTrade[], opts: FitOptions = {}, feats?: Map<AssetKey, PlayerFeature>,
): { values: Map<AssetKey, number>; depth: Depth; baseline: Map<AssetKey, number>; predictValue: ((f: PlayerFeature) => number) | null; report: FitReport } {
  const o = opts;
  const model = (tr: FitTrade[]) => {
    if (feats) return fitWithFeatures(tr, feats, o);
    const f = fitCore(tr, o);
    return { values: f.values, depth: f.depth, info: null, baseline: new Map<AssetKey, number>(), predictValue: null };
  };
  const full = model(trades);
  const values = full.values;
  const depth = full.depth;
  const scores = trades.map((t) => scoreTrade(t, values, false, depth)!);
  const tiers: Record<FairTier, number> = { even: 0, close: 0, edge: 0, lop: 0 };
  for (const s of scores) tiers[s.tier]++;
  const priorGaps = trades.map((t) => scoreTrade(t, new Map(), true, NO_DEPTH)!.diffPct);

  let holdoutMeanGap: number | null = null;
  let holdoutCoverage: number | null = null;
  const FOLDS = 5;
  if (trades.length >= FOLDS * 20) {
    const gaps: number[] = [], gws: number[] = [];
    let tested = 0;
    for (let f = 0; f < FOLDS; f++) {
      const train = trades.filter((_, i) => i % FOLDS !== f);
      const test = trades.filter((_, i) => i % FOLDS === f);
      const fold = model(train);
      for (const t of test) {
        tested++;
        const s = scoreTrade(t, fold.values, false, fold.depth);
        if (s) { gaps.push(s.diffPct); gws.push(t.weight ?? 1); }
      }
    }
    holdoutMeanGap = mean(gaps, gws);
    holdoutCoverage = tested ? gaps.length / tested : null;
  }
  // Calibration check for the depth setting: in uneven trades (e.g. 4-for-1) the side with more pieces
  // should not be worth systematically more or less than the other. Positive = the many-piece side
  // looks richer than it was accepted as, i.e. the depth discount is too weak.
  // The premium applies only when the many side's pieces are much lesser than the other side's best asset (see consolidation.ts),
  // so it is calibrated on exactly those trades: ln m = Σ w·g·ln(ratio) / Σ w·g², where g is each trade's premium weight and
  // ratio is the many side's plain-sum value over the other's.
  const biasAcc = new Map<string, { gr: number; gg: number; n: number }>();
  trades.forEach((t, i) => {
    const sc = scores[i];
    if (t.a.length === t.b.length) return;
    const manyIsA = t.a.length > t.b.length;
    const many = manyIsA ? t.a : t.b, few = manyIsA ? t.b : t.a;
    const best = (keys: AssetKey[]) => Math.max(...keys.map((k) => values.get(k) ?? 0));
    const g = premiumWeight(best(many), best(few));
    if (g <= 0) return;
    const shape = `${many.length}-${few.length}`;
    const logRatio = Math.log((manyIsA ? sc.valA : sc.valB) / (manyIsA ? sc.valB : sc.valA));
    const w = t.weight ?? 1;
    const e = biasAcc.get(shape) ?? { gr: 0, gg: 0, n: 0 };
    e.gr += w * g * logRatio; e.gg += w * g * g; e.n++; biasAcc.set(shape, e);
  });
  const shapeBias: Record<string, { n: number; pct: number }> = {};
  for (const [shape, e] of biasAcc) if (e.n >= 30 && e.gg > 0) shapeBias[shape] = { n: e.n, pct: Math.round((Math.exp(e.gr / e.gg) - 1) * 100) };

  return {
    values,
    depth,
    baseline: full.baseline,
    predictValue: full.predictValue,
    report: {
      trades: trades.length,
      assets: new Set(trades.flatMap((t) => [...t.a, ...t.b])).size,
      inSampleMeanGap: mean(scores.map((s) => s.diffPct), trades.map((t) => t.weight ?? 1)),
      priorMeanGap: mean(priorGaps, trades.map((t) => t.weight ?? 1)),
      holdoutMeanGap,
      holdoutCoverage,
      depth,
      shapeBias,
      vorp: full.info,
      tiers,
    },
  };
}
