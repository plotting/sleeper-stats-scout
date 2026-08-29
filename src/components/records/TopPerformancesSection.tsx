
import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Flame, Snowflake } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MatchupScoresView } from "@/types/database";

interface PerformanceRow {
  teamId: number | null;
  teamName: string;
  opponentName: string;
  score: number;
  opponentScore: number;
  week: number;
  seasonLabel: string;
  won: boolean | null;
  isPlayoff: boolean;
}

function computePerformances(
  allMatchups: MatchupScoresView[],
  yearMap: Map<number, number>,
): PerformanceRow[] {
  const rows: PerformanceRow[] = [];

  for (const m of allMatchups) {
    if (!m.home_team_id || !m.away_team_id || m.home_score == null || m.away_score == null) continue;
    const year = yearMap.get(m.season_id!) ?? m.season_id!;
    const seasonLabel = String(year);

    rows.push({
      teamId: m.home_team_id,
      teamName: m.home_team_name!,
      opponentName: m.away_team_name!,
      score: m.home_score,
      opponentScore: m.away_score,
      week: m.week_number!,
      seasonLabel,
      won: m.home_score > m.away_score ? true : m.home_score < m.away_score ? false : null,
      isPlayoff: !!m.is_playoff || !!m.is_consolation,
    });
    rows.push({
      teamId: m.away_team_id,
      teamName: m.away_team_name!,
      opponentName: m.home_team_name!,
      score: m.away_score,
      opponentScore: m.home_score,
      week: m.week_number!,
      seasonLabel,
      won: m.away_score > m.home_score ? true : m.away_score < m.home_score ? false : null,
      isPlayoff: !!m.is_playoff || !!m.is_consolation,
    });
  }

  return rows;
}

interface Props {
  allMatchups: MatchupScoresView[];
  yearMap: Map<number, number>;
}

export function TopPerformancesSection({ allMatchups, yearMap }: Props) {
  const [mode, setMode] = useState<"top" | "bottom">("top");
  const [count, setCount] = useState(25);

  const all = useMemo(() => computePerformances(allMatchups, yearMap), [allMatchups, yearMap]);
  const sorted = useMemo(
    () =>
      mode === "top"
        ? [...all].sort((a, b) => b.score - a.score).slice(0, count)
        : [...all].sort((a, b) => a.score - b.score).slice(0, count),
    [all, mode, count],
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center flex-wrap">
        <div className="flex gap-1 rounded-lg border border-white/10 p-1">
          <button
            className={cn(
              "px-3 py-1 text-sm rounded-md transition-colors",
              mode === "top" ? "bg-emerald-500/20 text-emerald-400" : "text-slate-400 hover:text-white",
            )}
            onClick={() => setMode("top")}
          >
            <Flame className="h-3.5 w-3.5 inline mr-1" />Top
          </button>
          <button
            className={cn(
              "px-3 py-1 text-sm rounded-md transition-colors",
              mode === "bottom" ? "bg-blue-500/20 text-blue-400" : "text-slate-400 hover:text-white",
            )}
            onClick={() => setMode("bottom")}
          >
            <Snowflake className="h-3.5 w-3.5 inline mr-1" />Bottom
          </button>
        </div>
        <Select value={String(count)} onValueChange={(v) => setCount(Number(v))}>
          <SelectTrigger className="w-[100px] h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[10, 25, 50, 100].map((n) => (
              <SelectItem key={n} value={String(n)}>
                Top {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">#</TableHead>
            <TableHead>Team</TableHead>
            <TableHead className="text-right">Score</TableHead>
            <TableHead>Opponent</TableHead>
            <TableHead className="text-right">Opp Score</TableHead>
            <TableHead>Week</TableHead>
            <TableHead>Year</TableHead>
            <TableHead>Result</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r, i) => (
            <TableRow key={`${r.teamId}-${r.seasonLabel}-${r.week}-${i}`}>
              <TableCell className="text-slate-500 text-sm">{i + 1}</TableCell>
              <TableCell>
                {r.teamId ? (
                  <Link
                    to={`/team/${r.teamId}`}
                    className="text-primary hover:underline font-medium text-sm"
                  >
                    {r.teamName}
                  </Link>
                ) : (
                  <span className="font-medium text-sm">{r.teamName}</span>
                )}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right font-mono font-semibold",
                  mode === "top" ? "text-emerald-400" : "text-red-400",
                )}
              >
                {r.score.toFixed(1)}
              </TableCell>
              <TableCell className="text-slate-400 text-sm">{r.opponentName}</TableCell>
              <TableCell className="text-right font-mono text-sm text-slate-400">
                {r.opponentScore.toFixed(1)}
              </TableCell>
              <TableCell className="text-sm text-slate-400">
                Wk {r.week}
                {r.isPlayoff && (
                  <span className="ml-1 text-xs text-purple-400">(PO)</span>
                )}
              </TableCell>
              <TableCell className="text-sm text-slate-400">{r.seasonLabel}</TableCell>
              <TableCell>
                {r.won === null ? (
                  <Badge variant="outline" className="text-xs border-slate-500/30 text-slate-400">
                    TIE
                  </Badge>
                ) : r.won ? (
                  <Badge variant="outline" className="text-xs border-emerald-500/30 text-emerald-400">
                    W
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs border-red-500/30 text-red-400">
                    L
                  </Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
