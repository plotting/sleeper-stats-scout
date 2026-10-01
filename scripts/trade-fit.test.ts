import test from 'node:test';
import assert from 'node:assert/strict';
import { fitAndReport, fitValues, pickKey, scoreTrade, toFitTrade, type FitTrade } from './lib/tradeFit';

// Synthetic market: hidden true values, trades that are roughly even under them.
function synthetic(n: number) {
  let seed = 7;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const truth = new Map<string, number>();
  const players = Array.from({ length: 40 }, (_, i) => `p:${i}`);
  players.forEach((p, i) => truth.set(p, 4000 / (1 + i * 0.5)));
  truth.set('pk:0:1', 1000);
  truth.set('pk:0:2', 450);
  const all = [...truth.keys()];
  const trades: FitTrade[] = [];
  while (trades.length < n) {
    const a = [all[Math.floor(rand() * all.length)]];
    let target = truth.get(a[0])!;
    // build the other side to within ~10% of the first
    const b: string[] = [];
    let sum = 0;
    for (let tries = 0; tries < 6 && sum < target * 0.92; tries++) {
      const k = all[Math.floor(rand() * all.length)];
      if (k === a[0] || b.includes(k)) continue;
      if (sum + truth.get(k)! <= target * 1.1) { b.push(k); sum += truth.get(k)!; }
    }
    if (b.length) trades.push({ id: trades.length, a, b });
  }
  return { trades, truth };
}

test('fit recovers relative order of values and balances trades', () => {
  const { trades, truth } = synthetic(600);
  const values = fitValues(trades);
  assert.ok(values.get('pk:0:1')! > values.get('pk:0:2')!);
  assert.ok(values.get('p:0')! > values.get('p:20')!);
  const { report } = fitAndReport(trades);
  assert.ok(report.inSampleMeanGap < report.priorMeanGap);
  assert.ok(report.inSampleMeanGap < 15, `mean gap ${report.inSampleMeanGap}`);
  assert.ok(truth.size > 0);
});

test('anchors the current-class first at 1000', () => {
  const { trades } = synthetic(300);
  assert.ok(Math.abs(fitValues(trades).get('pk:0:1')! - 1000) < 1e-6);
});

test('tiers follow the gap thresholds and unknown assets give no score', () => {
  const vals = new Map([['p:a', 100], ['p:b', 95], ['p:c', 50]]);
  assert.equal(scoreTrade({ id: 1, a: ['p:a'], b: ['p:b'] }, vals)!.tier, 'even');
  assert.equal(scoreTrade({ id: 2, a: ['p:a'], b: ['p:c'] }, vals)!.tier, 'edge');
  assert.equal(scoreTrade({ id: 3, a: ['p:a'], b: ['p:zz'] }, vals), null);
});

test('toFitTrade makes picks relative to the trade year and skips FAAB / 3-way trades', () => {
  assert.equal(pickKey(2027, 1, '2026-10-01T00:00:00Z'), 'pk:1:1');
  assert.equal(pickKey(2026, 7, '2026-10-01T00:00:00Z'), 'pk:0:5');
  const base = { id: 1, traded_at: '2026-10-01T00:00:00Z' };
  const t = toFitTrade({ ...base, sides: [{ r: 1, g: [{ p: '1' }] }, { r: 2, g: [{ k: [2027, 2, 2] }] }] });
  assert.deepEqual(t, { id: 1, a: ['p:1'], b: ['pk:1:2'] });
  assert.equal(toFitTrade({ ...base, sides: [{ r: 1, g: [{ b: 5 }] }, { r: 2, g: [{ p: '1' }] }] }), null);
  assert.equal(toFitTrade({ ...base, sides: [{ r: 1, g: [{ p: '1' }] }, { r: 2, g: [{ p: '2' }] }, { r: 3, g: [{ p: '3' }] }] }), null);
});
