import assert from 'node:assert/strict';
import { actualMatrix, hypotheticalMatrix, pairWeeks, rowTotal, standings } from '../src/utils/seasonH2h';
import type { MatchupScoresView } from '../src/types/database';

const g = (week: number, h: number, a: number, hs: number | null, as: number | null, extra: Partial<MatchupScoresView> = {}) =>
  ({ season_id: 1, week_number: week, is_playoff: false, is_consolation: false, home_team_id: h, away_team_id: a,
    home_team_name: `T${h}`, away_team_name: `T${a}`, home_score: hs, away_score: as, ...extra }) as unknown as MatchupScoresView;

// 4 teams, 2 weeks, plus a playoff game and an unplayed game
const rows = [
  g(1, 1, 2, 100, 90), g(1, 3, 4, 80, 120),
  g(2, 1, 3, 70, 110), g(2, 2, 4, 95, 99),
  g(3, 1, 2, 50, 40, { is_playoff: true }), g(3, 3, 4, null, null),
];
const ids = [1, 2, 3, 4];

// actual: regular season only by default, from each row team's side
const actual = actualMatrix(rows, ids);
assert.deepEqual(actual.get(1)!.get(2), { wins: 1, losses: 0, ties: 0, games: 1 });
assert.deepEqual(actual.get(2)!.get(1), { wins: 0, losses: 1, ties: 0, games: 1 });
assert.equal(actual.get(1)!.get(4)!.games, 0);
assert.equal(actualMatrix(rows, ids, 'all').get(1)!.get(2)!.games, 2);

// hypothetical: every week both scored, scores compared (team 1 vs 4: wk1 100 vs 120 L, wk2 70 vs 99 L)
const hyp = hypotheticalMatrix(rows, ids);
assert.deepEqual(hyp.get(1)!.get(4), { wins: 0, losses: 2, ties: 0, games: 2 });
assert.deepEqual(hyp.get(4)!.get(1), { wins: 2, losses: 0, ties: 0, games: 2 });
assert.deepEqual(hyp.get(1)!.get(2), { wins: 1, losses: 1, ties: 0, games: 2 }); // wk1 100>90, wk2 70<95
const t1 = rowTotal(hyp.get(1));
assert.equal(t1.games, 6); // 3 opponents x 2 weeks
// each pair is symmetric: my wins are their losses
for (const a of ids) for (const b of ids) if (a !== b) assert.equal(hyp.get(a)!.get(b)!.wins, hyp.get(b)!.get(a)!.losses);

// standings: wins then points for
const st = standings(rows, ids);
assert.deepEqual(st.map((s) => s.teamId), [4, 3, 1, 2]); // 2-0, then 1-1 by points for (190 vs 170), then 0-2
assert.equal(st[0].wins, 2); // team 4 beat 3 and 2

// pair detail marks the weeks they really met
const pw = pairWeeks(rows, 1, 2);
assert.deepEqual(pw.map((w) => [w.week, w.played]), [[1, true], [2, false]]);
assert.equal(pairWeeks(rows, 1, 99).length, 0);
console.log('season h2h: ok');
