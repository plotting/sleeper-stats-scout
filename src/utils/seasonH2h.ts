// Season head-to-head matrices: the games two teams actually played each other (the playoff tie-break view), and what their
// records would be if every team played every other team every week (each week's scores compared head to head).

import type { MatchupScoresView } from '@/types/database';

export interface PairCell { wins: number; losses: number; ties: number; games: number }
export type H2HMatrix = Map<number, Map<number, PairCell>>;
export interface WeekScore { score: number; oppId: number; oppScore: number }
export interface Standing { teamId: number; wins: number; losses: number; ties: number; pf: number }
export interface PairWeek { week: number; aScore: number; bScore: number; played: boolean }

const emptyCell = (): PairCell => ({ wins: 0, losses: 0, ties: 0, games: 0 });

function addResult(cell: PairCell, mine: number, theirs: number) {
  cell.games++;
  if (mine > theirs) cell.wins++;
  else if (mine < theirs) cell.losses++;
  else cell.ties++;
}

function newMatrix(teamIds: number[]): H2HMatrix {
  const m: H2HMatrix = new Map();
  for (const a of teamIds) {
    const row = new Map<number, PairCell>();
    for (const b of teamIds) if (a !== b) row.set(b, emptyCell());
    m.set(a, row);
  }
  return m;
}

/** A scored game of the season. `playoffs` picks regular-season weeks only (default), playoff and consolation weeks only, or both. */
function scoredGames(rows: MatchupScoresView[], playoffs: 'regular' | 'playoffs' | 'all') {
  return rows.filter((m) => {
    if (m.home_team_id == null || m.away_team_id == null || m.home_score == null || m.away_score == null || m.week_number == null) return false;
    const post = !!(m.is_playoff || m.is_consolation);
    return playoffs === 'all' || (playoffs === 'playoffs' ? post : !post);
  });
}

/** Each team's score by week (with who it faced). */
export function weeklyScores(rows: MatchupScoresView[], playoffs: 'regular' | 'playoffs' | 'all' = 'regular'): Map<number, Map<number, WeekScore>> {
  const out = new Map<number, Map<number, WeekScore>>();
  const put = (team: number, week: number, score: number, oppId: number, oppScore: number) => {
    const byWeek = out.get(team) ?? new Map<number, WeekScore>();
    byWeek.set(week, { score, oppId, oppScore });
    out.set(team, byWeek);
  };
  for (const m of scoredGames(rows, playoffs)) {
    put(m.home_team_id!, m.week_number!, m.home_score!, m.away_team_id!, m.away_score!);
    put(m.away_team_id!, m.week_number!, m.away_score!, m.home_team_id!, m.home_score!);
  }
  return out;
}

/** What actually happened: each row team's record against each column team in the games they really played. */
export function actualMatrix(rows: MatchupScoresView[], teamIds: number[], playoffs: 'regular' | 'playoffs' | 'all' = 'regular'): H2HMatrix {
  const m = newMatrix(teamIds);
  for (const g of scoredGames(rows, playoffs)) {
    const h = g.home_team_id!, a = g.away_team_id!;
    const hc = m.get(h)?.get(a), ac = m.get(a)?.get(h);
    if (hc) addResult(hc, g.home_score!, g.away_score!);
    if (ac) addResult(ac, g.away_score!, g.home_score!);
  }
  return m;
}

/** If every team played every other team every week: each week where both scored, compare the two scores. */
export function hypotheticalMatrix(rows: MatchupScoresView[], teamIds: number[], playoffs: 'regular' | 'playoffs' | 'all' = 'regular'): H2HMatrix {
  const scores = weeklyScores(rows, playoffs);
  const m = newMatrix(teamIds);
  for (const a of teamIds) for (const b of teamIds) {
    if (a === b) continue;
    const sa = scores.get(a), sb = scores.get(b);
    if (!sa || !sb) continue;
    for (const [week, mine] of sa) {
      const theirs = sb.get(week);
      if (theirs) addResult(m.get(a)!.get(b)!, mine.score, theirs.score);
    }
  }
  return m;
}

/** Actual standings for the games counted (wins, then points for). */
export function standings(rows: MatchupScoresView[], teamIds: number[], playoffs: 'regular' | 'playoffs' | 'all' = 'regular'): Standing[] {
  const s = new Map<number, Standing>(teamIds.map((id) => [id, { teamId: id, wins: 0, losses: 0, ties: 0, pf: 0 }]));
  for (const g of scoredGames(rows, playoffs)) {
    const h = s.get(g.home_team_id!), a = s.get(g.away_team_id!);
    if (h) { h.pf += g.home_score!; if (g.home_score! > g.away_score!) h.wins++; else if (g.home_score! < g.away_score!) h.losses++; else h.ties++; }
    if (a) { a.pf += g.away_score!; if (g.away_score! > g.home_score!) a.wins++; else if (g.away_score! < g.home_score!) a.losses++; else a.ties++; }
  }
  return [...s.values()].sort((x, y) => (y.wins + y.ties * 0.5) - (x.wins + x.ties * 0.5) || y.pf - x.pf);
}

/** Every week where both teams scored, with whether the two actually faced each other that week. */
export function pairWeeks(rows: MatchupScoresView[], a: number, b: number, playoffs: 'regular' | 'playoffs' | 'all' = 'regular'): PairWeek[] {
  const scores = weeklyScores(rows, playoffs);
  const sa = scores.get(a), sb = scores.get(b);
  if (!sa || !sb) return [];
  const out: PairWeek[] = [];
  for (const [week, mine] of sa) {
    const theirs = sb.get(week);
    if (theirs) out.push({ week, aScore: mine.score, bScore: theirs.score, played: mine.oppId === b });
  }
  return out.sort((x, y) => x.week - y.week);
}

/** Sum of a row of the matrix. */
export function rowTotal(row: Map<number, PairCell> | undefined): PairCell {
  const t = emptyCell();
  for (const c of row?.values() ?? []) { t.wins += c.wins; t.losses += c.losses; t.ties += c.ties; t.games += c.games; }
  return t;
}
