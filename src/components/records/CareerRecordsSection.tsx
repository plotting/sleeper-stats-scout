
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface CareerStats {
  team: string;
  regularSeason: {
    wins: number;
    losses: number;
    ties: number;
    percentage: number;
  };
  playoffs: {
    wins: number;
    losses: number;
    ties: number;
    percentage: number;
  };
  consolation: {
    wins: number;
    losses: number;
    ties: number;
    percentage: number;
  };
  hypothetical: {
    wins: number;
    losses: number;
    ties: number;
    percentage: number;
  };
  scoring: {
    hundredPlus: number;
    highestScore: number;
    lowestScore: number;
    timesHighest: number;
    timesLowest: number;
    vsHighest: number;
    vsLowest: number;
  };
  careerRecord?: {
    wins: number;
    losses: number;
    ties: number;
    percentage: number;
  };
  careerPpg: number;
}

interface CareerRecordsSectionProps {
  careerStats: CareerStats[];
}

export const CareerRecordsSection = ({ careerStats }: CareerRecordsSectionProps) => {
  // Calculate total career record percentages
  const statsWithCareerPercentage = careerStats.map(stat => {
    const totalWins = stat.regularSeason.wins + stat.playoffs.wins + stat.consolation.wins;
    const totalLosses = stat.regularSeason.losses + stat.playoffs.losses + stat.consolation.losses;
    const totalTies = stat.regularSeason.ties + stat.playoffs.ties + stat.consolation.ties;
    const totalGames = totalWins + totalLosses + totalTies;
    
    const careerPercentage = totalGames > 0 
      ? ((totalWins + (totalTies * 0.5)) / totalGames) * 100 
      : 0;
    
    return {
      ...stat,
      careerRecord: {
        wins: totalWins,
        losses: totalLosses,
        ties: totalTies,
        percentage: careerPercentage
      }
    };
  });
  
  // Sort stats by career percentage in descending order
  const sortedStats = [...statsWithCareerPercentage].sort(
    (a, b) => b.careerRecord.percentage - a.careerRecord.percentage
  );

  const ppgValues = sortedStats.map((s) => s.careerPpg).filter((v) => v > 0);
  const highestPpg = ppgValues.length ? Math.max(...ppgValues) : null;
  const lowestPpg = ppgValues.length ? Math.min(...ppgValues) : null;

  return (
    <div className="space-y-6">
      <Card className="p-6 overflow-x-auto">
        <h2 className="text-xl font-semibold mb-4">Career Records</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Team</TableHead>
              <TableHead>Career Record</TableHead>
              <TableHead>Regular Season</TableHead>
              <TableHead>Playoffs</TableHead>
              <TableHead>Consolation</TableHead>
              <TableHead>Vs All</TableHead>
              <TableHead>Career PPG</TableHead>
              <TableHead>100+ Games</TableHead>
              <TableHead>High/Low</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedStats.map((stat, index) => (
              <TableRow key={index}>
                <TableCell className="font-medium whitespace-nowrap">{stat.team}</TableCell>
                <TableCell>
                  {`${stat.careerRecord.wins}-${stat.careerRecord.losses}-${stat.careerRecord.ties}`}
                  <br />
                  <span className="text-sm text-muted-foreground">
                    {stat.careerRecord.percentage.toFixed(1)}%
                  </span>
                </TableCell>
                <TableCell>
                  {`${stat.regularSeason.wins}-${stat.regularSeason.losses}-${stat.regularSeason.ties}`}
                  <br />
                  <span className="text-sm text-muted-foreground">
                    {stat.regularSeason.percentage.toFixed(1)}%
                  </span>
                </TableCell>
                <TableCell>
                  {`${stat.playoffs.wins}-${stat.playoffs.losses}-${stat.playoffs.ties}`}
                  <br />
                  <span className="text-sm text-muted-foreground">
                    {stat.playoffs.percentage.toFixed(1)}%
                  </span>
                </TableCell>
                <TableCell>
                  {`${stat.consolation.wins}-${stat.consolation.losses}-${stat.consolation.ties}`}
                  <br />
                  <span className="text-sm text-muted-foreground">
                    {stat.consolation.percentage.toFixed(1)}%
                  </span>
                </TableCell>
                <TableCell>
                  {`${stat.hypothetical.wins}-${stat.hypothetical.losses}-${stat.hypothetical.ties}`}
                  <br />
                  <span className="text-sm text-muted-foreground">
                    {stat.hypothetical.percentage.toFixed(1)}%
                  </span>
                </TableCell>
                <TableCell>
                  <span className={
                    stat.careerPpg === highestPpg ? "text-emerald-400 font-semibold"
                    : stat.careerPpg === lowestPpg ? "text-red-400 font-semibold"
                    : ""
                  }>
                    {stat.careerPpg.toFixed(1)}
                  </span>
                </TableCell>
                <TableCell>{stat.scoring.hundredPlus}</TableCell>
                <TableCell>
                  <div className="text-sm">
                    Highest: {stat.scoring.timesHighest}<br />
                    Lowest: {stat.scoring.timesLowest}<br />
                    vs High: {stat.scoring.vsHighest}<br />
                    vs Low: {stat.scoring.vsLowest}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
};
