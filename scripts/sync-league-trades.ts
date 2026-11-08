// Pulls this league's completed trades from Sleeper into the trades table (the "League trades" card, trade history and
// grades read from it). Already-synced transactions are skipped (matched by Sleeper transaction id), so it is safe to
// run as often as you like. Run by .github/workflows/sync-league-trades.yml; by hand:
//   SUPABASE_SERVICE_ROLE_KEY=... TSX_TSCONFIG_PATH=tsconfig.app.json npx tsx scripts/sync-league-trades.ts
// Trades happen year-round, so unlike the score sync this does not wait for the league to be in season.

// The shared services use localStorage for caches; give Node a throwaway one.
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
} as Storage;

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set — trades are admin-write only.');
  process.exit(1);
}

const { fetchLeague, LEAGUE_ID } = await import('../src/services/sleeperApi');
const { syncTrades } = await import('../src/services/sleeperSync');

let errors = 0;
const log = (msg: string, level: 'info' | 'success' | 'warn' | 'error' = 'info') => {
  if (level === 'error') errors++;
  console.log(`[${level}] ${msg}`);
};

const league = await fetchLeague(LEAGUE_ID);
console.log(`League ${league.name} ${league.season}: status=${league.status}`);
await syncTrades(league, log);

if (errors > 0) {
  console.error(`Finished with ${errors} error(s).`);
  process.exit(1);
}
console.log('Done.');
