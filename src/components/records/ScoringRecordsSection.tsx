
import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ScoreHover } from "@/components/shared/ScoreHover";
import { useAllTimeScorePool } from "@/hooks/useAllTimeScorePool";
import { computeWinPct } from "@/utils/scorePercentile";

interface ScoringRecord {
  score: number;
  team: string;
  opponent: string;
  season: number;
  week: number;
  gameScore: string;
  isAdjusted?: boolean;
  adjustmentReason?: string;
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
            <TableCell className={cn("font-semibold", scoreColor)}>
              <ScoreHover score={record.score} excludeSelf>
                {record.score.toFixed(1)}
              </ScoreHover>
              {record.isAdjusted && (
                <span
                  className="ml-0.5 text-amber-400 cursor-help"
                  title={`Official score reflects a penalty: ${record.adjustmentReason ?? "adjustment applied"}`}
                >
                  *
                </span>
              )}
            </TableCell>
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

function ScoreComparator() {
  const { pool, isLoading } = useAllTimeScorePool();
  const [value, setValue] = useState("");

  const result = useMemo(() => {
    const score = parseFloat(value);
    if (Number.isNaN(score) || pool.length === 0) return null;
    return computeWinPct(score, pool);
  }, [value, pool]);

  return (
    <Card className="p-6 border-white/10 bg-[#0f172a] md:col-span-2">
      <h2 className="text-xl font-semibold mb-1">Score Comparator</h2>
      <p className="text-xs text-muted-foreground mb-4">
        See how any score stacks up against every regular-season score ever recorded in the league —
        updates automatically as new games are played. (Individual scores throughout the site show this
        on hover too.)
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <Input
          type="number"
          step="0.1"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Enter a score, e.g. 150.5"
          className="w-48"
          disabled={isLoading}
        />
        {result && (
          <p className="text-sm">
            Would have beaten{" "}
            <span className="font-semibold text-emerald-400">
              {result.wins}{result.ties > 0 ? ` (+${result.ties} tied)` : ""}
            </span>{" "}
            of {result.total} games ever played —{" "}
            <span className="font-semibold text-white">{result.pct.toFixed(1)}%</span>
          </p>
        )}
      </div>
    </Card>
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
      <ScoreComparator />

      <Card className="p-6 border-white/10 bg-[#0f172a]">
        <h2 className="text-xl font-semibold mb-4">Highest Regular Season Scores</h2>
        <ScoreTable records={regularSeasonHigh} variant="high" />
      </Card>
      <Card className="p-6 border-white/10 bg-[#0f172a]">
        <h2 className="text-xl font-semibold mb-4">Lowest Regular Season Scores</h2>
        <ScoreTable records={regularSeasonLow} variant="low" />
      </Card>

      <Card className="p-6 border-white/10 bg-[#0f172a]">
        <h2 className="text-xl font-semibold mb-4">Highest Playoff Scores</h2>
        <ScoreTable records={playoffHigh} variant="high" />
      </Card>
      <Card className="p-6 border-white/10 bg-[#0f172a]">
        <h2 className="text-xl font-semibold mb-4">Lowest Playoff Scores</h2>
        <ScoreTable records={playoffLow} variant="low" />
      </Card>

      <Card className="p-6 border-white/10 bg-[#0f172a]">
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

      <Card className="p-6 border-white/10 bg-[#0f172a]">
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

      <Card className="p-6 border-white/10 bg-[#0f172a]">
        <h2 className="text-xl font-semibold mb-4">Highest Single-Season PPG</h2>
        <p className="text-xs text-muted-foreground -mt-3 mb-4">Regular season, minimum 5 games played</p>
        <PpgTable records={highestSeasonPpg} variant="high" />
      </Card>
      <Card className="p-6 border-white/10 bg-[#0f172a]">
        <h2 className="text-xl font-semibold mb-4">Lowest Single-Season PPG</h2>
        <p className="text-xs text-muted-foreground -mt-3 mb-4">Regular season, minimum 5 games played</p>
        <PpgTable records={lowestSeasonPpg} variant="low" />
      </Card>
    </div>
  );
};
