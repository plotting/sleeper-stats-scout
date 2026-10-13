import type { MatchupScoresView } from "@/types/database";

/** One regular-season game from a team's side, with where its score ranked among every team's scores that week. */
export interface TeamGame {
  teamId: number;
  teamName: string;
  seasonId: number;
  week: number;
  score: number;
  oppScore: number;
  oppId: number;
  oppName: string;
  /** 1 = highest score of the week; ties share the better rank. */
  rank: number;
  /** Teams that scored that week. */
  teams: number;
  won: boolean;
  lost: boolean;
  /** Lost with the highest score of all the teams that lost that week (Sleeper's "highest points in a loss"). */
  topLoser: boolean;
  /** Won with the lowest score of all the teams that won that week ("least points in a win"). */
  bottomWinner: boolean;
}

/** Every regular-season game for every team, from the official stored scores. Playoff and consolation weeks are excluded: not every team plays them, so a weekly rank means nothing there. */
export function allTeamGames(matchups: MatchupScoresView[]): TeamGame[] {
  const rows = matchups.filter((m) => !m.is_playoff && !m.is_consolation && m.week_number != null && m.season_id != null && m.home_score != null && m.away_score != null && m.home_team_id != null && m.away_team_id != null);
  const seen = new Set<string>();
  const unique: MatchupScoresView[] = [];
  const scoresByWeek = new Map<string, number[]>();
  const loserMax = new Map<string, number>();
  const winnerMin = new Map<string, number>();
  for (const m of rows) {
    const ids = [m.home_team_id!, m.away_team_id!].sort((a, b) => a - b);
    const key = `${m.season_id}-${m.week_number}-${ids[0]}-${ids[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(m);
    const wk = `${m.season_id}-${m.week_number}`;
    (scoresByWeek.get(wk) ?? scoresByWeek.set(wk, []).get(wk)!).push(m.home_score!, m.away_score!);
    if (m.home_score !== m.away_score) {
      const hi = Math.max(m.home_score!, m.away_score!), lo = Math.min(m.home_score!, m.away_score!);
      loserMax.set(wk, Math.max(loserMax.get(wk) ?? -Infinity, lo));
      winnerMin.set(wk, Math.min(winnerMin.get(wk) ?? Infinity, hi));
    }
  }
  const out: TeamGame[] = [];
  for (const m of unique) {
    const wk = `${m.season_id}-${m.week_number}`;
    const scores = scoresByWeek.get(wk)!;
    for (const side of [0, 1] as const) {
      const home = side === 0;
      const score = (home ? m.home_score : m.away_score)!;
      const oppScore = (home ? m.away_score : m.home_score)!;
      const won = score > oppScore, lost = score < oppScore;
      out.push({
        teamId: (home ? m.home_team_id : m.away_team_id)!, teamName: (home ? m.home_team_name : m.away_team_name) ?? "?",
        seasonId: m.season_id!, week: m.week_number!, score, oppScore,
        oppId: (home ? m.away_team_id : m.home_team_id)!, oppName: (home ? m.away_team_name : m.home_team_name) ?? "?",
        rank: 1 + scores.filter((s) => s > score).length, teams: scores.length, won, lost,
        topLoser: lost && score === loserMax.get(wk), bottomWinner: won && score === winnerMin.get(wk),
      });
    }
  }
  return out.sort((a, b) => a.seasonId - b.seasonId || a.week - b.week);
}

export function teamGames(matchups: MatchupScoresView[], teamId: number): TeamGame[] {
  return allTeamGames(matchups).filter((g) => g.teamId === teamId);
}

export interface LuckSummary {
  games: number;
  /** Most points in any single loss / fewest in any single win. */
  highestLoss: TeamGame | null;
  lowestWin: TeamGame | null;
  /** Every time the team was the highest-scoring loser of the week / the lowest-scoring winner of the week. */
  topLosses: TeamGame[];
  bottomWins: TeamGame[];
  /** Losses while 2nd or 3rd highest scorer of the week (the top scorer can never lose a head-to-head). */
  topScorerLosses: { second: number; third: number; total: number };
  /** Wins while 2nd or 3rd lowest scorer of the week (the lowest scorer can never win). */
  lowScorerWins: { secondLowest: number; thirdLowest: number; total: number };
}

export function luckSummary(games: TeamGame[]): LuckSummary {
  let highestLoss: TeamGame | null = null, lowestWin: TeamGame | null = null;
  const top = { second: 0, third: 0, total: 0 }, low = { secondLowest: 0, thirdLowest: 0, total: 0 };
  const topLosses: TeamGame[] = [], bottomWins: TeamGame[] = [];
  for (const g of games) {
    if (g.lost && (!highestLoss || g.score > highestLoss.score)) highestLoss = g;
    if (g.won && (!lowestWin || g.score < lowestWin.score)) lowestWin = g;
    if (g.topLoser) topLosses.push(g);
    if (g.bottomWinner) bottomWins.push(g);
    if (g.lost && g.rank === 2) { top.second++; top.total++; }
    if (g.lost && g.rank === 3) { top.third++; top.total++; }
    if (g.won && g.rank === g.teams - 1) { low.secondLowest++; low.total++; }
    if (g.won && g.rank === g.teams - 2) { low.thirdLowest++; low.total++; }
  }
  return { games: games.length, highestLoss, lowestWin, topLosses, bottomWins, topScorerLosses: top, lowScorerWins: low };
}

/** Per-team and per-team-season tallies of the luck counts, for the league record book. */
export interface LuckTally { teamId: number; teamName: string; seasonId: number | null; topLosses: number; bottomWins: number; topScorerLosses: number; lowScorerWins: number }

export function luckTallies(games: TeamGame[]): { career: LuckTally[]; seasons: LuckTally[] } {
  const career = new Map<number, LuckTally>(), seasons = new Map<string, LuckTally>();
  const bump = (g: TeamGame) => {
    const c = career.get(g.teamId) ?? { teamId: g.teamId, teamName: g.teamName, seasonId: null, topLosses: 0, bottomWins: 0, topScorerLosses: 0, lowScorerWins: 0 };
    const sk = `${g.teamId}-${g.seasonId}`;
    const s = seasons.get(sk) ?? { teamId: g.teamId, teamName: g.teamName, seasonId: g.seasonId, topLosses: 0, bottomWins: 0, topScorerLosses: 0, lowScorerWins: 0 };
    for (const t of [c, s]) {
      if (g.topLoser) t.topLosses++;
      if (g.bottomWinner) t.bottomWins++;
      if (g.lost && (g.rank === 2 || g.rank === 3)) t.topScorerLosses++;
      if (g.won && (g.rank === g.teams - 1 || g.rank === g.teams - 2)) t.lowScorerWins++;
    }
    career.set(g.teamId, c); seasons.set(sk, s);
  };
  games.forEach(bump);
  return { career: [...career.values()], seasons: [...seasons.values()] };
}
