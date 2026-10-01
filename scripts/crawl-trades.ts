// Collects completed trades from public Sleeper dynasty leagues similar to this one into
// market_trades, snowballing outward from this league's managers. Run by
// .github/workflows/crawl-trades.yml; by hand:
//   SUPABASE_SERVICE_ROLE_KEY=... TSX_TSCONFIG_PATH=tsconfig.app.json npx tsx scripts/crawl-trades.ts
//
// Env: MAX_MINUTES (default 300), CALLS_PER_MINUTE (default 600, Sleeper asks for < 1000),
//      TARGET_TRADES (default 50000), SEASONS (default 2022-current).

import { createThrottle, parseTrade, profileLeague, type SleeperLeagueLite, type SleeperTransactionLite } from './lib/tradeMarket';

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
} as Storage;

const { supabase } = await import('../src/integrations/supabase/client');
const { LEAGUE_ID } = await import('../src/services/sleeperApi');

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set — the market tables are admin-only, so the crawler needs it.');
  process.exit(1);
}

const BASE = 'https://api.sleeper.app/v1';
const MAX_MS = Number(process.env.MAX_MINUTES ?? 300) * 60_000;
const TARGET = Number(process.env.TARGET_TRADES ?? 50_000);
const throttle = createThrottle(Number(process.env.CALLS_PER_MINUTE ?? 600));
const started = Date.now();
const nowYear = new Date().getFullYear();
const SEASONS = (process.env.SEASONS ?? `2022-${nowYear}`).split('-').map(Number);
const seasons = Array.from({ length: SEASONS[1] - SEASONS[0] + 1 }, (_, i) => SEASONS[0] + i);

let calls = 0;
async function api<T>(path: string): Promise<T | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    await throttle();
    calls++;
    try {
      const res = await fetch(`${BASE}${path}`);
      if (res.status === 429) { await new Promise((r) => setTimeout(r, 15_000 * (attempt + 1))); continue; }
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      await new Promise((r) => setTimeout(r, 2_000 * (attempt + 1)));
    }
  }
  return null;
}

const timeLeft = () => Date.now() - started < MAX_MS;
async function tradeCount(): Promise<number> {
  const { count } = await supabase.from('market_trades').select('id', { count: 'exact', head: true });
  return count ?? 0;
}
function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

// ── Players directory (refreshed weekly) ────────────────────────────────────
async function refreshPlayers() {
  const { data } = await supabase.from('sleeper_players').select('updated_at').order('updated_at', { ascending: false }).limit(1);
  const last = data?.[0]?.updated_at ? new Date(data[0].updated_at).getTime() : 0;
  if (Date.now() - last < 7 * 24 * 3600_000) return;
  console.log('Refreshing the player directory…');
  const all = await api<Record<string, { full_name?: string; first_name?: string; last_name?: string; position?: string; team?: string | null; age?: number | null }>>('/players/nfl');
  if (!all) return;
  const rows = Object.entries(all)
    .filter(([, p]) => ['QB', 'RB', 'WR', 'TE'].includes(p.position ?? ''))
    .map(([player_id, p]) => ({
      player_id,
      name: p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' '),
      position: p.position ?? null,
      team: p.team ?? null,
      age: p.age ?? null,
      updated_at: new Date().toISOString(),
    }))
    .filter((r) => r.name);
  for (let i = 0; i < rows.length; i += 500) {
    must(await supabase.from('sleeper_players').upsert(rows.slice(i, i + 500), { onConflict: 'player_id' }), 'players');
  }
  console.log(`Saved ${rows.length} players`);
}

// ── Seeds: this league's managers (current and past seasons) ────────────────
async function seedUsers() {
  const { count } = await supabase.from('market_seen_users').select('user_id', { count: 'exact', head: true });
  if ((count ?? 0) > 0) return;
  console.log('Seeding from this league…');
  let id: string | null = LEAGUE_ID;
  const users = new Set<string>();
  while (id) {
    const [league, list] = await Promise.all([
      api<SleeperLeagueLite>(`/league/${id}`),
      api<Array<{ user_id: string }>>(`/league/${id}/users`),
    ]);
    for (const u of list ?? []) users.add(u.user_id);
    id = league?.previous_league_id ?? null;
  }
  must(await supabase.from('market_seen_users').upsert([...users].map((user_id) => ({ user_id })), { onConflict: 'user_id', ignoreDuplicates: true }), 'seed users');
  console.log(`Seeded ${users.size} users`);
}

// ── One league: save its profile; if it matches, collect trades and discover members ──
async function processLeague(l: SleeperLeagueLite): Promise<number> {
  const profile = profileLeague(l);
  const { data: existing } = await supabase.from('market_leagues').select('league_id').eq('league_id', l.league_id).maybeSingle();
  if (existing) return 0;
  must(await supabase.from('market_leagues').insert(profile), 'league');
  if (!profile.matches) return 0;

  const rows = [];
  for (let week = 1; week <= 18; week++) {
    const txs = await api<SleeperTransactionLite[]>(`/league/${l.league_id}/transactions/${week}`);
    for (const tx of txs ?? []) {
      const row = parseTrade(tx, profile);
      if (row) rows.push(row);
    }
  }
  if (rows.length) {
    must(await supabase.from('market_trades').upsert(rows, { onConflict: 'league_id,transaction_id', ignoreDuplicates: true }), 'trades');
  }
  const members = await api<Array<{ user_id: string }>>(`/league/${l.league_id}/users`);
  if (members?.length) {
    must(await supabase.from('market_seen_users').upsert(members.map((u) => ({ user_id: u.user_id })), { onConflict: 'user_id', ignoreDuplicates: true }), 'users');
  }
  must(await supabase.from('market_leagues').update({ trades_synced_at: new Date().toISOString() }).eq('league_id', l.league_id), 'league done');
  return rows.length;
}

async function main() {
  await refreshPlayers();
  await seedUsers();
  let total = await tradeCount();
  let leaguesSeen = 0, leaguesMatched = 0, newTrades = 0;
  console.log(`Starting with ${total} trades (target ${TARGET}).`);

  while (timeLeft() && total < TARGET) {
    const { data: batch } = await supabase
      .from('market_seen_users').select('user_id').is('crawled_at', null).order('discovered_at').limit(20);
    if (!batch || batch.length === 0) { console.log('No more accounts to visit.'); break; }

    for (const { user_id } of batch) {
      if (!timeLeft() || total >= TARGET) break;
      for (const season of seasons) {
        const leagues = await api<SleeperLeagueLite[]>(`/user/${user_id}/leagues/nfl/${season}`);
        for (const l of leagues ?? []) {
          leaguesSeen++;
          const n = await processLeague(l);
          if (n > 0) { leaguesMatched++; newTrades += n; total += n; }
        }
      }
      must(await supabase.from('market_seen_users').update({ crawled_at: new Date().toISOString() }).eq('user_id', user_id), 'user done');
    }
    console.log(`… ${total} trades · ${leaguesSeen} leagues seen · ${leaguesMatched} with trades · ${calls} calls · ${Math.round((Date.now() - started) / 60000)} min`);
  }
  console.log(`Done: +${newTrades} trades this run, ${total} total.`);
}

await main();
