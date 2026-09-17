
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface ScoringRecord {
  score: number;
  team: string;
  opponent: string;
  season: number;
  week: number;
  gameScore: string;
}

interface MarginRecord {
  margin: number;
  winner: string;
  loser: string;
  season: number;
  week: number;
  score: string;
}

interface CombinedRecord {
  total: number;
  teams: string;
  season: number;
  week: number;
  score: string;
}

interface SeasonPpgRecord {
  team: string;
  season: number;
  games: number;
  ppg: number;
}

interface ScoringRecordsSectionProps {
  regularSeasonHigh: ScoringRecord[];
  regularSeasonLow: ScoringRecord[];
  playoffHigh: ScoringRecord[];
  playoffLow: ScoringRecord[];
  largestMargins: MarginRecord[];
  highestCombined: CombinedRecord[];
  highestSeasonPpg: SeasonPpgRecord[];
  lowestSeasonPpg: SeasonPpgRecord[];
}

function ScoreTable({ records, variant }: { records: ScoringRecord[]; variant: "high" | "low" }) {
  const scoreColor = variant === "high" ? "text-emerald-400" : "text-red-400";
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Score</TableHead>
          <TableHead>Team</TableHead>
          <TableHead>Opponent</TableHead>
          <TableHead>Season/Week</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {records.map((record, index) => (
          <TableRow key={index}>
            <TableCell className={cn("font-semibold", scoreColor)}>{record.score.toFixed(1)}</TableCell>
            <TableCell>{record.team}</TableCell>
            <TableCell>{record.opponent}</TableCell>
            <TableCell>{`S${record.season}/W${record.week}`}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function PpgTable({ records, variant }: { records: SeasonPpgRecord[]; variant: "high" | "low" }) {
  const scoreColor = variant === "high" ? "text-emerald-400" : "text-red-400";
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>PPG</TableHead>
          <TableHead>Team</TableHead>
          <TableHead>Season</TableHead>
          <TableHead>Games</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {records.map((record, index) => (
          <TableRow key={index}>
            <TableCell className={cn("font-semibold", scoreColor)}>{record.ppg.toFixed(1)}</TableCell>
            <TableCell>{record.team}</TableCell>
            <TableCell>{`S${record.season}`}</TableCell>
            <TableCell>{record.games}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export const ScoringRecordsSection = ({
  regularSeasonHigh,
  regularSeasonLow,
  playoffHigh,
  playoffLow,
  largestMargins,
  highestCombined,
  highestSeasonPpg,
  lowestSeasonPpg,
}: ScoringRecordsSectionProps) => {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card className="p-6 border-white/10 bg-[#1a1a2e]">
        <h2 className="text-xl font-semibold mb-4">Highest Regular Season Scores</h2>
        <ScoreTable records={regularSeasonHigh} variant="high" />
      </Card>
      <Card className="p-6 border-white/10 bg-[#1a1a2e]">
        <h2 className="text-xl font-semibold mb-4">Lowest Regular Season Scores</h2>
        <ScoreTable records={regularSeasonLow} variant="low" />
      </Card>

      <Card className="p-6 border-white/10 bg-[#1a1a2e]">
        <h2 className="text-xl font-semibold mb-4">Highest Playoff Scores</h2>
        <ScoreTable records={playoffHigh} variant="high" />
      </Card>
      <Card className="p-6 border-white/10 bg-[#1a1a2e]">
        <h2 className="text-xl font-semibold mb-4">Lowest Playoff Scores</h2>
        <ScoreTable records={playoffLow} variant="low" />
      </Card>

      <Card className="p-6 border-white/10 bg-[#1a1a2e]">
        <h2 className="text-xl font-semibold mb-4">Largest Margins of Victory</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Winner</TableHead>
              <TableHead>Loser</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Season/Week</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {largestMargins.map((record, index) => (
              <TableRow key={index}>
                <TableCell className="font-medium">{record.winner}</TableCell>
                <TableCell>{record.loser}</TableCell>
                <TableCell>{record.score}</TableCell>
                <TableCell>{`S${record.season}/W${record.week}`}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-6 border-white/10 bg-[#1a1a2e]">
        <h2 className="text-xl font-semibold mb-4">Highest Combined Scores</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Teams</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Season/Week</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {highestCombined.map((record, index) => (
              <TableRow key={index}>
                <TableCell className="font-medium">{record.teams}</TableCell>
                <TableCell>{record.score}</TableCell>
                <TableCell>{record.total.toFixed(1)}</TableCell>
                <TableCell>{`S${record.season}/W${record.week}`}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-6 border-white/10 bg-[#1a1a2e]">
        <h2 className="text-xl font-semibold mb-4">Highest Single-Season PPG</h2>
        <p className="text-xs text-muted-foreground -mt-3 mb-4">Regular season, minimum 5 games played</p>
        <PpgTable records={highestSeasonPpg} variant="high" />
      </Card>
      <Card className="p-6 border-white/10 bg-[#1a1a2e]">
        <h2 className="text-xl font-semibold mb-4">Lowest Single-Season PPG</h2>
        <p className="text-xs text-muted-foreground -mt-3 mb-4">Regular season, minimum 5 games played</p>
        <PpgTable records={lowestSeasonPpg} variant="low" />
      </Card>
    </div>
  );
};
