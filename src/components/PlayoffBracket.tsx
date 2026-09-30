import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "./ui/card";
import { MatchupScoresView } from "@/types/database";
import { useStandingsData } from "./standings/useStandingsData";
import BracketView from "./playoff-bracket/BracketView";
import { getPlayoffConfig } from "@/utils/playoffRegistry";

// Seasons are addressed by season id (id == season number in this database).
const PlayoffBracket = ({ season }: { season: string }) => {
  const seasonId = Number(season);
  const config = getPlayoffConfig(seasonId);

  const { data: matchups, isLoading: matchupsLoading } = useQuery({
    queryKey: ["playoff-matchups", seasonId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matchup_scores_view")
        .select("*")
        .eq("season_id", seasonId)
        .gte("week_number", config?.playoff_week_start ?? 1)
        .order("week_number");
      if (error) throw error;
      return data as MatchupScoresView[];
    },
    enabled: !!config,
  });

  const { data: teams, isLoading: teamsLoading } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data, error } = await supabase.from("teams").select("*");
      if (error) throw error;
      return data;
    },
  });

  // Seeds come from the deduplicated regular-season standings.
  const { teamSeeds, isLoading: standingsLoading } = useStandingsData(seasonId);

  if (!config || (config.winners ?? []).length === 0) {
    return (
      <Card className="p-6">
        <h2 className="text-2xl font-bold text-center mb-2">Playoff Bracket</h2>
        <p className="text-center text-sm text-slate-400">
          {config
            ? "Sleeper hasn't published a bracket for this season yet."
            : "No bracket saved for this season yet — run Sync Scores for it in Admin."}
        </p>
      </Card>
    );
  }

  if (matchupsLoading || teamsLoading || standingsLoading) {
    return <p className="text-center py-4">Loading playoff data...</p>;
  }

  const teamNames = new Map<number, string>((teams ?? []).map((t) => [t.id, t.name]));

  return (
    <Card className="p-6">
      <BracketView
        config={config}
        matchups={matchups ?? []}
        teamNames={teamNames}
        teamSeeds={teamSeeds}
        seasonId={seasonId}
      />
    </Card>
  );
};

export default PlayoffBracket;
