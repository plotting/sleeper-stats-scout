import test from 'node:test';
import assert from 'node:assert/strict';
import { computeVorp, type SeasonRow } from './lib/vorp';

function season(): SeasonRow[] {
  const rows: SeasonRow[] = [];
  const add = (pos: string, n: number, top: number, step: number, g: number, k: number, gLow: number) => {
    for (let i = 1; i <= n; i++) {
      const games = i <= k ? g : gLow;
      rows.push({ player_name: `${pos}${i}`, position: pos, year: 2023, total_points: Math.round((top - i * step) * games * 10) / 10, games_played: games });
    }
  };
  add('QB', 40, 26, 0.45, 15, 15, 12); add('RB', 80, 20, 0.22, 13, 45, 10); add('WR', 80, 20, 0.2, 13, 45, 10);
  add('TE', 30, 15, 0.45, 14, 15, 10); add('DST', 20, 12, 0.3, 17, 20, 17);
  return rows;
}

test('replacement is the player after those needed to fill every slot every week (QB: 13th)', () => {
  const rows = season();
  const v = computeVorp(rows);
  const qbs = rows.filter((r) => r.position === 'QB');
  const repl = qbs[12]; // 13th by points
  const replPpg = repl.total_points / repl.games_played;
  const top = v.find((r) => r.player_name === 'QB1')!;
  const expected = Math.round((qbs[0].total_points - replPpg * 17) * 10) / 10;
  assert.equal(top.vorp, Math.max(0, expected));
});

test('RB and WR replacement sits deeper than the old fixed rank 30, and VORP never goes negative', () => {
  const rows = season();
  const v = computeVorp(rows);
  assert.ok(v.every((r) => r.vorp >= 0));
  // a RB around the old replacement rank (30th) now has real value above the deeper replacement
  assert.ok(v.find((r) => r.player_name === 'RB30')!.vorp > 0);
  assert.ok(v.find((r) => r.player_name === 'RB1')!.vorp > v.find((r) => r.player_name === 'RB30')!.vorp);
});
