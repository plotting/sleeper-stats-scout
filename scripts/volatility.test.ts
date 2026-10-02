import test from 'node:test';
import assert from 'node:assert/strict';
import { ageBucket, outcomeBuckets, type SeasonPair } from './lib/volatility';

test('age buckets', () => {
  assert.deepEqual([22, 24, 25, 28, 29, 33].map(ageBucket), ['young', 'young', 'prime', 'prime', 'vet', 'vet']);
});

test('outcome distribution scales production changes by the VORP slope and reports breakout / bust odds', () => {
  const pairs: SeasonPair[] = [];
  // 100 young WRs: changes in ln(1+VORP) spread evenly from -1 to +1
  for (let i = 0; i < 100; i++) pairs.push({ position: 'WR', age: 23, delta: -1 + (2 * i) / 99 });
  for (let i = 0; i < 10; i++) pairs.push({ position: 'TE', age: 30, delta: 0 }); // too few to report
  const out = outcomeBuckets(pairs, 0.5);
  assert.ok(!out.has('TE:vet'));
  const wr = out.get('WR:young')!;
  assert.equal(wr.n, 100);
  assert.ok(Math.abs(wr.p50) < 0.02);
  assert.ok(Math.abs(wr.p10 - -0.4) < 0.03 && Math.abs(wr.p90 - 0.4) < 0.03); // 0.5 × ±0.8
  assert.ok(wr.p10 < wr.p50 && wr.p50 < wr.p90);
  assert.ok(wr.up > 0.25 && wr.up < 0.45);     // Δ·0.5 ≥ ln 1.1 ⇒ Δ ≥ 0.19
  assert.ok(wr.down > 0.15 && wr.down < 0.4);  // Δ·0.5 ≤ ln 0.85 ⇒ Δ ≤ −0.33
});
