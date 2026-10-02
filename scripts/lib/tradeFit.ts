// Fits a value to every player and pick from the completed trades in the market database.
//
// Idea: managers accept trades they think are roughly even, so we look for values that make
// the two sides of as many trades as possible balance. Each asset has a log-value θ, a side is
// worth the sum of exp(θ) over its assets, and we minimise (log sideA − log sideB)² over all
// trades with a small ridge toward a prior so rarely-seen assets stay sensible. Values are
// rescaled so the most valuable player (10+ trades) is 10,000.

import type { Asset, TradeRow } from './tradeMarket';

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
  alpha?: number;
  /** Log-value each asset is shrunk toward (default: a flat prior for players, a round curve for picks). */
  priors?: Map<AssetKey, number>;
}

/** Value of a side: (Σ v^α)^(1/α). α = 1 is a plain sum; larger α lets the best piece dominate, so
 *  stars are worth more than the sum of several lesser players (a consolidation premium). */
export function sideValue(vals: number[], alpha: number): number {
  if (alpha === 1) return vals.reduce((a, b) => a + b, 0);
  return Math.pow(vals.reduce((a, b) => a + Math.pow(b, alpha), 0), 1 / alpha);
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
  const rows = trades.map((t) => ({ a: t.a.map(idx), b: t.b.map(idx), w: t.weight ?? 1 }));
  const n = keys.length;
  const prior = keys.map((k) => opts.priors?.get(k) ?? Math.log(priorValue(k)));
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
      const d = ((Math.log(sa) - Math.log(sb)) / alpha) * r.w; // log of side A over side B, weighted
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

  // Scale so the most valuable player (10+ trades) is TOP_PLAYER_SCALE; fall back to the nearest 1st-round pick.
  const appearances = new Float64Array(n);
  for (const r of rows) for (const i of [...r.a, ...r.b]) appearances[i]++;
  let topX = 0;
  keys.forEach((k, i) => { if (k.startsWith('p:') && appearances[i] >= 10) topX = Math.max(topX, Math.exp(theta[i])); });
  let scale = 1;
  if (topX > 0) {
    scale = TOP_PLAYER_SCALE / topX;
  } else {
    for (let off = 0; off <= 3; off++) {
      const i = index.get(`pk:${off}:1`);
      if (i !== undefined) { scale = priorValue(`pk:${off}:1`) / Math.exp(theta[i]); break; }
    }
  }
  const out = new Map<AssetKey, number>();
  keys.forEach((k, i) => out.set(k, Math.exp(theta[i]) * scale));
  // Assets in the priors that never appear in a trade are valued from their prior alone.
  for (const [k, p] of opts.priors ?? []) if (!index.has(k)) out.set(k, Math.exp(p) * scale);
  return out;
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
): { values: Map<AssetKey, number>; info: VorpPriorInfo | null; baseline: Map<AssetKey, number> } {
  const first = fitValues(trades, opts);
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
  if (X.length < 30) return { values: first, info: null, baseline: new Map() };

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

  const values = fitValues(trades, { ...opts, ridge: opts.ridge ?? 0.4, priors });

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
  return { values, baseline, info: { r2: ssTot > 0 ? 1 - ssRes / ssTot : 0, players: X.length, slope: beta[1], marketVsVorp } };
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
  vorp: VorpPriorInfo | null;      // how well recent VORP + age explain player values
  alpha: number;
  tiers: Record<FairTier, number>;
}

// Mean, not median: the prior values every player alike, so most 1-for-1 trades look perfectly even.
const mean = (xs: number[], ws?: number[]) => {
  if (xs.length === 0) return NaN;
  const w = ws ?? xs.map(() => 1);
  const total = w.reduce((a, b) => a + b, 0);
  return total > 0 ? xs.reduce((a, x, i) => a + x * w[i], 0) / total : NaN;
};

/**
 * Fit on everything, plus a 5-fold check on unseen trades. α stays 1 (plain sums): any other α only
 * re-labels the same ordering (sides compare identically via Σ v^α) while compressing the displayed
 * values and shrinking measured gaps, so it must not be tuned on the gap.
 */
export function fitAndReport(
  trades: FitTrade[], opts: FitOptions = {}, feats?: Map<AssetKey, PlayerFeature>,
): { values: Map<AssetKey, number>; baseline: Map<AssetKey, number>; report: FitReport } {
  const alpha = opts.alpha ?? 1;
  const o = { ...opts, alpha };
  const model = (tr: FitTrade[]) => (feats ? fitWithFeatures(tr, feats, o) : { values: fitValues(tr, o), info: null, baseline: new Map<AssetKey, number>() });
  const full = model(trades);
  const values = full.values;
  const scores = trades.map((t) => scoreTrade(t, values, false, alpha)!);
  const tiers: Record<FairTier, number> = { even: 0, close: 0, edge: 0, lop: 0 };
  for (const s of scores) tiers[s.tier]++;
  const priorGaps = trades.map((t) => scoreTrade(t, new Map(), true, 1)!.diffPct);

  let holdoutMeanGap: number | null = null;
  let holdoutCoverage: number | null = null;
  const FOLDS = 5;
  if (trades.length >= FOLDS * 20) {
    const gaps: number[] = [], gws: number[] = [];
    let tested = 0;
    for (let f = 0; f < FOLDS; f++) {
      const train = trades.filter((_, i) => i % FOLDS !== f);
      const test = trades.filter((_, i) => i % FOLDS === f);
      const vals = model(train).values;
      for (const t of test) {
        tested++;
        const s = scoreTrade(t, vals, false, alpha);
        if (s) { gaps.push(s.diffPct); gws.push(t.weight ?? 1); }
      }
    }
    holdoutMeanGap = mean(gaps, gws);
    holdoutCoverage = tested ? gaps.length / tested : null;
  }
  return {
    values,
    baseline: full.baseline,
    report: {
      trades: trades.length,
      assets: new Set(trades.flatMap((t) => [...t.a, ...t.b])).size,
      inSampleMeanGap: mean(scores.map((s) => s.diffPct), trades.map((t) => t.weight ?? 1)),
      priorMeanGap: mean(priorGaps, trades.map((t) => t.weight ?? 1)),
      holdoutMeanGap,
      holdoutCoverage,
      alpha,
      vorp: full.info,
      tiers,
    },
  };
}
