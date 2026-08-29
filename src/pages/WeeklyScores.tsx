
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { MatchupScoresView, TeamRecordsView } from "@/types/database";
import SeasonSelector from "@/components/weekly-scores/SeasonSelector";
import WeeklyScoresTable from "@/components/weekly-scores/WeeklyScoresTable";
import WLHeatmapCard from "@/components/weekly-scores/WLHeatmapCard";
import ScheduleTable from "@/components/weekly-scores/ScheduleTable";

const WeeklyScores = () => {
  const [selectedSeason, setSelectedSeason] = useState("14");

  const weekCount = parseInt(selectedSeason) <= 10 ? 16 : 17;
  const regularSeasonWeeks = 14;

  const { data: teams } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("*")
        .order("id");
      if (error) throw error;
      return data;
    },
  });

  const { data: matchupScores } = useQuery({
    queryKey: ["matchup-scores", selectedSeason],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matchup_scores_view")
        .select("*")
        .eq("season_id", parseInt(selectedSeason))
        .order("week_number");
      if (error) throw error;
      return data as MatchupScoresView[];
    },
  });

  const { data: teamRecords } = useQuery({
    queryKey: ["team-records", selectedSeason],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_records_view")
        .select("*")
        .eq("season_id", parseInt(selectedSeason));
      if (error) throw error;
      return data as TeamRecordsView[];
    },
  });

  const teamData = teams?.reduce((acc, team) => {
    acc[team.id] = {
      records: Array.from({ length: weekCount }, (_, weekIndex) => {
        const weekNumber = weekIndex + 1;
        const teamRecord = teamRecords?.find(r => r.team_id === team.id);
        
        if (!teamRecord) return "-";

        if (weekNumber <= regularSeasonWeeks) {
          const relevantMatchups = matchupScores?.filter(m => 
            (m.home_team_id === team.id || m.away_team_id === team.id) && 
            m.week_number <= weekNumber &&
            !m.is_playoff
          ) || [];

          const wins = relevantMatchups.filter(m => 
            (m.home_team_id === team.id && m.home_score !== null && m.away_score !== null && m.home_score > m.away_score) ||
            (m.away_team_id === team.id && m.away_score !== null && m.home_score !== null && m.away_score > m.home_score)
          ).length;

          const losses = relevantMatchups.filter(m => 
            (m.home_team_id === team.id && m.home_score !== null && m.away_score !== null && m.home_score < m.away_score) ||
            (m.away_team_id === team.id && m.away_score !== null && m.home_score !== null && m.away_score < m.home_score)
          ).length;
          
          // Add proper tie detection
          const ties = relevantMatchups.filter(m => 
            (m.home_team_id === team.id && m.home_score !== null && m.away_score !== null && m.home_score === m.away_score) ||
            (m.away_team_id === team.id && m.away_score !== null && m.home_score !== null && m.away_score === m.home_score)
          ).length;

          const tieDisplay = ties > 0 ? `-${ties}` : '';
          return `${wins}-${losses}${tieDisplay}`;
        }

        const totalWins = teamRecord.regular_season_wins + teamRecord.playoff_wins;
        const totalLosses = teamRecord.regular_season_losses + teamRecord.playoff_losses;
        const totalTies = teamRecord.regular_season_ties + teamRecord.playoff_ties;
        const tieDisplay = totalTies > 0 ? `-${totalTies}` : '';
        
        return `${totalWins}-${totalLosses}${tieDisplay}`;
      }),
      scores: Array.from({ length: weekCount }, (_, weekIndex) => {
        const weekNumber = weekIndex + 1;
        const matchup = matchupScores?.find(m => 
          (m.home_team_id === team.id || m.away_team_id === team.id) && 
          m.week_number === weekNumber
        );

        if (!matchup) return "-";
        return matchup.home_team_id === team.id ? 
          matchup.home_score?.toFixed(2) || "-" : 
          matchup.away_score?.toFixed(2) || "-";
      }),
    };
    return acc;
  }, {} as Record<number, { records: string[], scores: string[] }>) || {};

  return (
    <div className="min-h-screen">
      <header className="mb-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">Weekly Scores</h1>
            <p className="text-muted-foreground">Track team records and scores week by week</p>
          </div>
          <SeasonSelector 
            selectedSeason={selectedSeason}
            onSeasonChange={setSelectedSeason}
          />
        </div>
      </header>

      <div className="space-y-8">
        <WeeklyScoresTable 
          teams={teams}
          teamData={teamData}
          weekCount={weekCount}
          regularSeasonWeeks={regularSeasonWeeks}
          selectedSeason={selectedSeason}
        />

        <WLHeatmapCard matchups={matchupScores} />

        <ScheduleTable 
          matchupScores={matchupScores}
          selectedSeason={selectedSeason}
        />
      </div>
    </div>
  );
};

export default WeeklyScores;
