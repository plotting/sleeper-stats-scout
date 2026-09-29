import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { MatchupScoresView } from "@/types/database";

/**
 * Every individual regular-season team-game score ever recorded, corrected
 * for manual score_adjustments (e.g. illegal-lineup penalties) to reflect
 * what was actually scored on the field. Shared across the whole app via
 * react-query's cache, so every caller reuses one fetch — and it updates
 * automatically as new games are synced, since it's a live query rather
 * than a precomputed snapshot.
 */
export function useAllTimeScorePool() {
  const { data: matchups, isLoading: matchupsLoading } = useQuery({
    queryKey: ["all-time-score-pool-matchups"],
    queryFn: async () => {
      const PAGE = 1000;
      let rows: MatchupScoresView[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("matchup_scores_view")
          .select("*")
          .eq("is_playoff", false)
          .eq("is_consolation", false)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        rows = rows.concat(data as MatchupScoresView[]);
        if (data.length < PAGE) break;
        from += PAGE;
      }
      return rows;
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: adjustments, isLoading: adjustmentsLoading } = useQuery({
    queryKey: ["score-adjustments-all"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("score_adjustments")
        .select("season_id, week_number, team_id, adjustment");
      if (error) throw error;
      return data as { season_id: number; week_number: number; team_id: number; adjustment: number }[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const adjustmentMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of adjustments ?? []) {
      m.set(`${a.season_id}-${a.week_number}-${a.team_id}`, a.adjustment);
    }
    return m;
  }, [adjustments]);

  const pool = useMemo(() => {
    if (!matchups) return [];
    const seen = new Set<string>();
    const values: number[] = [];
    for (const m of matchups) {
      if (m.home_score == null || m.away_score == null || m.week_number == null) continue;
      const ids = [m.home_team_id ?? 0, m.away_team_id ?? 0].sort((a, b) => a - b);
      const key = `${m.season_id}-${m.week_number}-${ids[0]}-${ids[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const rawFor = (teamId: number | null, officialScore: number) => {
        const adj = teamId != null ? adjustmentMap.get(`${m.season_id}-${m.week_number}-${teamId}`) : undefined;
        return adj != null ? officialScore - adj : officialScore;
      };

      values.push(rawFor(m.home_team_id, m.home_score));
      values.push(rawFor(m.away_team_id, m.away_score));
    }
    return values;
  }, [matchups, adjustmentMap]);

  return { pool, isLoading: matchupsLoading || adjustmentsLoading };
}
