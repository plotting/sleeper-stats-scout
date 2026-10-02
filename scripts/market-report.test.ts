import test from 'node:test';
import assert from 'node:assert/strict';
import { ageFactor, decodeShare, durabilityOf, encodeShare, projectValue, trend, verdictOf, type AgeCurve, type CalcAsset } from '../src/utils/marketCalc';

test('verdict steps from Smash to Robbery with the 10 / 25 / 50% cut-offs', () => {
  assert.equal(verdictOf(1000, 950).label, 'Even');
  assert.equal(verdictOf(1000, 800).label, 'Win');          // 20% gap, you ahead
  assert.equal(verdictOf(1000, 600).label, 'Clear win');    // 40%
  assert.equal(verdictOf(1000, 300).label, 'Smash');        // 70%
  assert.equal(verdictOf(800, 1000).label, 'Lose');
  assert.equal(verdictOf(600, 1000).label, 'Clear loss');
  assert.equal(verdictOf(300, 1000).label, 'Robbery');
  assert.deepEqual([verdictOf(1000, 300).segment, verdictOf(1000, 600).segment, verdictOf(1000, 800).segment, verdictOf(1000, 960).segment, verdictOf(800, 1000).segment, verdictOf(600, 1000).segment, verdictOf(300, 1000).segment], [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(verdictOf(0, 0).label, 'Even');
});

test('aging: value falls past the peak, stays put without a curve, and picks are flat', () => {
  const wr: AgeCurve = { b1: -0.15, b2: -0.12 }; // peaks a little under 26, then declines
  assert.ok(ageFactor(wr, 29, 3) < 0.85);
  assert.ok(ageFactor(wr, 22, 2) > ageFactor(wr, 29, 2));
  assert.equal(ageFactor(null, 29, 3), 1);
  assert.equal(ageFactor(wr, null, 3), 1);
  assert.ok(ageFactor(wr, 40, 5) >= 0.15 && ageFactor(wr, 20, 5) <= 1.6);
  const player: CalcAsset = { key: 'p:1', label: 'x', value: 5000, nTrades: 50, meta: { playerId: '1', position: 'WR', age: 29 } };
  const pick: CalcAsset = { key: 'pk:1:1', label: 'y', value: 3000, nTrades: 50 };
  assert.ok(projectValue(player, 3, new Map([["WR", wr]])) < 5000 * 0.85);
  assert.equal(projectValue(pick, 3, new Map([['WR', wr]])), 3000);
  assert.equal(projectValue(player, 3, new Map()), 5000);
});

test('trend: always ahead / always behind / flips', () => {
  assert.equal(trend([100, 200, 50]), 'Always ahead');
  assert.equal(trend([-100, -5]), 'Always behind');
  assert.equal(trend([300, 40, -500]), 'Flips');
});

test('durability: games missed per season, gaps count as missed seasons', () => {
  const d = durabilityOf([{ year: 2022, games_played: 17 }, { year: 2023, games_played: 15 }, { year: 2024, games_played: 16 }, { year: 2026, games_played: 3 }], 2026)!;
  assert.equal(d.seasons, 3);
  assert.equal(d.avgMissed, 1);                  // (0 + 2 + 1) / 3
  assert.equal(d.label, 'Ironman');
  const gap = durabilityOf([{ year: 2021, games_played: 17 }, { year: 2023, games_played: 17 }], 2026)!;
  assert.equal(gap.seasons, 3);
  assert.equal(gap.avgMissed, 17 / 3);           // 2022 missed entirely
  assert.equal(gap.label, 'Injury-prone');
  assert.equal(durabilityOf([{ year: 2026, games_played: 4 }], 2026), null);
});

test('share links round-trip and ignore junk keys', () => {
  const s = { receive: ['p:101', 'pk:1:1:early'], send: ['p:7', 'pk:2:3'], format: '1qb', vorp: 50, pick: 120 };
  assert.deepEqual(decodeShare('?' + encodeShare(s)), s);
  assert.deepEqual(decodeShare('?r=p:1,evil,pk:9:9&f=zz').receive, ['p:1']);
  assert.equal(decodeShare('?f=zz').format, undefined);
});

test('outcome range applies the percentile changes to the value, capped at 10,000, with a position rank for each', async () => {
  const { outcomeRange, rankEquivalent, ageBucketOf } = await import('../src/utils/marketCalc');
  const vol = new Map([['WR:prime', { p10: Math.log(0.5), p50: 0, p90: Math.log(1.2), up: 0.4, down: 0.15, n: 300 }]]);
  const mk = (v: number, pos: string, age: number, id: string): CalcAsset => ({ key: `p:${id}`, label: id, value: v, nTrades: 40, meta: { playerId: id, position: pos, age } });
  const r = outcomeRange(mk(5000, 'WR', 26, '1'), vol)!;
  assert.equal(Math.round(r.floor), 2500); assert.equal(Math.round(r.expected), 5000); assert.equal(Math.round(r.ceiling), 6000);
  assert.equal(outcomeRange(mk(9000, 'WR', 26, '1'), vol)!.ceiling, 10000);
  assert.equal(outcomeRange(mk(5000, 'WR', 31, '1'), vol), null);     // no data for that group
  assert.equal(outcomeRange({ key: 'pk:1:1', label: 'x', value: 3000, nTrades: 9 }, vol), null);
  assert.deepEqual([21, 24, 25, 28, 29].map(ageBucketOf), ['young', 'young', 'prime', 'prime', 'vet']);
  const entries = [mk(9000, 'WR', 25, 'a'), mk(8000, 'WR', 25, 'b'), mk(7000, 'RB', 25, 'c'), mk(4000, 'WR', 25, 'd')];
  assert.equal(rankEquivalent(entries, 'WR', 8500), 'WR2');
  assert.equal(rankEquivalent(entries, 'WR', 2500), 'WR4');
  assert.equal(rankEquivalent(entries, 'RB', 10000), 'RB1');
});
