import type { MatchupScoresView } from "@/types/database";
import type { TeamWeekProjection } from "@/services/playerProjections";

// The playoff-odds model, shared by the page (which only displays saved snapshots) and the scheduled job that
// computes them (scripts/sim-playoff-odds.ts). Pure functions only.

/** Standard deviation of an array */
export function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((sum, x) => sum + (x - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

export function avg(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** Abramowitz & Stegun approximation for standard normal CDF */
export function normalCDF(z: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/** P(team1 beats team2) using normal CDF given projected means and std devs */
export function matchupWinProb(m1: number, s1: number, m2: number, s2: number): number {
  const denom = Math.sqrt(s1 ** 2 + s2 ** 2);
  return denom > 0 ? normalCDF((m1 - m2) / denom) : 0.5;
}

export interface TeamWeekStat {
  mean: number;
  std: number;
  /** True when this came from real rosters + Sleeper's weekly projections
   *  (bye-aware), false when falling back to the season-long team model. */
  playerLevel: boolean;
}

/** A specific team's projected mean/std for one future week — prefers the
 *  bye-aware, roster-based projection for that week when available, and
 *  otherwise falls back to the season-long team-level model with std
 *  widened by how far out the week is (forecast confidence decays with
 *  distance, so a repeat pairing further out isn't as predictable). */
export function getEffectiveTeamWeekStat(
  weekProjections: Map<number, Map<number, TeamWeekProjection> | null>,
  teamId: number,
  week: number,
  nearestWeek: number,
  fallbackMean: number,
  fallbackStd: number,
): TeamWeekStat {
  const wp = weekProjections.get(week)?.get(teamId);
  if (wp) return { mean: wp.mean, std: Math.max(wp.std, 4), playerLevel: true };
  const horizonMul = Math.sqrt(1 + 0.08 * Math.max(week - nearestWeek, 0));
  return { mean: fallbackMean, std: fallbackStd * horizonMul, playerLevel: false };
}

export interface SimTeam {
  teamId: number;
  teamName: string;
  projMean: number;
  projStd: number;
  wins: number;
  losses: number;
  ties: number;
  pf: number;
  gamesPlayed: number;
}

export interface FutureGame {
  homeId: number;
  awayId: number;
  week: number;
}

export function computeSimTeams(
  currentMatchups: MatchupScoresView[],
  allMatchups: MatchupScoresView[],
  sortedHistSeasonIds: number[], // DB season IDs sorted newest→oldest (excluding current)
): SimTeam[] {
  const currentSeasonId = currentMatchups[0]?.season_id;

  // Current season actual scores per team
  const currData = new Map<number, { name: string; scores: number[]; wins: number; losses: number; ties: number; pf: number }>();

  for (const m of currentMatchups) {
    if (m.is_playoff || m.is_consolation || m.home_score == null || m.away_score == null) continue;
    const addTeam = (tid: number | null, name: string | null, score: number, opp: number) => {
      if (!tid || !name) return;
      if (!currData.has(tid)) currData.set(tid, { name, scores: [], wins: 0, losses: 0, ties: 0, pf: 0 });
      const d = currData.get(tid)!;
      d.scores.push(score); d.pf += score;
      if (score > opp) d.wins++;
      else if (score < opp) d.losses++;
      else d.ties++;
    };
    addTeam(m.home_team_id, m.home_team_name, m.home_score, m.away_score);
    addTeam(m.away_team_id, m.away_team_name, m.away_score, m.home_score);
  }
  // Ensure all teams from future matchups are present
  for (const m of currentMatchups) {
    if (m.home_team_id && m.home_team_name && !currData.has(m.home_team_id))
      currData.set(m.home_team_id, { name: m.home_team_name, scores: [], wins: 0, losses: 0, ties: 0, pf: 0 });
    if (m.away_team_id && m.away_team_name && !currData.has(m.away_team_id))
      currData.set(m.away_team_id, { name: m.away_team_name, scores: [], wins: 0, losses: 0, ties: 0, pf: 0 });
  }

  // Historical scores per team per season
  const histByTeamSeason = new Map<number, Map<number, number[]>>();
  for (const m of allMatchups) {
    if (m.season_id === currentSeasonId || m.is_playoff || m.is_consolation) continue;
    if (m.home_score == null || m.away_score == null) continue;
    const addHist = (tid: number | null, score: number, sid: number | null) => {
      if (!tid || !sid) return;
      if (!histByTeamSeason.has(tid)) histByTeamSeason.set(tid, new Map());
      const bySeason = histByTeamSeason.get(tid)!;
      if (!bySeason.has(sid)) bySeason.set(sid, []);
      bySeason.get(sid)!.push(score);
    };
    addHist(m.home_team_id, m.home_score, m.season_id);
    addHist(m.away_team_id, m.away_score, m.season_id);
  }

  // League baseline from all historical scores
  const allHistFlat: number[] = [];
  for (const [, bySeason] of histByTeamSeason) {
    for (const [, scores] of bySeason) allHistFlat.push(...scores);
  }
  const leagueAvg = allHistFlat.length > 0 ? avg(allHistFlat) : 120;
  const leagueStd = allHistFlat.length >= 2 ? stdDev(allHistFlat) : 25;

  return [...currData.entries()].map(([tid, curr]) => {
    const gp = curr.scores.length;
    const currPPG = gp > 0 ? avg(curr.scores) : leagueAvg;
    const currStdDev = gp >= 3 ? stdDev(curr.scores) : leagueStd;

    // Weighted historical mean + std dev (recency: most recent prior season → highest weight)
    const byS = histByTeamSeason.get(tid) ?? new Map<number, number[]>();
    let histMeanW = 0, histStdW = 0, totalW = 0;
    for (const [sid, scores] of byS) {
      const rank = sortedHistSeasonIds.indexOf(sid); // 0 = most recent prior season
      const w = rank === 0 ? 4 : rank === 1 ? 2.5 : rank === 2 ? 1.5 : 0.8;
      histMeanW += avg(scores) * w;
      histStdW += (scores.length >= 2 ? stdDev(scores) : leagueStd) * w;
      totalW += w;
    }
    const histMean = totalW > 0 ? histMeanW / totalW : leagueAvg;
    const histStd = totalW > 0 ? histStdW / totalW : leagueStd;

    // Blend: grows from all-historical (0 games) to 60% current (full season)
    const wCurr = Math.min(gp / 14, 1) * 0.6;
    const projMean = gp === 0 ? histMean : wCurr * currPPG + (1 - wCurr) * histMean;
    const projStd = gp >= 3 ? 0.45 * currStdDev + 0.55 * histStd : histStd;

    return {
      teamId: tid, teamName: curr.name,
      projMean, projStd: Math.max(projStd, 8),
      wins: curr.wins, losses: curr.losses, ties: curr.ties,
      pf: curr.pf, gamesPlayed: gp,
    };
  });
}

export function getFutureGames(
  currentMatchups: MatchupScoresView[],
  teams: SimTeam[],
  totalRegularWeeks = 14,
): FutureGame[] {
  // First try: null-score games already in the view
  const fromView = currentMatchups
    .filter((m) => !m.is_playoff && !m.is_consolation && m.home_score == null && m.away_score == null && m.home_team_id && m.away_team_id)
    .map((m) => ({ homeId: m.home_team_id!, awayId: m.away_team_id!, week: m.week_number! }));
  if (fromView.length > 0) return fromView;

  // Fallback: derive remaining weeks from avg games played
  if (teams.length === 0) return [];
  const avgGP = teams.reduce((s, t) => s + t.gamesPlayed, 0) / teams.length;
  const completedWeeks = Math.round(avgGP);
  if (completedWeeks >= totalRegularWeeks) return [];

  const teamIds = teams.map((t) => t.teamId);
  const games: FutureGame[] = [];
  for (let w = completedWeeks + 1; w <= totalRegularWeeks; w++) {
    const shuffled = [...teamIds].sort(() => Math.random() - 0.5);
    for (let i = 0; i + 1 < shuffled.length; i += 2) {
      games.push({ homeId: shuffled[i], awayId: shuffled[i + 1], week: w });
    }
  }
  return games;
}


/** Masks out regular-season scores after `asOfWeek`, so the simulation can be
 *  re-run as if only weeks up to that point were known — the basis for the
 *  "as of week" look-back selector. Keeps every row (including future weeks)
 *  so schedule pairings stay intact; only the scores are hidden. */
export function truncateMatchupsAsOf(matchups: MatchupScoresView[], asOfWeek: number): MatchupScoresView[] {
  return matchups.map((m) =>
    !m.is_playoff && !m.is_consolation && (m.week_number ?? 0) > asOfWeek
      ? { ...m, home_score: null, away_score: null }
      : m,
  );
}

/** Everything the Monte Carlo needs for the odds "as of" a given week: standings from the games played through
 *  `asOfWeek` (later scores hidden), and a mean/std for every game still to play. `projections` are the
 *  roster-based weekly projections (injury- and bye-aware) for weeks that were still ahead; weeks without one fall back
 *  to the team-level model. Returns null when no games remain (the season is settled). */
export function buildOddsInput(
  matchups: MatchupScoresView[],
  allMatchups: MatchupScoresView[],
  sortedHistSeasonIds: number[],
  asOfWeek: number,
  projections: Map<number, Map<number, TeamWeekProjection> | null>,
) {
  const truncated = truncateMatchupsAsOf(matchups, asOfWeek);
  const teams = computeSimTeams(truncated, allMatchups, sortedHistSeasonIds);
  const games = getFutureGames(truncated, teams);
  if (games.length === 0) return null;
  const byId = new Map(teams.map((t) => [t.teamId, t]));
  const nearest = Math.min(...games.map((g) => g.week));
  const futureGames = games.map((g) => {
    const home = byId.get(g.homeId);
    const away = byId.get(g.awayId);
    const h = getEffectiveTeamWeekStat(projections, g.homeId, g.week, nearest, home?.projMean ?? 0, home?.projStd ?? 20);
    const a = getEffectiveTeamWeekStat(projections, g.awayId, g.week, nearest, away?.projMean ?? 0, away?.projStd ?? 20);
    return { homeId: g.homeId, awayId: g.awayId, week: g.week, homeMean: h.mean, homeStd: h.std, awayMean: a.mean, awayStd: a.std };
  });
  return {
    teams,
    futureGames,
    simTeams: teams.map((t) => ({ teamId: t.teamId, wins: t.wins, losses: t.losses, ties: t.ties, pf: t.pf })),
  };
}

/** Old syncs stored the same game twice (home/away swapped) — without this,
 *  every count that touches raw matchup rows silently double-counts. */
export function dedupeMatchups(rows: MatchupScoresView[]): MatchupScoresView[] {
  const seen = new Set<string>();
  return rows.filter((m) => {
    const ids = [m.home_team_id ?? 0, m.away_team_id ?? 0].sort((a, b) => a - b);
    const key = `${m.season_id}-${m.week_number}-${ids[0]}-${ids[1]}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Playoff odds for every bracket size from one run: the chance of finishing in the top N is the sum of the first N seed chances. */
export function playoffPctFromSeeds(seedPct: number[], bracketSize: number): number {
  return seedPct.slice(0, bracketSize).reduce((a, b) => a + b, 0);
}
