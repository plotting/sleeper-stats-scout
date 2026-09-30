// Refreshes the current season's scores and player stats so late stat
// corrections (Monday night through Thursday) reach the site without anyone
// opening /admin. Run by .github/workflows/scheduled-sync.yml; can also be run
// by hand:  TSX_TSCONFIG_PATH=tsconfig.app.json npx tsx scripts/scheduled-sync.ts
//
// FORCE=1 runs even when Sleeper doesn't report the league as in season.

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

const { fetchLeague, LEAGUE_ID } = await import('../src/services/sleeperApi');
const { syncScoresAndSchedules } = await import('../src/services/sleeperSync');
const { syncPlayerStats } = await import('../src/services/playerStatsSync');

let errors = 0;
const log = (msg: string, level: 'info' | 'success' | 'warn' | 'error' = 'info') => {
  if (level === 'error') errors++;
  console.log(`[${level}] ${msg}`);
};

const league = await fetchLeague(LEAGUE_ID);
console.log(`League ${league.name} ${league.season}: status=${league.status}, week ${league.settings.leg}`);

if (league.status !== 'in_season' && process.env.FORCE !== '1') {
  console.log('League is not in season — nothing to refresh. (Set FORCE=1 to run anyway.)');
  process.exit(0);
}

console.log('── Scores & schedules ──');
await syncScoresAndSchedules(league, log);

console.log('── Player stats ──');
try {
  await syncPlayerStats(league, log);
} catch (err) {
  log(`Player stats failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
}

if (errors > 0) {
  console.error(`Finished with ${errors} error(s).`);
  process.exit(1);
}
console.log('Done.');
