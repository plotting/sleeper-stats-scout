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

test('scales the five biggest players (5+ trades) to an average of 9000', () => {
  const { trades } = synthetic(600);
  const vals = fitValues(trades);
  const top = [...vals].filter(([k]) => k.startsWith('p:')).map(([, v]) => v).sort((x, y) => y - x).slice(0, 5);
  assert.ok(Math.abs(top.reduce((a, b) => a + b, 0) / 5 - 9000) < 1e-6);
});

test('values are plain sums (alpha 1) unless asked, so published gaps are not compressed', () => {
  const { trades } = synthetic(300);
  assert.equal(fitAndReport(trades).report.alpha, 1);
  // alpha only re-labels: values v under alpha equal plain sums of r = v^alpha (same ordering, same trade)
  const v = new Map([['p:a', 900], ['p:b', 500], ['p:c', 500]]);
  const r = new Map([...v].map(([k, x]) => [k, x ** 4]));
  const t = { id: 1, a: ['p:a'], b: ['p:b', 'p:c'] };
  const asAlpha4 = scoreTrade(t, v, false, 4)!, asPlain = scoreTrade(t, r, false, 1)!;
  assert.ok(Math.abs(asAlpha4.valA ** 4 - asPlain.valA) / asPlain.valA < 1e-9);
  assert.equal(asAlpha4.valA > asAlpha4.valB, asPlain.valA > asPlain.valB);
  // ...but the displayed gap shrinks as alpha grows, which is why alpha can't be tuned on the gap
  assert.ok(asAlpha4.diffPct < asPlain.diffPct);
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
  assert.deepEqual(t, { id: 1, a: ['p:1'], b: ['pk:1:2'], weight: 1 });
  assert.equal(toFitTrade({ ...base, sides: [{ r: 1, g: [{ b: 5 }] }, { r: 2, g: [{ p: '1' }] }] }), null);
  assert.equal(toFitTrade({ ...base, sides: [{ r: 1, g: [{ p: '1' }] }, { r: 2, g: [{ p: '2' }] }, { r: 3, g: [{ p: '3' }] }] }), null);
});

test('trade weights pull the fit toward the heavily weighted trades', () => {
  // Two conflicting views of X vs Y: light trades say X is worth 3Y, heavy trades say 1Y.
  const trades: FitTrade[] = [];
  for (let i = 0; i < 20; i++) trades.push({ id: `l${i}`, a: ['p:x'], b: ['p:y', 'p:y2', 'p:y3'], weight: 0.1 });
  for (let i = 0; i < 20; i++) trades.push({ id: `h${i}`, a: ['p:x'], b: ['p:y'], weight: 1 });
  const v = fitValues(trades, { alpha: 1 });
  const unweighted = fitValues(trades.map((t) => ({ ...t, weight: 1 })), { alpha: 1 });
  assert.ok(v.get('p:x')! / v.get('p:y')! < unweighted.get('p:x')! / unweighted.get('p:y')!);
});

test('VORP prior helps sparse players and values players that never traded', () => {
  let seed = 5;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const feats = new Map<string, { vorp: number; age: number | null }>();
  const truth = new Map<string, number>();
  for (let i = 0; i < 80; i++) {
    const vorp = 5 + i * 4;
    feats.set(`p:${i}`, { vorp, age: 24 });
    truth.set(`p:${i}`, 300 * (1 + Math.log(1 + vorp)) ** 2.2 * (0.9 + 0.2 * rand()));
  }
  feats.set('p:untraded', { vorp: 150, age: 24 });
  const traded = [...truth.keys()];
  const trades: FitTrade[] = [];
  while (trades.length < 220) {
    const a = traded[Math.floor(rand() * 80)];
    const b: string[] = [];
    let s = 0;
    for (let tries = 0; tries < 6 && s < truth.get(a)! * 0.92; tries++) {
      const k = traded[Math.floor(rand() * 80)];
      if (k === a || b.includes(k) || s + truth.get(k)! > truth.get(a)! * 1.1) continue;
      b.push(k); s += truth.get(k)!;
    }
    if (b.length) trades.push({ id: trades.length, a: [a], b });
  }
  const plain = fitAndReport(trades);
  const withVorp = fitAndReport(trades, {}, feats);
  assert.ok(withVorp.report.vorp && withVorp.report.vorp.r2 > 0.5, `r2 ${withVorp.report.vorp?.r2}`);
  assert.ok(withVorp.report.holdoutMeanGap! <= plain.report.holdoutMeanGap! + 0.5, `holdout ${withVorp.report.holdoutMeanGap} vs ${plain.report.holdoutMeanGap}`);
  // never traded, but valued from VORP in line with similar traded players
  const v = withVorp.values.get('p:untraded')!;
  assert.ok(v > 0 && v > withVorp.values.get('p:5')! && v < withVorp.values.get('p:75')!);
});
