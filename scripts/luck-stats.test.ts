import test from 'node:test';
import assert from 'node:assert/strict';
import { allTeamGames, luckSummary, luckTallies, teamGames } from '../src/utils/luckStats';
import type { MatchupScoresView } from '../src/types/database';

const g = (week: number, h: number, a: number, hs: number, as: number, season = 1) =>
  ({ season_id: season, week_number: week, is_playoff: false, is_consolation: false, home_team_id: h, away_team_id: a, home_team_name: `T${h}`, away_team_name: `T${a}`, home_score: hs, away_score: as }) as unknown as MatchupScoresView;

// Week 1 (6 teams): scores 150,140,130,120,110,100. pairs: 1(150) v 4(120); 2(140) v 3(130); 5(110) v 6(100)
const week1 = [g(1, 1, 4, 150, 120), g(1, 2, 3, 140, 130), g(1, 5, 6, 110, 100)];
// Week 2: 5(105) v 6(90); 1(150) v 2(140); 3(130) v 4(125)
const week2 = [g(2, 5, 6, 105, 90), g(2, 1, 2, 150, 140), g(2, 3, 4, 130, 125)];
const extra = [{ ...g(3, 1, 2, 999, 1), is_playoff: true } as MatchupScoresView, g(1, 4, 1, 120, 150)]; // a playoff game and a duplicate row

test('weekly rank of each score; playoff and duplicate rows ignored', () => {
  const t3 = teamGames([...week1, ...week2, ...extra], 3);
  assert.equal(t3.length, 2);
  assert.deepEqual(t3.map((x) => x.rank), [3, 3]);
  assert.equal(t3[0].lost, true);
  assert.equal(t3[1].won, true);
  assert.equal(t3[0].oppName, 'T2');
});

test('highest-scoring loser and lowest-scoring winner of each week', () => {
  const games = allTeamGames([...week1, ...week2]);
  // week 1 losers: 120, 130, 100 -> highest loser is team 3 (130); winners: 150, 140, 110 -> lowest winner is team 5 (110)
  assert.deepEqual(games.filter((x) => x.week === 1 && x.topLoser).map((x) => x.teamId), [3]);
  assert.deepEqual(games.filter((x) => x.week === 1 && x.bottomWinner).map((x) => x.teamId), [5]);
  // week 2 losers: 90, 140, 125 -> team 2 (140); winners: 105, 150, 130 -> team 5 (105)
  assert.deepEqual(games.filter((x) => x.week === 2 && x.topLoser).map((x) => x.teamId), [2]);
  assert.deepEqual(games.filter((x) => x.week === 2 && x.bottomWinner).map((x) => x.teamId), [5]);
});

test('luck summary lists every occurrence, not just the single best', () => {
  const all = [...week1, ...week2];
  const s5 = luckSummary(teamGames(all, 5));
  assert.equal(s5.bottomWins.length, 2); // lowest-scoring winner in both weeks
  assert.equal(s5.topLosses.length, 0);
  assert.deepEqual(s5.lowScorerWins, { secondLowest: 2, thirdLowest: 0, total: 2 }); // 5th of 6 each week
  assert.equal(s5.lowestWin?.score, 105);
  const s3 = luckSummary(teamGames(all, 3));
  assert.equal(s3.topLosses.length, 1);
  assert.deepEqual(s3.topScorerLosses, { second: 0, third: 1, total: 1 });
  const s2 = luckSummary(teamGames(all, 2));
  assert.equal(s2.topLosses.length, 1); // week 2: lost with 140, highest of the week's losers
  assert.deepEqual(s2.topScorerLosses, { second: 1, third: 0, total: 1 }); // 140 was 2nd highest in week 2
});

test('tallies per team (career) and per team-season', () => {
  const t = luckTallies(allTeamGames([...week1, ...week2, g(1, 1, 2, 100, 90, 2)]));
  const c5 = t.career.find((x) => x.teamId === 5)!;
  assert.equal(c5.bottomWins, 2);
  assert.ok(t.seasons.some((x) => x.teamId === 1 && x.seasonId === 2));
  assert.equal(t.seasons.find((x) => x.teamId === 5 && x.seasonId === 1)!.bottomWins, 2);
});
