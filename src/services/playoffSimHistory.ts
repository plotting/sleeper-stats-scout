import { supabase } from "@/integrations/supabase/client";

export interface PlayoffSimSnapshotTeam {
  teamId: number;
  projPpg: number;
  projStd: number;
  projWins: number;
  projSeed: number;
  playoffPct: number;
  seedPct: number[];
  /** Change in playoffPct (fraction) caused by the week's results alone; see the delta_results migration. */
  deltaResults?: number | null;
}

/** Persists one "as of week" snapshot of the Monte Carlo sim, one row per
 *  team. Upserts on (season_id, as_of_week, bracket_size, team_id) so a
 *  backfill can be safely re-run without creating duplicates. */
export async function savePlayoffSimSnapshot(
  seasonId: number,
  asOfWeek: number,
  bracketSize: number,
  numSims: number,
  teams: PlayoffSimSnapshotTeam[],
): Promise<void> {
  const rows = teams.map((t) => ({
    season_id: seasonId,
    as_of_week: asOfWeek,
    bracket_size: bracketSize,
    num_sims: numSims,
    team_id: t.teamId,
    proj_ppg: t.projPpg,
    proj_std: t.projStd,
    proj_wins: t.projWins,
    proj_seed: t.projSeed,
    playoff_pct: t.playoffPct,
    seed_pct: t.seedPct,
    delta_results: t.deltaResults ?? null,
  }));
  const onConflict = "season_id,as_of_week,bracket_size,team_id";
  let { error } = await supabase.from("playoff_sim_history").upsert(rows, { onConflict });
  if (error && /delta_results/.test(error.message)) {
    // the delta_results column needs its migration; save the rest without it until then
    ({ error } = await supabase.from("playoff_sim_history").upsert(rows.map(({ delta_results: _unused, ...rest }) => rest), { onConflict }));
  }
  if (error) throw new Error(`Failed to save week ${asOfWeek} snapshot: ${error.message}`);
}

export async function deletePlayoffSimHistoryForSeason(seasonId: number): Promise<void> {
  const { error } = await supabase.from("playoff_sim_history").delete().eq("season_id", seasonId);
  if (error) throw new Error(`Failed to clear history for season ${seasonId}: ${error.message}`);
}

export interface PlayoffSimHistoryRow {
  as_of_week: number;
  bracket_size: number;
  num_sims: number;
  team_id: number;
  proj_ppg: number;
  proj_std: number;
  proj_wins: number;
  proj_seed: number;
  playoff_pct: number;
  seed_pct: number[];
  computed_at: string;
  /** Fraction, like playoff_pct; null/absent for snapshots saved before the column existed. */
  delta_results?: number | null;
}

export async function fetchPlayoffSimHistory(seasonId: number): Promise<PlayoffSimHistoryRow[]> {
  const base = "as_of_week, bracket_size, num_sims, team_id, proj_ppg, proj_std, proj_wins, proj_seed, playoff_pct, seed_pct, computed_at";
  for (const cols of [`${base}, delta_results`, base]) {
    const { data, error } = await supabase.from("playoff_sim_history").select(cols).eq("season_id", seasonId).order("as_of_week");
    if (!error) return (data ?? []) as unknown as PlayoffSimHistoryRow[];
    if (!cols.includes("delta_results")) throw new Error(`Failed to load playoff sim history: ${error.message}`);
  }
  return [];
}
