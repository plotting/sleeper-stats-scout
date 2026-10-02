import test from 'node:test';
import assert from 'node:assert/strict';
import { assess, pickOptions, suggestToEven, type CalcAsset } from '../src/utils/marketCalc';

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
  assert.deepEqual(suggestToEven(500, pool, new Set(['s']), 3, 2).map((x) => x.key), ['p', 'r']);
  assert.deepEqual(suggestToEven(0.2, pool, new Set()), []);
});

test('a higher consolidation exponent makes one star worth more than the sum of lesser pieces', () => {
  const star = [a('s', 1000)];
  const parts = [a('x', 600), a('y', 600)];
  assert.equal(assess(star, parts, 1).winner, 'them'); // 1000 vs 1200
  assert.equal(assess(star, parts, 3).winner, 'you');  // 1000 vs ~756
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
  assert.deepEqual(labels, ['2027 1st', '2027 1st · early (1-3)', '2027 1st · late (7-10)', '2027 2nd']);
});
