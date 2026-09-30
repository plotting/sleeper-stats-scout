import { supabase } from '@/integrations/supabase/client';
import { fetchWeekStats, getFantasyPlayers, type FantasyPosition, type SleeperLeague } from './sleeperApi';
import type { LogFn } from './sleeperSync';

const POSITIONS: FantasyPosition[] = ['QB', 'RB', 'WR', 'TE'];

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

interface PlayerSeason {
  player_name: string;
  position: FantasyPosition;
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
 *  QB/RB/WR/TE rows in `player_seasons` (D/ST rows are left as they are).
 *  The final regular-season week is excluded (resting starters / seeding). */
export async function syncPlayerStats(
  league: SleeperLeague,
  log: LogFn,
  onProgress?: (pct: number) => void,
): Promise<PlayerStatsResult> {
  const year = parseInt(league.season, 10);
  const scoring = league.scoring_settings;
  if (!scoring || Object.keys(scoring).length === 0) {
    throw new Error(`No scoring settings on the ${year} Sleeper league`);
  }

  const playoffStart = league.settings.playoff_week_start > 0 ? league.settings.playoff_week_start : 15;
  const lastRegularWeek = playoffStart - 1;
  const scoredThrough = league.status === 'complete'
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
      const player = players.get(playerId);
      if (!player || !(line.gp > 0)) continue;
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
      ppg: Math.round((total / p.games_played) * 100) / 100,
    };
  });

  // No unique key to upsert on, so replace this year's rows for these positions.
  const { error: delErr } = await supabase
    .from('player_seasons')
    .delete()
    .eq('year', year)
    .in('position', POSITIONS);
  if (delErr) throw new Error(`Failed to clear ${year} player stats: ${delErr.message}`);

  const BATCH = 400;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase.from('player_seasons').insert(rows.slice(i, i + BATCH));
    if (error) throw new Error(`Failed to save player stats: ${error.message}`);
    onProgress?.(80 + (Math.min(i + BATCH, rows.length) / rows.length) * 20);
  }
  log(`Saved ${rows.length} player seasons for ${year}`, 'success');
  return { total: rows.length, weeksFetched, excludedWeek };
}
