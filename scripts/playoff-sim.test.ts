import assert from 'node:assert/strict';
import { runSim } from '../src/utils/playoffSimCore';
import { buildOddsInput, playoffPctFromSeeds } from '../src/utils/playoffSimModel';
import type { MatchupScoresView } from '../src/types/database';

const game = (week: number, h: number, a: number, hs: number | null, as: number | null) =>
  ({ season_id: 1, week_number: week, is_playoff: false, is_consolation: false, home_team_id: h, away_team_id: a,
    home_team_name: `T${h}`, away_team_name: `T${a}`, home_score: hs, away_score: as }) as unknown as MatchupScoresView;

const matchups = [game(1, 1, 2, 100, 90), game(1, 3, 4, 80, 120), game(2, 1, 3, 110, 100), game(2, 2, 4, 95, 99), game(3, 1, 4, 100, 100), game(3, 2, 3, 100, 100)];

// Scores after the as-of week are hidden, standings reflect only what was played
const w1 = buildOddsInput(matchups, matchups, [], 1, new Map())!;
assert.equal(w1.teams.find((t) => t.teamId === 1)!.wins, 1);
assert.equal(w1.teams.find((t) => t.teamId === 3)!.losses, 1);
assert.equal(w1.futureGames.length, 4);
// a roster-based projection replaces the team-level number for that week only
const proj = new Map([[2, new Map([[1, { mean: 200, std: 10, benchedByeCount: 0, streamedCount: 0 }]])]]);
const withProj = buildOddsInput(matchups, matchups, [], 1, proj)!;
assert.equal(withProj.futureGames.find((g) => g.week === 2 && g.homeId === 1)!.homeMean, 200);
assert.notEqual(withProj.futureGames.find((g) => g.week === 3 && g.homeId === 1)!.homeMean, 200);

// Playoff % for any bracket size is the sum of the first N seed chances from one run
const res = runSim({ teams: w1.simTeams, futureGames: w1.futureGames, numSims: 20000, bracketSize: 2 });
for (const r of res) {
  assert.ok(Math.abs(r.seedPct.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(Math.abs(playoffPctFromSeeds(r.seedPct, 2) - r.playoffPct) < 1e-9);
}
console.log('playoff sim: ok');
