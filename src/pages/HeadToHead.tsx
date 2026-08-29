
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";
import type { MatchupScoresView, Team } from "@/types/database";

function fmt(n: number, d = 1) {
  return n.toFixed(d);
}

type Filter = "all" | "regular" | "playoff";
type ViewMode = "breakdown" | "matrix";

interface H2HRow {
  opponentId: number;
  opponentName: string;
  wins: number;
  losses: number;
  ties: number;
  games: number;
  pf: number;
  pa: number;
  winPct: number;
  margin: number;
}

function computeH2H(
  matchups: MatchupScoresView[],
  teamId: number,
  filter: Filter,
): H2HRow[] {
  const stats = new Map<number, { name: string; wins: number; losses: number; ties: number; pf: number; pa: number; games: number }>();

  for (const m of matchups) {
    if (m.home_score == null || m.away_score == null) continue;
    const isPlayoff = (m.week_number ?? 0) >= 15;
    if (filter === "regular" && isPlayoff) continue;
    if (filter === "playoff" && !isPlayoff) continue;

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
      wins: s.wins, losses: s.losses, ties: s.ties,
      games: s.games,
      pf: s.pf, pa: s.pa,
      winPct: s.games > 0 ? (s.wins + s.ties * 0.5) / s.games : 0,
      margin: s.games > 0 ? (s.pf - s.pa) / s.games : 0,
    }))
    .filter((r) => r.games > 0)
    .sort((a, b) => b.wins - a.wins || b.margin - a.margin);
}

interface MatrixCell {
  wins: number;
  losses: number;
  ties: number;
  games: number;
}

function buildMatrix(
  matchups: MatchupScoresView[],
  teams: Team[],
  filter: Filter,
): Map<number, Map<number, MatrixCell>> {
  const m = new Map<number, Map<number, MatrixCell>>();
  for (const t of teams) {
    const row = new Map<number, MatrixCell>();
    for (const opp of teams) {
      if (opp.id !== t.id) row.set(opp.id, { wins: 0, losses: 0, ties: 0, games: 0 });
    }
    m.set(t.id, row);
  }

  for (const mu of matchups) {
    if (mu.home_score == null || mu.away_score == null) continue;
    if (!mu.home_team_id || !mu.away_team_id) continue;
    const isPlayoff = (mu.week_number ?? 0) >= 15;
    if (filter === "regular" && isPlayoff) continue;
    if (filter === "playoff" && !isPlayoff) continue;

    const hId = mu.home_team_id, aId = mu.away_team_id;
    const hWin = mu.home_score > mu.away_score;
    const tie = mu.home_score === mu.away_score;

    const hCell = m.get(hId)?.get(aId);
    const aCell = m.get(aId)?.get(hId);

    if (hCell) {
      hCell.games++;
      if (hWin) hCell.wins++;
      else if (tie) hCell.ties++;
      else hCell.losses++;
    }
    if (aCell) {
      aCell.games++;
      if (hWin) aCell.losses++;
      else if (tie) aCell.ties++;
      else aCell.wins++;
    }
  }
  return m;
}

// ─── Matrix View ──────────────────────────────────────────────────────────────

interface MatrixViewProps {
  teams: Team[];
  matchups: MatchupScoresView[];
  filter: Filter;
}

function MatrixView({ teams, matchups, filter }: MatrixViewProps) {
  const matrix = useMemo(() => buildMatrix(matchups, teams, filter), [matchups, teams, filter]);

  // Teams already arrive in DB id order (Erik=1, Jeff=2, … Adam=10) — preserve it.
  const sortedTeams = teams;

  return (
    <div className="overflow-x-auto">
      <p className="text-xs text-slate-500 mb-3">
        Row team's record <span className="text-emerald-400">W</span>-<span className="text-red-400">L</span> vs each column team.
      </p>
      <table className="min-w-full text-xs border-collapse">
        <thead>
          <tr>
            {/* top-left corner */}
            <th className="w-28 min-w-[112px] sticky left-0 z-10 bg-[#13131f] border-b border-white/10 pb-2 pr-3 text-left">
              <span className="text-slate-500 font-normal">vs →</span>
            </th>
            {sortedTeams.map((t) => (
              <th
                key={t.id}
                className="min-w-[72px] text-center pb-2 px-1 border-b border-white/10 font-medium text-slate-300"
                title={t.name}
              >
                {t.name.split(" ")[0]}
              </th>
            ))}
            <th className="min-w-[72px] text-center pb-2 px-2 border-b border-white/10 text-slate-500 font-normal">
              Overall
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedTeams.map((rowTeam, ri) => {
            let totalW = 0, totalL = 0, totalT = 0;
            const cells = sortedTeams.map((colTeam) => {
              if (rowTeam.id === colTeam.id) return null;
              const cell = matrix.get(rowTeam.id)?.get(colTeam.id);
              if (cell) { totalW += cell.wins; totalL += cell.losses; totalT += cell.ties; }
              return cell ?? null;
            });
            const totalG = totalW + totalL + totalT;
            const totalPct = totalG > 0 ? (totalW + totalT * 0.5) / totalG : 0;

            return (
              <tr
                key={rowTeam.id}
                className={ri % 2 === 0 ? "bg-white/[0.02]" : ""}
              >
                <td className="sticky left-0 z-10 bg-inherit py-2 pr-3 font-medium text-slate-300 whitespace-nowrap">
                  <Link to={`/team/${rowTeam.id}`} className="hover:text-white transition-colors">
                    {rowTeam.name}
                  </Link>
                </td>
                {sortedTeams.map((colTeam, ci) => {
                  if (rowTeam.id === colTeam.id) {
                    return (
                      <td key={colTeam.id} className="text-center py-2 px-1 bg-white/[0.04]">
                        <span className="text-slate-600">—</span>
                      </td>
                    );
                  }
                  const cell = cells[ci];
                  if (!cell || cell.games === 0) {
                    return (
                      <td key={colTeam.id} className="text-center py-2 px-1">
                        <span className="text-slate-600 text-xs">—</span>
                      </td>
                    );
                  }
                  const pct = (cell.wins + cell.ties * 0.5) / cell.games;
                  return (
                    <td key={colTeam.id} className="text-center py-2 px-1">
                      <span className={cn(
                        "font-mono font-semibold",
                        pct > 0.5 ? "text-emerald-400" : pct < 0.5 ? "text-red-400" : "text-slate-400",
                      )}>
                        {cell.wins}-{cell.losses}
                        {cell.ties > 0 && <span className="text-amber-400">-{cell.ties}</span>}
                      </span>
                    </td>
                  );
                })}
                {/* Overall column */}
                <td className="text-center py-2 px-2 border-l border-white/10">
                  <div className={cn(
                    "font-mono font-semibold text-xs",
                    totalPct > 0.5 ? "text-emerald-400" : totalPct < 0.5 ? "text-red-400" : "text-slate-400",
                  )}>
                    {totalW}-{totalL}{totalT > 0 && `-${totalT}`}
                  </div>
                  <div className="text-slate-500 text-[10px]">{fmt(totalPct * 100, 0)}%</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const HeadToHead = () => {
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [filter, setFilter] = useState<Filter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("matrix");

  const { data: teams, isLoading: teamsLoading } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data, error } = await supabase.from("teams").select("*").order("id");
      if (error) throw error;
      return data as Team[];
    },
  });

  // Per-team H2H: only fetch when a team is selected in breakdown mode
  const { data: teamMatchups, isLoading: teamMatchupsLoading } = useQuery({
    queryKey: ["h2h-matchups", selectedTeamId],
    enabled: !!selectedTeamId && viewMode === "breakdown",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matchup_scores_view")
        .select("*")
        .or(`home_team_id.eq.${selectedTeamId},away_team_id.eq.${selectedTeamId}`)
        .order("season_id")
        .order("week_number");
      if (error) throw error;
      return data as MatchupScoresView[];
    },
  });

  // All matchups for the matrix
  const { data: allMatchups, isLoading: allMatchupsLoading } = useQuery({
    queryKey: ["h2h-all-matchups"],
    enabled: viewMode === "matrix",
    queryFn: async () => {
      const PAGE = 1000;
      let rows: MatchupScoresView[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("matchup_scores_view")
          .select("home_team_id, away_team_id, home_score, away_score, home_team_name, away_team_name, week_number, is_playoff, season_id")
          .order("season_id")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        rows = rows.concat(data as MatchupScoresView[]);
        if (data.length < PAGE) break;
        from += PAGE;
      }
      return rows;
    },
  });

  const teamId = selectedTeamId ? parseInt(selectedTeamId) : null;
  const rows = useMemo(
    () => (teamId && teamMatchups ? computeH2H(teamMatchups, teamId, filter) : []),
    [teamMatchups, teamId, filter],
  );

  const totalWins = rows.reduce((s, r) => s + r.wins, 0);
  const totalLosses = rows.reduce((s, r) => s + r.losses, 0);
  const totalTies = rows.reduce((s, r) => s + r.ties, 0);
  const overallPPG = rows.length > 0
    ? rows.reduce((s, r) => s + r.pf, 0) / rows.reduce((s, r) => s + r.games, 0)
    : 0;
  const maxAbsMargin = Math.max(...rows.map((r) => Math.abs(r.margin)), 1);

  const isMatrixLoading = teamsLoading || (viewMode === "matrix" && allMatchupsLoading);
  const isBreakdownLoading = teamsLoading || (!!selectedTeamId && teamMatchupsLoading);

  const FilterToggle = () => (
    <div className="flex gap-1 rounded-lg border border-white/10 p-1">
      {(["all", "regular", "playoff"] as Filter[]).map((f) => (
        <button
          key={f}
          onClick={() => setFilter(f)}
          className={cn(
            "px-3 py-1 text-xs rounded-md transition-colors",
            filter === f ? "bg-white/10 text-white font-medium" : "text-slate-400 hover:text-white",
          )}
        >
          {f === "all" ? "All" : f === "regular" ? "Reg. Season" : "Playoffs"}
        </button>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Head-to-Head</h1>
          <p className="text-muted-foreground">All-time matchup records between every team</p>
        </div>
        {/* View mode toggle */}
        <div className="flex gap-1 rounded-lg border border-white/10 p-1">
          {(["matrix", "breakdown"] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setViewMode(v)}
              className={cn(
                "px-4 py-1.5 text-sm rounded-md transition-colors capitalize",
                viewMode === v ? "bg-white/10 text-white font-medium" : "text-slate-400 hover:text-white",
              )}
            >
              {v === "matrix" ? "All-Time Matrix" : "Team Breakdown"}
            </button>
          ))}
        </div>
      </header>

      {/* ── Matrix View ──────────────────────────────────────────────────── */}
      {viewMode === "matrix" && (
        <Card className="border-white/10">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <CardTitle className="text-lg">All-Time Head-to-Head Matrix</CardTitle>
                <CardDescription>
                  Every team's all-time record vs every other team ·{" "}
                  {filter === "all" ? "All games" : filter === "regular" ? "Regular season only" : "Playoff games only"}
                </CardDescription>
              </div>
              <FilterToggle />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {isMatrixLoading ? (
              <p className="text-slate-400 text-sm animate-pulse py-8 text-center">Loading matrix…</p>
            ) : teams && allMatchups ? (
              <MatrixView teams={teams} matchups={allMatchups} filter={filter} />
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* ── Breakdown View ───────────────────────────────────────────────── */}
      {viewMode === "breakdown" && (
        <>
          <div className="flex justify-end">
            <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select a team…" />
              </SelectTrigger>
              <SelectContent>
                {teams?.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!selectedTeamId ? (
            <Card className="border-white/10">
              <CardContent className="py-16 text-center text-slate-400">
                Select a team above to view their head-to-head breakdown
              </CardContent>
            </Card>
          ) : isBreakdownLoading ? (
            <p className="text-slate-400 text-sm animate-pulse">Loading matchup data…</p>
          ) : (
            <Card className="border-white/10">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <CardTitle className="text-lg">
                      {teams?.find((t) => String(t.id) === selectedTeamId)?.name ?? "Team"} — Opponent Breakdown
                    </CardTitle>
                    <CardDescription>
                      {filter === "all" ? "All games" : filter === "regular" ? "Regular season only" : "Playoff games only"}
                      {rows.length > 0 && (
                        <span className="ml-2">
                          · Overall{" "}
                          <span className="text-emerald-400 font-mono">{totalWins}</span>
                          <span className="text-slate-500">-</span>
                          <span className="text-red-400 font-mono">{totalLosses}</span>
                          {totalTies > 0 && (
                            <><span className="text-slate-500">-</span><span className="text-amber-400 font-mono">{totalTies}</span></>
                          )}
                          {" "}· avg {fmt(overallPPG)} pts
                        </span>
                      )}
                    </CardDescription>
                  </div>
                  <FilterToggle />
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {rows.length === 0 ? (
                  <p className="text-slate-400 text-sm py-4">No matchup data for this filter.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Opponent</TableHead>
                        <TableHead className="text-right">G</TableHead>
                        <TableHead className="text-right">W-L</TableHead>
                        <TableHead className="text-right">Win%</TableHead>
                        <TableHead className="text-right">Avg PF</TableHead>
                        <TableHead className="text-right">Avg PA</TableHead>
                        <TableHead className="text-right">Margin</TableHead>
                        <TableHead className="w-28 text-center text-xs text-slate-500">vs Avg</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => {
                        const avgPF = r.games > 0 ? r.pf / r.games : 0;
                        const avgPA = r.games > 0 ? r.pa / r.games : 0;
                        const diff = avgPF - overallPPG;
                        return (
                          <TableRow key={r.opponentId}>
                            <TableCell>
                              <Link
                                to={`/team/${r.opponentId}`}
                                className="text-primary hover:underline font-medium text-sm"
                              >
                                {r.opponentName}
                              </Link>
                            </TableCell>
                            <TableCell className="text-right text-sm text-slate-400">{r.games}</TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              <span className="text-emerald-400">{r.wins}</span>
                              <span className="text-slate-500">-</span>
                              <span className="text-red-400">{r.losses}</span>
                              {r.ties > 0 && (
                                <><span className="text-slate-500">-</span><span className="text-amber-400">{r.ties}</span></>
                              )}
                            </TableCell>
                            <TableCell className={cn(
                              "text-right font-mono text-sm",
                              r.winPct >= 0.6 ? "text-emerald-400" : r.winPct >= 0.4 ? "text-slate-300" : "text-red-400",
                            )}>
                              {fmt(r.winPct * 100, 0)}%
                            </TableCell>
                            <TableCell className={cn(
                              "text-right font-mono text-sm font-medium",
                              avgPF > overallPPG ? "text-emerald-400" : "text-red-400",
                            )}>
                              {fmt(avgPF)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm text-slate-400">
                              {fmt(avgPA)}
                            </TableCell>
                            <TableCell className={cn(
                              "text-right font-mono text-sm",
                              r.margin > 0 ? "text-emerald-400" : r.margin < 0 ? "text-red-400" : "text-slate-400",
                            )}>
                              {r.margin > 0 ? "+" : ""}{fmt(r.margin)}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1 h-5">
                                <div className="flex-1 flex justify-end">
                                  {diff < 0 && (
                                    <div
                                      className="h-2 rounded-l bg-red-500/60"
                                      style={{ width: `${(Math.abs(diff) / maxAbsMargin) * 100}%` }}
                                    />
                                  )}
                                </div>
                                <div className="w-px h-3 bg-white/20 shrink-0" />
                                <div className="flex-1">
                                  {diff > 0 && (
                                    <div
                                      className="h-2 rounded-r bg-emerald-500/60"
                                      style={{ width: `${(diff / maxAbsMargin) * 100}%` }}
                                    />
                                  )}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default HeadToHead;
