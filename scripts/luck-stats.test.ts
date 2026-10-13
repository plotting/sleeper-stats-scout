import test from 'node:test';
import assert from 'node:assert/strict';
import { luckSummary, teamGames } from '../src/utils/luckStats';
import type { MatchupScoresView } from '../src/types/database';

const g = (week: number, h: number, a: number, hs: number, as: number, season = 1) =>
  ({ season_id: season, week_number: week, is_playoff: false, is_consolation: false, home_team_id: h, away_team_id: a, home_score: hs, away_score: as }) as unknown as MatchupScoresView;

// Week 1 (6 teams): scores 150,140,130,120,110,100. Team 3 (130, 3rd highest) loses to team 2 (140... no, pair them so a 3rd-highest scorer loses)
// pairs: 1(150) v 4(120); 2(140) v 3(130); 5(110) v 6(100)
const week1 = [g(1, 1, 4, 150, 120), g(1, 2, 3, 140, 130), g(1, 5, 6, 110, 100)];
// Week 2: team 5 (2nd lowest of 6) wins: 5(105) v 6(90); 1(150) v 2(140); 3(130) v 4(125)
const week2 = [g(2, 5, 6, 105, 90), g(2, 1, 2, 150, 140), g(2, 3, 4, 130, 125)];
// a playoff game and a duplicate row must not count
const extra = [{ ...g(3, 1, 2, 999, 1), is_playoff: true } as MatchupScoresView, g(1, 4, 1, 120, 150)];

test('weekly rank of each score and the games each team played', () => {
  const t3 = teamGames([...week1, ...week2, ...extra], 3);
  assert.equal(t3.length, 2); // duplicate and playoff rows ignored
  assert.deepEqual(t3.map((x) => x.rank), [3, 3]); // 130 is third in week 1 (150,140,130,...) and in week 2 (150,140,130,...)
  assert.equal(t3[0].lost, true);
  assert.equal(t3[1].won, true);
});

test('luck summary: most points in a loss, fewest in a win, losses as 2nd/3rd scorer, wins as 2nd/3rd lowest', () => {
  const s = luckSummary(teamGames([...week1, ...week2], 3));
  assert.equal(s.highestLoss?.score, 130);
  assert.equal(s.lowestWin?.score, 130);
  assert.deepEqual(s.topScorerLosses, { second: 0, third: 1, total: 1 });
  const t5 = luckSummary(teamGames([...week1, ...week2], 5));
  // team 5 beats team 6 both weeks while 5th of 6 (2nd lowest) each time
  assert.deepEqual(t5.lowScorerWins, { secondLowest: 2, thirdLowest: 0, total: 2 });
  assert.equal(t5.highestLoss, null);
  assert.equal(t5.lowestWin?.score, 105);
  const t4 = luckSummary(teamGames([...week1, ...week2], 4)); // week 1: 120 loses as 4th of 6; week 2: 125 loses as 4th of 6
  assert.deepEqual(t4.topScorerLosses, { second: 0, third: 0, total: 0 });
  assert.equal(t4.highestLoss?.score, 125);
});
