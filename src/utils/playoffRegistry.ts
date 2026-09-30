import { bracketByes, bracketTeams, computePlacements, type PlayoffConfig } from './playoffBracket';

// Synchronous lookup of each season's synced playoff structure. Filled once at
// app start (see PlayoffConfigProvider) so league-format questions ("how many
// teams make the playoffs?", "which week do they start?") can be answered
// anywhere without threading a query through every component.

const configs = new Map<number, PlayoffConfig>();
const placements = new Map<number, Map<number, number>>();

export function setPlayoffConfigs(rows: PlayoffConfig[]) {
  configs.clear();
  placements.clear();
  for (const row of rows) {
    configs.set(row.season_id, row);
    placements.set(row.season_id, computePlacements(row.winners ?? [], row.losers ?? []));
  }
}

export const getPlayoffConfig = (seasonId: number) => configs.get(seasonId);

/** Teams in the playoff bracket (falls back to the stored setting, then 4). */
export function getPlayoffBracketSize(seasonId: number, fallback = 4): number {
  const c = configs.get(seasonId);
  if (!c) return fallback;
  const inBracket = bracketTeams(c.winners ?? []).size;
  return inBracket || c.playoff_teams || fallback;
}

export function getPlayoffStartWeek(seasonId: number, fallback = 15): number {
  return configs.get(seasonId)?.playoff_week_start || fallback;
}

/** Final places decided by the synced bracket, or undefined if not synced. */
export function getBracketPlacements(seasonId: number): Map<number, number> | undefined {
  const p = placements.get(seasonId);
  return p && p.size > 0 ? p : undefined;
}

export function getByeTeams(seasonId: number): Set<number> {
  const c = configs.get(seasonId);
  return c ? bracketByes(c.winners ?? []) : new Set();
}
