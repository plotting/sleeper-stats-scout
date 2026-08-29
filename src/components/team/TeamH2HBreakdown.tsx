import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { MatchupScoresView } from "@/types/database";

interface Props {
  teamId: number;
  matchups: MatchupScoresView[]; // all matchups (all seasons) to show career H2H
}

interface H2HRow {
  opponentId: number;
  opponentName: string;
  wins: number;
  losses: number;
  ties: number;
  pf: number;
  pa: number;
  games: number;
  margin: number;
}

function fmt(n: number, d = 1) {
  return n.toFixed(d);
}

const TeamH2HBreakdown = ({ teamId, matchups }: Props) => {
  const rows = useMemo((): H2HRow[] => {
    const stats = new Map<number, { name: string; wins: number; losses: number; ties: number; pf: number; pa: number; games: number }>();

    for (const m of matchups) {
      if (m.home_score == null || m.away_score == null) continue;

      let myScore: number, oppScore: number, oppId: number, oppName: string;

      if (m.home_team_id === teamId) {
        myScore = m.home_score; oppScore = m.away_score;
        oppId = m.away_team_id!; oppName = m.away_team_name!;
      } else if (m.away_team_id === teamId) {
        myScore = m.away_score; oppScore = m.home_score;
        oppId = m.home_team_id!; oppName = m.home_team_name!;
      } else {
        continue;
      }

      if (!oppId || !oppName) continue;
      if (!stats.has(oppId)) stats.set(oppId, { name: oppName, wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, games: 0 });
      const s = stats.get(oppId)!;
      s.pf += myScore; s.pa += oppScore; s.games++;
      if (myScore > oppScore) s.wins++;
      else if (myScore < oppScore) s.losses++;
      else s.ties++;
    }

    return [...stats.entries()]
      .map(([id, s]) => ({
        opponentId: id,
        opponentName: s.name,
        wins: s.wins,
        losses: s.losses,
        ties: s.ties,
        pf: s.pf,
        pa: s.pa,
        games: s.games,
        margin: s.games > 0 ? (s.pf - s.pa) / s.games : 0,
      }))
      .sort((a, b) => b.wins - a.wins || b.margin - a.margin);
  }, [matchups, teamId]);

  if (rows.length === 0) return null;

  const totalWins = rows.reduce((s, r) => s + r.wins, 0);
  const totalLosses = rows.reduce((s, r) => s + r.losses, 0);
  const totalTies = rows.reduce((s, r) => s + r.ties, 0);

  return (
    <Card className="border-white/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-slate-300 flex items-center justify-between">
          All-Time Head-to-Head Record
          <span className="text-xs font-normal text-slate-500">
            Overall: <span className="text-emerald-400 font-mono">{totalWins}</span>
            <span className="text-slate-600">-</span>
            <span className="text-red-400 font-mono">{totalLosses}</span>
            {totalTies > 0 && <><span className="text-slate-600">-</span><span className="text-amber-400 font-mono">{totalTies}</span></>}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Opponent</TableHead>
              <TableHead className="text-right">W-L</TableHead>
              <TableHead className="text-right">Win%</TableHead>
              <TableHead className="text-right">Avg PF</TableHead>
              <TableHead className="text-right">Avg PA</TableHead>
              <TableHead className="text-right">Margin</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const winPct = r.games > 0 ? r.wins / r.games : 0;
              return (
                <TableRow key={r.opponentId}>
                  <TableCell>
                    <Link
                      to={`/team/${r.opponentId}`}
                      className="text-primary hover:underline text-sm font-medium"
                    >
                      {r.opponentName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    <span className="text-emerald-400">{r.wins}</span>
                    <span className="text-slate-500">-</span>
                    <span className="text-red-400">{r.losses}</span>
                    {r.ties > 0 && <span className="text-amber-400">-{r.ties}</span>}
                  </TableCell>
                  <TableCell className={cn(
                    "text-right font-mono text-sm",
                    winPct >= 0.6 ? "text-emerald-400" : winPct >= 0.4 ? "text-slate-300" : "text-red-400",
                  )}>
                    {fmt(winPct * 100, 0)}%
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm text-slate-300">{fmt(r.pf / r.games)}</TableCell>
                  <TableCell className="text-right font-mono text-sm text-slate-400">{fmt(r.pa / r.games)}</TableCell>
                  <TableCell className={cn(
                    "text-right font-mono text-sm",
                    r.margin > 0 ? "text-emerald-400" : r.margin < 0 ? "text-red-400" : "text-slate-400",
                  )}>
                    {r.margin > 0 ? "+" : ""}{fmt(r.margin)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default TeamH2HBreakdown;
