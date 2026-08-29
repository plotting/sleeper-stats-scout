
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { MatchupScoresView } from "@/types/database";

const WeeklyRecords = () => {
  const [selectedWeek, setSelectedWeek] = useState("1");
  const weeks = Array.from({ length: 17 }, (_, i) => (i + 1).toString());

  const { data: weeklyStats, isLoading } = useQuery({
    queryKey: ['weekly-stats', selectedWeek],
    queryFn: async () => {
      const { data: teams, error: teamsError } = await supabase
        .from('teams')
        .select('*')
        .order('id');
      
      if (teamsError) throw teamsError;

      const { data: matchups, error: matchupsError } = await supabase
        .from('matchup_scores_view')
        .select('*')
        .eq('week_number', parseInt(selectedWeek))
        .order('week_number');

      if (matchupsError) throw matchupsError;

      return teams.map(team => {
        const teamMatchups = (matchups as MatchupScoresView[]).filter(
          m => m.home_team_id === team.id || m.away_team_id === team.id
        );

        const validMatchups = teamMatchups.filter(m =>
          m.home_score !== null && m.away_score !== null
        );

        const scores = validMatchups.map(m =>
          m.home_team_id === team.id ? m.home_score : m.away_score
        ) as number[];

        const wins = validMatchups.filter(m =>
          (m.home_team_id === team.id && m.home_score! > m.away_score!) ||
          (m.away_team_id === team.id && m.away_score! > m.home_score!)
        ).length;

        const losses = validMatchups.filter(m =>
          (m.home_team_id === team.id && m.home_score! < m.away_score!) ||
          (m.away_team_id === team.id && m.away_score! < m.home_score!)
        ).length;

        const ties = validMatchups.filter(m =>
          m.home_score! === m.away_score!
        ).length;

        const avgPoints = scores.length > 0
          ? scores.reduce((a, b) => a + b, 0) / scores.length
          : 0;

        // Dynamic seasons: collect distinct years where this team played this week
        const seasonYears = [...new Set(validMatchups.map(m => m.season_id))].sort();
        const seasonsLabel = seasonYears.length === 0
          ? "—"
          : seasonYears.length === 1
            ? `${seasonYears[0]}`
            : `${seasonYears[0]}–${seasonYears[seasonYears.length - 1]} (${seasonYears.length})`;

        return {
          team: team.name,
          wins,
          losses,
          ties,
          avgPoints,
          bestScore: scores.length ? Math.max(...scores) : 0,
          worstScore: scores.length ? Math.min(...scores) : 0,
          seasons: seasonsLabel
        };
      });
    }
  });

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-screen">
      <div className="text-lg text-muted-foreground">Loading weekly records...</div>
    </div>;
  }

  return (
    <div className="min-h-screen">
      <header className="mb-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">Weekly Records</h1>
            <p className="text-muted-foreground">Historical performance by week</p>
          </div>
          <Select value={selectedWeek} onValueChange={setSelectedWeek}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select Week" />
            </SelectTrigger>
            <SelectContent>
              {weeks.map((week) => (
                <SelectItem key={week} value={week}>
                  Week {week}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      <Card className="p-6">
        <h2 className="text-2xl font-bold mb-4">Week {selectedWeek} Statistics</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Team</TableHead>
              <TableHead>Record (W-L-T)</TableHead>
              <TableHead>Avg Points</TableHead>
              <TableHead>Best Score</TableHead>
              <TableHead>Worst Score</TableHead>
              <TableHead>Seasons</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {weeklyStats?.map((record, index) => (
              <TableRow key={index}>
                <TableCell className="font-medium">{record.team}</TableCell>
                <TableCell>{`${record.wins}-${record.losses}-${record.ties}`}</TableCell>
                <TableCell>{record.avgPoints.toFixed(2)}</TableCell>
                <TableCell>{record.bestScore.toFixed(2)}</TableCell>
                <TableCell>{record.worstScore.toFixed(2)}</TableCell>
                <TableCell>{record.seasons}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
};

export default WeeklyRecords;
