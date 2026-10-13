import type { MatchupScoresView } from "@/types/database";

/** One regular-season game from a team's side, with where its score ranked among every team's scores that week. */
export interface TeamGame {
  seasonId: number;
  week: number;
  score: number;
  oppScore: number;
  oppId: number;
  /** 1 = highest score of the week; ties share the better rank. */
  rank: number;
  /** Teams that scored that week. */
  teams: number;
  won: boolean;
  lost: boolean;
}

/** Every regular-season game for `teamId` (playoff and consolation weeks excluded: not every team plays them, so a weekly rank means nothing). */
export function teamGames(matchups: MatchupScoresView[], teamId: number): TeamGame[] {
  const rows = matchups.filter((m) => !m.is_playoff && !m.is_consolation && m.week_number != null && m.season_id != null && m.home_score != null && m.away_score != null && m.home_team_id != null && m.away_team_id != null);
  // each game appears once per week; collect the scores of the week to rank against
  const byWeek = new Map<string, number[]>();
  const seen = new Set<string>();
  const unique: MatchupScoresView[] = [];
  for (const m of rows) {
    const ids = [m.home_team_id!, m.away_team_id!].sort((a, b) => a - b);
    const key = `${m.season_id}-${m.week_number}-${ids[0]}-${ids[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(m);
    const wk = `${m.season_id}-${m.week_number}`;
    (byWeek.get(wk) ?? byWeek.set(wk, []).get(wk)!).push(m.home_score!, m.away_score!);
  }
  const out: TeamGame[] = [];
  for (const m of unique) {
    const home = m.home_team_id === teamId, away = m.away_team_id === teamId;
    if (!home && !away) continue;
    const score = (home ? m.home_score : m.away_score)!;
    const oppScore = (home ? m.away_score : m.home_score)!;
    const scores = byWeek.get(`${m.season_id}-${m.week_number}`)!;
    out.push({
      seasonId: m.season_id!, week: m.week_number!, score, oppScore, oppId: (home ? m.away_team_id : m.home_team_id)!,
      rank: 1 + scores.filter((s) => s > score).length, teams: scores.length, won: score > oppScore, lost: score < oppScore,
    });
  }
  return out.sort((a, b) => a.seasonId - b.seasonId || a.week - b.week);
}

export interface LuckSummary {
  games: number;
  /** Most points scored in a loss / fewest in a win. */
  highestLoss: TeamGame | null;
  lowestWin: TeamGame | null;
  /** Losses while 2nd or 3rd highest scorer of the week (the top scorer can never lose a head-to-head). */
  topScorerLosses: { second: number; third: number; total: number };
  /** Wins while 2nd or 3rd lowest scorer of the week (the lowest scorer can never win). */
  lowScorerWins: { secondLowest: number; thirdLowest: number; total: number };
}

export function luckSummary(games: TeamGame[]): LuckSummary {
  let highestLoss: TeamGame | null = null, lowestWin: TeamGame | null = null;
  const top = { second: 0, third: 0, total: 0 }, low = { secondLowest: 0, thirdLowest: 0, total: 0 };
  for (const g of games) {
    if (g.lost && (!highestLoss || g.score > highestLoss.score)) highestLoss = g;
    if (g.won && (!lowestWin || g.score < lowestWin.score)) lowestWin = g;
    if (g.lost && g.rank === 2) { top.second++; top.total++; }
    if (g.lost && g.rank === 3) { top.third++; top.total++; }
    if (g.won && g.rank === g.teams - 1) { low.secondLowest++; low.total++; }
    if (g.won && g.rank === g.teams - 2) { low.thirdLowest++; low.total++; }
  }
  return { games: games.length, highestLoss, lowestWin, topScorerLosses: top, lowScorerWins: low };
}
