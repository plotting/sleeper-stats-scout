
import React from "react";
import FourTeamPlayoffs from "./playoff-bracket/FourTeamPlayoffs";
import ModifiedPlayoffs from "./playoff-bracket/ModifiedPlayoffs";
import SixTeamPlayoffs from "./playoff-bracket/SixTeamPlayoffs";
import FiveTeamPlayoffs from "./playoff-bracket/FiveTeamPlayoffs";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "./ui/card";
import { MatchupScoresView } from "@/types/database";
import { useStandingsData } from "./standings/useStandingsData";

const PlayoffBracket = ({ season }: { season: string }) => {
  const seasonNum = Number(season);

  // Fetch playoff and consolation matchups data based on season
  const { data: matchups, isLoading: matchupsLoading } = useQuery({
    queryKey: ['playoff-matchups', seasonNum],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matchup_scores_view')
        .select('*')
        .eq('season_id', seasonNum)
        .or('is_playoff.eq.true,is_consolation.eq.true')
        .order('week_number');

      if (error) throw error;
      // Deduplicate by week + team pair — old syncs may have non-canonical
      // home/away assignments creating two rows for the same matchup.
      const seen = new Set<string>();
      return (data as MatchupScoresView[]).filter(m => {
        const key = `${m.week_number}-${[m.home_team_id, m.away_team_id].sort((a, b) => (a ?? 0) - (b ?? 0)).join('-')}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
  });

  // Fetch teams data
  const { data: teams, isLoading: teamsLoading } = useQuery({
    queryKey: ['teams'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('*');
      if (error) throw error;
      return data;
    },
  });

  // Seeding is derived from deduplicated regular-season records (same
  // computation the Overview standings page uses) — team_records_view
  // itself can contain stale/duplicated win-loss data from old syncs.
  const { teamSeeds, isLoading: standingsLoading } = useStandingsData(seasonNum);

  const isLoading = matchupsLoading || teamsLoading || standingsLoading;

  if (isLoading) {
    return <p className="text-center py-4">Loading playoff data...</p>;
  }

  // Display appropriate bracket based on season
  const renderBracket = () => {
    // Seasons 1-7: 4-team playoffs (standard format)
    if (seasonNum <= 7) {
      return <FourTeamPlayoffs 
        matchups={matchups || []} 
        teams={teams || []} 
        teamSeeds={teamSeeds}
      />;
    }

    // Seasons 8-10: Modified playoffs with loser-advances format
    if (seasonNum <= 10) {
      return <ModifiedPlayoffs 
        matchups={matchups || []} 
        teams={teams || []} 
        teamSeeds={teamSeeds}
        seasonNumber={seasonNum}
      />;
    }

    // Seasons 11-12: 6-team playoffs (confirmed via Sleeper's playoff_teams=6
    // league setting for both seasons — playoffs starting in week 15)
    if (seasonNum <= 12) {
      return <SixTeamPlayoffs
        matchups={matchups || []}
        teams={teams || []}
        teamSeeds={teamSeeds}
        seasonNumber={seasonNum}
      />;
    }

    // Season 13+: 5-team playoffs (confirmed via Sleeper's playoff_teams=5 setting)
    return <FiveTeamPlayoffs
      matchups={matchups || []}
      teams={teams || []}
      teamSeeds={teamSeeds}
    />;
  };

  return (
    <Card className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-center">Playoff Bracket</h2>
      </div>

      {renderBracket()}
    </Card>
  );
};

export default PlayoffBracket;
