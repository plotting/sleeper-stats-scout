
import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Recaps from "./Recaps";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { MatchupScoresView } from "@/types/database";

const SEASON_ID = 14;
const SEASON_YEAR = 2026;

function fmt(n: number, d = 1) {
  return n.toFixed(d);
}

// ── Standings ─────────────────────────────────────────────────────────────────

interface StandingsRow {
  teamId: number;
  teamName: string;
  wins: number;
  losses: number;
  ties: number;
  pf: number;
  pa: number;
  ppg: number;
  streak: number; // positive = win streak, negative = loss streak
  lastResult: "W" | "L" | "T" | null;
}

function computeStandings(matchups: MatchupScoresView[]): StandingsRow[] {
  const regular = matchups.filter((m) => m.is_playoff !== true && m.is_consolation !== true);
  const stats = new Map<number, { name: string; wins: number; losses: number; ties: number; pf: number; pa: number; games: number; resultsByWeek: { week: number; result: "W" | "L" | "T" }[] }>();

  const ensure = (id: number, name: string) => {
    if (!stats.has(id)) stats.set(id, { name, wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, games: 0, resultsByWeek: [] });
    return stats.get(id)!;
  };

  for (const m of regular) {
    if (!m.home_team_id || !m.away_team_id || m.home_score == null || m.away_score == null) continue;
    const h = ensure(m.home_team_id, m.home_team_name!);
    const a = ensure(m.away_team_id, m.away_team_name!);
    const wk = m.week_number ?? 0;

    h.pf += m.home_score; h.pa += m.away_score; h.games++;
    a.pf += m.away_score; a.pa += m.home_score; a.games++;

    if (m.home_score > m.away_score) {
      h.wins++; a.losses++;
      h.resultsByWeek.push({ week: wk, result: "W" });
      a.resultsByWeek.push({ week: wk, result: "L" });
    } else if (m.away_score > m.home_score) {
      a.wins++; h.losses++;
      h.resultsByWeek.push({ week: wk, result: "L" });
      a.resultsByWeek.push({ week: wk, result: "W" });
    } else {
      h.ties++; a.ties++;
      h.resultsByWeek.push({ week: wk, result: "T" });
      a.resultsByWeek.push({ week: wk, result: "T" });
    }
  }

  return [...stats.entries()]
    .map(([teamId, s]) => {
      const sorted = s.resultsByWeek.sort((a, b) => a.week - b.week);
      const last = sorted[sorted.length - 1]?.result ?? null;
      // Streak: count consecutive same result from end
      let streak = 0;
      for (let i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i].result !== last) break;
        streak++;
      }
      return {
        teamId,
        teamName: s.name,
        wins: s.wins,
        losses: s.losses,
        ties: s.ties,
        pf: s.pf,
        pa: s.pa,
        ppg: s.games > 0 ? s.pf / s.games : 0,
        streak: last === "W" ? streak : last === "L" ? -streak : 0,
        lastResult: last,
      };
    })
    .sort((a, b) => b.wins - a.wins || b.pf - a.pf);
}

function Standings({ matchups }: { matchups: MatchupScoresView[] }) {
  const rows = useMemo(() => computeStandings(matchups), [matchups]);

  if (rows.length === 0) {
    return <p className="text-slate-400 text-sm">No games played yet this season.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8">#</TableHead>
          <TableHead>Team</TableHead>
          <TableHead className="text-right">W-L</TableHead>
          <TableHead className="text-right">PF</TableHead>
          <TableHead className="text-right">PA</TableHead>
          <TableHead className="text-right">PPG</TableHead>
          <TableHead className="text-right">Streak</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={r.teamId}>
            <TableCell className="text-slate-500 text-sm">{i + 1}</TableCell>
            <TableCell>
              <Link to={`/team/${r.teamId}?season=${SEASON_ID}`} className="text-primary hover:underline font-medium">
                {r.teamName}
              </Link>
            </TableCell>
            <TableCell className="text-right font-mono text-sm">
              <span className="text-emerald-400">{r.wins}</span>
              <span className="text-slate-500">-</span>
              <span className="text-red-400">{r.losses}</span>
              {r.ties > 0 && <><span className="text-slate-500">-</span><span className="text-amber-400">{r.ties}</span></>}
            </TableCell>
            <TableCell className="text-right font-mono text-sm text-slate-300">{fmt(r.pf)}</TableCell>
            <TableCell className="text-right font-mono text-sm text-slate-500">{fmt(r.pa)}</TableCell>
            <TableCell className="text-right font-mono text-sm text-slate-400">{fmt(r.ppg)}</TableCell>
            <TableCell className="text-right">
              {r.streak !== 0 && (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-xs tabular-nums",
                    r.streak > 0
                      ? "border-emerald-500/30 text-emerald-400"
                      : "border-red-500/30 text-red-400",
                  )}
                >
                  {r.streak > 0 ? `W${r.streak}` : `L${Math.abs(r.streak)}`}
                </Badge>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ── Recent Results ─────────────────────────────────────────────────────────────

function RecentResults({ matchups }: { matchups: MatchupScoresView[] }) {
  const completed = useMemo(() => {
    return matchups
      .filter((m) => m.home_score != null && m.away_score != null && m.is_playoff !== true)
      .sort((a, b) => (b.week_number ?? 0) - (a.week_number ?? 0))
      .slice(0, 18); // last ~3 weeks of games
  }, [matchups]);

  if (completed.length === 0) return <p className="text-slate-400 text-sm">No completed games yet.</p>;

  // Group by week
  const byWeek = new Map<number, typeof completed>();
  for (const m of completed) {
    const wk = m.week_number ?? 0;
    if (!byWeek.has(wk)) byWeek.set(wk, []);
    byWeek.get(wk)!.push(m);
  }
  const weeks = [...byWeek.keys()].sort((a, b) => b - a);

  return (
    <div className="space-y-4">
      {weeks.map((wk) => (
        <div key={wk}>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Week {wk}</p>
          <div className="grid gap-2">
            {byWeek.get(wk)!.map((m, i) => {
              const homeWon = m.home_score! > m.away_score!;
              const awayWon = m.away_score! > m.home_score!;
              return (
                <div key={i} className="flex items-center gap-3 bg-white/3 rounded-lg px-3 py-2 text-sm">
                  <div className="flex-1 flex items-center justify-end gap-2">
                    <Link
                      to={`/team/${m.home_team_id}?season=${SEASON_ID}`}
                      className={cn("font-medium hover:underline truncate", homeWon ? "text-white" : "text-slate-400")}
                    >
                      {m.home_team_name}
                    </Link>
                    <span className={cn("font-mono font-semibold shrink-0", homeWon ? "text-emerald-400" : "text-red-400")}>
                      {m.home_score!.toFixed(1)}
                    </span>
                  </div>
                  <span className="text-slate-600 text-xs shrink-0">vs</span>
                  <div className="flex-1 flex items-center gap-2">
                    <span className={cn("font-mono font-semibold shrink-0", awayWon ? "text-emerald-400" : "text-red-400")}>
                      {m.away_score!.toFixed(1)}
                    </span>
                    <Link
                      to={`/team/${m.away_team_id}?season=${SEASON_ID}`}
                      className={cn("font-medium hover:underline truncate", awayWon ? "text-white" : "text-slate-400")}
                    >
                      {m.away_team_name}
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Top Scorers ────────────────────────────────────────────────────────────────

function TopScorers({ matchups }: { matchups: MatchupScoresView[] }) {
  const rows = useMemo(() => {
    const regular = matchups.filter((m) => m.is_playoff !== true && m.is_consolation !== true);
    const scores: { teamId: number; teamName: string; score: number; week: number; opponent: string; won: boolean }[] = [];
    for (const m of regular) {
      if (m.home_score == null || m.away_score == null) continue;
      scores.push({ teamId: m.home_team_id!, teamName: m.home_team_name!, score: m.home_score, week: m.week_number!, opponent: m.away_team_name!, won: m.home_score > m.away_score });
      scores.push({ teamId: m.away_team_id!, teamName: m.away_team_name!, score: m.away_score, week: m.week_number!, opponent: m.home_team_name!, won: m.away_score > m.home_score });
    }
    return scores.sort((a, b) => b.score - a.score).slice(0, 10);
  }, [matchups]);

  if (rows.length === 0) return <p className="text-slate-400 text-sm">No games played yet.</p>;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8">#</TableHead>
          <TableHead>Team</TableHead>
          <TableHead className="text-right">Score</TableHead>
          <TableHead>Opponent</TableHead>
          <TableHead className="text-right">Week</TableHead>
          <TableHead>Result</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={i}>
            <TableCell className="text-slate-500 text-sm">{i + 1}</TableCell>
            <TableCell>
              <Link to={`/team/${r.teamId}?season=${SEASON_ID}`} className="text-primary hover:underline font-medium text-sm">
                {r.teamName}
              </Link>
            </TableCell>
            <TableCell className="text-right font-mono font-semibold text-emerald-400">{r.score.toFixed(1)}</TableCell>
            <TableCell className="text-sm text-slate-400">{r.opponent}</TableCell>
            <TableCell className="text-right text-sm text-slate-400">Wk {r.week}</TableCell>
            <TableCell>
              <Badge variant="outline" className={cn("text-xs", r.won ? "border-emerald-500/30 text-emerald-400" : "border-red-500/30 text-red-400")}>
                {r.won ? "W" : "L"}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

const Season14 = () => {
  const [tab, setTab] = useState<"season" | "recaps">("season");

  const { data: matchups, isLoading } = useQuery({
    queryKey: ["season14-matchups"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matchup_scores_view")
        .select("*")
        .eq("season_id", SEASON_ID)
        .order("week_number");
      if (error) throw error;
      return data as MatchupScoresView[];
    },
  });

  const gamesPlayed = useMemo(
    () => (matchups ?? []).filter((m) => m.home_score != null && m.away_score != null && m.is_playoff !== true).length,
    [matchups],
  );

  const currentWeek = useMemo(() => {
    if (!matchups) return 0;
    const played = matchups.filter((m) => m.home_score != null && m.away_score != null);
    return played.length > 0 ? Math.max(...played.map((m) => m.week_number ?? 0)) : 0;
  }, [matchups]);

  return (
    <div className="min-h-screen space-y-6">
      {/* ── Header ── */}
      <header className="mb-2">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-4xl font-bold text-white">Season 14</h1>
          <Badge variant="outline" className="border-blue-500/40 text-blue-400 text-sm px-3">
            {SEASON_YEAR}
          </Badge>
          {tab === "season" && currentWeek > 0 && (
            <Badge variant="outline" className="border-white/20 text-slate-400 text-sm px-3">
              Week {currentWeek}
            </Badge>
          )}
        </div>
        {tab === "season" && (
          <p className="text-muted-foreground">
            {gamesPlayed > 0 ? `${gamesPlayed} games played` : "Season not yet started"}
          </p>
        )}
      </header>

      {/* ── Tab toggle ── */}
      <div className="flex gap-1 rounded-lg border border-white/10 p-1 w-fit">
        {([
          { key: "season", label: "S14 '26" },
          { key: "recaps", label: "Recaps"  },
        ] as { key: "season" | "recaps"; label: string }[]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "px-4 py-1.5 text-sm rounded-md transition-colors",
              tab === key ? "bg-white/10 text-white font-medium" : "text-slate-400 hover:text-white",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Season 14 content ── */}
      {tab === "season" && (
        isLoading ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-slate-400 animate-pulse">Loading Season 14 data…</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 space-y-6">
              <Card className="p-6">
                <CardHeader className="px-0 pt-0 pb-4">
                  <CardTitle className="text-lg">Standings</CardTitle>
                </CardHeader>
                <CardContent className="px-0 pb-0">
                  <Standings matchups={matchups ?? []} />
                </CardContent>
              </Card>

              <Card className="p-6">
                <CardHeader className="px-0 pt-0 pb-4">
                  <CardTitle className="text-lg">Top Scoring Weeks</CardTitle>
                </CardHeader>
                <CardContent className="px-0 pb-0">
                  <TopScorers matchups={matchups ?? []} />
                </CardContent>
              </Card>
            </div>

            <div>
              <Card className="p-6">
                <CardHeader className="px-0 pt-0 pb-4">
                  <CardTitle className="text-lg">Recent Results</CardTitle>
                </CardHeader>
                <CardContent className="px-0 pb-0">
                  <RecentResults matchups={matchups ?? []} />
                </CardContent>
              </Card>
            </div>
          </div>
        )
      )}

      {/* ── Recaps content ── */}
      {tab === "recaps" && <Recaps />}
    </div>
  );
};

export default Season14;
