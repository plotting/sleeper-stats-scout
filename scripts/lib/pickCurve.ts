// Pick value from outcomes: how much VORP rookie picks in each round and slot tier actually
// produced over their first five seasons in this league's own drafts. The article most dynasty
// pick charts lean on makes the same point: value depends heavily on where in the round a pick falls.

export interface DraftedPick { round: number; slot: number; annualVorp: number } // slot = 1..teams within the round

/** Tiers for a 10-team round: early (1-3), mid (4-6), late (7-10). */
export const PICK_TIERS = [
  { key: 'early', slots: [1, 2, 3] },
  { key: 'mid', slots: [4, 5, 6] },
  { key: 'late', slots: [7, 8, 9, 10] },
] as const;
export type PickTier = (typeof PICK_TIERS)[number]['key'];

/** Mean annual VORP per `${round}:${tier}` and `${round}:any` (zeros count: a pick that never played is a miss). */
export function tierExpectations(picks: DraftedPick[]): Map<string, { annualVorp: number; n: number }> {
  const acc = new Map<string, { sum: number; n: number }>();
  const add = (key: string, v: number) => { const e = acc.get(key) ?? { sum: 0, n: 0 }; e.sum += v; e.n++; acc.set(key, e); };
  for (const p of picks) {
    add(`${p.round}:any`, p.annualVorp);
    add(`${p.round}:s${p.slot}`, p.annualVorp); // single slot, for the shape of the curve
    const tier = PICK_TIERS.find((t) => (t.slots as readonly number[]).includes(p.slot));
    if (tier) add(`${p.round}:${tier.key}`, p.annualVorp);
  }
  return new Map([...acc].map(([k, e]) => [k, { annualVorp: e.sum / e.n, n: e.n }]));
}
