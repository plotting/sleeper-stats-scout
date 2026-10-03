import test from 'node:test';
import assert from 'node:assert/strict';
import { findWinWin } from '../src/utils/winWin';
import type { CalcAsset } from '../src/utils/marketCalc';

const a = (key: string, value: number): CalcAsset => ({ key, label: key, value, nTrades: 5 });

test('findWinWin keeps value-matched trades that help both lineups, best minimum gain first', () => {
  const you = { rosterId: 1, name: 'Me', assets: [a('m1', 3000), a('m2', 1000)] };
  const them = { rosterId: 2, name: 'Them', assets: [a('t1', 2950), a('t2', 1020), a('t3', 5000)] };
  // lineup gains: swapping m1 for t1 helps both a little; m2 for t2 helps one side only
  const delta = (_id: number, recv: CalcAsset[], send: CalcAsset[]) => {
    const key = `${recv.map((x) => x.key).join()}|${send.map((x) => x.key).join()}`;
    if (key === 't1|m1') return { you: 4, them: 2 };
    if (key === 't2|m2') return { you: 3, them: -1 };
    return { you: 0, them: 0 };
  };
  const out = findWinWin(you, [them], { players: 1, picks: 1 }, delta);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].receive.map((x) => x.key), ['t1']);
  assert.deepEqual(out[0].send.map((x) => x.key), ['m1']);
  assert.equal(findWinWin(you, [them], { players: 1, picks: 1 }, () => null).length, 0);
});
