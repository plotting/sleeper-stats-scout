
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MatchupScoresView } from "@/types/database";

interface AllTimeScheduleRecordsProps {
  matchups: MatchupScoresView[];
}

interface ScheduleRecord {
  team: string;
  season: number;
  percentage: number;
  record: string;
  details: string;
}

export const AllTimeScheduleRecords = ({ matchups }: AllTimeScheduleRecordsProps) => {
  const calculateScheduleRecords = () => {
    if (!matchups) return { hardest: [], easiest: [] };

    // Filter out playoff games to only include regular season
    const regularSeasonMatchups = matchups.filter(m => !m.is_playoff && !m.is_consolation);
    
    const scheduleRecords = new Map<string, ScheduleRecord>();

    // Process each season's schedules
    const seasons = new Set(regularSeasonMatchups.map(m => m.season_id));
    seasons.forEach(seasonId => {
      const seasonMatches = regularSeasonMatchups.filter(m => m.season_id === seasonId);
      const teams = new Set(seasonMatches.map(m => m.home_team_name));

      teams.forEach(teamName => {
        if (!teamName) return;
        
        const teamMatches = seasonMatches.filter(m => 
          m.home_team_name === teamName || m.away_team_name === teamName
        );

        let totalWins = 0;
        let totalGames = 0;

        teams.forEach(otherTeam => {
          if (!otherTeam) return;
          const wins = calculateTeamWinsWithSchedule(seasonMatches, teamName, otherTeam);
          totalWins += wins.wins;
          totalGames += wins.games;
        });

        const percentage = (totalWins / totalGames) * 100;
        const record = `${totalWins}-${totalGames - totalWins}`;
        const key = `${teamName}-${seasonId}`;

        scheduleRecords.set(key, {
          team: teamName,
          season: seasonId,
          percentage,
          record,
          details: `${record} (${percentage.toFixed(1)}%)`
        });
      });
    });

    const records = Array.from(scheduleRecords.values());
    records.sort((a, b) => b.percentage - a.percentage);

    return {
      hardest: records.slice(0, 10),
      easiest: records.slice(-10).reverse()
    };
  };

  const calculateTeamWinsWithSchedule = (
    matches: MatchupScoresView[],
    scheduleTeam: string,
    playingTeam: string
  ) => {
    let wins = 0;
    let games = 0;

    const scheduleMatches = matches.filter(m =>
      m.home_team_name === scheduleTeam || m.away_team_name === scheduleTeam
    );

    scheduleMatches.forEach(match => {
      if (!match.home_score || !match.away_score) return;

      // If it's a head-to-head matchup, use actual result
      if (match.home_team_name === playingTeam || match.away_team_name === playingTeam) {
        const isPlayingTeamHome = match.home_team_name === playingTeam;
        if (isPlayingTeamHome && match.home_score > match.away_score) wins++;
        if (!isPlayingTeamHome && match.away_score > match.home_score) wins++;
        games++;
        return;
      }

      // Otherwise, swap in the playing team's score from their game that week
      const playingTeamMatch = matches.find(m =>
        (m.home_team_name === playingTeam || m.away_team_name === playingTeam) &&
        m.week_number === match.week_number
      );

      if (!playingTeamMatch?.home_score || !playingTeamMatch?.away_score) return;

      const playingTeamScore = playingTeamMatch.home_team_name === playingTeam
        ? playingTeamMatch.home_score
        : playingTeamMatch.away_score;

      const opponentScore = match.home_team_name === scheduleTeam
        ? match.away_score
        : match.home_score;

      if (playingTeamScore > opponentScore) wins++;
      games++;
    });

    return { wins, games };
  };

  const { hardest, easiest } = calculateScheduleRecords();

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card className="p-6 border-white/10 bg-[#1a1a2e]">
        <h2 className="text-xl font-semibold mb-4">Hardest Schedules of All Time</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Team</TableHead>
              <TableHead>Season</TableHead>
              <TableHead>Record</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {hardest.map((record, index) => (
              <TableRow key={index}>
                <TableCell className="font-medium">{record.team}</TableCell>
                <TableCell>{record.season}</TableCell>
                <TableCell>{record.details}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-6 border-white/10 bg-[#1a1a2e]">
        <h2 className="text-xl font-semibold mb-4">Easiest Schedules of All Time</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Team</TableHead>
              <TableHead>Season</TableHead>
              <TableHead>Record</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {easiest.map((record, index) => (
              <TableRow key={index}>
                <TableCell className="font-medium">{record.team}</TableCell>
                <TableCell>{record.season}</TableCell>
                <TableCell>{record.details}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
};
