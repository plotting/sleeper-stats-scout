import test from 'node:test';
import assert from 'node:assert/strict';
import { fitAndReport, fitValues, pickKey, recencyWeight, recentAnnualVorp, scoreTrade, shapeWeight, toFitTrade, NO_DEPTH, type FitTrade } from './lib/tradeFit';

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

test('scales the most valuable player (10+ trades) to exactly 10,000', () => {
  const { trades } = synthetic(600);
  const vals = fitValues(trades);
  const top = Math.max(...[...vals].filter(([k]) => k.startsWith('p:')).map(([, v]) => v));
  assert.ok(Math.abs(top - 10000) < 1e-6);
});

test('no depth discount by default; the discount changes which trades balance', () => {
  const { trades } = synthetic(300);
  assert.deepEqual(fitAndReport(trades).report.depth, NO_DEPTH);
  const v = new Map([['p:a', 900], ['p:b', 500], ['p:c', 500]]);
  const t = { id: 1, a: ['p:a'], b: ['p:b', 'p:c'] };
  assert.equal(scoreTrade(t, v)!.valA < scoreTrade(t, v)!.valB, true);                       // plain: 900 vs 1000
  assert.equal(scoreTrade(t, v, false, { players: 0.5, picks: 1 })!.valB, 750);              // 500 + 250
});

test('a depth discount in the fit gives multi-piece sides less credit (stars worth more per piece)', () => {
  // data: one star is accepted for three equal mids, so with a discount the star is worth less than 3 mids
  const trades: FitTrade[] = [];
  for (let i = 0; i < 40; i++) trades.push({ id: `t${i}`, a: ['p:star'], b: ['p:m1', 'p:m2', 'p:m3'] });
  for (let i = 0; i < 40; i++) trades.push({ id: `u${i}`, a: ['p:m1'], b: ['p:m2'] }, { id: `v${i}`, a: ['p:m2'], b: ['p:m3'] });
  const plain = fitValues(trades);
  const disc = fitValues(trades, { depth: { players: 0.5, picks: 1 } });
  const ratio = (m: Map<string, number>) => m.get('p:star')! / m.get('p:m1')!;
  assert.ok(Math.abs(ratio(plain) - 3) < 0.35, `plain ratio ${ratio(plain)}`);       // 1 + 1 + 1
  assert.ok(Math.abs(ratio(disc) - 1.75) < 0.25, `discounted ratio ${ratio(disc)}`); // 1 + 0.5 + 0.25
});

test('one wildly lopsided trade cannot drag values (robust loss)', () => {
  const trades: FitTrade[] = [];
  for (let i = 0; i < 60; i++) trades.push({ id: `a${i}`, a: ['p:x'], b: ['p:y'] });
  trades.push({ id: 'outlier', a: ['p:x'], b: ['p:y', 'p:z'] }, { id: 'wild', a: ['p:x'], b: ['p:z'] });
  const v = fitValues(trades);
  assert.ok(Math.abs(Math.log(v.get('p:x')! / v.get('p:y')!)) < 0.2);
});

test('clean 1-for-1 trades weigh most; bigger trades less', () => {
  assert.equal(shapeWeight(1, 1), 1);
  assert.ok(shapeWeight(2, 1) < 1 && shapeWeight(4, 1) < shapeWeight(2, 1) && shapeWeight(2, 2) < 1);
});

test('shape bias shows whether the many-piece side looks richer than it was accepted as', () => {
  const trades: FitTrade[] = [];
  for (let i = 0; i < 80; i++) trades.push({ id: `a${i}`, a: ['p:star'], b: ['p:m1', 'p:m2', 'p:m3'] });
  for (let i = 0; i < 80; i++) trades.push({ id: `b${i}`, a: ['p:m1'], b: ['p:m2'] }, { id: `c${i}`, a: ['p:m2'], b: ['p:m3'] });
  const { report } = fitAndReport(trades, { depth: { players: 0.5, picks: 1 } });
  assert.ok(report.shapeBias['3-1'].n === 80);
  assert.ok(Math.abs(report.shapeBias['3-1'].pct) < 15, `bias ${report.shapeBias['3-1'].pct}%`);
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

test('reports how far the market sits above VORP by position and a baseline for every player', () => {
  let seed = 9;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const feats = new Map<string, { vorp: number; age: number | null; position: string }>();
  const truth = new Map<string, number>();
  for (let i = 0; i < 90; i++) {
    const position = i % 3 === 0 ? 'QB' : 'WR'; // QBs are paid 60% above what VORP implies
    const vorp = 5 + i * 3;
    feats.set(`p:${i}`, { vorp, age: 25, position });
    truth.set(`p:${i}`, 300 * (1 + Math.log(1 + vorp)) ** 2 * (position === 'QB' ? 1.6 : 1) * (0.95 + 0.1 * rand()));
  }
  const keys = [...truth.keys()];
  const trades: FitTrade[] = [];
  while (trades.length < 900) {
    const a = keys[Math.floor(rand() * 90)];
    const b: string[] = [];
    let s = 0;
    for (let tries = 0; tries < 6 && s < truth.get(a)! * 0.92; tries++) {
      const k = keys[Math.floor(rand() * 90)];
      if (k === a || b.includes(k) || s + truth.get(k)! > truth.get(a)! * 1.1) continue;
      b.push(k); s += truth.get(k)!;
    }
    if (b.length) trades.push({ id: trades.length, a: [a], b });
  }
  const { baseline, report } = fitAndReport(trades, {}, feats);
  assert.equal(baseline.size, 90);
  const mv = report.vorp!.marketVsVorp;
  assert.ok(mv.QB > mv.WR + 10, `QB ${mv.QB}% vs WR ${mv.WR}%`);
});

test('trade weights halve every half-life', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  assert.ok(Math.abs(recencyWeight('2026-10-01T00:00:00Z', now, 120) - 1) < 1e-9);
  assert.ok(Math.abs(recencyWeight('2026-06-03T00:00:00Z', now, 120) - 0.5) < 0.01); // 120 days earlier
  assert.ok(recencyWeight('2023-10-01T00:00:00Z', now, 120) < 0.01);
});

test('a barely-started season does not drag recent VORP down', () => {
  // full seasons: 150 VORP last year, 60 the year before; this season is 4 games old with 12 VORP (= 51 annualised)
  const v = recentAnnualVorp([
    { yearsAgo: 0, vorp: 12, seasonGames: 4 },
    { yearsAgo: 1, vorp: 150, seasonGames: 17 },
    { yearsAgo: 2, vorp: 60, seasonGames: 17 },
  ])!;
  const naive = 0.5 * 12 + 0.3 * 150 + 0.2 * 60; // the old calculation
  assert.ok(v > naive * 1.5, `${v} vs naive ${naive}`);
  assert.ok(v > 90 && v < 150);
  assert.equal(recentAnnualVorp([]), null);
});

import { premiumFor } from './lib/tradeFit';
test('scoreTrade applies the premium to the fewer-piece side only when the extra pieces are much lesser', () => {
  const t = { id: 1, a: ['p:1'], b: ['p:2', 'p:3'] } as unknown as FitTrade;
  const prem = new Map([['2-1', 1.5]]);
  const values = new Map([['p:1', 1000], ['p:2', 300], ['p:3', 300]]);
  const adj = scoreTrade(t, values, false, undefined, prem)!;
  assert.equal(Math.round(adj.valA), 1500);
  assert.equal(adj.valB, 600);
  const comparable = scoreTrade(t, new Map([['p:1', 1000], ['p:2', 900], ['p:3', 100]]), false, undefined, prem)!;
  assert.equal(comparable.valA, 1000);
  assert.equal(premiumFor(prem, [1, 2], [3, 4]), null);
});
