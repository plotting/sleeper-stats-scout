// Run: npx tsx --test scripts/playoff-bracket.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBracket, bracketByes, computePlacements, roundWeeks, roundLabel, losersPlaceOffset, type SleeperBracketMatch,
} from '../src/utils/playoffBracket';

const identity = new Map(Array.from({ length: 14 }, (_, i) => [i + 1, i + 101]));

// 6-team bracket with two byes (seeds 1 and 2), championship + 3rd + 5th games.
const winners: SleeperBracketMatch[] = [
  { r: 1, m: 1, t1: 3, t2: 6, w: 3, l: 6 },
  { r: 1, m: 2, t1: 4, t2: 5, w: 5, l: 4 },
  { r: 2, m: 3, t1: 1, t2: 5, t2_from: { w: 2 }, w: 1, l: 5 },
  { r: 2, m: 4, t1: 2, t2: 3, t2_from: { w: 1 }, w: 3, l: 2 },
  { r: 2, m: 5, t1: 6, t2: 4, t1_from: { l: 1 }, t2_from: { l: 2 }, w: 4, l: 6, p: 5 },
  { r: 3, m: 6, t1: 1, t2: 3, t1_from: { w: 3 }, t2_from: { w: 4 }, w: 1, l: 3, p: 1 },
  { r: 3, m: 7, t1: 5, t2: 2, t1_from: { l: 3 }, t2_from: { l: 4 }, w: 2, l: 5, p: 3 },
];

test('byes are teams absent from round 1', () => {
  const m = normalizeBracket(winners, identity);
  assert.deepEqual([...bracketByes(m)].sort(), [101, 102]);
});

test('placements come from placement games', () => {
  const p = computePlacements(normalizeBracket(winners, identity), []);
  assert.equal(p.get(101), 1); // champion
  assert.equal(p.get(103), 2); // runner-up
  assert.equal(p.get(102), 3); // won 3rd-place game
  assert.equal(p.get(105), 4);
  assert.equal(p.get(104), 5); // won 5th-place game
  assert.equal(p.get(106), 6);
});

test('relative consolation places are offset by the winners-bracket size', () => {
  const losers: SleeperBracketMatch[] = [
    { r: 1, m: 1, t1: 7, t2: 10, w: 7, l: 10 },
    { r: 2, m: 2, t1: 7, t2: 8, w: 8, l: 7, p: 1 },
    { r: 2, m: 3, t1: 9, t2: 10, w: 10, l: 9, p: 3 },
  ];
  const p = computePlacements(normalizeBracket(winners, identity), normalizeBracket(losers, identity));
  assert.equal(p.get(108), 7);
  assert.equal(p.get(107), 8);
  assert.equal(p.get(110), 9);
  assert.equal(p.get(109), 10);
});

test('absolute consolation places are used as-is', () => {
  const losers: SleeperBracketMatch[] = [{ r: 1, m: 1, t1: 7, t2: 8, w: 7, l: 8, p: 7 }];
  const p = computePlacements(normalizeBracket(winners, identity), normalizeBracket(losers, identity));
  assert.equal(p.get(107), 7);
  assert.equal(p.get(108), 8);
});

test('unplayed placement games assign nothing', () => {
  const pending: SleeperBracketMatch[] = [{ r: 1, m: 1, t1: 1, t2: 2, w: null, l: null, p: 1 }];
  assert.equal(computePlacements(normalizeBracket(pending, identity), []).size, 0);
});

test('round weeks honour Sleeper round types', () => {
  assert.deepEqual(roundWeeks({ playoff_week_start: 15, round_type: 0 }, 2, 3), [16]);
  assert.deepEqual(roundWeeks({ playoff_week_start: 15, round_type: 1 }, 3, 3), [17, 18]);
  assert.deepEqual(roundWeeks({ playoff_week_start: 15, round_type: 1 }, 2, 3), [16]);
  assert.deepEqual(roundWeeks({ playoff_week_start: 15, round_type: 2 }, 2, 3), [17, 18]);
});

test('round labels count back from the final', () => {
  assert.equal(roundLabel(3, 3), 'Championship');
  assert.equal(roundLabel(2, 3), 'Semifinals');
  assert.equal(roundLabel(1, 3), 'Quarterfinals');
  assert.equal(roundLabel(1, 4), 'Round 1');
});

test('losers-bracket place offset follows the winners-bracket size', () => {
  const rel: SleeperBracketMatch[] = [{ r: 1, m: 1, t1: 7, t2: 8, w: 7, l: 8, p: 1 }];
  const abs: SleeperBracketMatch[] = [{ r: 1, m: 1, t1: 7, t2: 8, w: 7, l: 8, p: 7 }];
  const w = normalizeBracket(winners, identity);
  assert.equal(losersPlaceOffset(w, normalizeBracket(rel, identity)), 6);
  assert.equal(losersPlaceOffset(w, normalizeBracket(abs, identity)), 0);
});

test('rosters without a mapped team keep their roster id', () => {
  const partial = new Map([[1, 101]]);
  const m = normalizeBracket([{ r: 1, m: 1, t1: 1, t2: 2, w: null, l: null }], partial);
  assert.equal(m[0].t2, null);
  assert.equal(m[0].t2_roster, 2);
  assert.equal(m[0].t1_roster, undefined);
});
