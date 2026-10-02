// Best starting lineup for a roster: dedicated slots first, then flex slots (most restrictive first), always taking
// the highest-scoring eligible player left. Used by the calculator's league mode to show lineup impact.

const ELIGIBLE: Record<string, string[]> = {
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'],
  WRRB_FLEX: ['RB', 'WR'], REC_FLEX: ['WR', 'TE'], FLEX: ['RB', 'WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
};

/** Starting slots that hold skill players (bench, IR, taxi, K and DEF are ignored). */
export function starterSlots(rosterPositions: string[]): string[] {
  return rosterPositions.filter((p) => p in ELIGIBLE);
}

export interface RosterPlayer { id: string; position: string; score: number; name?: string }
export interface LineupSlot { slot: string; player: RosterPlayer | null }

export function bestLineup(players: RosterPlayer[], slots: string[]): LineupSlot[] {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const used = new Set<string>();
  const order = slots.map((slot, i) => ({ slot, i })).sort((a, b) => ELIGIBLE[a.slot].length - ELIGIBLE[b.slot].length || a.i - b.i);
  const out: LineupSlot[] = slots.map((slot) => ({ slot, player: null }));
  for (const { slot, i } of order) {
    const p = sorted.find((x) => !used.has(x.id) && ELIGIBLE[slot].includes(x.position));
    if (p) { used.add(p.id); out[i] = { slot, player: p }; }
  }
  return out;
}

export const lineupScore = (l: LineupSlot[]): number => l.reduce((s, x) => s + (x.player?.score ?? 0), 0);

/** Total starter score by position (what each position group contributes to the lineup). */
export function positionTotals(l: LineupSlot[]): Record<string, number> {
  const out: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const x of l) if (x.player) out[x.player.position] = (out[x.player.position] ?? 0) + x.player.score;
  return out;
}

/** 1 = strongest of the league for each position group. */
export function positionRanks(totalsByTeam: Map<number, Record<string, number>>, rosterId: number): Record<string, number> {
  const mine = totalsByTeam.get(rosterId);
  const out: Record<string, number> = {};
  if (!mine) return out;
  for (const pos of Object.keys(mine)) {
    let better = 0;
    for (const [id, t] of totalsByTeam) if (id !== rosterId && (t[pos] ?? 0) > mine[pos]) better++;
    out[pos] = better + 1;
  }
  return out;
}
