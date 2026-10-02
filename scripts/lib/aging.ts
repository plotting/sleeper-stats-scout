// Value-by-age curve per position, from the fitted values: ln(value) = c + b1·a + b2·a², a = (age − 26) / 5.
// A cross-sectional picture (younger players are priced higher up to the peak, then value declines), used
// by the calculator to project a trade's value over the next few seasons.

import { olsWeighted } from './tradeFit';

export interface AgePoint { position: string; age: number; value: number; trades: number }
export interface AgeCurve { b1: number; b2: number }

export function fitAgeCurves(points: AgePoint[], minPlayers = 25): Map<string, AgeCurve> {
  const out = new Map<string, AgeCurve>();
  for (const pos of new Set(points.map((p) => p.position))) {
    const pts = points.filter((p) => p.position === pos && p.trades >= 5 && p.age >= 20 && p.age <= 38 && p.value > 0);
    if (pts.length < minPlayers) continue;
    const X = pts.map((p) => { const a = (p.age - 26) / 5; return [1, a, a * a]; });
    const beta = olsWeighted(X, pts.map((p) => Math.log(p.value)), pts.map((p) => Math.min(p.trades, 40)));
    out.set(pos, { b1: beta[1], b2: beta[2] });
  }
  return out;
}
