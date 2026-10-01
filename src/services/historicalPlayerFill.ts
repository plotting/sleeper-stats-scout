import { supabase } from '@/integrations/supabase/client';
import { nameKey } from '@/utils/dynastyValue';
import type { LogFn } from './sleeperSync';

// Sleeper's player list no longer contains many long-retired players (Tony Gonzalez,
// Sidney Rice, ...), so the Sleeper-based player stats sync drops them for the early
// seasons. That removes real top players from the replacement-level ranking. This
// file adds them back from nflverse weekly stats (public/data/nflverse-player-seasons-
// 2013-2019.json), scored with this league's scoring settings, regular-season weeks
// 1-16, QB/RB/WR/TE. Only players that are not already in player_seasons for that
// year (matched by name ignoring suffix/punctuation) are added.

type Row = [name: string, position: string, year: number, points: number, games: number];

let cache: Row[] | null = null;
async function loadRows(): Promise<Row[]> {
  if (cache) return cache;
  const res = await fetch('/data/nflverse-player-seasons-2013-2019.json');
  if (!res.ok) throw new Error(`Could not load the historical stats file (${res.status})`);
  cache = (await res.json()) as Row[];
  return cache;
}

export const HISTORICAL_FILL_YEARS = [2013, 2014, 2015, 2016, 2017, 2018, 2019];

async function existingKeys(year: number): Promise<Set<string>> {
  const keys = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('player_seasons')
      .select('player_name')
      .eq('year', year)
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`Failed to read ${year} player stats: ${error.message}`);
    for (const r of data ?? []) keys.add(nameKey(r.player_name));
    if (!data || data.length < 1000) break;
  }
  return keys;
}

/** Adds the players missing from player_seasons for one year. Returns how many were (or would be) added. */
export async function fillMissingForYear(year: number, log: LogFn, dryRun = false): Promise<number> {
  const rows = (await loadRows()).filter((r) => r[2] === year && r[4] > 0);
  if (rows.length === 0) return 0;
  const have = await existingKeys(year);

  // Two different players sharing a name in one year would collide on the unique key: keep the higher scorer.
  const byKey = new Map<string, Row>();
  for (const r of rows) {
    const k = nameKey(r[0]);
    if (have.has(k)) continue;
    const cur = byKey.get(k);
    if (!cur || r[3] > cur[3]) byKey.set(k, r);
  }
  const missing = [...byKey.values()];
  const top = [...missing].sort((a, b) => b[3] - a[3]).slice(0, 5).map((r) => `${r[0]} ${r[3].toFixed(0)}`).join(', ');
  log(`${year}: ${missing.length} players missing${missing.length ? ` (top: ${top})` : ''}${dryRun ? ' — preview only' : ''}`, missing.length ? 'info' : 'success');
  if (dryRun || missing.length === 0) return missing.length;

  const BATCH = 400;
  const payload = missing.map((r) => ({
    player_name: r[0],
    position: r[1],
    year: r[2],
    total_points: r[3],
    games_played: r[4],
  }));
  for (let i = 0; i < payload.length; i += BATCH) {
    const { error } = await supabase.from('player_seasons').insert(payload.slice(i, i + BATCH));
    if (error) throw new Error(`Failed to add missing ${year} players: ${error.message}`);
  }
  log(`${year}: added ${missing.length} missing players from nflverse`, 'success');
  return missing.length;
}

export async function fillAllMissing(log: LogFn, dryRun: boolean): Promise<void> {
  for (const year of HISTORICAL_FILL_YEARS) {
    await fillMissingForYear(year, log, dryRun);
  }
}
