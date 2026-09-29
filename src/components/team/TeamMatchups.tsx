
import { Link } from "react-router-dom";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { MatchupScoresView } from "@/types/database";
import { ScoreHover } from "@/components/shared/ScoreHover";

interface TeamMatchupsProps {
  teamId: number;
  selectedSeason: string;
}

const TeamMatchups = ({ teamId, selectedSeason }: TeamMatchupsProps) => {
  const { data: matchups, isLoading } = useQuery({
    queryKey: ['team-matchups', teamId, selectedSeason],
    queryFn: async () => {
      if (!teamId) throw new Error('No team ID provided');
      const { data, error } = await supabase
        .from('matchup_scores_view')
        .select('*')
        .eq('season_id', parseInt(selectedSeason))
        .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
        .order('week_number');

      if (error) throw error;
      return data || [];
    },
    enabled: !!teamId,
    retry: 1,
  });

  if (isLoading) {
    return (
      <Card className="p-6">
        <h2 className="text-xl font-bold mb-4">Weekly Matchups</h2>
        <div className="flex justify-center py-8">
          Loading matchups...
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h2 className="text-xl font-bold mb-4">Weekly Matchups</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Week</TableHead>
            <TableHead>Opponent</TableHead>
            <TableHead>Score</TableHead>
            <TableHead>Record</TableHead>
            <TableHead>Type</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {matchups && matchups.length > 0 ? (
            matchups.map((matchup) => {
              const isHomeTeam = matchup.home_team_id === teamId;
              const opponentId = isHomeTeam ? matchup.away_team_id : matchup.home_team_id;
              const opponentName = isHomeTeam ? matchup.away_team_name : matchup.home_team_name;
              const teamScore = isHomeTeam ? matchup.home_score : matchup.away_score;
              const opponentScore = isHomeTeam ? matchup.away_score : matchup.home_score;
              const result = teamScore !== null && opponentScore !== null
                ? teamScore > opponentScore 
                  ? 'W' 
                  : teamScore < opponentScore 
                    ? 'L'
                    : 'T'
                : null;

              return (
                <TableRow key={matchup.week_number}>
                  <TableCell>Week {matchup.week_number}</TableCell>
                  <TableCell>
                    <Link 
                      to={`/team/${opponentId}?season=${selectedSeason}`}
                      className="text-primary hover:underline"
                    >
                      {opponentName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {teamScore !== null && opponentScore !== null ? (
                      <span className={
                        result === 'W' 
                          ? 'text-green-500' 
                          : result === 'L' 
                            ? 'text-red-500'
                            : 'text-yellow-500'
                      }>
                        <ScoreHover score={teamScore} excludeSelf={!matchup.is_playoff}>{teamScore.toFixed(2)}</ScoreHover>
                        {" - "}
                        <ScoreHover score={opponentScore} excludeSelf={!matchup.is_playoff}>{opponentScore.toFixed(2)}</ScoreHover>
                      </span>
                    ) : (
                      'TBD'
                    )}
                  </TableCell>
                  <TableCell>
                    {teamScore !== null && opponentScore !== null && (
                      <span className={`font-bold ${
                        result === 'W' 
                          ? 'text-green-500' 
                          : result === 'L'
                            ? 'text-red-500'
                            : 'text-yellow-500'
                      }`}>
                        {result}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {matchup.is_playoff ? (
                      matchup.is_playoff_bracket ? 'Playoff' : 'Consolation'
                    ) : (
                      'Regular Season'
                    )}
                  </TableCell>
                </TableRow>
              );
            })
          ) : (
            <TableRow>
              <TableCell colSpan={5} className="text-center py-4">
                No matchups found for this season
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  );
};

export default TeamMatchups;
