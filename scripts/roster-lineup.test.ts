import test from 'node:test';
import assert from 'node:assert/strict';
import { bestLineup, lineupScore, positionRanks, positionTotals, starterSlots, type RosterPlayer } from '../src/utils/rosterLineup';
import { buildTeams, pickSeasons, projectedSlots } from '../src/utils/leagueTeams';

const P = (id: string, position: string, score: number): RosterPlayer => ({ id, position, score });

test('starter slots ignore bench, IR, taxi, K and DEF', () => {
  assert.deepEqual(starterSlots(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'FLEX', 'DEF', 'K', 'BN', 'BN', 'IR', 'TAXI']), ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'FLEX']);
});

test('best lineup fills dedicated slots first, then flex with the best left over', () => {
  const slots = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'FLEX'];
  const roster = [P('q1', 'QB', 30), P('q2', 'QB', 25), P('r1', 'RB', 40), P('r2', 'RB', 35), P('r3', 'RB', 20), P('r4', 'RB', 5),
    P('w1', 'WR', 50), P('w2', 'WR', 45), P('w3', 'WR', 38), P('w4', 'WR', 22), P('t1', 'TE', 15), P('t2', 'TE', 12)];
  const l = bestLineup(roster, slots);
  const ids = l.map((x) => x.player?.id);
  assert.deepEqual(ids.slice(0, 6), ['q1', 'r1', 'r2', 'w1', 'w2', 't1']);           // dedicated slots take the best at each position
  assert.deepEqual(new Set(ids.slice(6)), new Set(['w3', 'w4', 'r3']));              // flex: best three of what's left (38, 22, 20) — the QB2 can't flex
  assert.equal(lineupScore(l), 30 + 40 + 35 + 50 + 45 + 15 + 38 + 22 + 20);
  assert.equal(positionTotals(l).WR, 50 + 45 + 38 + 22);
});

test('a short roster leaves empty slots and super flex lets a QB in', () => {
  const l = bestLineup([P('q1', 'QB', 30), P('q2', 'QB', 25)], ['QB', 'SUPER_FLEX', 'RB']);
  assert.deepEqual(l.map((x) => x.player?.id ?? null), ['q1', 'q2', null]);
});

test('position ranks: 1 = strongest in the league', () => {
  const totals = new Map([[1, { QB: 30, RB: 50, WR: 70, TE: 10 }], [2, { QB: 40, RB: 45, WR: 60, TE: 10 }], [3, { QB: 20, RB: 60, WR: 80, TE: 15 }]]);
  assert.deepEqual(positionRanks(totals, 1), { QB: 2, RB: 2, WR: 2, TE: 2 });
});

test('picks follow traded_picks ownership and the next class gets a projected slot tier', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  assert.deepEqual(pickSeasons(now), [2027, 2028, 2029]);
  assert.deepEqual(pickSeasons(new Date('2026-03-01T00:00:00Z')), [2026, 2027, 2028]);
  const mk = (id: number, wins: number, fpts: number) => ({ roster_id: id, owner_id: `u${id}`, players: [`p${id}`], settings: { wins, losses: 6 - wins, ties: 0, fpts } });
  const rosters = Array.from({ length: 10 }, (_, i) => mk(i + 1, i, 500 + i)); // roster 1 is worst (0 wins), roster 10 is best
  assert.equal(projectedSlots(rosters).get(1), 1);
  assert.equal(projectedSlots(rosters).get(10), 10);
  const users = rosters.map((r) => ({ user_id: r.owner_id!, display_name: `User ${r.roster_id}`, metadata: r.roster_id === 1 ? { team_name: 'The Worst' } : undefined }));
  // roster 1's 2027 first now belongs to roster 10; roster 2 owns an extra 2028 second from roster 5
  const teams = buildTeams({ rosters, users, tradedPicks: [{ season: '2027', round: 1, roster_id: 1, owner_id: 10 }, { season: '2028', round: 2, roster_id: 5, owner_id: 2 }], rounds: 2, now });
  const t10 = teams.find((t) => t.rosterId === 10)!;
  assert.ok(t10.picks.some((p) => p.season === 2027 && p.round === 1 && p.originalRosterId === 1 && p.tier === 'early' && p.slot === 1));
  assert.equal(teams.find((t) => t.rosterId === 1)!.picks.some((p) => p.season === 2027 && p.round === 1 && p.originalRosterId === 1), false);
  assert.equal(teams.find((t) => t.rosterId === 1)!.name, 'The Worst');
  assert.ok(teams.find((t) => t.rosterId === 2)!.picks.some((p) => p.season === 2028 && p.round === 2 && p.originalRosterId === 5 && p.tier === null));
  assert.equal(teams.reduce((n, t) => n + t.picks.length, 0), 3 * 2 * 10); // every pick has exactly one owner
});

test('a team can trade the valued players it owns and the picks it owns, priced by slot tier when known', async () => {
  const { teamAssets } = await import('../src/utils/leaguePricing');
  const now = new Date('2026-10-01T00:00:00Z');
  const entries = [
    { key: 'p:1', label: 'Star', value: 9000, nTrades: 50, meta: { playerId: '1', position: 'WR' } },
    { key: 'p:2', label: 'Other team', value: 8000, nTrades: 50, meta: { playerId: '2', position: 'RB' } },
  ];
  const values = new Map([['pk:1:1', { value: 3500, n_trades: 900 }], ['pk:1:1:early', { value: 6000, n_trades: 900 }], ['pk:2:1', { value: 3000, n_trades: 800 }]]);
  const team = {
    rosterId: 3, ownerId: 'u3', name: 'Three', players: ['1', 'ghost'],
    picks: [
      { season: 2027, round: 1, originalRosterId: 3, slot: 2, tier: 'early' as const },
      { season: 2027, round: 1, originalRosterId: 5, slot: 9, tier: 'late' as const },   // no late-tier value: falls back to the round average
      { season: 2028, round: 1, originalRosterId: 3, slot: null, tier: null },
      { season: 2028, round: 3, originalRosterId: 3, slot: null, tier: null },           // no value for that round: not tradable here
    ],
  };
  const a = teamAssets(team, entries, values, new Map([[5, 'Five']]), now);
  assert.deepEqual(a.map((x) => x.label), ['Star', '2027 Early 1st', '2027 1st (Five)', '2028 1st']);
  assert.deepEqual(a.map((x) => x.value), [9000, 6000, 3500, 3000]);
  assert.ok(a.slice(1).every((x) => x.key.startsWith('pk:')));
  assert.equal(new Set(a.map((x) => x.key)).size, 4);
});
