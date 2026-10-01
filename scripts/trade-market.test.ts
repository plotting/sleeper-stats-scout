import test from 'node:test';
import assert from 'node:assert/strict';
import { profileLeague, parseTrade } from './lib/tradeMarket';

const base = {
  league_id: 'L1', season: '2025', total_rosters: 10,
  roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN'],
  scoring_settings: { pass_td: 6, rec: 0 },
  settings: { type: 2, num_teams: 10 },
};

test('this league style matches', () => {
  assert.equal(profileLeague(base).matches, true);
});

test('superflex, redraft, full PPR and 14-team leagues do not match', () => {
  assert.equal(profileLeague({ ...base, roster_positions: [...base.roster_positions, 'SUPER_FLEX'] }).matches, false);
  assert.equal(profileLeague({ ...base, settings: { type: 0, num_teams: 10 } }).matches, false);
  assert.equal(profileLeague({ ...base, scoring_settings: { pass_td: 4, rec: 1 } }).matches, false);
  assert.equal(profileLeague({ ...base, settings: { type: 2, num_teams: 14 } }).matches, false);
});

test('a two-team trade is split into what each side receives', () => {
  const league = profileLeague(base);
  const row = parseTrade({
    transaction_id: 't1', type: 'trade', status: 'complete', created: 1760000000000, leg: 6,
    roster_ids: [1, 2],
    adds: { '4034': 1, '6794': 2 },
    draft_picks: [{ season: '2027', round: 1, roster_id: 2, owner_id: 1 }],
    waiver_budget: [{ sender: 1, receiver: 2, amount: 15 }],
  }, league);
  assert.ok(row);
  assert.deepEqual(row.sides[0], { r: 1, g: [{ p: '4034' }, { k: [2027, 1, 2] }] });
  assert.deepEqual(row.sides[1], { r: 2, g: [{ p: '6794' }, { b: 15 }] });
  assert.deepEqual(row.player_ids.sort(), ['4034', '6794']);
  assert.deepEqual(row.pick_keys, ['2027-1']);
  assert.equal(row.week, 6);
  assert.equal(row.shape, '2-2');
  assert.equal(row.has_picks, true);
  assert.equal(row.has_players, true);
});

test('failed, non-trade and one-sided trades are skipped', () => {
  const league = profileLeague(base);
  const tx = { transaction_id: 'x', type: 'trade', status: 'complete', created: 1, roster_ids: [1, 2], adds: { '1': 1 } };
  assert.equal(parseTrade(tx, league), null); // roster 2 receives nothing
  assert.equal(parseTrade({ ...tx, status: 'failed', adds: { '1': 1, '2': 2 } }, league), null);
  assert.equal(parseTrade({ ...tx, type: 'waiver', adds: { '1': 1, '2': 2 } }, league), null);
});
