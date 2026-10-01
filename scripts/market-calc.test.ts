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
