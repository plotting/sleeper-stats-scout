import { supabase } from '@/integrations/supabase/client';
import { fetchWeekStats, getFantasyPlayers, type FantasyPosition, type SleeperLeague } from './sleeperApi';
import type { Database } from '@/integrations/supabase/types';
import type { LogFn } from './sleeperSync';

const POSITIONS: FantasyPosition[] = ['QB', 'RB', 'WR', 'TE'];

// Team defenses are keyed by team abbreviation in Sleeper's stats, and stored
// in player_seasons under the full team name with position 'DST'.
const DST_NAMES: Record<string, string> = {
  ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens', BUF: 'Buffalo Bills',
  CAR: 'Carolina Panthers', CHI: 'Chicago Bears', CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns',
  DAL: 'Dallas Cowboys', DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers',
  HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars', JAC: 'Jacksonville Jaguars',
  KC: 'Kansas City Chiefs', LV: 'Las Vegas Raiders', OAK: 'Las Vegas Raiders',
  LAC: 'Los Angeles Chargers', SD: 'Los Angeles Chargers', LAR: 'Los Angeles Rams', LA: 'Los Angeles Rams',
  STL: 'Los Angeles Rams', MIA: 'Miami Dolphins', MIN: 'Minnesota Vikings', NE: 'New England Patriots',
  NO: 'New Orleans Saints', NYG: 'New York Giants', NYJ: 'New York Jets', PHI: 'Philadelphia Eagles',
  PIT: 'Pittsburgh Steelers', SF: 'San Francisco 49ers', SEA: 'Seattle Seahawks', TB: 'Tampa Bay Buccaneers',
  TEN: 'Tennessee Titans', WAS: 'Washington Commanders', WSH: 'Washington Commanders',
};
const SYNCED_POSITIONS = [...POSITIONS, 'DST'];
// Fewer DST rows than this means Sleeper's defense stats weren't usable; keep the old ones.
const MIN_DST_ROWS = 20;

// This league's DB keeps raw season totals in `player_seasons`; the `player_vorp`
// view derives rank, replacement level and VORP from them, so this sync only
// writes points and games played.

function scoreLine(stats: Record<string, number>, scoring: Record<string, number>): number {
  let pts = 0;
  for (const [key, weight] of Object.entries(scoring)) {
    const v = stats[key];
    if (v) pts += v * weight;
  }
  return pts;
}

type SeasonRow = Database['public']['Tables']['player_seasons']['Row'];

interface PlayerSeason {
  player_name: string;
  position: FantasyPosition | 'DST';
  total_points: number;
  games_played: number;
}

export interface PlayerStatsResult {
  total: number;
  weeksFetched: number;
  excludedWeek: number | null;
}

/** Build one season's per-player fantasy totals from Sleeper weekly stats,
 *  scored with THIS league's scoring settings, and replace that year's
 *  QB/RB/WR/TE and D/ST rows in `player_seasons`.
 *  The final regular-season week is excluded (resting starters / seeding). */
export async function syncPlayerStats(
  league: SleeperLeague,
  log: LogFn,
  onProgress?: (pct: number) => void,
  /** Score a different season than `league` with this league's settings
   *  (used for seasons that predate the Sleeper league chain). */
  yearOverride?: number,
): Promise<PlayerStatsResult> {
  const year = yearOverride ?? parseInt(league.season, 10);
  const scoring = league.scoring_settings;
  if (!scoring || Object.keys(scoring).length === 0) {
    throw new Error(`No scoring settings on the ${year} Sleeper league`);
  }

  const isBorrowed = yearOverride != null && yearOverride !== parseInt(league.season, 10);
  const playoffStart = league.settings.playoff_week_start > 0 ? league.settings.playoff_week_start : 15;
  const lastRegularWeek = playoffStart - 1;
  const scoredThrough = league.status === 'complete' || isBorrowed
    ? lastRegularWeek
    : Math.min(lastRegularWeek, league.settings.last_scored_leg || league.settings.leg || 0);
  const excludedWeek = scoredThrough >= lastRegularWeek ? lastRegularWeek : null;
  const lastWeek = excludedWeek != null ? lastRegularWeek - 1 : scoredThrough;

  if (lastWeek < 1) {
    log(`${year}: no completed weeks to score yet`, 'warn');
    return { total: 0, weeksFetched: 0, excludedWeek };
  }

  log(`${year}: loading Sleeper players…`);
  const players = await getFantasyPlayers();

  const seasons = new Map<string, PlayerSeason>();
  let weeksFetched = 0;
  for (let week = 1; week <= lastWeek; week++) {
    const stats = await fetchWeekStats(year, week);
    if (!stats || Array.isArray(stats)) {
      log(`${year} week ${week}: no stats returned`, 'warn');
      continue;
    }
    weeksFetched++;
    for (const [playerId, line] of Object.entries(stats)) {
      const dstName = DST_NAMES[playerId];
      const player = players.get(playerId) ?? (dstName ? { name: dstName, position: 'DST' as const } : undefined);
      if (!player) continue;
      // Team defenses may not carry `gp`; any line with points allowed is a played game.
      const played = dstName ? (line.gp > 0 || line.pts_allow != null) : line.gp > 0;
      if (!played) continue;
      const pts = scoreLine(line, scoring);
      const cur = seasons.get(playerId) ?? {
        player_name: player.name,
        position: player.position,
        total_points: 0,
        games_played: 0,
      };
      cur.total_points += pts;
      cur.games_played += 1;
      seasons.set(playerId, cur);
    }
    log(`${year} week ${week}: scored ${Object.keys(stats).length} stat lines`);
    onProgress?.((week / lastWeek) * 80);
  }

  const rows = [...seasons.values()].map((p) => {
    const total = Math.round(p.total_points * 100) / 100;
    return {
      player_name: p.player_name,
      position: p.position,
      year,
      total_points: total,
      games_played: p.games_played,
    };
  });

  // No unique key to upsert on, so replace this year's rows for these positions.
  const dstCount = rows.filter((r) => r.position === 'DST').length;
  const keepDst = dstCount < MIN_DST_ROWS;
  if (keepDst) {
    log(`${year}: only ${dstCount} D/ST stat lines found — leaving existing D/ST rows alone`, 'warn');
  }
  const replaced = keepDst ? POSITIONS : SYNCED_POSITIONS;
  const toSave = keepDst ? rows.filter((r) => r.position !== 'DST') : rows;
  // `ppg` is a generated column, so it is never written. Keep a copy of the
  // old rows so a failed insert can put them back instead of leaving the year empty.
  const backup: Array<Pick<SeasonRow, 'player_name' | 'position' | 'year' | 'total_points' | 'games_played'>> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('player_seasons')
      .select('player_name, position, year, total_points, games_played')
      .eq('year', year)
      .in('position', replaced)
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`Failed to read ${year} player stats: ${error.message}`);
    backup.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const { data: deleted, error: delErr } = await supabase
    .from('player_seasons')
    .delete()
    .eq('year', year)
    .in('position', replaced)
    .select('id');
  if (delErr) throw new Error(`Failed to clear ${year} player stats: ${delErr.message}`);
  if (backup.length > 0 && (deleted?.length ?? 0) < backup.length) {
    // Row-level security silently skips rows the caller can't delete.
    throw new Error(
      `Could only clear ${deleted?.length ?? 0} of ${backup.length} existing ${year} rows — table write access is blocked (see supabase/migrations/20260930000004_player_seasons_write.sql)`,
    );
  }

  const BATCH = 400;
  try {
    for (let i = 0; i < toSave.length; i += BATCH) {
      const { error } = await supabase.from('player_seasons').insert(toSave.slice(i, i + BATCH));
      if (error) throw new Error(error.message);
      onProgress?.(80 + (Math.min(i + BATCH, toSave.length) / toSave.length) * 20);
    }
  } catch (err) {
    // Roll back: clear any partial insert and restore the previous rows.
    const reason = err instanceof Error ? err.message : String(err);
    await supabase.from('player_seasons').delete().eq('year', year).in('position', replaced);
    let restored = 0;
    for (let i = 0; i < backup.length; i += BATCH) {
      const { error } = await supabase.from('player_seasons').insert(backup.slice(i, i + BATCH));
      if (!error) restored += Math.min(BATCH, backup.length - i);
    }
    throw new Error(`Failed to save player stats (${reason}); restored ${restored} of ${backup.length} previous rows`);
  }
  log(`Saved ${toSave.length} player seasons for ${year}${keepDst ? '' : ` (${dstCount} D/ST)`}`, 'success');
  return { total: toSave.length, weeksFetched, excludedWeek };
}
