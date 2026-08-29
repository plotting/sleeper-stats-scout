/**
 * Player-level weekly team projections for the live season's playoff
 * simulator: looks at each team's actual roster, detects bye weeks from
 * Sleeper's weekly projections feed, and fills a missing starter from the
 * bench or (failing that) a sampled free agent at that position.
 *
 * Uses Sleeper's undocumented `/projections/nfl/{season}/{week}` endpoint
 * (the same one Sleeper's own app calls) — it isn't part of the public API
 * contract, so every call is defensive: a non-OK response, a network error,
 * or a week whose projections haven't been published yet all just return
 * `null`, and callers fall back to the season-long team-level projection.
 */

import type { SleeperRoster } from './sleeperApi';

const PROJ_BASE = 'https://api.sleeper.app/projections/nfl';
const RELEVANT_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'DEF'];

const SLOT_ELIGIBILITY: Record<string, string[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  DEF: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
};

// Sleeper gives a single point estimate per player, not a distribution — these
// are rough week-to-week volatility heuristics (std as a fraction of mean),
// higher for boom/bust skill positions and defense.
const POSITION_STD_PCT: Record<string, number> = {
  QB: 0.32, RB: 0.45, WR: 0.47, TE: 0.55, DEF: 0.62,
};
const STREAMED_STD_MULTIPLIER = 1.3; // extra uncertainty for a sampled free agent

// Summing independent per-player variance alone understates real team-level
// week-to-week volatility — it only captures "this player has a boom/bust
// week," not model error, injuries during the game, unexpected role/game-
// script changes, or matchup-specific surprises. Without this, a strong
// team's simulated playoff odds collapse toward an unrealistic 100% because
// the model is more confident in its own point estimate than it should be.
// Added in quadrature alongside the position-based variance below.
const BASELINE_TEAM_STD = 10;

interface ProjectedPlayer {
  playerId: string;
  position: string;
  hasGame: boolean;
  pts: number | null;
}

interface RawProjectionRow {
  player_id: string;
  game_id: string | null;
  stats?: { pts_std?: number };
  player?: { position?: string | null };
}

const weekProjCache = new Map<string, Promise<ProjectedPlayer[] | null>>();

async function fetchWeekProjections(season: string, week: number): Promise<ProjectedPlayer[] | null> {
  const key = `${season}-${week}`;
  if (weekProjCache.has(key)) return weekProjCache.get(key)!;

  const promise = (async (): Promise<ProjectedPlayer[] | null> => {
    try {
      const qs = RELEVANT_POSITIONS.map((p) => `position[]=${p}`).join('&');
      const res = await fetch(`${PROJ_BASE}/${season}/${week}?season_type=regular&${qs}`);
      if (!res.ok) return null;
      const raw: RawProjectionRow[] = await res.json();
      if (!Array.isArray(raw)) return null;
      return raw.map((r) => ({
        playerId: r.player_id,
        position: r.player?.position ?? '',
        hasGame: r.game_id != null,
        pts: r.stats?.pts_std ?? null,
      }));
    } catch {
      return null;
    }
  })();

  weekProjCache.set(key, promise);
  return promise;
}

/**
 * A week whose projections haven't been published yet returns placeholder
 * ADP-only rows (no `stats.pts_std`) for most players — but checking that
 * across the ENTIRE Sleeper player pool is noisy, since most of that pool is
 * scrubs/practice-squad players Rotowire never bothers projecting regardless
 * of the week. The reliable signal is coverage among players who actually
 * matter here: this league's own starters. A real bye week only sidelines a
 * small fraction of a 10-team league's starters at once, so a big drop in
 * coverage means the week's projections simply aren't published yet. */
function weekIsPublished(rosters: RosterInput[], byId: Map<string, ProjectedPlayer>): boolean {
  const starterIds = rosters.flatMap((r) => r.starters).filter(Boolean);
  if (starterIds.length === 0) return false;
  const covered = starterIds.filter((id) => byId.get(id)?.pts != null).length;
  return covered / starterIds.length > 0.5;
}

export interface TeamWeekProjection {
  mean: number;
  std: number;
  benchedByeCount: number;
  streamedCount: number;
}

interface RosterInput {
  teamId: number;
  players: string[];
  starters: string[];
}

function projectTeamWeek(
  roster: RosterInput,
  rosterPositions: string[],
  byId: Map<string, ProjectedPlayer>,
  freeAgentsByPos: Map<string, ProjectedPlayer[]>,
  usedFreeAgents: Set<string>,
): TeamWeekProjection {
  const usedRosterPlayers = new Set<string>();
  const bench = roster.players.filter((id) => !roster.starters.includes(id));
  let mean = 0;
  let varianceSum = 0;
  let benchedByeCount = 0;
  let streamedCount = 0;

  const startingSlots = rosterPositions.filter((s) => s !== 'BN');
  startingSlots.forEach((slot, i) => {
    const eligible = SLOT_ELIGIBILITY[slot] ?? [slot];
    const starterId = roster.starters[i];
    const starterProj = starterId ? byId.get(starterId) : undefined;
    let chosen: ProjectedPlayer | undefined;

    if (starterProj && starterProj.hasGame && starterProj.pts != null) {
      chosen = starterProj;
    } else {
      benchedByeCount++;
      chosen = bench
        .map((id) => byId.get(id))
        .filter((p): p is ProjectedPlayer =>
          !!p && !usedRosterPlayers.has(p.playerId) && p.hasGame && p.pts != null && eligible.includes(p.position))
        .sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0))[0];
    }

    if (chosen) {
      usedRosterPlayers.add(chosen.playerId);
      mean += chosen.pts ?? 0;
      const pct = POSITION_STD_PCT[chosen.position] ?? 0.4;
      varianceSum += ((chosen.pts ?? 0) * pct) ** 2;
      return;
    }

    // Nobody on the roster can fill this slot — stream the best available free agent.
    const pool = eligible
      .flatMap((pos) => freeAgentsByPos.get(pos) ?? [])
      .filter((p) => !usedFreeAgents.has(p.playerId))
      .sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0));
    const sample = pool.slice(0, 3);
    if (sample.length > 0) {
      streamedCount++;
      const avgPts = sample.reduce((s, p) => s + (p.pts ?? 0), 0) / sample.length;
      sample.forEach((p) => usedFreeAgents.add(p.playerId));
      mean += avgPts;
      const pct = (POSITION_STD_PCT[eligible[0]] ?? 0.4) * STREAMED_STD_MULTIPLIER;
      varianceSum += (avgPts * pct) ** 2;
    }
  });

  const std = Math.sqrt(varianceSum + BASELINE_TEAM_STD ** 2);
  return { mean, std, benchedByeCount, streamedCount };
}

/**
 * Computes each team's projected mean/std for one specific week from real
 * rosters + Sleeper's weekly player projections, substituting bench players
 * (or sampled free agents) for anyone on bye. Returns `null` when that
 * week's projections aren't published yet, so callers can fall back to the
 * season-long team-level model.
 */
export async function computeTeamWeekProjections(
  season: string,
  week: number,
  rosters: RosterInput[],
  rosterPositions: string[],
): Promise<Map<number, TeamWeekProjection> | null> {
  const rows = await fetchWeekProjections(season, week);
  if (!rows) return null;

  const byId = new Map(rows.map((r) => [r.playerId, r]));
  if (!weekIsPublished(rosters, byId)) return null;

  const rosteredIds = new Set(rosters.flatMap((r) => r.players));
  const freeAgentsByPos = new Map<string, ProjectedPlayer[]>();
  for (const r of rows) {
    if (rosteredIds.has(r.playerId) || !r.hasGame || r.pts == null || !r.position) continue;
    if (!freeAgentsByPos.has(r.position)) freeAgentsByPos.set(r.position, []);
    freeAgentsByPos.get(r.position)!.push(r);
  }
  for (const list of freeAgentsByPos.values()) list.sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0));

  const usedFreeAgents = new Set<string>();
  const result = new Map<number, TeamWeekProjection>();
  for (const roster of rosters) {
    result.set(roster.teamId, projectTeamWeek(roster, rosterPositions, byId, freeAgentsByPos, usedFreeAgents));
  }
  return result;
}
