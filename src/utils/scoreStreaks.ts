// Best and worst runs of consecutive weeks for a team: the highest or lowest total over N straight games.

import type { MatchupScoresView } from '@/types/database';

export interface RunGame { week: number; score: number; oppScore: number; oppName: string; won: boolean | null }
export interface StreakRun {
  teamId: number;
  teamName: string;
  seasonId: number;
  startWeek: number;
  endWeek: number;
  games: RunGame[];
  total: number;
  avg: number;
}

export interface RunOptions {
  order: 'high' | 'low';
  /** only this team */
  teamId?: number;
  /** only this season (DB season id) */
  seasonId?: number;
  /** playoff and consolation games count too; off = regular season only */
  includePlayoffs?: boolean;
  /** how many runs to return (default 10) */
  limit?: number;
}

/** Runs of `n` consecutive weeks within one season. A week with no score breaks the run. A team's runs never overlap
 *  (its best is taken first), so one hot month can't fill the whole table. */
export function findRuns(rows: MatchupScoresView[], n: number, opts: RunOptions): StreakRun[] {
  const { order, teamId, seasonId, includePlayoffs = false, limit = 10 } = opts;
  if (n < 1) return [];
  const bySeasonTeam = new Map<string, { teamId: number; teamName: string; seasonId: number; games: RunGame[] }>();
  const add = (sid: number, tid: number | null, name: string | null, score: number | null, opp: number | null, oppName: string | null, week: number) => {
    if (tid == null || score == null || opp == null) return;
    const key = `${sid}-${tid}`;
    const e = bySeasonTeam.get(key) ?? { teamId: tid, teamName: name ?? `Team ${tid}`, seasonId: sid, games: [] };
    e.games.push({ week, score, oppScore: opp, oppName: oppName ?? 'Opponent', won: score > opp ? true : score < opp ? false : null });
    bySeasonTeam.set(key, e);
  };
  for (const m of rows) {
    if (m.season_id == null || m.week_number == null) continue;
    if (seasonId != null && m.season_id !== seasonId) continue;
    if (!includePlayoffs && (m.is_playoff || m.is_consolation)) continue;
    add(m.season_id, m.home_team_id, m.home_team_name, m.home_score, m.away_score, m.away_team_name, m.week_number);
    add(m.season_id, m.away_team_id, m.away_team_name, m.away_score, m.home_score, m.home_team_name, m.week_number);
  }

  const candidates: StreakRun[] = [];
  for (const e of bySeasonTeam.values()) {
    if (teamId != null && e.teamId !== teamId) continue;
    const games = e.games.sort((a, b) => a.week - b.week);
    const all: StreakRun[] = [];
    for (let i = 0; i + n <= games.length; i++) {
      const w = games.slice(i, i + n);
      if (w[n - 1].week - w[0].week !== n - 1) continue; // a missing week breaks the run
      const total = w.reduce((s, g) => s + g.score, 0);
      all.push({ teamId: e.teamId, teamName: e.teamName, seasonId: e.seasonId, startWeek: w[0].week, endWeek: w[n - 1].week, games: w, total, avg: total / n });
    }
    all.sort((a, b) => (order === 'high' ? b.total - a.total : a.total - b.total) || a.startWeek - b.startWeek);
    const taken: StreakRun[] = [];
    for (const r of all) if (taken.every((t) => r.startWeek > t.endWeek || r.endWeek < t.startWeek)) taken.push(r);
    candidates.push(...taken);
  }
  candidates.sort((a, b) => (order === 'high' ? b.total - a.total : a.total - b.total) || a.seasonId - b.seasonId || a.startWeek - b.startWeek);
  return candidates.slice(0, limit);
}
