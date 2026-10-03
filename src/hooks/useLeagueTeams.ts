import { useQuery } from "@tanstack/react-query";
import { LEAGUE_ID, fetchLeague, fetchLeagueDrafts, fetchLeagueRosters, fetchLeagueUsers, fetchTradedPicks } from "@/services/sleeperApi";
import { buildTeams, type LeagueTeam } from "@/utils/leagueTeams";
import { starterSlots } from "@/utils/rosterLineup";

/** This league's teams (players and draft picks each owns) and starting slots, straight from the Sleeper API. */
export function useLeagueTeams(enabled: boolean) {
  return useQuery({
    queryKey: ["league-teams", LEAGUE_ID],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<{ teams: LeagueTeam[]; slots: string[] }> => {
      const [league, users, rosters, traded, drafts] = await Promise.all([
        fetchLeague(LEAGUE_ID), fetchLeagueUsers(LEAGUE_ID), fetchLeagueRosters(LEAGUE_ID), fetchTradedPicks(LEAGUE_ID), fetchLeagueDrafts(LEAGUE_ID).catch(() => []),
      ]);
      // Only rounds that exist in this league's rookie draft: the league setting, else the most recent draft's, else 4.
      const draftRounds = league.settings?.draft_rounds || drafts.map((d) => d.settings?.rounds ?? 0).filter(Boolean).pop() || 4;
      const rounds = draftRounds;
      return { teams: buildTeams({ rosters, users, tradedPicks: traded ?? [], rounds, now: new Date() }), slots: starterSlots(league.roster_positions ?? []) };
    },
  });
}
