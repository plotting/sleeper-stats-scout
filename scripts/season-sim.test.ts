import assert from 'node:assert/strict';
import { simulateSeason, sampleSeason, gameKey } from '../src/utils/seasonSim';
import { findRuns } from '../src/utils/scoreStreaks';
import type { MatchupScoresView } from '../src/types/database';

function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const teams = [1, 2, 3, 4].map((id) => ({ teamId: id, wins: 0, losses: 0, ties: 0, pf: 0 }));
const mk = (week: number, homeId: number, awayId: number, hm: number, am: number) => ({ week, homeId, awayId, homeMean: hm, homeStd: 20, awayMean: am, awayStd: 20 });
const games = [mk(1, 1, 2, 150, 90), mk(1, 3, 4, 100, 100), mk(2, 1, 3, 150, 100), mk(2, 2, 4, 90, 100), mk(3, 1, 4, 150, 100), mk(3, 2, 3, 90, 100)];

// the strong team wins nearly everything; seed and wins distributions are proper probabilities
const out = simulateSeason({ teams, games, numSims: 20000, bracketSize: 2, rng: mulberry32(7) });
const t1 = out.find((o) => o.teamId === 1)!;
assert.ok(t1.avgWins > 2.5 && t1.winsMode === 3);
assert.ok(t1.winsLow <= t1.winsMode && t1.winsMode <= t1.winsHigh);
for (const o of out) assert.ok(Math.abs(o.seedPct.reduce((a, b) => a + b, 0) - 1) < 1e-9);
assert.ok(Math.abs(out.reduce((s, o) => s + o.avgWins, 0) - games.length) < 1e-9); // every game gives out exactly one win

// locking a game to a result fixes it
const locks = new Map([[gameKey(games[0]), 'away' as const]]);
const locked = simulateSeason({ teams, games, locks, numSims: 20000, bracketSize: 2, rng: mulberry32(7) });
const l2 = locked.find((o) => o.teamId === 2)!;
assert.ok(l2.avgWins >= 1 && Math.abs(locked.reduce((s, o) => s + o.avgWins, 0) - games.length) < 1e-9);
assert.ok(locked.find((o) => o.teamId === 1)!.avgWins < t1.avgWins);

// one sampled season honours locks, plays every game once and ranks by wins
const one = sampleSeason({ teams, games, locks, rng: mulberry32(3) });
assert.equal(one.games.length, games.length);
const g0 = one.games.find((g) => g.key === gameKey(games[0]))!;
assert.ok(g0.locked && g0.awayScore > g0.homeScore);
assert.equal(one.standings.reduce((s, r) => s + r.wins + r.losses + r.ties, 0), games.length * 2);

// scoring streaks
const row = (season: number, week: number, h: number, a: number, hs: number | null, as: number | null, extra: Partial<MatchupScoresView> = {}) =>
  ({ season_id: season, week_number: week, is_playoff: false, is_consolation: false, home_team_id: h, away_team_id: a,
    home_team_name: `T${h}`, away_team_name: `T${a}`, home_score: hs, away_score: as, ...extra }) as unknown as MatchupScoresView;
const rows = [
  row(1, 1, 1, 2, 100, 50), row(1, 2, 1, 2, 200, 60), row(1, 3, 1, 2, 190, 70), row(1, 4, 1, 2, 80, 90), row(1, 5, 1, 2, 70, 60),
  row(1, 6, 1, 2, 300, 10, { is_playoff: true }),
];
const hi2 = findRuns(rows, 2, { order: 'high', teamId: 1 });
assert.equal(hi2[0].total, 390); assert.equal(hi2[0].startWeek, 2);
assert.ok(hi2.every((r) => r.endWeek <= 5)); // regular season only by default
assert.ok(hi2.slice(1).every((r) => r.startWeek > 3 || r.endWeek < 2)); // no overlap with the best run
const lo3 = findRuns(rows, 3, { order: 'low', teamId: 1 });
assert.equal(lo3[0].total, 190 + 80 + 70); // weeks 3-5
const withPlayoffs = findRuns(rows, 2, { order: 'high', teamId: 1, includePlayoffs: true });
assert.equal(withPlayoffs.length > 0 && withPlayoffs.some((r) => r.endWeek === 6), true);
// a missing week breaks the run
const gap = findRuns([row(1, 1, 1, 2, 100, 50), row(1, 3, 1, 2, 100, 50)], 2, { order: 'high', teamId: 1 });
assert.equal(gap.length, 0);
// each run lists every game with the result
assert.deepEqual(hi2[0].games.map((g) => [g.score, g.won]), [[200, true], [190, true]]);
console.log('season sim + streaks: ok');
