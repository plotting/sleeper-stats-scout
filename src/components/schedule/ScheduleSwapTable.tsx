import { Link } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { MatchupScoresView, Team } from "@/types/database";

interface ScheduleSwapTableProps {
  seasonId: number;
}

const ScheduleSwapTable = ({ seasonId }: ScheduleSwapTableProps) => {
  // Fetch all teams
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

  // Fetch all matchups for the season
  const { data: matchups, isLoading: matchupsLoading } = useQuery({
    queryKey: ['matchups-swap', seasonId],
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

  if (teamsLoading || matchupsLoading) {
    return <p className="text-center py-4">Loading schedule data...</p>;
  }

  const hasCompletedGames = matchups?.some(
    (m) => m.home_score != null && m.away_score != null
  );

  if (!hasCompletedGames) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Season hasn't started yet — schedule analysis will show up after Week 1.
        </CardContent>
      </Card>
    );
  }

  // Calculate swap records
  const calculateSwapRecords = () => {
    if (!teams || !matchups) return {};
    
    const swapRecords: Record<number, Record<number, { wins: number; losses: number; ties: number }>> = {};
    
    // Initialize records
    teams.forEach(teamA => {
      swapRecords[teamA.id] = {};
      teams.forEach(teamB => {
        swapRecords[teamA.id][teamB.id] = { wins: 0, losses: 0, ties: 0 };
      });
    });
    
    // For each team
    teams.forEach(teamA => {
      // For each other team's schedule
      teams.forEach(teamB => {
        if (teamA.id === teamB.id) {
          // Same team, use actual record (from own schedule)
          const teamMatches = matchups.filter(m => 
            m.home_team_id === teamA.id || m.away_team_id === teamA.id
          );
          
          teamMatches.forEach(match => {
            const isHome = match.home_team_id === teamA.id;
            const teamScore = isHome ? match.home_score : match.away_score;
            const oppScore = isHome ? match.away_score : match.home_score;
            
            if (teamScore === null || oppScore === null) return;
            
            if (teamScore > oppScore) swapRecords[teamA.id][teamB.id].wins++;
            else if (teamScore < oppScore) swapRecords[teamA.id][teamB.id].losses++;
            else swapRecords[teamA.id][teamB.id].ties++;
          });
          
          return;
        }
        
        // Check each week of team B's schedule
        const teamBMatches = matchups.filter(m => 
          m.home_team_id === teamB.id || m.away_team_id === teamB.id
        );
        
        teamBMatches.forEach(matchB => {
          // Find teamA's match for the same week
          const teamAMatch = matchups.find(m => 
            (m.home_team_id === teamA.id || m.away_team_id === teamA.id) && 
            m.week_number === matchB.week_number
          );
          
          if (!teamAMatch || !matchB.home_score || !matchB.away_score || 
              !teamAMatch.home_score || !teamAMatch.away_score) {
            return;
          }
          
          // If teams played each other this week, keep original result
          const teamBOpponentId = matchB.home_team_id === teamB.id 
            ? matchB.away_team_id 
            : matchB.home_team_id;
            
          if (teamBOpponentId === teamA.id) {
            const isTeamAHome = teamAMatch.home_team_id === teamA.id;
            const teamAScore = isTeamAHome ? teamAMatch.home_score : teamAMatch.away_score;
            const oppScore = isTeamAHome ? teamAMatch.away_score : teamAMatch.home_score;
            
            if (teamAScore > oppScore) swapRecords[teamA.id][teamB.id].wins++;
            else if (teamAScore < oppScore) swapRecords[teamA.id][teamB.id].losses++;
            else swapRecords[teamA.id][teamB.id].ties++;
            return;
          }
          
          // Find teamA's score for that week
          const isTeamAHome = teamAMatch.home_team_id === teamA.id;
          const teamAScore = isTeamAHome ? teamAMatch.home_score : teamAMatch.away_score;
          
          // Get teamB's opponent's score
          const isTeamBHome = matchB.home_team_id === teamB.id;
          const opponentScore = isTeamBHome ? matchB.away_score : matchB.home_score;
          
          // Compare teamA's score against teamB's opponent
          if (teamAScore > opponentScore) {
            swapRecords[teamA.id][teamB.id].wins++;
          } else if (teamAScore < opponentScore) {
            swapRecords[teamA.id][teamB.id].losses++;
          } else {
            swapRecords[teamA.id][teamB.id].ties++;
          }
        });
      });
    });
    
    return swapRecords;
  };
  
  // Calculate strength of schedule - updated to include all teams
  const calculateStrengthOfSchedule = () => {
    if (!teams || !matchups) return {};
    
    const strengthOfSchedule: Record<number, { 
      totalWins: number;
      totalLosses: number;
      totalTies: number;
      avgWinPct: number;
    }> = {};
    
    // For each team's schedule
    teams.forEach(scheduleTeam => {
      let totalWins = 0;
      let totalLosses = 0;
      let totalTies = 0;
      
      // Get all matchups for this team
      const teamMatches = matchups.filter(m => 
        m.home_team_id === scheduleTeam.id || m.away_team_id === scheduleTeam.id
      );
      
      // For ALL teams (including the schedule owner) playing against this team's schedule
      teams.forEach(playingTeam => {
        const playingTeamResults = { wins: 0, losses: 0, ties: 0 };
        
        // Check each of scheduleTeam's matches
        teamMatches.forEach(match => {
          // Find playingTeam's match for the same week
          const playingTeamMatch = matchups.find(m => 
            (m.home_team_id === playingTeam.id || m.away_team_id === playingTeam.id) && 
            m.week_number === match.week_number
          );
          
          if (!playingTeamMatch || !match.home_score || !match.away_score || 
              !playingTeamMatch.home_score || !playingTeamMatch.away_score) {
            return;
          }
          
          // Get the opponent of scheduleTeam for this match
          const opponentId = match.home_team_id === scheduleTeam.id 
            ? match.away_team_id 
            : match.home_team_id;
          
          // If playing against themselves, keep original result
          if (opponentId === playingTeam.id) {
            const isPlayingTeamHome = playingTeamMatch.home_team_id === playingTeam.id;
            const playingTeamScore = isPlayingTeamHome ? playingTeamMatch.home_score : playingTeamMatch.away_score;
            const oppScore = isPlayingTeamHome ? playingTeamMatch.away_score : playingTeamMatch.home_score;
            
            if (playingTeamScore > oppScore) playingTeamResults.wins++;
            else if (playingTeamScore < oppScore) playingTeamResults.losses++;
            else playingTeamResults.ties++;
            return;
          }
          
          // Get playingTeam's score
          const isPlayingTeamHome = playingTeamMatch.home_team_id === playingTeam.id;
          const playingTeamScore = isPlayingTeamHome ? playingTeamMatch.home_score : playingTeamMatch.away_score;
          
          // Get opponent's score
          const isOpponentHome = match.home_team_id === opponentId;
          const opponentScore = isOpponentHome ? match.home_score : match.away_score;
          
          // Compare playingTeam's score with opponent
          if (playingTeamScore > opponentScore) {
            playingTeamResults.wins++;
          } else if (playingTeamScore < opponentScore) {
            playingTeamResults.losses++;
          } else if (playingTeamScore === opponentScore) { // Explicit equality check for ties
            playingTeamResults.ties++;
          }
        });
        
        totalWins += playingTeamResults.wins;
        totalLosses += playingTeamResults.losses;
        totalTies += playingTeamResults.ties;
      });
      
      const totalGames = totalWins + totalLosses + totalTies;
      const avgWinPct = totalGames > 0 
        ? ((totalWins + (totalTies * 0.5)) / totalGames) * 100 
        : 0;
        
      strengthOfSchedule[scheduleTeam.id] = {
        totalWins,
        totalLosses,
        totalTies,
        avgWinPct
      };
    });
    
    return strengthOfSchedule;
  };

  const swapRecords = calculateSwapRecords();
  const scheduleStrength = calculateStrengthOfSchedule();

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Schedule Swap Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 bg-card z-10">Team \ Schedule</TableHead>
                  {teams?.map(team => (
                    <TableHead key={team.id} className="text-center">
                      <Link 
                        to={`/team/${team.id}?season=${seasonId}`}
                        className="text-primary hover:underline whitespace-nowrap"
                      >
                        {team.name}
                      </Link>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {teams?.map(teamA => (
                  <TableRow key={teamA.id}>
                    <TableCell className="font-medium sticky left-0 bg-background z-10">
                      <Link 
                        to={`/team/${teamA.id}?season=${seasonId}`}
                        className="text-primary hover:underline"
                      >
                        {teamA.name}
                      </Link>
                    </TableCell>
                    {teams?.map(teamB => {
                      const record = swapRecords[teamA.id]?.[teamB.id];
                      if (!record) return <TableCell key={teamB.id}>-</TableCell>;
                      
                      const total = record.wins + record.losses + record.ties;
                      const winPct = total > 0 
                        ? (((record.wins + (record.ties * 0.5)) / total) * 100).toFixed(1) 
                        : "0.0";
                      
                      // Highlight own schedule (actual record)
                      const isOwnSchedule = teamA.id === teamB.id;
                      
                      return (
                        <TableCell 
                          key={teamB.id} 
                          className={`text-center ${isOwnSchedule ? "font-bold bg-muted/50" : ""}`}
                        >
                          {record.wins}-{record.losses}{record.ties > 0 ? `-${record.ties}` : ""}
                          <div className="text-xs text-muted-foreground">
                            {winPct}%
                          </div>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Strength of Schedule</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead>Combined Record</TableHead>
                  <TableHead>Win %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teams?.map(team => {
                  const strength = scheduleStrength[team.id];
                  if (!strength) return null;
                  
                  // Sort by win percentage (ascending - lower means harder schedule)
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
                        {strength.totalWins}-{strength.totalLosses}
                        {strength.totalTies > 0 ? `-${strength.totalTies}` : ""}
                      </TableCell>
                      <TableCell>
                        {strength.avgWinPct.toFixed(1)}%
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

export default ScheduleSwapTable;
