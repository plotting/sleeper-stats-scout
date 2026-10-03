import test from 'node:test';
import assert from 'node:assert/strict';
import { assess, pickOptions, sideTotal, suggestToEven, type CalcAsset } from '../src/utils/marketCalc';

const a = (key: string, value: number, nTrades = 5): CalcAsset => ({ key, label: key, value, nTrades });

test('assess sums both sides and tiers the gap by the larger side', () => {
  const r = assess([a('x', 1000)], [a('y', 600), a('z', 300)]);
  assert.equal(r.recv, 1000); assert.equal(r.sent, 900);
  assert.equal(r.tier, 'even'); assert.equal(r.winner, 'you');
  assert.equal(assess([a('x', 1000)], [a('y', 600)]).tier, 'edge');
  assert.equal(assess([a('x', 1000)], [a('y', 100)]).tier, 'lop');
  assert.equal(assess([], []).diffPct, 0);
});

test('pick options skip the already-drafted class after June and need fitted values', () => {
  const vals = new Map([['pk:0:1', { value: 1000, n_trades: 9 }], ['pk:1:1', { value: 700, n_trades: 9 }], ['pk:1:2', { value: 300, n_trades: 4 }]]);
  const fall = pickOptions(new Date('2026-10-01T00:00:00Z'), vals).map((p) => p.label);
  assert.deepEqual(fall, ['2027 1st', '2027 2nd']);
  const spring = pickOptions(new Date('2026-03-01T00:00:00Z'), vals).map((p) => p.label);
  assert.deepEqual(spring, ['2026 1st', '2027 1st', '2027 2nd']);
});

test('suggestions are the closest values with enough history, excluding assets already in the trade', () => {
  const pool = [a('p', 520), a('q', 480, 1), a('r', 900), a('s', 505)];
  assert.deepEqual(suggestToEven(500, pool, new Set(['s']), [], undefined, 3, 2).map((x) => x.key), ['p', 'r']);
  assert.deepEqual(suggestToEven(0.2, pool, new Set(), []), []);
});

test('depth discount: the richest player counts fully, each extra one a fraction of the one before', () => {
  const star = [a('s', 1000)];
  const parts = [a('x', 600), a('y', 600)];
  assert.equal(assess(star, parts).winner, 'them');                           // plain sum: 1000 vs 1200
  assert.equal(assess(star, parts, { players: 0.5, picks: 1 }).winner, 'you'); // 1000 vs 600 + 300
  assert.equal(sideTotal([a('p:1', 2000), a('p:2', 2000), a('p:3', 2000), a('p:4', 2000)], { players: 0.85, picks: 1 }).toFixed(0), String(Math.round(2000 * (1 + 0.85 + 0.85 ** 2 + 0.85 ** 3))));
  // picks have their own discount and don't use up the player ranks
  assert.equal(sideTotal([a('p:1', 1000), a('pk:1:1', 1000), a('pk:1:2', 1000)], { players: 0.5, picks: 0.5 }), 1000 + 1000 + 500);
});

test('suggestions account for the discount: an extra piece on a full side adds less', () => {
  const pool = [a('q', 2000), a('r', 1000)];
  const side = [a('p:a', 3000), a('p:b', 2900)];
  const d = { players: 0.5, picks: 1 };
  // adding 2000 to a side that already has two players is worth only 2000 × 0.25 = 500; the 1000 piece adds 250
  assert.deepEqual(suggestToEven(500, pool, new Set(), side, d, 0, 1).map((x) => x.key), ['q']);
  assert.deepEqual(suggestToEven(500, pool, new Set(), [], d, 0, 1).map((x) => x.key), ['r']);
});

test('VORP weight blends market and baseline; untraded players use the baseline; picks stay market-only', async () => {
  const { effectiveValue } = await import('../src/utils/marketCalc');
  const qb = { key: 'p:1', value: 8000, nTrades: 50, baseline: 4000 };
  assert.equal(effectiveValue(qb, 0), 8000);
  assert.ok(Math.abs(effectiveValue(qb, 1) - 4000) < 1e-6);
  assert.ok(Math.abs(effectiveValue(qb, 0.5) - Math.sqrt(8000 * 4000)) < 1e-6);
  assert.equal(effectiveValue({ key: 'p:2', value: 3000, nTrades: 0, baseline: 2500 }, 0), 2500);
  assert.equal(effectiveValue({ key: 'pk:0:1', value: 4000, nTrades: 99, baseline: 100 }, 1), 4000);
  assert.equal(effectiveValue({ key: 'p:3', value: 3000, nTrades: 20 }, 1), 3000);
});

test('pick options add early / mid / late slot tiers when the fit has them', () => {
  const vals = new Map([
    ['pk:1:1', { value: 3000, n_trades: 900 }], ['pk:1:1:early', { value: 6000, n_trades: 900 }],
    ['pk:1:1:late', { value: 1500, n_trades: 900 }], ['pk:1:2', { value: 1500, n_trades: 800 }],
  ]);
  const labels = pickOptions(new Date('2026-10-01T00:00:00Z'), vals).map((p) => p.label);
  assert.deepEqual(labels, ['2027 1st', '2027 Early 1st', '2027 Late 1st', '2027 2nd']);
});

test('pickKeyFor matches the fit: years ahead of the trade year, clamped, round capped at 5', async () => {
  const { pickKeyFor } = await import('../src/utils/marketCalc');
  assert.equal(pickKeyFor(2027, 1, '2026-10-01T00:00:00Z'), 'pk:1:1');
  assert.equal(pickKeyFor(2026, 7, '2026-10-01T00:00:00Z'), 'pk:0:5');
  assert.equal(pickKeyFor(2035, 2, '2026-10-01T00:00:00Z'), 'pk:3:2');
});

test('normalizeTop makes the best well-traded player 10,000 and leaves config rows alone', async () => {
  const { normalizeTop } = await import('../src/utils/marketCalc');
  const m = new Map([
    ['p:1', { value: 7592, n_trades: 115 }], ['p:2', { value: 7322, n_trades: 136 }], ['p:3', { value: 9000, n_trades: 2 }],
    ['pk:1:1', { value: 3000, n_trades: 900 }], ['cfg:alpha', { value: 1, n_trades: 0 }],
  ]);
  normalizeTop(m);
  assert.equal(Math.round(m.get('p:1')!.value), 10000);
  assert.ok(m.get('p:2')!.value < 10000 && m.get('p:2')!.value > 9500);
  assert.equal(Math.round(m.get('pk:1:1')!.value), Math.round(3000 * 10000 / 7592));
  assert.equal(m.get('cfg:alpha')!.value, 1);
});

import { daysBetween, valueChanges } from '../src/utils/marketCalc';
test('valueChanges: percent move, skipping assets that were unvalued or near zero then', () => {
  const ch = valueChanges(new Map([['a', 1200], ['b', 900], ['c', 500], ['d', 50]]), new Map([['a', 1000], ['b', 1000], ['d', 10]]));
  assert.equal(Math.round(ch.get('a')!), 20);
  assert.equal(Math.round(ch.get('b')!), -10);
  assert.equal(ch.has('c'), false);
  assert.equal(ch.has('d'), false);
  assert.equal(daysBetween('2026-10-01', '2026-10-08'), 7);
});

import { findOffers } from '../src/utils/marketCalc';
test('findOffers: packages near the target, simplest and closest first, ignoring scraps', () => {
  const pool = [a('s', 1000), a('m1', 600), a('m2', 400), a('m3', 380), a('scrap', 50), a('big', 3000)];
  const offers = findOffers(1000, pool, undefined, 0.05, 5);
  assert.equal(offers[0].assets.map((x) => x.key).join(), 's'); // a single piece beats a package
  assert.ok(offers.some((o) => o.assets.map((x) => x.key).join() === 'm1,m2'));
  assert.ok(offers.every((o) => o.diffPct <= 5 && !o.assets.some((x) => x.key === 'scrap' || x.key === 'big')));
  assert.deepEqual(findOffers(0, pool), []);
});

import { adjustedTotals } from '../src/utils/marketCalc';
test('consolidation premium lifts the side with fewer pieces; equal counts and unmeasured shapes are untouched', () => {
  const depth = { players: 1, picks: 1, premium: new Map([['2-1', 1.5]]) };
  const r = assess([a('star', 1000)], [a('x', 700), a('y', 700)], depth);
  assert.equal(Math.round(r.recv), 1500); // 1000 × 1.5
  assert.equal(r.sent, 1400);
  assert.equal(r.premium?.side, 'recv');
  assert.equal(adjustedTotals([a('p', 500), a('q', 500)], [a('x', 500), a('y', 500)], depth).premium, null);
  assert.equal(adjustedTotals([a('s', 1000)], [a('x', 400), a('y', 300), a('z', 300)], depth).premium, null); // 3-1 not measured
});

test('suggestToEven with context judges the premium-adjusted gap', () => {
  const depth = { players: 1, picks: 1, premium: new Map([['2-1', 1.5]]) };
  // I send one 1000 asset, receive one 700: behind 300. Adding a 300 asset to what I receive makes it 2-for-1 (premium on my single) — overshoots (500 off); a 700 asset lands 100 off.
  const pool = [a('c300', 300), a('c700', 700)];
  const out = suggestToEven(-300, pool, new Set(), [a('r', 700)], depth, 0, 1, { other: [a('s', 1000)], sideIsRecv: true });
  assert.deepEqual(out.map((x) => x.key), ['c700']);
});

test('findOffers asks multi-piece packages to cover the premium', () => {
  const depth = { players: 1, picks: 1, premium: new Map([['2-1', 1.5]]) };
  const pool = [a('m1', 800), a('m2', 700), a('one', 1000)];
  const offers = findOffers(1000, pool, depth, 0.05, 5);
  assert.ok(offers.some((o) => o.assets.map((x) => x.key).join() === 'one'));
  assert.ok(offers.some((o) => o.assets.map((x) => x.key).join() === 'm1,m2')); // 1500 total = 1000 × 1.5
  assert.ok(offers.every((o) => o.need >= 1000));
});
