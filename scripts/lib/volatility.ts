// How much a player's value tends to move from one season to the next, by position and age group, from how
// production (annual VORP) actually changed for players of that age in past seasons. Value follows
// ln(1 + VORP) with slope β from the VORP regression, so a change Δ in ln(1 + VORP) moves ln(value) by β·Δ.

export interface SeasonPair { position: string; age: number; delta: number } // delta = ln(1 + VORP next season) − ln(1 + VORP this season)
export interface Outcome { p10: number; p50: number; p90: number; up: number; down: number; n: number } // changes in ln(value); up/down are odds

export const AGE_BUCKETS = ['young', 'prime', 'vet'] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];
export const ageBucket = (age: number): AgeBucket => (age <= 24 ? 'young' : age <= 28 ? 'prime' : 'vet');

const quantile = (sorted: number[], q: number) => {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

/** Next-season value change distribution per `${position}:${bucket}`; buckets with fewer than `minPairs` pairs are skipped. */
export function outcomeBuckets(pairs: SeasonPair[], slope: number, minPairs = 60): Map<string, Outcome> {
  const groups = new Map<string, number[]>();
  for (const p of pairs) {
    const k = `${p.position}:${ageBucket(p.age)}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(p.delta * slope);
  }
  const out = new Map<string, Outcome>();
  for (const [k, xs] of groups) {
    if (xs.length < minPairs) continue;
    const s = [...xs].sort((a, b) => a - b);
    out.set(k, {
      p10: quantile(s, 0.1), p50: quantile(s, 0.5), p90: quantile(s, 0.9),
      up: s.filter((x) => x >= Math.log(1.1)).length / s.length,      // value up 10% or more
      down: s.filter((x) => x <= Math.log(0.85)).length / s.length,   // value down 15% or more
      n: s.length,
    });
  }
  return out;
}
