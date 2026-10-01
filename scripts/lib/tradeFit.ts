// Fits a value to every player and pick from the completed trades in the market database.
//
// Idea: managers accept trades they think are roughly even, so we look for values that make
// the two sides of as many trades as possible balance. Each asset has a log-value θ, a side is
// worth the sum of exp(θ) over its assets, and we minimise (log sideA − log sideB)² over all
// trades with a small ridge toward a prior so rarely-seen assets stay sensible. Values are
// rescaled so the top five players (5+ trades) average 9000.

import type { Asset, TradeRow } from './tradeMarket';

export type AssetKey = string; // "p:<sleeper id>" | "pk:<years ahead>:<round>"

export interface FitTrade {
  id: number | string;
  a: AssetKey[];
  b: AssetKey[];
}

/** Pick keys are relative to the trade date so every draft class shares one curve. */
export function pickKey(season: number, round: number, tradedAt: string): AssetKey {
  const offset = Math.min(3, Math.max(0, season - new Date(tradedAt).getUTCFullYear()));
  return `pk:${offset}:${Math.min(5, Math.max(1, round))}`;
}

/** Two-sided trades without FAAB become a fit row; everything else is skipped. */
export function toFitTrade(t: Pick<TradeRow, 'sides' | 'traded_at'> & { id: number | string }): FitTrade | null {
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
  return { id: t.id, a, b };
}

/** Rough prior before any trade has been seen. */
export function priorValue(key: AssetKey): number {
  if (key.startsWith('pk:')) {
    const [, offset, round] = key.split(':').map(Number);
    return 1000 * Math.pow(0.45, round - 1) * Math.pow(0.7, offset);
  }
  return 300;
}

export interface FitOptions { iterations?: number; learningRate?: number; ridge?: number; alpha?: number }

/** Value of a side: (Σ v^α)^(1/α). α = 1 is a plain sum; larger α lets the best piece dominate, so
 *  stars are worth more than the sum of several lesser players (a consolidation premium). */
export function sideValue(vals: number[], alpha: number): number {
  if (alpha === 1) return vals.reduce((a, b) => a + b, 0);
  return Math.pow(vals.reduce((a, b) => a + Math.pow(b, alpha), 0), 1 / alpha);
}

/** Top players (with some trade history) average this, like the 0-10,000 scale other trade tools use. */
export const TOP_PLAYER_SCALE = 9000;

/** Fits values (top players scaled to ~9000). Returns value per asset key. */
export function fitValues(trades: FitTrade[], opts: FitOptions = {}): Map<AssetKey, number> {
  const iterations = opts.iterations ?? 2500;
  const lr = opts.learningRate ?? 0.05;
  const ridge = opts.ridge ?? 0.005;
  const alpha = opts.alpha ?? 1;

  const index = new Map<AssetKey, number>();
  const keys: AssetKey[] = [];
  const idx = (k: AssetKey) => {
    let i = index.get(k);
    if (i === undefined) { i = keys.length; index.set(k, i); keys.push(k); }
    return i;
  };
  const rows = trades.map((t) => ({ a: t.a.map(idx), b: t.b.map(idx) }));
  const n = keys.length;
  const prior = keys.map((k) => Math.log(priorValue(k)));
  const theta = Float64Array.from(prior);
  const m = new Float64Array(n);
  const v = new Float64Array(n);
  const grad = new Float64Array(n);
  const val = new Float64Array(n);

  const wt = new Float64Array(n); // v^α = exp(α·θ), each asset's weight inside its side
  for (let it = 1; it <= iterations; it++) {
    for (let i = 0; i < n; i++) { wt[i] = Math.exp(alpha * theta[i]); grad[i] = 2 * ridge * (theta[i] - prior[i]); }
    for (const r of rows) {
      let sa = 0, sb = 0;
      for (const i of r.a) sa += wt[i];
      for (const i of r.b) sb += wt[i];
      const d = (Math.log(sa) - Math.log(sb)) / alpha; // log of side A over side B
      for (const i of r.a) grad[i] += (2 * d * wt[i]) / sa;
      for (const i of r.b) grad[i] -= (2 * d * wt[i]) / sb;
    }
    const b1 = 0.9, b2 = 0.999;
    for (let i = 0; i < n; i++) {
      m[i] = b1 * m[i] + (1 - b1) * grad[i];
      v[i] = b2 * v[i] + (1 - b2) * grad[i] * grad[i];
      theta[i] -= (lr * (m[i] / (1 - Math.pow(b1, it)))) / (Math.sqrt(v[i] / (1 - Math.pow(b2, it))) + 1e-8);
    }
  }

  // Scale so the top players (5+ trades) average TOP_PLAYER_SCALE; fall back to the nearest 1st-round pick.
  const appearances = new Float64Array(n);
  for (const r of rows) for (const i of [...r.a, ...r.b]) appearances[i]++;
  const tops = keys.map((k, i) => ({ k, x: Math.exp(theta[i]), c: appearances[i] }))
    .filter((e) => e.k.startsWith('p:') && e.c >= 5).sort((x, y) => y.x - x.x).slice(0, 5);
  let scale = 1;
  if (tops.length === 5) {
    scale = TOP_PLAYER_SCALE / (tops.reduce((acc, e) => acc + e.x, 0) / 5);
  } else {
    for (let off = 0; off <= 3; off++) {
      const i = index.get(`pk:${off}:1`);
      if (i !== undefined) { scale = priorValue(`pk:${off}:1`) / Math.exp(theta[i]); break; }
    }
  }
  const out = new Map<AssetKey, number>();
  keys.forEach((k, i) => out.set(k, Math.exp(theta[i]) * scale));
  return out;
}

export type FairTier = 'even' | 'close' | 'edge' | 'lop';

export interface TradeScore { valA: number; valB: number; diffPct: number; tier: FairTier }

/** Gap between the sides as a share of the bigger one; null if any asset has no value. */
export function scoreTrade(t: FitTrade, values: Map<AssetKey, number>, fallbackToPrior = false, alpha = 1): TradeScore | null {
  const side = (keys: AssetKey[]) => {
    const xs: number[] = [];
    for (const k of keys) {
      const x = values.get(k) ?? (fallbackToPrior ? priorValue(k) : undefined);
      if (x === undefined) return null;
      xs.push(x);
    }
    return sideValue(xs, alpha);
  };
  const valA = side(t.a);
  const valB = side(t.b);
  if (valA === null || valB === null) return null;
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
  alpha: number;
  tiers: Record<FairTier, number>;
}

// Mean, not median: the prior values every player alike, so most 1-for-1 trades look perfectly even.
const mean = (xs: number[]) => (xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length);

export const ALPHA_GRID = [1, 1.25, 1.5, 2, 2.5, 3];

function holdoutGap(train: FitTrade[], test: FitTrade[], opts: FitOptions): { gap: number; coverage: number } {
  const alpha = opts.alpha ?? 1;
  const vals = fitValues(train, opts);
  const gaps: number[] = [];
  for (const t of test) {
    const s = scoreTrade(t, vals, false, alpha);
    if (s) gaps.push(s.diffPct);
  }
  return { gap: mean(gaps), coverage: test.length ? gaps.length / test.length : 0 };
}

/** Picks the consolidation exponent α that best predicts held-out trades (one 80/20 split). */
export function chooseAlpha(trades: FitTrade[], opts: FitOptions = {}): number {
  if (trades.length < 100) return 1;
  const train = trades.filter((_, i) => i % 5 !== 0);
  const test = trades.filter((_, i) => i % 5 === 0);
  let best = 1, bestGap = Infinity;
  for (const alpha of ALPHA_GRID) {
    const { gap } = holdoutGap(train, test, { ...opts, alpha });
    if (gap < bestGap) { best = alpha; bestGap = gap; }
  }
  return best;
}

/** Fit on everything (α chosen by held-out error unless given), plus a 5-fold check on unseen trades. */
export function fitAndReport(trades: FitTrade[], opts: FitOptions = {}): { values: Map<AssetKey, number>; report: FitReport } {
  const alpha = opts.alpha ?? chooseAlpha(trades, opts);
  const o = { ...opts, alpha };
  const values = fitValues(trades, o);
  const scores = trades.map((t) => scoreTrade(t, values, false, alpha)!);
  const tiers: Record<FairTier, number> = { even: 0, close: 0, edge: 0, lop: 0 };
  for (const s of scores) tiers[s.tier]++;
  const priorGaps = trades.map((t) => scoreTrade(t, new Map(), true, 1)!.diffPct);

  let holdoutMeanGap: number | null = null;
  let holdoutCoverage: number | null = null;
  const FOLDS = 5;
  if (trades.length >= FOLDS * 20) {
    const gaps: number[] = [];
    let tested = 0;
    for (let f = 0; f < FOLDS; f++) {
      const train = trades.filter((_, i) => i % FOLDS !== f);
      const test = trades.filter((_, i) => i % FOLDS === f);
      const vals = fitValues(train, o);
      for (const t of test) {
        tested++;
        const s = scoreTrade(t, vals, false, alpha);
        if (s) gaps.push(s.diffPct);
      }
    }
    holdoutMeanGap = mean(gaps);
    holdoutCoverage = tested ? gaps.length / tested : null;
  }
  return {
    values,
    report: {
      trades: trades.length,
      assets: values.size,
      inSampleMeanGap: mean(scores.map((s) => s.diffPct)),
      priorMeanGap: mean(priorGaps),
      holdoutMeanGap,
      holdoutCoverage,
      alpha,
      tiers,
    },
  };
}
