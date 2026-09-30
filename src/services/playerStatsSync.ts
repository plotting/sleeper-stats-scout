import { supabase } from '@/integrations/supabase/client';
import { fetchWeekStats, getFantasyPlayers, type FantasyPosition, type SleeperLeague } from './sleeperApi';
import type { LogFn } from './sleeperSync';

const POSITIONS: FantasyPosition[] = ['QB', 'RB', 'WR', 'TE'];

/** How many players at each position a league "starts", counting the share of
 *  flex/superflex slots that position can fill. Replacement level for VORP is
 *  the player ranked at (teams × this number). */
function starterSlots(league: SleeperLeague): Record<FantasyPosition, number> {
  const slots: Record<FantasyPosition, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  const flexEligible: Record<string, FantasyPosition[]> = {
    FLEX: ['RB', 'WR', 'TE'],
    WRRB_FLEX: ['RB', 'WR'],
    REC_FLEX: ['WR', 'TE'],
    SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  };
  for (const slot of league.roster_positions ?? []) {
    if ((POSITIONS as string[]).includes(slot)) {
      slots[slot as FantasyPosition] += 1;
    } else if (flexEligible[slot]) {
      const eligible = flexEligible[slot];
      // Superflex is filled by a QB most of the time; other flex slots split evenly.
      if (slot === 'SUPER_FLEX') slots.QB += 0.75;
      const rest = slot === 'SUPER_FLEX' ? 0.25 : 1;
      for (const pos of eligible.filter((p) => slot !== 'SUPER_FLEX' || p !== 'QB')) {
        slots[pos] += rest / (slot === 'SUPER_FLEX' ? 3 : eligible.length);
      }
    }
  }
  return slots;
}

function scoreLine(stats: Record<string, number>, scoring: Record<string, number>): number {
  let pts = 0;
  for (const [key, weight] of Object.entries(scoring)) {
    const v = stats[key];
    if (v) pts += v * weight;
  }
  return pts;
}

interface PlayerSeason {
  sleeper_player_id: string;
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
 *  scored with THIS league's scoring settings, then compute VORP against
 *  replacement level and upsert into `player_vorp`.
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
        sleeper_player_id: playerId,
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

  // Rank within position, find replacement level, compute VORP.
  const slots = starterSlots(league);
  const teams = league.total_rosters || league.settings.num_teams || 12;
  const rows: Array<PlayerSeason & { year: number; season_rank: number; vorp: number }> = [];
  for (const pos of POSITIONS) {
    const ranked = [...seasons.values()]
      .filter((p) => p.position === pos)
      .sort((a, b) => b.total_points - a.total_points);
    if (ranked.length === 0) continue;
    const replacementRank = Math.max(1, Math.round(teams * slots[pos]));
    const replacement = ranked[Math.min(replacementRank, ranked.length) - 1].total_points;
    log(`${year} ${pos}: replacement = #${replacementRank} (${replacement.toFixed(1)} pts)`);
    ranked.forEach((p, i) => {
      rows.push({
        ...p,
        year,
        season_rank: i + 1,
        total_points: Math.round(p.total_points * 100) / 100,
        vorp: Math.round((p.total_points - replacement) * 100) / 100,
      });
    });
  }

  const BATCH = 400;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase
      .from('player_vorp')
      .upsert(rows.slice(i, i + BATCH), { onConflict: 'sleeper_player_id,year' });
    if (error) {
      throw new Error(
        `Failed to save player stats (${error.message}). Run supabase/migrations/20260930000002_player_stats.sql in the Supabase SQL editor.`,
      );
    }
    onProgress?.(80 + ((i + BATCH) / rows.length) * 20);
  }
  log(`Upserted ${rows.length} player seasons for ${year}`, 'success');
  return { total: rows.length, weeksFetched, excludedWeek };
}
