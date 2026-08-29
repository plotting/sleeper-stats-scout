
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { TeamRecordsView, MatchupScoresView } from "@/types/database";
import { getTeamFinalPlacements } from "../playoff-bracket/utils/bracketUtils";

/** Per-team computed record derived directly from matchup_scores_view */
export interface ComputedTeamRecord {
  teamId: number;
  teamName: string;
  rsWins: number;
  rsLosses: number;
  rsTies: number;
  rsPF: number;
  rsPA: number;
  poWins: number;
  poLosses: number;
  poTies: number;
}

/** Return the number of teams in the playoff bracket for a given season */
function getPlayoffBracketSize(seasonNumber: number): number {
  if (seasonNumber >= 11 && seasonNumber <= 12) return 6; // SixTeamPlayoffs (confirmed via Sleeper playoff_teams=6)
  if (seasonNumber >= 13) return 5;                       // FiveTeamPlayoffs (confirmed via Sleeper playoff_teams=5)
  return 4;                                               // Seasons 1-10: FourTeam / Modified
}

export const useStandingsData = (seasonId: number) => {
  // team_records_view — used only to get the team list (id + name).
  const {
    data: standings,
    isLoading: recordsLoading
  } = useQuery({
    queryKey: ['standings', seasonId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_records_view')
        .select('*')
        .eq('season_id', seasonId);
      if (error) throw error;
      return data as TeamRecordsView[];
    },
  });

  // Single query for ALL season matchups — used for both record computation
  // and playoff placement logic.
  const {
    data: allMatchups,
    isLoading: allMatchupsLoading
  } = useQuery({
    queryKey: ['all-season-matchups', seasonId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matchup_scores_view')
        .select('*')
        .eq('season_id', seasonId);
      if (error) throw error;
      return data as MatchupScoresView[];
    },
  });

  // All seasons have exactly 14 regular season weeks; playoffs start week 15.
  const PLAYOFF_START_WEEK = 15;

  const isLoading = recordsLoading || allMatchupsLoading;

  // ── Playoff matchups derived from allMatchups ──────────────────────────────
  const playoffMatchups = useMemo((): MatchupScoresView[] => {
    if (!allMatchups) return [];
    // Deduplicate: old syncs stored the same game twice (home/away swapped).
    // Without dedup, phantom duplicate games corrupt consolation placement math.
    const seen = new Set<string>();
    return allMatchups.filter(m => {
      if (m.week_number == null || m.week_number < PLAYOFF_START_WEEK) return false;
      const ids = [m.home_team_id ?? 0, m.away_team_id ?? 0].sort((a, b) => a - b);
      const key = `${m.week_number}-${ids[0]}-${ids[1]}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [allMatchups]);

  // ── Compute per-team records from raw matchup data ─────────────────────────
  // Regular season = week < playoffStartWeek
  // Playoff        = week >= playoffStartWeek
  const computedRecords = useMemo((): Map<number, ComputedTeamRecord> => {
    const map = new Map<number, ComputedTeamRecord>();
    if (!allMatchups || !standings) return map;

    // Pre-populate from team list so every team appears
    for (const s of standings) {
      if (s.team_id == null) continue;
      map.set(s.team_id, {
        teamId: s.team_id,
        teamName: s.team_name ?? '',
        rsWins: 0, rsLosses: 0, rsTies: 0, rsPF: 0, rsPA: 0,
        poWins: 0, poLosses: 0, poTies: 0,
      });
    }

    // Deduplicate: some seasons have the same matchup stored more than once.
    const seen = new Set<string>();

    for (const m of allMatchups) {
      const hid = m.home_team_id, aid = m.away_team_id;
      const hs = m.home_score,   as_ = m.away_score;
      if (!hid || !aid || hs == null || as_ == null) continue;

      const key = `${m.week_number}-${Math.min(hid, aid)}-${Math.max(hid, aid)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const isPlayoff = m.week_number != null && m.week_number >= PLAYOFF_START_WEEK;

      const homeWin = hs > as_ ? 1 : 0;
      const awayWin = as_ > hs ? 1 : 0;
      const tie     = hs === as_ ? 1 : 0;

      const ensureRec = (id: number, name: string | null): ComputedTeamRecord => {
        if (!map.has(id)) map.set(id, { teamId: id, teamName: name ?? '', rsWins:0, rsLosses:0, rsTies:0, rsPF:0, rsPA:0, poWins:0, poLosses:0, poTies:0 });
        return map.get(id)!;
      };

      const home = ensureRec(hid, m.home_team_name);
      const away = ensureRec(aid, m.away_team_name);

      if (isPlayoff) {
        home.poWins += homeWin; home.poLosses += awayWin; home.poTies += tie;
        away.poWins += awayWin; away.poLosses += homeWin; away.poTies += tie;
      } else {
        home.rsWins += homeWin; home.rsLosses += awayWin; home.rsTies += tie;
        home.rsPF   += hs;      home.rsPA    += as_;
        away.rsWins += awayWin; away.rsLosses += homeWin; away.rsTies += tie;
        away.rsPF   += as_;     away.rsPA    += hs;
      }
    }

    return map;
  }, [allMatchups, standings]);

  // Regular-season weekly scores per team, used only for the tied-teams
  // head-to-head tiebreak below (week -> teamId -> score).
  const weeklyScores = useMemo(() => {
    const byWeek = new Map<number, Map<number, number>>();
    if (!allMatchups) return byWeek;
    const seen = new Set<string>();
    for (const m of allMatchups) {
      const wk = m.week_number;
      if (wk == null || wk >= PLAYOFF_START_WEEK) continue;
      const hid = m.home_team_id, aid = m.away_team_id;
      const hs = m.home_score, as_ = m.away_score;
      if (!hid || !aid || hs == null || as_ == null) continue;
      const key = `${wk}-${Math.min(hid, aid)}-${Math.max(hid, aid)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!byWeek.has(wk)) byWeek.set(wk, new Map());
      byWeek.get(wk)!.set(hid, hs);
      byWeek.get(wk)!.set(aid, as_);
    }
    return byWeek;
  }, [allMatchups]);

  /**
   * League tiebreak rule for teams tied on win%: for every regular-season week,
   * compare the tied teams' scores against ONLY each other (not the full
   * league) — a team gets a "win" for each other tied team it outscored that
   * week. Rank by that restricted win total, then by total PF as a second
   * tiebreak. (Verified against Season 12's real Sleeper bracket seeding,
   * where this is the only method that reproduces Aron seeded above CJ/Thom
   * despite CJ having better full-league all-play record and PF.)
   */
  function tiedGroupHeadToHeadWins(teamIds: number[]): Map<number, number> {
    const wins = new Map<number, number>(teamIds.map(id => [id, 0]));
    for (const scores of weeklyScores.values()) {
      for (const a of teamIds) {
        const aScore = scores.get(a);
        if (aScore == null) continue;
        for (const b of teamIds) {
          if (a === b) continue;
          const bScore = scores.get(b);
          if (bScore == null) continue;
          if (aScore > bScore) wins.set(a, (wins.get(a) ?? 0) + 1);
        }
      }
    }
    return wins;
  }

  // Sort teams by computed regular-season record (win% first; ties broken by
  // the tied-group head-to-head rule above, then total PF).
  const sortedByRegularSeason: TeamRecordsView[] = useMemo(() => {
    if (!standings) return [];

    const recordOf = (t: TeamRecordsView) => {
      const r = computedRecords.get(t.team_id!);
      const w = r?.rsWins   ?? (t.regular_season_wins   ?? 0);
      const l = r?.rsLosses ?? (t.regular_season_losses ?? 0);
      const ty = r?.rsTies  ?? (t.regular_season_ties   ?? 0);
      const total = w + l + ty;
      const pct = total === 0 ? 0 : (w + 0.5 * ty) / total;
      const pf = r?.rsPF ?? (t.regular_season_points_for ?? 0);
      return { pct, pf };
    };

    // Group teams by win% (rounded to avoid float drift), sort groups desc.
    const groups = new Map<number, TeamRecordsView[]>();
    for (const t of standings) {
      const pct = Math.round(recordOf(t).pct * 1e6);
      if (!groups.has(pct)) groups.set(pct, []);
      groups.get(pct)!.push(t);
    }
    const orderedPcts = [...groups.keys()].sort((a, b) => b - a);

    const result: TeamRecordsView[] = [];
    for (const pct of orderedPcts) {
      const group = groups.get(pct)!;
      if (group.length === 1) {
        result.push(group[0]);
        continue;
      }
      // 2+ teams tied on win% — break the tie with the restricted
      // head-to-head rule, then total PF.
      const ids = group.map(t => t.team_id!).filter((id): id is number => id != null);
      const h2hWins = tiedGroupHeadToHeadWins(ids);
      const sortedGroup = [...group].sort((a, b) => {
        const aWins = h2hWins.get(a.team_id!) ?? 0;
        const bWins = h2hWins.get(b.team_id!) ?? 0;
        if (aWins !== bWins) return bWins - aWins;
        return recordOf(b).pf - recordOf(a).pf;
      });
      result.push(...sortedGroup);
    }
    return result;
  }, [standings, computedRecords, weeklyScores]);

  // Rank-based playoff bracket team IDs
  const bracketTeamIds = useMemo(() => {
    if (sortedByRegularSeason.length === 0) return undefined;
    const bracketSize = getPlayoffBracketSize(seasonId);
    const ids = new Set<number>(
      sortedByRegularSeason
        .slice(0, bracketSize)
        .map(t => t.team_id)
        .filter((id): id is number => id != null)
    );
    return ids.size > 0 ? ids : undefined;
  }, [sortedByRegularSeason, seasonId]);

  // Seed map (rank 1 = best) for mop-up placement ordering
  const teamSeeds = useMemo(() => new Map<number, number>(
    sortedByRegularSeason
      .map((t, i) => [t.team_id as number, i + 1] as [number, number])
      .filter(([id]) => id != null)
  ), [sortedByRegularSeason]);

  const teamPlacements = useMemo(() =>
    getTeamFinalPlacements(playoffMatchups, bracketTeamIds, teamSeeds, seasonId),
  [playoffMatchups, bracketTeamIds, teamSeeds, seasonId]);

  return {
    sortedByRegularSeason,
    teamSeeds,
    bracketTeamIds,
    teamPlacements,
    computedRecords,
    isLoading
  };
};
