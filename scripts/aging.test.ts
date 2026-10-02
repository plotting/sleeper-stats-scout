import test from 'node:test';
import assert from 'node:assert/strict';
import { fitAgeCurves, type AgePoint } from './lib/aging';

test('recovers a declining-after-peak value curve per position and skips thin positions', () => {
  const pts: AgePoint[] = [];
  for (let age = 21; age <= 34; age++) {
    for (let k = 0; k < 6; k++) {
      const a = (age - 26) / 5;
      pts.push({ position: 'WR', age, value: Math.exp(8 - 0.2 * a - 0.5 * a * a + 0.02 * (k - 3)), trades: 20 });
    }
  }
  pts.push({ position: 'TE', age: 25, value: 3000, trades: 30 });
  const c = fitAgeCurves(pts);
  assert.ok(Math.abs(c.get('WR')!.b1 - -0.2) < 0.05);
  assert.ok(Math.abs(c.get('WR')!.b2 - -0.5) < 0.05);
  assert.ok(!c.has('TE'));
});
