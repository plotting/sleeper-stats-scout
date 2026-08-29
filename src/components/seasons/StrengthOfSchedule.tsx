import { Link } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { MatchupScoresView, Team, TeamRecordsView } from "@/types/database";

interface StrengthOfScheduleProps {
  seasonId: number;
}

const StrengthOfSchedule = ({ seasonId }: StrengthOfScheduleProps) => {
  // Only show for season 2 and higher
  if (seasonId < 2) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">
          Strength of Schedule analysis is available starting from Season 2.
        </CardContent>
      </Card>
    );
  }

  // Fetch teams
  const { data: teams, isLoading: teamsLoading } = useQuery({
    queryKey: ['teams'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('*')
        .order('id');
      if (error) throw error;
      return data as Team[];
    },
  });

  // Fetch current season matchups
  const { data: currentMatchups, isLoading: currentLoading } = useQuery({
    queryKey: ['matchups-sos-current', seasonId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matchup_scores_view')
        .select('*')
        .eq('season_id', seasonId)
        .not('is_playoff', 'eq', true)
        .not('is_consolation', 'eq', true)
        .order('week_number');
      if (error) throw error;
      return data as MatchupScoresView[];
    },
  });

  // Fetch prior season records
  const { data: priorSeasonRecords } = useQuery({
    queryKey: ['team-records-prior', seasonId - 1],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_records_view')
        .select('*')
        .eq('season_id', seasonId - 1);
      if (error) throw error;
      return data as TeamRecordsView[];
    },
  });

  // Fetch prior season matchups
  const { data: priorMatchups } = useQuery({
    queryKey: ['matchups-sos-prior', seasonId - 1],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matchup_scores_view')
        .select('*')
        .eq('season_id', seasonId - 1)
        .not('is_playoff', 'eq', true)
        .not('is_consolation', 'eq', true)
        .order('week_number');
      if (error) throw error;
      return data as MatchupScoresView[];
    },
  });

  if (teamsLoading || currentLoading) {
    return <p className="text-center py-4">Loading strength of schedule data...</p>;
  }

  if (!currentMatchups || currentMatchups.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Season {seasonId}'s schedule hasn't been generated yet — strength of schedule will show up once it has.
        </CardContent>
      </Card>
    );
  }

  // Calculate Preseason SOS
  const calculatePreseasonSOS = () => {
    if (!teams || !currentMatchups || !priorSeasonRecords) return {};

    const priorRecordsMap = new Map<number, { wins: number; losses: number; ties: number; winPct: number }>();
    
    priorSeasonRecords.forEach(record => {
      const wins = record.regular_season_wins || 0;
      const losses = record.regular_season_losses || 0;
      const ties = record.regular_season_ties || 0;
      const total = wins + losses + ties;
      const winPct = total > 0 ? ((wins + (ties * 0.5)) / total) : 0;
      
      priorRecordsMap.set(record.team_id!, { wins, losses, ties, winPct });
    });

    const preseasonSOS: Record<number, { 
      avgWinPct: number; 
      totalGames: number;
      combinedWins: number;
      combinedLosses: number;
      combinedTies: number;
    }> = {};

    teams.forEach(team => {
      const teamMatches = currentMatchups.filter(m => 
        m.home_team_id === team.id || m.away_team_id === team.id
      );

      let totalWinPct = 0;
      let gameCount = 0;
      let combinedWins = 0;
      let combinedLosses = 0;
      let combinedTies = 0;

      teamMatches.forEach(match => {
        const opponentId = match.home_team_id === team.id ? match.away_team_id : match.home_team_id;
        const opponentRecord = priorRecordsMap.get(opponentId);
        
        if (opponentRecord) {
          totalWinPct += opponentRecord.winPct;
          gameCount++;
          combinedWins += opponentRecord.wins;
          combinedLosses += opponentRecord.losses;
          combinedTies += opponentRecord.ties;
        }
      });

      preseasonSOS[team.id] = {
        avgWinPct: gameCount > 0 ? (totalWinPct / gameCount) * 100 : 0,
        totalGames: gameCount,
        combinedWins,
        combinedLosses,
        combinedTies
      };
    });

    return preseasonSOS;
  };

  // Calculate SOS if played everyone (from prior season)
  const calculateEveryoneSOS = () => {
    if (!teams || !currentMatchups || !priorMatchups) return {};

    // Calculate what each team's record would be if they played everyone every week in prior season
    const everyoneRecords = new Map<number, { wins: number; losses: number; ties: number; winPct: number }>();

    teams.forEach(teamA => {
      let totalWins = 0;
      let totalLosses = 0;
      let totalTies = 0;

      teams.forEach(teamB => {
        if (teamA.id === teamB.id) return; // Skip self

        // For each week, compare teamA's score vs teamB's opponents
        const weeks = Array.from(new Set(priorMatchups.map(m => m.week_number)));
        
        weeks.forEach(week => {
          const teamAMatch = priorMatchups.find(m => 
            (m.home_team_id === teamA.id || m.away_team_id === teamA.id) && 
            m.week_number === week
          );
          
          const teamBMatch = priorMatchups.find(m => 
            (m.home_team_id === teamB.id || m.away_team_id === teamB.id) && 
            m.week_number === week
          );

          if (!teamAMatch || !teamBMatch || 
              teamAMatch.home_score === null || teamAMatch.away_score === null ||
              teamBMatch.home_score === null || teamBMatch.away_score === null) {
            return;
          }

          const teamAScore = teamAMatch.home_team_id === teamA.id 
            ? teamAMatch.home_score 
            : teamAMatch.away_score;
          
          const teamBScore = teamBMatch.home_team_id === teamB.id 
            ? teamBMatch.home_score 
            : teamBMatch.away_score;

          if (teamAScore > teamBScore) totalWins++;
          else if (teamAScore < teamBScore) totalLosses++;
          else totalTies++;
        });
      });

      const totalGames = totalWins + totalLosses + totalTies;
      const winPct = totalGames > 0 ? ((totalWins + (totalTies * 0.5)) / totalGames) : 0;
      
      everyoneRecords.set(teamA.id, { wins: totalWins, losses: totalLosses, ties: totalTies, winPct });
    });

    // Now calculate SOS based on current season schedule using everyone records
    const everyoneSOS: Record<number, { 
      avgWinPct: number; 
      totalGames: number;
      combinedWins: number;
      combinedLosses: number;
      combinedTies: number;
    }> = {};

    teams.forEach(team => {
      const teamMatches = currentMatchups.filter(m => 
        m.home_team_id === team.id || m.away_team_id === team.id
      );

      let totalWinPct = 0;
      let gameCount = 0;
      let combinedWins = 0;
      let combinedLosses = 0;
      let combinedTies = 0;

      teamMatches.forEach(match => {
        const opponentId = match.home_team_id === team.id ? match.away_team_id : match.home_team_id;
        const opponentRecord = everyoneRecords.get(opponentId);
        
        if (opponentRecord) {
          totalWinPct += opponentRecord.winPct;
          gameCount++;
          combinedWins += opponentRecord.wins;
          combinedLosses += opponentRecord.losses;
          combinedTies += opponentRecord.ties;
        }
      });

      everyoneSOS[team.id] = {
        avgWinPct: gameCount > 0 ? (totalWinPct / gameCount) * 100 : 0,
        totalGames: gameCount,
        combinedWins,
        combinedLosses,
        combinedTies
      };
    });

    return everyoneSOS;
  };

  const preseasonSOS = calculatePreseasonSOS();
  const everyoneSOS = calculateEveryoneSOS();

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Preseason Strength of Schedule</CardTitle>
          <p className="text-sm text-muted-foreground">
            Based on opponents' records from Season {seasonId - 1}
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead>Combined Opponents Record</TableHead>
                  <TableHead>Opponents' Avg Win %</TableHead>
                  <TableHead>Games</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teams?.sort((a, b) => {
                  const aWinPct = preseasonSOS[a.id]?.avgWinPct || 0;
                  const bWinPct = preseasonSOS[b.id]?.avgWinPct || 0;
                  return bWinPct - aWinPct; // Sort by hardest schedule first
                }).map(team => {
                  const sos = preseasonSOS[team.id];
                  if (!sos) return null;
                  
                  return (
                    <TableRow key={team.id}>
                      <TableCell>
                        <Link 
                          to={`/team/${team.id}?season=${seasonId}`}
                          className="text-primary hover:underline"
                        >
                          {team.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {sos.combinedWins}-{sos.combinedLosses}
                        {sos.combinedTies > 0 ? `-${sos.combinedTies}` : ""}
                      </TableCell>
                      <TableCell>
                        {sos.avgWinPct.toFixed(1)}%
                      </TableCell>
                      <TableCell>
                        {sos.totalGames}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SOS if Everyone Played Everyone</CardTitle>
          <p className="text-sm text-muted-foreground">
            Based on hypothetical records if all teams played each other every week in Season {seasonId - 1}
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead>Combined Opponents Record</TableHead>
                  <TableHead>Opponents' Avg Win %</TableHead>
                  <TableHead>Games</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teams?.sort((a, b) => {
                  const aWinPct = everyoneSOS[a.id]?.avgWinPct || 0;
                  const bWinPct = everyoneSOS[b.id]?.avgWinPct || 0;
                  return bWinPct - aWinPct; // Sort by hardest schedule first
                }).map(team => {
                  const sos = everyoneSOS[team.id];
                  if (!sos) return null;
                  
                  return (
                    <TableRow key={team.id}>
                      <TableCell>
                        <Link 
                          to={`/team/${team.id}?season=${seasonId}`}
                          className="text-primary hover:underline"
                        >
                          {team.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {sos.combinedWins}-{sos.combinedLosses}
                        {sos.combinedTies > 0 ? `-${sos.combinedTies}` : ""}
                      </TableCell>
                      <TableCell>
                        {sos.avgWinPct.toFixed(1)}%
                      </TableCell>
                      <TableCell>
                        {sos.totalGames}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default StrengthOfSchedule;