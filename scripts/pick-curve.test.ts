import test from 'node:test';
import assert from 'node:assert/strict';
import { tierExpectations, type DraftedPick } from './lib/pickCurve';

test('tier expectations average annual VORP by round and slot tier, counting misses as zero', () => {
  const picks: DraftedPick[] = [
    { round: 1, slot: 1, annualVorp: 40 }, { round: 1, slot: 3, annualVorp: 20 },
    { round: 1, slot: 5, annualVorp: 10 }, { round: 1, slot: 9, annualVorp: 0 },
    { round: 2, slot: 2, annualVorp: 6 },
  ];
  const e = tierExpectations(picks);
  assert.equal(e.get('1:early')!.annualVorp, 30);
  assert.equal(e.get('1:mid')!.annualVorp, 10);
  assert.equal(e.get('1:late')!.annualVorp, 0);
  assert.equal(e.get('1:any')!.annualVorp, 17.5);
  assert.equal(e.get('2:early')!.n, 1);
  assert.ok(!e.has('2:mid'));
});
