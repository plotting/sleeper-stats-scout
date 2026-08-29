import { supabase } from "@/integrations/supabase/client";

export interface PlayoffSimSnapshotTeam {
  teamId: number;
  projPpg: number;
  projStd: number;
  projWins: number;
  projSeed: number;
  playoffPct: number;
  seedPct: number[];
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
  }));
  const { error } = await supabase
    .from("playoff_sim_history")
    .upsert(rows, { onConflict: "season_id,as_of_week,bracket_size,team_id" });
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
}

export async function fetchPlayoffSimHistory(seasonId: number): Promise<PlayoffSimHistoryRow[]> {
  const { data, error } = await supabase
    .from("playoff_sim_history")
    .select("as_of_week, bracket_size, num_sims, team_id, proj_ppg, proj_std, proj_wins, proj_seed, playoff_pct, seed_pct")
    .eq("season_id", seasonId)
    .order("as_of_week");
  if (error) throw new Error(`Failed to load playoff sim history: ${error.message}`);
  return (data ?? []) as unknown as PlayoffSimHistoryRow[];
}
