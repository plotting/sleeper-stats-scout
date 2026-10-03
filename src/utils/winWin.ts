import { findOffers, type CalcAsset, type Depth, type Offer } from "./marketCalc";

export interface FinderTeam { rosterId: number; name: string; assets: CalcAsset[] }
export type LineupDelta = (partnerRosterId: number, receive: CalcAsset[], send: CalcAsset[]) => { you: number; them: number } | null;
export interface WinWinTrade { team: FinderTeam; receive: CalcAsset[]; send: CalcAsset[]; offer: Offer; d: { you: number; them: number } }

/**
 * Trades that help both lineups without being lopsided on value: for each leaguemate, value-matched packages for each of
 * your best assets (sell) and for each of their best assets (buy), kept only when both teams' best starting lineups improve.
 * Ranked by the smaller of the two gains, so the trade the other side is most likely to accept comes first.
 */
export function findWinWin(
  you: FinderTeam, others: FinderTeam[], depth: Depth, delta: LineupDelta,
  opts: { tol?: number; minValue?: number; top?: number; limit?: number; minGain?: number } = {},
): WinWinTrade[] {
  const { tol = 0.1, minValue = 600, top = 12, limit = 10, minGain = 0.5 } = opts;
  const best = (xs: CalcAsset[]) => xs.filter((a) => a.value >= minValue).slice(0, top);
  const out: WinWinTrade[] = [];
  const seen = new Set<string>();
  const add = (team: FinderTeam, receive: CalcAsset[], send: CalcAsset[], offer: Offer) => {
    const sig = `${team.rosterId}|${receive.map((a) => a.key).sort().join()}|${send.map((a) => a.key).sort().join()}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    const d = delta(team.rosterId, receive, send);
    if (d && d.you >= minGain && d.them >= minGain) out.push({ team, receive, send, offer, d });
  };
  for (const team of others) {
    for (const mine of best(you.assets)) for (const o of findOffers(mine.value, team.assets, depth, tol, 2)) add(team, o.assets, [mine], o);
    for (const theirs of best(team.assets)) for (const o of findOffers(theirs.value, you.assets, depth, tol, 2)) add(team, [theirs], o.assets, o);
  }
  return out.sort((a, b) => Math.min(b.d.you, b.d.them) - Math.min(a.d.you, a.d.them)).slice(0, limit);
}
