import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { getAllSeasons, getSeasonYear } from "@/utils/seasonUtils";
import type { MatchupScoresView } from "@/types/database";
import { getTeamFinalPlacements } from "@/components/playoff-bracket/utils/placementUtils";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus, Target, Award, Zap, Shuffle, Crown, Sparkles, Loader2 } from "lucide-react";
import { usePlayoffSimWorker } from "@/hooks/usePlayoffSimWorker";
import type { WorkerSimResult } from "@/workers/playoffSim.worker";
import { fetchLeagueRosters, fetchLeague, LEAGUE_ID } from "@/services/sleeperApi";
import { buildRosterToTeamMap } from "@/services/sleeperSync";
import { computeTeamWeekProjections, type TeamWeekProjection } from "@/services/playerProjections";
import { savePlayoffSimSnapshot, deletePlayoffSimHistoryForSeason, fetchPlayoffSimHistory } from "@/services/playoffSimHistory";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 1) {
  return n.toFixed(decimals);
}

function signedFmt(n: number, decimals = 1): string {
  const s = n.toFixed(decimals);
  return n > 0 ? `+${s}` : s;
}

/** Standard deviation of an array */
function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((sum, x) => sum + (x - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

// ─── Data hook ────────────────────────────────────────────────────────────────

/** Old syncs stored the same game twice (home/away swapped) — without this,
 *  every count that touches raw matchup rows silently double-counts. */
function dedupeMatchups(rows: MatchupScoresView[]): MatchupScoresView[] {
  const seen = new Set<string>();
  return rows.filter((m) => {
    const ids = [m.home_team_id ?? 0, m.away_team_id ?? 0].sort((a, b) => a - b);
    const key = `${m.season_id}-${m.week_number}-${ids[0]}-${ids[1]}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function useAnalyticsData(seasonId: string) {
  const { data: matchups, isLoading } = useQuery({
    queryKey: ["analytics-matchups", seasonId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matchup_scores_view")
        .select("*")
        .eq("season_id", parseInt(seasonId))
        .order("week_number");
      if (error) throw error;
      return dedupeMatchups(data as MatchupScoresView[]);
    },
  });

  // All matchups (all seasons) for all-time analysis.
  // Paginated: PostgREST enforces a server-side max-rows cap (default 1000) that
  // silently truncates results — paginate to collect every row.
  const { data: allMatchups, isLoading: allLoading } = useQuery({
    queryKey: ["analytics-all-matchups"],
    queryFn: async () => {
      const PAGE = 1000;
      let rows: MatchupScoresView[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("matchup_scores_view")
          .select("*")
          .order("season_id")
          .order("week_number")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        rows = rows.concat(data as MatchupScoresView[]);
        if (data.length < PAGE) break;
        from += PAGE;
      }
      return dedupeMatchups(rows);
    },
  });

  const { data: seasons } = useQuery({
    queryKey: ["seasons-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("seasons").select("id, year, season_number");
      if (error) throw error;
      return data;
    },
  });

  return { matchups, allMatchups, seasons, isLoading: isLoading || allLoading };
}

// season_id (DB pk) → year label
function useSeasonYearMap(seasons: { id: number; year: number; season_number: number }[] | undefined) {
  return useMemo(() => {
    const m = new Map<number, number>();
    if (!seasons) return m;
    for (const s of seasons) m.set(s.id, s.year ?? getSeasonYear(s.season_number));
    return m;
  }, [seasons]);
}

// ─── Luck Meter ───────────────────────────────────────────────────────────────

interface LuckRow {
  teamId: number;
  teamName: string;
  actualWins: number;
  actualLosses: number;
  actualTies: number;
  expectedWins: number;
  luckDiff: number; // actualWins - expectedWins
}

function computeLuck(matchups: MatchupScoresView[]): LuckRow[] {
  // Only regular season (non-playoff, non-consolation)
  const regular = matchups.filter((m) => !m.is_playoff && !m.is_consolation);

  // Group by week to build "all scores this week" arrays
  const weekScores = new Map<number, { teamId: number; teamName: string; score: number }[]>();
  for (const m of regular) {
    if (m.home_team_id && m.home_score != null && m.home_team_name) {
      const week = m.week_number!;
      if (!weekScores.has(week)) weekScores.set(week, []);
      weekScores.get(week)!.push({ teamId: m.home_team_id, teamName: m.home_team_name, score: m.home_score });
    }
    if (m.away_team_id && m.away_score != null && m.away_team_name) {
      const week = m.week_number!;
      if (!weekScores.has(week)) weekScores.set(week, []);
      weekScores.get(week)!.push({ teamId: m.away_team_id, teamName: m.away_team_name, score: m.away_score });
    }
  }

  // For each matchup, calculate actual W/L and expected wins
  const stats = new Map<number, { teamName: string; actualWins: number; actualLosses: number; actualTies: number; expectedWins: number }>();

  const ensure = (id: number, name: string) => {
    if (!stats.has(id)) stats.set(id, { teamName: name, actualWins: 0, actualLosses: 0, actualTies: 0, expectedWins: 0 });
    return stats.get(id)!;
  };

  for (const m of regular) {
    if (!m.home_team_id || !m.away_team_id || m.home_score == null || m.away_score == null) continue;

    const week = m.week_number!;
    const allScores = weekScores.get(week) ?? [];
    const numTeams = allScores.length;
    if (numTeams < 2) continue;

    // Actual W/L
    const homeRow = ensure(m.home_team_id, m.home_team_name!);
    const awayRow = ensure(m.away_team_id, m.away_team_name!);

    if (m.home_score > m.away_score) {
      homeRow.actualWins++;
      awayRow.actualLosses++;
    } else if (m.away_score > m.home_score) {
      awayRow.actualWins++;
      homeRow.actualLosses++;
    } else {
      homeRow.actualTies++;
      awayRow.actualTies++;
    }

    // Expected wins = how many teams each team would beat in this week's scores
    for (const entry of allScores) {
      const row = ensure(entry.teamId, entry.teamName);
      const beaten = allScores.filter((o) => o.teamId !== entry.teamId && entry.score > o.score).length;
      const tied = allScores.filter((o) => o.teamId !== entry.teamId && entry.score === o.score).length;
      row.expectedWins += (beaten + tied * 0.5) / (numTeams - 1);
    }

    // Avoid double-counting (each matchup processes one home+away, but expected wins
    // loop above iterates all week entries which already includes home+away from all matchups)
    // We break after processing expected wins once per week
  }

  // Because weekScores loop double-counts (expected wins computed per matchup, not per week),
  // let's recompute expected wins cleanly per week:
  const expWinsByTeam = new Map<number, number>();
  for (const [, scores] of weekScores) {
    const numTeams = scores.length;
    for (const entry of scores) {
      const beaten = scores.filter((o) => o.teamId !== entry.teamId && entry.score > o.score).length;
      const tied = scores.filter((o) => o.teamId !== entry.teamId && entry.score === o.score).length;
      expWinsByTeam.set(entry.teamId, (expWinsByTeam.get(entry.teamId) ?? 0) + (beaten + tied * 0.5) / (numTeams - 1));
    }
  }

  return [...stats.entries()]
    .map(([teamId, s]) => ({
      teamId,
      teamName: s.teamName,
      actualWins: s.actualWins,
      actualLosses: s.actualLosses,
      actualTies: s.actualTies,
      expectedWins: expWinsByTeam.get(teamId) ?? 0,
      luckDiff: (s.actualWins + s.actualTies * 0.5) - (expWinsByTeam.get(teamId) ?? 0),
    }))
    .sort((a, b) => b.luckDiff - a.luckDiff);
}

function LuckMeter({ matchups }: { matchups: MatchupScoresView[] }) {
  const rows = useMemo(() => computeLuck(matchups), [matchups]);

  if (rows.length === 0) return <p className="text-slate-400 text-sm">No regular season data.</p>;

  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.luckDiff)), 1);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Expected W-L compares each team's score against every other team's score that week.
        A team that scores in the top half every week but draws the one opponent who beat them all
        will show <span className="text-red-400">unlucky</span>; the reverse shows{" "}
        <span className="text-emerald-400">lucky</span>.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">#</TableHead>
            <TableHead>Team</TableHead>
            <TableHead className="text-right">Actual W-L</TableHead>
            <TableHead className="text-right">Expected W-L</TableHead>
            <TableHead className="text-right">Luck</TableHead>
            <TableHead className="w-40">Luck Bar</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={r.teamId}>
              <TableCell className="text-slate-500 text-sm">{i + 1}</TableCell>
              <TableCell>
                <Link to={`/team/${r.teamId}`} className="text-primary hover:underline font-medium">
                  {r.teamName}
                </Link>
              </TableCell>
              <TableCell className="text-right font-mono text-sm">
                {r.actualWins}-{r.actualLosses}{r.actualTies > 0 ? `-${r.actualTies}` : ""}
              </TableCell>
              <TableCell className="text-right font-mono text-sm text-slate-400">
                {fmt(r.expectedWins)}-{fmt(r.actualWins + r.actualLosses + r.actualTies - r.expectedWins)}
              </TableCell>
              <TableCell className={cn("text-right font-mono text-sm font-semibold",
                r.luckDiff > 0.4 ? "text-emerald-400" : r.luckDiff < -0.4 ? "text-red-400" : "text-slate-400")}>
                {signedFmt(r.luckDiff)}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1 h-5">
                  <div className="flex-1 flex justify-end">
                    {r.luckDiff < 0 && (
                      <div
                        className="h-3 rounded-l bg-red-500/70"
                        style={{ width: `${(Math.abs(r.luckDiff) / maxAbs) * 100}%` }}
                      />
                    )}
                  </div>
                  <div className="w-px h-full bg-white/20 shrink-0" />
                  <div className="flex-1">
                    {r.luckDiff > 0 && (
                      <div
                        className="h-3 rounded-r bg-emerald-500/70"
                        style={{ width: `${(r.luckDiff / maxAbs) * 100}%` }}
                      />
                    )}
                  </div>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Consistency ──────────────────────────────────────────────────────────────

interface ConsistencyRow {
  teamId: number;
  teamName: string;
  avg: number;
  stdDev: number;
  cv: number; // coefficient of variation — lower = more consistent
  min: number;
  max: number;
  games: number;
}

function computeConsistency(matchups: MatchupScoresView[]): ConsistencyRow[] {
  const regular = matchups.filter((m) => !m.is_playoff && !m.is_consolation);
  const scoresByTeam = new Map<number, { name: string; scores: number[] }>();

  const addScore = (id: number | null, name: string | null, score: number | null) => {
    if (!id || !name || score == null || score <= 0) return;
    if (!scoresByTeam.has(id)) scoresByTeam.set(id, { name, scores: [] });
    scoresByTeam.get(id)!.scores.push(score);
  };

  for (const m of regular) {
    addScore(m.home_team_id, m.home_team_name, m.home_score);
    addScore(m.away_team_id, m.away_team_name, m.away_score);
  }

  return [...scoresByTeam.entries()]
    .map(([id, { name, scores }]) => {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      const sd = stdDev(scores);
      return {
        teamId: id,
        teamName: name,
        avg,
        stdDev: sd,
        cv: avg > 0 ? sd / avg : 0,
        min: Math.min(...scores),
        max: Math.max(...scores),
        games: scores.length,
      };
    })
    .sort((a, b) => a.cv - b.cv); // most consistent first
}

function ConsistencyTab({ matchups }: { matchups: MatchupScoresView[] }) {
  const rows = useMemo(() => computeConsistency(matchups), [matchups]);

  if (rows.length === 0) return <p className="text-slate-400 text-sm">No regular season data.</p>;

  // Rank for badge colors
  const sorted = [...rows].sort((a, b) => a.cv - b.cv);
  const getRank = (teamId: number) => sorted.findIndex((r) => r.teamId === teamId) + 1;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Consistency is measured by coefficient of variation (Std Dev ÷ Avg). Lower CV = more
        predictable scoring. Sorted most consistent → least.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">#</TableHead>
            <TableHead>Team</TableHead>
            <TableHead className="text-right">Avg</TableHead>
            <TableHead className="text-right">Std Dev</TableHead>
            <TableHead className="text-right">CV</TableHead>
            <TableHead className="text-right">Low</TableHead>
            <TableHead className="text-right">High</TableHead>
            <TableHead className="text-right">Range</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const rank = getRank(r.teamId);
            const total = rows.length;
            const pct = rank / total;
            const color =
              pct <= 0.25 ? "text-emerald-400" : pct <= 0.5 ? "text-blue-400" : pct <= 0.75 ? "text-amber-400" : "text-red-400";
            return (
              <TableRow key={r.teamId}>
                <TableCell className="text-slate-500 text-sm">{rank}</TableCell>
                <TableCell>
                  <Link to={`/team/${r.teamId}`} className="text-primary hover:underline font-medium">
                    {r.teamName}
                  </Link>
                </TableCell>
                <TableCell className="text-right font-mono text-sm">{fmt(r.avg)}</TableCell>
                <TableCell className="text-right font-mono text-sm text-slate-400">{fmt(r.stdDev)}</TableCell>
                <TableCell className={cn("text-right font-mono text-sm font-semibold", color)}>
                  {fmt(r.cv * 100)}%
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-red-400/80">{fmt(r.min)}</TableCell>
                <TableCell className="text-right font-mono text-sm text-emerald-400/80">{fmt(r.max)}</TableCell>
                <TableCell className="text-right font-mono text-sm text-slate-400">{fmt(r.max - r.min)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Power Rankings ───────────────────────────────────────────────────────────

interface PowerRow {
  teamId: number;
  teamName: string;
  wins: number;
  losses: number;
  ties: number;
  ppg: number;
  recentAvg: number;   // last 3 weeks
  expectedWins: number;
  powerScore: number;  // 0–100
  rank: number;
  prevRank: number;    // rank as of previous week
  movement: number;    // prevRank - rank (positive = moved up)
  recentScores: number[]; // last 3 weeks for sparkline
}

function computePowerRankings(matchups: MatchupScoresView[], thruWeek: number): PowerRow[] {
  const regular = matchups.filter((m) => !m.is_playoff && !m.is_consolation);
  const inWindow = regular.filter((m) => (m.week_number ?? 0) <= thruWeek);

  // Per-team accumulation
  const stats = new Map<number, {
    name: string;
    wins: number; losses: number; ties: number;
    totalScore: number; games: number;
    weekScores: Map<number, number>;
  }>();

  const ensure = (id: number, name: string) => {
    if (!stats.has(id)) stats.set(id, { name, wins: 0, losses: 0, ties: 0, totalScore: 0, games: 0, weekScores: new Map() });
    return stats.get(id)!;
  };

  // Weekly scores for all teams (for expected wins)
  const allWeekScores = new Map<number, { teamId: number; score: number }[]>();

  for (const m of inWindow) {
    if (!m.home_team_id || !m.away_team_id || m.home_score == null || m.away_score == null) continue;
    const wk = m.week_number!;

    if (!allWeekScores.has(wk)) allWeekScores.set(wk, []);
    allWeekScores.get(wk)!.push({ teamId: m.home_team_id, score: m.home_score });
    allWeekScores.get(wk)!.push({ teamId: m.away_team_id, score: m.away_score });

    const h = ensure(m.home_team_id, m.home_team_name!);
    const a = ensure(m.away_team_id, m.away_team_name!);

    h.totalScore += m.home_score; h.games++; h.weekScores.set(wk, m.home_score);
    a.totalScore += m.away_score; a.games++; a.weekScores.set(wk, m.away_score);

    if (m.home_score > m.away_score) { h.wins++; a.losses++; }
    else if (m.away_score > m.home_score) { a.wins++; h.losses++; }
    else { h.ties++; a.ties++; }
  }

  // Expected wins per team (all-play)
  const expWins = new Map<number, number>();
  for (const [, scores] of allWeekScores) {
    const n = scores.length;
    for (const { teamId, score } of scores) {
      const beaten = scores.filter((o) => o.teamId !== teamId && score > o.score).length;
      const tied = scores.filter((o) => o.teamId !== teamId && score === o.score).length;
      expWins.set(teamId, (expWins.get(teamId) ?? 0) + (beaten + tied * 0.5) / (n - 1));
    }
  }

  if (stats.size === 0) return [];

  // Compute raw values
  const rows = [...stats.entries()].map(([id, s]) => {
    const recentWeeks = [thruWeek, thruWeek - 1, thruWeek - 2].filter((w) => w >= 1);
    const recentScores = recentWeeks.map((w) => s.weekScores.get(w) ?? 0).filter((sc) => sc > 0);
    const recentAvg = recentScores.length > 0 ? recentScores.reduce((a, b) => a + b, 0) / recentScores.length : 0;
    const ppg = s.games > 0 ? s.totalScore / s.games : 0;
    const total = s.wins + s.losses + s.ties;
    const winPct = total > 0 ? (s.wins + s.ties * 0.5) / total : 0;
    const ew = expWins.get(id) ?? 0;
    const expWinPct = s.games > 0 ? ew / s.games : 0;

    return { teamId: id, teamName: s.name, wins: s.wins, losses: s.losses, ties: s.ties, ppg, recentAvg, expectedWins: ew, winPct, expWinPct, recentScores: recentScores.slice(0, 3) };
  });

  // Normalize and score
  const maxPpg = Math.max(...rows.map((r) => r.ppg), 1);
  const minPpg = Math.min(...rows.map((r) => r.ppg));
  const maxRecent = Math.max(...rows.map((r) => r.recentAvg), 1);
  const minRecent = Math.min(...rows.map((r) => r.recentAvg));

  const norm = (v: number, lo: number, hi: number) => hi === lo ? 0.5 : (v - lo) / (hi - lo);

  const scored = rows.map((r) => ({
    ...r,
    powerScore: Math.round(
      100 * (0.30 * r.winPct + 0.35 * norm(r.ppg, minPpg, maxPpg) + 0.25 * norm(r.recentAvg, minRecent, maxRecent) + 0.10 * r.expWinPct)
    ),
  })).sort((a, b) => b.powerScore - a.powerScore);

  // Compute previous week ranks
  const prevRows = computePowerRankings(matchups, thruWeek - 1);
  const prevRankMap = new Map(prevRows.map((r) => [r.teamId, r.rank]));

  return scored.map((r, i) => ({
    ...r,
    rank: i + 1,
    prevRank: prevRankMap.get(r.teamId) ?? i + 1,
    movement: (prevRankMap.get(r.teamId) ?? i + 1) - (i + 1),
  }));
}

function PowerRankings({ matchups }: { matchups: MatchupScoresView[] }) {
  const regular = matchups.filter((m) => !m.is_playoff && !m.is_consolation);
  const maxWeek = Math.max(0, ...regular.map((m) => m.week_number ?? 0));
  const [selectedWeek, setSelectedWeek] = useState(maxWeek);

  const rows = useMemo(() => computePowerRankings(matchups, selectedWeek), [matchups, selectedWeek]);

  if (maxWeek === 0 || rows.length === 0) return <p className="text-slate-400 text-sm">No data yet.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-sm text-slate-400">Rankings through week:</p>
        <Select value={String(selectedWeek)} onValueChange={(v) => setSelectedWeek(Number(v))}>
          <SelectTrigger className="w-[110px] h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: maxWeek }, (_, i) => i + 1).reverse().map((w) => (
              <SelectItem key={w} value={String(w)}>Week {w}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-slate-500">Score = 30% win% + 35% season PPG + 25% last-3-week avg + 10% expected wins</p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-14">Rank</TableHead>
            <TableHead>Team</TableHead>
            <TableHead className="text-right">W-L</TableHead>
            <TableHead className="text-right">PPG</TableHead>
            <TableHead className="text-right">Last 3 Wk</TableHead>
            <TableHead className="text-right">Exp W</TableHead>
            <TableHead className="text-right">Score</TableHead>
            <TableHead className="w-28">
              <span className="sr-only">Bar</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const MoveIcon = r.movement > 0 ? TrendingUp : r.movement < 0 ? TrendingDown : Minus;
            const moveColor = r.movement > 0 ? "text-emerald-400" : r.movement < 0 ? "text-red-400" : "text-slate-500";
            return (
              <TableRow key={r.teamId}>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span className={cn("text-sm font-bold w-5 text-right tabular-nums",
                      r.rank === 1 ? "text-amber-400" : r.rank <= 3 ? "text-slate-300" : "text-slate-500")}>
                      {r.rank}
                    </span>
                    <span className={cn("flex items-center gap-0.5 text-xs", moveColor)}>
                      <MoveIcon className="h-3 w-3" />
                      {r.movement !== 0 && <span>{Math.abs(r.movement)}</span>}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Link to={`/team/${r.teamId}`} className="text-primary hover:underline font-medium">
                    {r.teamName}
                  </Link>
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  <span className="text-emerald-400">{r.wins}</span>
                  <span className="text-slate-500">-</span>
                  <span className="text-red-400">{r.losses}</span>
                  {r.ties > 0 && <><span className="text-slate-500">-</span><span className="text-amber-400">{r.ties}</span></>}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-slate-300">{fmt(r.ppg)}</TableCell>
                <TableCell className="text-right font-mono text-sm">
                  <span className={r.recentAvg >= r.ppg ? "text-emerald-400" : "text-red-400"}>
                    {r.recentAvg > 0 ? fmt(r.recentAvg) : "—"}
                  </span>
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-slate-400">{fmt(r.expectedWins)}</TableCell>
                <TableCell className="text-right font-mono text-sm font-semibold text-amber-300">{r.powerScore}</TableCell>
                <TableCell>
                  <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-500 to-amber-400"
                      style={{ width: `${r.powerScore}%` }}
                    />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── PPG by Opponent ──────────────────────────────────────────────────────────

interface OpponentRow {
  opponentId: number;
  opponentName: string;
  games: number;
  teamAvg: number;
  oppAvg: number;
  wins: number;
  losses: number;
  ties: number;
  margin: number; // teamAvg - oppAvg
}

function computeOpponentBreakdown(
  allMatchups: MatchupScoresView[],
  teamId: number,
): OpponentRow[] {
  const stats = new Map<number, {
    name: string; games: number;
    teamTotal: number; oppTotal: number;
    wins: number; losses: number; ties: number;
  }>();

  for (const m of allMatchups) {
    if (m.home_score == null || m.away_score == null) continue;

    let myScore: number | null = null;
    let oppScore: number | null = null;
    let oppId: number | null = null;
    let oppName: string | null = null;

    if (m.home_team_id === teamId) {
      myScore = m.home_score; oppScore = m.away_score;
      oppId = m.away_team_id; oppName = m.away_team_name;
    } else if (m.away_team_id === teamId) {
      myScore = m.away_score; oppScore = m.home_score;
      oppId = m.home_team_id; oppName = m.home_team_name;
    }

    if (myScore == null || oppScore == null || !oppId || !oppName) continue;

    if (!stats.has(oppId)) stats.set(oppId, { name: oppName, games: 0, teamTotal: 0, oppTotal: 0, wins: 0, losses: 0, ties: 0 });
    const s = stats.get(oppId)!;
    s.games++; s.teamTotal += myScore; s.oppTotal += oppScore;
    if (myScore > oppScore) s.wins++;
    else if (myScore < oppScore) s.losses++;
    else { s.ties++; }
  }

  return [...stats.entries()]
    .map(([id, s]) => ({
      opponentId: id,
      opponentName: s.name,
      games: s.games,
      teamAvg: s.games > 0 ? s.teamTotal / s.games : 0,
      oppAvg: s.games > 0 ? s.oppTotal / s.games : 0,
      wins: s.wins,
      losses: s.losses,
      ties: s.ties,
      margin: s.games > 0 ? (s.teamTotal - s.oppTotal) / s.games : 0,
    }))
    .sort((a, b) => b.teamAvg - a.teamAvg);
}

function PPGByOpponent({
  allMatchups,
  teams,
}: {
  allMatchups: MatchupScoresView[];
  teams: { teamId: number; teamName: string }[];
}) {
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(teams[0]?.teamId ?? null);

  const rows = useMemo(
    () => (selectedTeamId != null ? computeOpponentBreakdown(allMatchups, selectedTeamId) : []),
    [allMatchups, selectedTeamId],
  );

  const overallAvg = rows.length > 0
    ? rows.reduce((s, r) => s + r.teamAvg * r.games, 0) / rows.reduce((s, r) => s + r.games, 0)
    : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-sm text-slate-400">Team:</p>
        <Select
          value={selectedTeamId != null ? String(selectedTeamId) : ""}
          onValueChange={(v) => setSelectedTeamId(Number(v))}
        >
          <SelectTrigger className="w-[200px] h-8 text-sm">
            <SelectValue placeholder="Select a team…" />
          </SelectTrigger>
          <SelectContent>
            {teams.map((t) => (
              <SelectItem key={t.teamId} value={String(t.teamId)}>{t.teamName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {overallAvg > 0 && (
          <p className="text-xs text-slate-500">Overall avg: <span className="text-slate-300 font-mono">{fmt(overallAvg)}</span> pts</p>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-slate-400 text-sm">No matchup data found.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Opponent</TableHead>
              <TableHead className="text-right">G</TableHead>
              <TableHead className="text-right">W-L</TableHead>
              <TableHead className="text-right">My Avg</TableHead>
              <TableHead className="text-right">Opp Avg</TableHead>
              <TableHead className="text-right">Margin</TableHead>
              <TableHead className="w-28">vs League Avg</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const diff = r.teamAvg - overallAvg;
              const absDiff = Math.max(...rows.map((x) => Math.abs(x.teamAvg - overallAvg)), 1);
              return (
                <TableRow key={r.opponentId}>
                  <TableCell>
                    <Link to={`/team/${r.opponentId}`} className="text-primary hover:underline font-medium text-sm">
                      {r.opponentName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right text-sm text-slate-400">{r.games}</TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    <span className="text-emerald-400">{r.wins}</span>
                    <span className="text-slate-500">-</span>
                    <span className="text-red-400">{r.losses}</span>
                    {r.ties > 0 && <><span className="text-slate-500">-</span><span className="text-amber-400">{r.ties}</span></>}
                  </TableCell>
                  <TableCell className={cn("text-right font-mono text-sm font-semibold",
                    r.teamAvg > overallAvg ? "text-emerald-400" : "text-red-400")}>
                    {fmt(r.teamAvg)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm text-slate-400">{fmt(r.oppAvg)}</TableCell>
                  <TableCell className={cn("text-right font-mono text-sm",
                    r.margin > 0 ? "text-emerald-400" : r.margin < 0 ? "text-red-400" : "text-slate-400")}>
                    {signedFmt(r.margin)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 h-5">
                      <div className="flex-1 flex justify-end">
                        {diff < 0 && (
                          <div className="h-2 rounded-l bg-red-500/60" style={{ width: `${(Math.abs(diff) / absDiff) * 100}%` }} />
                        )}
                      </div>
                      <div className="w-px h-3 bg-white/20 shrink-0" />
                      <div className="flex-1">
                        {diff > 0 && (
                          <div className="h-2 rounded-r bg-emerald-500/60" style={{ width: `${(diff / absDiff) * 100}%` }} />
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
    </div>
  );
}

// ─── Playoff Probability ──────────────────────────────────────────────────────
// For each (GP, record) snapshot observed in any season through week 9,
// what % of teams with that record ended up making the playoffs?

const MAX_SNAPSHOT_WEEK = 9;

interface PlayoffProbRow {
  gamesPlayed: number;
  wins: number;
  losses: number;
  ties: number;
  occurrences: number;
  madePlayoffs: number;
  pct: number;
}

function computePlayoffProb(allMatchups: MatchupScoresView[]): PlayoffProbRow[] {
  const seasonIds = [
    ...new Set(allMatchups.map((m) => m.season_id).filter((s): s is number => s != null)),
  ];
  // key = "gamesPlayed-wins-losses-ties"
  const byRecord = new Map<string, { occ: number; made: number }>();

  for (const sid of seasonIds) {
    const seasonMatchups = allMatchups.filter((m) => m.season_id === sid);
    const regularSeason = seasonMatchups.filter((m) => m.is_playoff !== true && m.is_consolation !== true);

    // Always use rank-based: top half by full regular season wins + PF tiebreaker
    const playoffTeamIds = new Set<number>();
    const teamStats = new Map<number, { wins: number; pf: number }>();
    for (const m of regularSeason) {
      if (!m.home_team_id || !m.away_team_id || m.home_score == null || m.away_score == null) continue;
      if (!teamStats.has(m.home_team_id)) teamStats.set(m.home_team_id, { wins: 0, pf: 0 });
      if (!teamStats.has(m.away_team_id)) teamStats.set(m.away_team_id, { wins: 0, pf: 0 });
      const h = teamStats.get(m.home_team_id)!;
      const a = teamStats.get(m.away_team_id)!;
      h.pf += m.home_score; a.pf += m.away_score;
      if (m.home_score > m.away_score) h.wins++;
      else if (m.away_score > m.home_score) a.wins++;
    }
    const sorted = [...teamStats.entries()].sort((x, y) => y[1].wins - x[1].wins || y[1].pf - x[1].pf);
    sorted.slice(0, Math.ceil(sorted.length / 2)).forEach(([tid]) => playoffTeamIds.add(tid));

    // Build incremental records week by week (snapshot after each week)
    const teamRecords = new Map<number, { wins: number; losses: number; ties: number; gp: number }>();
    for (const m of regularSeason) {
      if (m.home_team_id && !teamRecords.has(m.home_team_id))
        teamRecords.set(m.home_team_id, { wins: 0, losses: 0, ties: 0, gp: 0 });
      if (m.away_team_id && !teamRecords.has(m.away_team_id))
        teamRecords.set(m.away_team_id, { wins: 0, losses: 0, ties: 0, gp: 0 });
    }

    const maxWeek = Math.min(
      MAX_SNAPSHOT_WEEK,
      Math.max(0, ...regularSeason.map((m) => m.week_number ?? 0)),
    );

    for (let week = 1; week <= maxWeek; week++) {
      const weekGames = regularSeason.filter((m) => m.week_number === week);
      const played = new Set<number>();

      for (const m of weekGames) {
        if (!m.home_team_id || !m.away_team_id || m.home_score == null || m.away_score == null) continue;
        const h = teamRecords.get(m.home_team_id);
        const a = teamRecords.get(m.away_team_id);
        if (!h || !a) continue;
        h.gp++; a.gp++;
        played.add(m.home_team_id); played.add(m.away_team_id);
        if (m.home_score > m.away_score) { h.wins++; a.losses++; }
        else if (m.away_score > m.home_score) { a.wins++; h.losses++; }
        else { h.ties++; a.ties++; }
      }

      // Snapshot all teams that played this week
      for (const tid of played) {
        const rec = teamRecords.get(tid)!;
        const recKey = `${rec.gp}-${rec.wins}-${rec.losses}-${rec.ties}`;
        if (!byRecord.has(recKey)) byRecord.set(recKey, { occ: 0, made: 0 });
        const r = byRecord.get(recKey)!;
        r.occ++;
        if (playoffTeamIds.has(tid)) r.made++;
      }
    }
  }

  return [...byRecord.entries()]
    .map(([k, v]) => {
      const [gp, w, l, t] = k.split("-").map(Number);
      return {
        gamesPlayed: gp, wins: w, losses: l, ties: t,
        occurrences: v.occ, madePlayoffs: v.made,
        pct: v.occ > 0 ? v.made / v.occ : 0,
      };
    })
    .sort((a, b) => a.gamesPlayed - b.gamesPlayed || b.wins - a.wins || a.losses - b.losses);
}

function PlayoffProbability({ allMatchups }: { allMatchups: MatchupScoresView[] }) {
  const rows = useMemo(() => computePlayoffProb(allMatchups), [allMatchups]);
  const hasTies = rows.some((r) => r.ties > 0);

  if (rows.length === 0) return <p className="text-slate-400 text-sm">No historical data available.</p>;

  let lastGp = -1;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        At each point in the regular season (weeks 1–9), what percentage of teams with each record
        historically made the playoffs? Based on all completed seasons.
      </p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 text-center">GP</TableHead>
              <TableHead>Record</TableHead>
              <TableHead className="text-right">Times</TableHead>
              <TableHead className="text-right">Made PO</TableHead>
              <TableHead className="text-right">PO%</TableHead>
              <TableHead className="w-32">Probability</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const showGp = r.gamesPlayed !== lastGp;
              lastGp = r.gamesPlayed;
              return (
                <TableRow key={`${r.gamesPlayed}-${r.wins}-${r.losses}-${r.ties}`}
                  className={showGp && r.gamesPlayed > 1 ? "border-t-2 border-white/10" : ""}
                >
                  <TableCell className="text-center font-mono text-sm text-slate-500">
                    {showGp ? r.gamesPlayed : ""}
                  </TableCell>
                  <TableCell className="font-mono font-semibold">
                    <span className="text-emerald-400">{r.wins}</span>
                    <span className="text-slate-500">-</span>
                    <span className="text-red-400">{r.losses}</span>
                    {(hasTies || r.ties > 0) && (
                      <>
                        <span className="text-slate-500">-</span>
                        <span className="text-amber-400">{r.ties}</span>
                      </>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm text-slate-400">{r.occurrences}</TableCell>
                  <TableCell className="text-right text-sm text-slate-400">{r.madePlayoffs}</TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono font-semibold",
                      r.pct >= 0.8 ? "text-emerald-400"
                        : r.pct >= 0.5 ? "text-blue-400"
                        : r.pct >= 0.2 ? "text-amber-400"
                        : "text-red-400",
                    )}
                  >
                    {fmt(r.pct * 100, 0)}%
                  </TableCell>
                  <TableCell>
                    <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          r.pct >= 0.8 ? "bg-emerald-500/70"
                            : r.pct >= 0.5 ? "bg-blue-500/70"
                            : r.pct >= 0.2 ? "bg-amber-500/70"
                            : "bg-red-500/70",
                        )}
                        style={{ width: `${r.pct * 100}%` }}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Monte Carlo Playoff Simulator ───────────────────────────────────────────

function avg(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** Abramowitz & Stegun approximation for standard normal CDF */
function normalCDF(z: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/** P(team1 beats team2) using normal CDF given projected means and std devs */
function matchupWinProb(m1: number, s1: number, m2: number, s2: number): number {
  const denom = Math.sqrt(s1 ** 2 + s2 ** 2);
  return denom > 0 ? normalCDF((m1 - m2) / denom) : 0.5;
}

interface TeamWeekStat {
  mean: number;
  std: number;
  /** True when this came from real rosters + Sleeper's weekly projections
   *  (bye-aware), false when falling back to the season-long team model. */
  playerLevel: boolean;
}

/** A specific team's projected mean/std for one future week — prefers the
 *  bye-aware, roster-based projection for that week when available, and
 *  otherwise falls back to the season-long team-level model with std
 *  widened by how far out the week is (forecast confidence decays with
 *  distance, so a repeat pairing further out isn't as predictable). */
function getEffectiveTeamWeekStat(
  weekProjections: Map<number, Map<number, TeamWeekProjection> | null>,
  teamId: number,
  week: number,
  nearestWeek: number,
  fallbackMean: number,
  fallbackStd: number,
): TeamWeekStat {
  const wp = weekProjections.get(week)?.get(teamId);
  if (wp) return { mean: wp.mean, std: Math.max(wp.std, 4), playerLevel: true };
  const horizonMul = Math.sqrt(1 + 0.08 * Math.max(week - nearestWeek, 0));
  return { mean: fallbackMean, std: fallbackStd * horizonMul, playerLevel: false };
}

interface SimTeam {
  teamId: number;
  teamName: string;
  projMean: number;
  projStd: number;
  wins: number;
  losses: number;
  ties: number;
  pf: number;
  gamesPlayed: number;
}

interface FutureGame {
  homeId: number;
  awayId: number;
  week: number;
}

function computeSimTeams(
  currentMatchups: MatchupScoresView[],
  allMatchups: MatchupScoresView[],
  sortedHistSeasonIds: number[], // DB season IDs sorted newest→oldest (excluding current)
): SimTeam[] {
  const currentSeasonId = currentMatchups[0]?.season_id;

  // Current season actual scores per team
  const currData = new Map<number, { name: string; scores: number[]; wins: number; losses: number; ties: number; pf: number }>();

  for (const m of currentMatchups) {
    if (m.is_playoff || m.is_consolation || m.home_score == null || m.away_score == null) continue;
    const addTeam = (tid: number | null, name: string | null, score: number, opp: number) => {
      if (!tid || !name) return;
      if (!currData.has(tid)) currData.set(tid, { name, scores: [], wins: 0, losses: 0, ties: 0, pf: 0 });
      const d = currData.get(tid)!;
      d.scores.push(score); d.pf += score;
      if (score > opp) d.wins++;
      else if (score < opp) d.losses++;
      else d.ties++;
    };
    addTeam(m.home_team_id, m.home_team_name, m.home_score, m.away_score);
    addTeam(m.away_team_id, m.away_team_name, m.away_score, m.home_score);
  }
  // Ensure all teams from future matchups are present
  for (const m of currentMatchups) {
    if (m.home_team_id && m.home_team_name && !currData.has(m.home_team_id))
      currData.set(m.home_team_id, { name: m.home_team_name, scores: [], wins: 0, losses: 0, ties: 0, pf: 0 });
    if (m.away_team_id && m.away_team_name && !currData.has(m.away_team_id))
      currData.set(m.away_team_id, { name: m.away_team_name, scores: [], wins: 0, losses: 0, ties: 0, pf: 0 });
  }

  // Historical scores per team per season
  const histByTeamSeason = new Map<number, Map<number, number[]>>();
  for (const m of allMatchups) {
    if (m.season_id === currentSeasonId || m.is_playoff || m.is_consolation) continue;
    if (m.home_score == null || m.away_score == null) continue;
    const addHist = (tid: number | null, score: number, sid: number | null) => {
      if (!tid || !sid) return;
      if (!histByTeamSeason.has(tid)) histByTeamSeason.set(tid, new Map());
      const bySeason = histByTeamSeason.get(tid)!;
      if (!bySeason.has(sid)) bySeason.set(sid, []);
      bySeason.get(sid)!.push(score);
    };
    addHist(m.home_team_id, m.home_score, m.season_id);
    addHist(m.away_team_id, m.away_score, m.season_id);
  }

  // League baseline from all historical scores
  const allHistFlat: number[] = [];
  for (const [, bySeason] of histByTeamSeason) {
    for (const [, scores] of bySeason) allHistFlat.push(...scores);
  }
  const leagueAvg = allHistFlat.length > 0 ? avg(allHistFlat) : 120;
  const leagueStd = allHistFlat.length >= 2 ? stdDev(allHistFlat) : 25;

  return [...currData.entries()].map(([tid, curr]) => {
    const gp = curr.scores.length;
    const currPPG = gp > 0 ? avg(curr.scores) : leagueAvg;
    const currStdDev = gp >= 3 ? stdDev(curr.scores) : leagueStd;

    // Weighted historical mean + std dev (recency: most recent prior season → highest weight)
    const byS = histByTeamSeason.get(tid) ?? new Map<number, number[]>();
    let histMeanW = 0, histStdW = 0, totalW = 0;
    for (const [sid, scores] of byS) {
      const rank = sortedHistSeasonIds.indexOf(sid); // 0 = most recent prior season
      const w = rank === 0 ? 4 : rank === 1 ? 2.5 : rank === 2 ? 1.5 : 0.8;
      histMeanW += avg(scores) * w;
      histStdW += (scores.length >= 2 ? stdDev(scores) : leagueStd) * w;
      totalW += w;
    }
    const histMean = totalW > 0 ? histMeanW / totalW : leagueAvg;
    const histStd = totalW > 0 ? histStdW / totalW : leagueStd;

    // Blend: grows from all-historical (0 games) to 60% current (full season)
    const wCurr = Math.min(gp / 14, 1) * 0.6;
    const projMean = gp === 0 ? histMean : wCurr * currPPG + (1 - wCurr) * histMean;
    const projStd = gp >= 3 ? 0.45 * currStdDev + 0.55 * histStd : histStd;

    return {
      teamId: tid, teamName: curr.name,
      projMean, projStd: Math.max(projStd, 8),
      wins: curr.wins, losses: curr.losses, ties: curr.ties,
      pf: curr.pf, gamesPlayed: gp,
    };
  });
}

function getFutureGames(
  currentMatchups: MatchupScoresView[],
  teams: SimTeam[],
  totalRegularWeeks = 14,
): FutureGame[] {
  // First try: null-score games already in the view
  const fromView = currentMatchups
    .filter((m) => !m.is_playoff && !m.is_consolation && m.home_score == null && m.away_score == null && m.home_team_id && m.away_team_id)
    .map((m) => ({ homeId: m.home_team_id!, awayId: m.away_team_id!, week: m.week_number! }));
  if (fromView.length > 0) return fromView;

  // Fallback: derive remaining weeks from avg games played
  if (teams.length === 0) return [];
  const avgGP = teams.reduce((s, t) => s + t.gamesPlayed, 0) / teams.length;
  const completedWeeks = Math.round(avgGP);
  if (completedWeeks >= totalRegularWeeks) return [];

  const teamIds = teams.map((t) => t.teamId);
  const games: FutureGame[] = [];
  for (let w = completedWeeks + 1; w <= totalRegularWeeks; w++) {
    const shuffled = [...teamIds].sort(() => Math.random() - 0.5);
    for (let i = 0; i + 1 < shuffled.length; i += 2) {
      games.push({ homeId: shuffled[i], awayId: shuffled[i + 1], week: w });
    }
  }
  return games;
}

const DEFAULT_NUM_SIMS = 1_000_000;

/** Masks out regular-season scores after `asOfWeek`, so the simulation can be
 *  re-run as if only weeks up to that point were known — the basis for the
 *  "as of week" look-back selector. Keeps every row (including future weeks)
 *  so schedule pairings stay intact; only the scores are hidden. */
function truncateMatchupsAsOf(matchups: MatchupScoresView[], asOfWeek: number): MatchupScoresView[] {
  return matchups.map((m) =>
    !m.is_playoff && !m.is_consolation && (m.week_number ?? 0) > asOfWeek
      ? { ...m, home_score: null, away_score: null }
      : m,
  );
}

function pctColor(pct: number) {
  return pct >= 0.8 ? "text-emerald-400" : pct >= 0.5 ? "text-blue-400" : pct >= 0.25 ? "text-amber-400" : "text-red-400";
}

function PlayoffSim({
  matchups,
  allMatchups,
  dbSeasons,
}: {
  matchups: MatchupScoresView[];
  allMatchups: MatchupScoresView[];
  dbSeasons: { id: number; year: number; season_number: number }[] | undefined;
}) {
  const [simKey, setSimKey] = useState(0);
  const [numSims, setNumSims] = useState(DEFAULT_NUM_SIMS);
  const { run, isRunning } = usePlayoffSimWorker();
  const queryClient = useQueryClient();
  const [results, setResults] = useState<WorkerSimResult[]>([]);

  const currentSeasonId = matchups[0]?.season_id;
  const sortedHistIds = useMemo(() => {
    if (!dbSeasons) return [];
    return [...dbSeasons]
      .filter((s) => s.id !== currentSeasonId)
      .sort((a, b) => b.id - a.id)
      .map((s) => s.id);
  }, [dbSeasons, currentSeasonId]);

  // Every regular-season week with at least one completed game — powers the
  // "as of week" look-back selector so historical odds can always be replayed.
  const playedWeeks = useMemo(() => {
    const s = new Set<number>();
    for (const m of matchups) {
      if (!m.is_playoff && !m.is_consolation && m.home_score != null && m.away_score != null && m.week_number) {
        s.add(m.week_number);
      }
    }
    return [...s].sort((a, b) => a - b);
  }, [matchups]);
  const latestPlayedWeek = playedWeeks[playedWeeks.length - 1] ?? 0;
  // Every selectable "as of" point, oldest first — 0 (preseason) plus every
  // played week. Shared between the dropdown, the backfill loop, and the
  // week-over-week delta lookup so all three agree on what "previous" means.
  const allAsOfWeeks = useMemo(() => [0, ...playedWeeks], [playedWeeks]);

  const [asOfWeek, setAsOfWeek] = useState(latestPlayedWeek);
  const [playoffSpots, setPlayoffSpots] = useState<number | null>(null);
  // Reset both selectors when the underlying season changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setAsOfWeek(latestPlayedWeek); setPlayoffSpots(null); }, [currentSeasonId]);

  const effectiveMatchups = useMemo(
    () => (asOfWeek >= latestPlayedWeek ? matchups : truncateMatchupsAsOf(matchups, asOfWeek)),
    [matchups, asOfWeek, latestPlayedWeek],
  );

  const teams = useMemo(
    () => computeSimTeams(effectiveMatchups, allMatchups, sortedHistIds),
    [effectiveMatchups, allMatchups, sortedHistIds],
  );

  const futureGames = useMemo(() => getFutureGames(effectiveMatchups, teams), [effectiveMatchups, teams]);
  const teamMap = new Map(teams.map((t) => [t.teamId, t]));

  const seasonBracketSize = getPlayoffBracketSize(currentSeasonId ?? 0);
  const effectiveBracketSize = playoffSpots ?? seasonBracketSize;

  // Player-level (bye-aware) projections only apply to the live season — a
  // completed season never has future games, so this naturally never fires
  // for historical seasons even without an explicit guard on selection.
  const latestDbSeasonId = dbSeasons && dbSeasons.length > 0 ? Math.max(...dbSeasons.map((s) => s.id)) : undefined;
  const isLiveSeason = currentSeasonId != null && currentSeasonId === latestDbSeasonId;

  // Backfill: for a completed past season, replay the sim as of every played
  // week and persist each snapshot, so the "look back" view can be shown
  // for any prior season without re-running the Monte Carlo sim live.
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<{ done: number; total: number } | null>(null);

  async function runBackfill() {
    if (!currentSeasonId || playedWeeks.length === 0) return;
    const weeksToBackfill = allAsOfWeeks;
    setBackfilling(true);
    setBackfillProgress({ done: 0, total: weeksToBackfill.length });
    try {
      await deletePlayoffSimHistoryForSeason(currentSeasonId);
      const bracketSize = getPlayoffBracketSize(currentSeasonId);
      const backfillNumSims = 100_000;
      for (let i = 0; i < weeksToBackfill.length; i++) {
        const week = weeksToBackfill[i];
        const truncated = truncateMatchupsAsOf(matchups, week);
        const weekTeams = computeSimTeams(truncated, allMatchups, sortedHistIds);
        const weekFutureGames = getFutureGames(truncated, weekTeams);
        if (weekFutureGames.length > 0) {
          const weekTeamMap = new Map(weekTeams.map((t) => [t.teamId, t]));
          const weekNearestWeek = Math.min(...weekFutureGames.map((g) => g.week));
          const enrichedGames = weekFutureGames.map((g) => {
            const home = weekTeamMap.get(g.homeId);
            const away = weekTeamMap.get(g.awayId);
            const homeStat = getEffectiveTeamWeekStat(new Map(), g.homeId, g.week, weekNearestWeek, home?.projMean ?? 0, home?.projStd ?? 20);
            const awayStat = getEffectiveTeamWeekStat(new Map(), g.awayId, g.week, weekNearestWeek, away?.projMean ?? 0, away?.projStd ?? 20);
            return {
              homeId: g.homeId, awayId: g.awayId, week: g.week,
              homeMean: homeStat.mean, homeStd: homeStat.std,
              awayMean: awayStat.mean, awayStd: awayStat.std,
            };
          });
          const weekResults = await run({
            teams: weekTeams.map((t) => ({ teamId: t.teamId, wins: t.wins, losses: t.losses, ties: t.ties, pf: t.pf })),
            futureGames: enrichedGames,
            numSims: backfillNumSims,
            bracketSize,
          });
          await savePlayoffSimSnapshot(currentSeasonId, week, bracketSize, backfillNumSims, weekResults.map((r) => {
            const t = weekTeamMap.get(r.teamId);
            return {
              teamId: r.teamId,
              projPpg: t?.projMean ?? 0,
              projStd: t?.projStd ?? 0,
              projWins: r.avgProjectedWins,
              projSeed: r.avgRank,
              playoffPct: r.playoffPct,
              seedPct: r.seedPct,
            };
          }));
        }
        setBackfillProgress({ done: i + 1, total: weeksToBackfill.length });
      }
    } finally {
      setBackfilling(false);
      queryClient.invalidateQueries({ queryKey: ["playoff-sim-history", currentSeasonId] });
    }
  }

  const { data: rosterData } = useQuery({
    queryKey: ["sleeper-rosters-for-sim"],
    queryFn: async () => {
      const [rosters, league, rosterTeamMap] = await Promise.all([
        fetchLeagueRosters(LEAGUE_ID),
        fetchLeague(LEAGUE_ID),
        buildRosterToTeamMap(LEAGUE_ID),
      ]);
      return { rosters, league, rosterTeamMap };
    },
    enabled: isLiveSeason,
    staleTime: 30 * 60 * 1000,
  });

  // Backfilled week-by-week snapshots (if any exist for this season) power
  // the "change since last week" indicator next to Playoff % below.
  const { data: simHistory } = useQuery({
    queryKey: ["playoff-sim-history", currentSeasonId],
    queryFn: () => fetchPlayoffSimHistory(currentSeasonId!),
    enabled: currentSeasonId != null,
    staleTime: 5 * 60 * 1000,
  });
  const historyByWeek = useMemo(() => {
    const m = new Map<number, Map<number, number>>();
    for (const row of simHistory ?? []) {
      if (!m.has(row.as_of_week)) m.set(row.as_of_week, new Map());
      m.get(row.as_of_week)!.set(row.team_id, row.playoff_pct);
    }
    return m;
  }, [simHistory]);
  const previousAsOfWeek = (() => {
    const idx = allAsOfWeeks.indexOf(asOfWeek);
    return idx > 0 ? allAsOfWeeks[idx - 1] : null;
  })();
  const prevWeekPlayoffPct = previousAsOfWeek != null ? historyByWeek.get(previousAsOfWeek) : undefined;

  const futureWeeks = useMemo(
    () => [...new Set(futureGames.map((g) => g.week))].sort((a, b) => a - b),
    [futureGames],
  );
  const nearestWeek = futureWeeks[0] ?? 0;

  const [weekProjections, setWeekProjections] = useState<Map<number, Map<number, TeamWeekProjection> | null>>(new Map());
  useEffect(() => {
    if (!rosterData || futureWeeks.length === 0) { setWeekProjections(new Map()); return; }
    let cancelled = false;
    const rosterInputs = rosterData.rosters
      .map((r) => {
        const teamId = rosterData.rosterTeamMap.get(r.roster_id);
        return teamId ? { teamId, players: r.players ?? [], starters: r.starters ?? [] } : null;
      })
      .filter((r): r is { teamId: number; players: string[]; starters: string[] } => r != null);

    Promise.all(futureWeeks.map(async (week) => {
      const proj = await computeTeamWeekProjections(rosterData.league.season, week, rosterInputs, rosterData.league.roster_positions);
      return [week, proj] as const;
    })).then((entries) => {
      if (!cancelled) setWeekProjections(new Map(entries));
    });
    return () => { cancelled = true; };
  }, [rosterData, futureWeeks]);

  // simKey lets the user force a fresh re-randomization without changing inputs
  useEffect(() => {
    let cancelled = false;
    if (teams.length === 0) return;
    const enrichedGames = futureGames.map((g) => {
      const home = teamMap.get(g.homeId);
      const away = teamMap.get(g.awayId);
      const homeStat = getEffectiveTeamWeekStat(weekProjections, g.homeId, g.week, nearestWeek, home?.projMean ?? 0, home?.projStd ?? 20);
      const awayStat = getEffectiveTeamWeekStat(weekProjections, g.awayId, g.week, nearestWeek, away?.projMean ?? 0, away?.projStd ?? 20);
      return {
        homeId: g.homeId, awayId: g.awayId, week: g.week,
        homeMean: homeStat.mean, homeStd: homeStat.std,
        awayMean: awayStat.mean, awayStd: awayStat.std,
      };
    });
    run({
      teams: teams.map((t) => ({
        teamId: t.teamId, wins: t.wins, losses: t.losses, ties: t.ties, pf: t.pf,
      })),
      futureGames: enrichedGames,
      numSims,
      bracketSize: effectiveBracketSize,
    }).then((res) => { if (!cancelled) setResults(res); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams, futureGames, numSims, effectiveBracketSize, simKey, weekProjections]);

  if (teams.length === 0)
    return <p className="text-slate-400 text-sm">No team data for the selected season.</p>;

  const weeksLeft = new Set(futureGames.map((g) => g.week)).size;
  const numTeams = teams.length;

  // Sort by projected rank (avgRank ascending = best seed first)
  const sortedResults = [...results].sort((a, b) => a.avgRank - b.avgRank);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => setSimKey((k) => k + 1)}
          disabled={isRunning}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-white/10 rounded-md text-slate-400 hover:text-white hover:border-white/20 transition-colors disabled:opacity-50"
        >
          {isRunning && <Loader2 className="h-3 w-3 animate-spin" />}
          {isRunning ? "Simulating…" : `Re-run (${numSims.toLocaleString()} sims)`}
        </button>

        {!isLiveSeason && playedWeeks.length > 0 && (
          <button
            onClick={runBackfill}
            disabled={backfilling}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-white/10 rounded-md text-slate-400 hover:text-white hover:border-white/20 transition-colors disabled:opacity-50"
          >
            {backfilling && <Loader2 className="h-3 w-3 animate-spin" />}
            {backfilling
              ? `Backfilling week ${backfillProgress?.done ?? 0}/${backfillProgress?.total ?? playedWeeks.length}…`
              : "Backfill week-by-week history"}
          </button>
        )}
        {!isLiveSeason && !backfilling && (simHistory?.length ?? 0) === 0 && playedWeeks.length > 0 && (
          <span className="text-[11px] text-slate-600 italic">Run backfill to see week-over-week change</span>
        )}

        {/* Sim count */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Sims:</span>
          <div className="flex gap-1 rounded-lg border border-white/10 p-0.5">
            {[10_000, 100_000, 1_000_000].map((n) => (
              <button
                key={n}
                onClick={() => setNumSims(n)}
                className={cn(
                  "px-2 py-1 text-xs rounded-md transition-colors",
                  numSims === n ? "bg-white/10 text-white font-medium" : "text-slate-400 hover:text-white",
                )}
              >
                {n >= 1_000_000 ? "1M" : n.toLocaleString()}
              </button>
            ))}
          </div>
        </div>

        {/* As-of-week look-back selector */}
        {playedWeeks.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">As of week:</span>
            <select
              value={asOfWeek}
              onChange={(e) => setAsOfWeek(Number(e.target.value))}
              className="bg-slate-900 border border-white/10 rounded-md text-xs text-white px-2 py-1"
            >
              <option value={0} className="bg-slate-900 text-white">Preseason</option>
              {playedWeeks.map((w) => (
                <option key={w} value={w} className="bg-slate-900 text-white">
                  Week {w}{w === latestPlayedWeek ? " (latest)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        <p className="text-xs text-slate-500">
          {weeksLeft > 0 ? `${weeksLeft} regular season week${weeksLeft > 1 ? "s" : ""} remaining` : "Regular season complete — showing final standings"}
        </p>
        {/* Playoff spots dropdown */}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-slate-500">Playoff spots:</span>
          <div className="flex gap-1 rounded-lg border border-white/10 p-0.5">
            {[4, 5, 6].map((n) => (
              <button
                key={n}
                onClick={() => setPlayoffSpots(n)}
                className={cn(
                  "px-2.5 py-1 text-xs rounded-md transition-colors",
                  effectiveBracketSize === n
                    ? "bg-white/10 text-white font-medium"
                    : "text-slate-400 hover:text-white",
                )}
              >
                Top {n}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className={cn("space-y-4 transition-opacity duration-200", isRunning && "opacity-40 pointer-events-none")}>
      <p className="text-xs text-slate-500 border-l-2 border-white/10 pl-3">
        Projected mean blends actual season PPG (weighted by games played) with recency-weighted career average.
        Sorted by projected seed — Playoff % shows odds of finishing in the top {effectiveBracketSize}.
        {asOfWeek < latestPlayedWeek && (
          asOfWeek === 0
            ? " Showing preseason odds — no games played yet, based purely on historical projections."
            : ` Showing odds as they stood after Week ${asOfWeek} — later results aren't factored in.`
        )}
      </p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              <TableHead>Team</TableHead>
              <TableHead className="text-right">Record</TableHead>
              <TableHead className="text-right">PF</TableHead>
              <TableHead className="text-right">Proj PPG</TableHead>
              <TableHead className="text-right">±</TableHead>
              <TableHead className="text-right">Proj W</TableHead>
              <TableHead className="text-right">Proj Seed</TableHead>
              <TableHead className="text-right">Playoff %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedResults.map((r, i) => {
              const t = teamMap.get(r.teamId);
              if (!t) return null;
              return (
                <TableRow key={r.teamId}>
                  <TableCell className="text-slate-500 text-sm">{i + 1}</TableCell>
                  <TableCell>
                    <Link to={`/team/${r.teamId}`} className="text-primary hover:underline font-medium">
                      {t.teamName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    <span className="text-emerald-400">{t.wins}</span>
                    <span className="text-slate-500">-</span>
                    <span className="text-red-400">{t.losses}</span>
                    {t.ties > 0 && (
                      <>
                        <span className="text-slate-500">-</span>
                        <span className="text-amber-400">{t.ties}</span>
                      </>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm text-slate-400">{fmt(t.pf, 1)}</TableCell>
                  <TableCell className="text-right font-mono text-sm text-slate-300">{fmt(t.projMean, 1)}</TableCell>
                  <TableCell className="text-right font-mono text-sm text-slate-500">±{fmt(t.projStd, 1)}</TableCell>
                  <TableCell className="text-right font-mono text-sm text-slate-400">{fmt(r.avgProjectedWins, 1)}</TableCell>
                  <TableCell className="text-right font-mono text-sm text-slate-300">
                    #{fmt(r.avgRank, 1)}
                  </TableCell>
                  <TableCell className={cn("text-right font-mono font-semibold text-sm", pctColor(r.playoffPct))}>
                    {fmt(r.playoffPct * 100, 1)}%
                    {(() => {
                      const prevPct = prevWeekPlayoffPct?.get(r.teamId);
                      if (prevPct == null) return null;
                      const delta = r.playoffPct * 100 - prevPct * 100;
                      if (Math.abs(delta) < 0.05) {
                        return <span className="ml-1.5 text-[10px] font-normal text-slate-600">±0.0</span>;
                      }
                      return (
                        <span className={cn("ml-1.5 text-[10px] font-normal", delta > 0 ? "text-emerald-500" : "text-red-500")}>
                          {delta > 0 ? "▲" : "▼"}{fmt(Math.abs(delta), 1)}
                        </span>
                      );
                    })()}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Seed distribution matrix */}
      {results.length > 0 && (
        <div className="mt-6 border-t border-white/10 pt-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-1">Finish Probability by Seed</h3>
          <p className="text-xs text-slate-500 mb-3">
            Chance of finishing in each exact position across all {numSims.toLocaleString()} simulated seasons.
            Shaded columns clinch a playoff spot at that seed.
          </p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  {Array.from({ length: numTeams }, (_, i) => (
                    <TableHead key={i} className="text-center w-14">{i + 1}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedResults.map((r) => {
                  const t = teamMap.get(r.teamId);
                  if (!t) return null;
                  return (
                    <TableRow key={r.teamId}>
                      <TableCell>
                        <Link to={`/team/${r.teamId}`} className="text-primary hover:underline font-medium text-sm">
                          {t.teamName}
                        </Link>
                      </TableCell>
                      {r.seedPct.map((pct, seedIdx) => (
                        <TableCell
                          key={seedIdx}
                          className={cn(
                            "text-center font-mono text-xs p-1",
                            seedIdx < effectiveBracketSize && "bg-amber-400/[0.06]",
                          )}
                        >
                          {pct >= 0.001 ? (
                            <span className={pct >= 0.5 ? "text-white font-semibold" : "text-slate-400"}>
                              {fmt(pct * 100, pct >= 0.1 ? 0 : 1)}%
                            </span>
                          ) : (
                            <span className="text-slate-700">—</span>
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Matchup Odds by Week */}
      {weeksLeft > 0 && (() => {
        const gamesByWeek = new Map<number, FutureGame[]>();
        for (const g of futureGames) {
          if (!gamesByWeek.has(g.week)) gamesByWeek.set(g.week, []);
          gamesByWeek.get(g.week)!.push(g);
        }
        const sortedWeeks = [...gamesByWeek.keys()].sort((a, b) => a - b);
        return (
          <div className="space-y-4 mt-6 border-t border-white/10 pt-6">
            <div>
              <h3 className="text-sm font-semibold text-slate-300 mb-1">Remaining Matchup Odds</h3>
              <p className="text-xs text-slate-500">
                Analytical win probability: P(A beats B) = Φ((μ<sub>A</sub>−μ<sub>B</sub>)/√(σ<sub>A</sub>²+σ<sub>B</sub>²)).
                Uncertainty widens the further out a game is — a repeat matchup 9 weeks from now isn't
                as predictable as the same pairing next week, even though the projection itself hasn't changed.
              </p>
            </div>
            {sortedWeeks.map((week) => {
              const weekIsPlayerLevel = weekProjections.get(week) != null;
              return (
              <div key={week}>
                <p className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wide flex items-center gap-2">
                  Week {week}
                  {weekIsPlayerLevel && (
                    <span className="normal-case tracking-normal font-normal text-emerald-400/80 text-[10px] bg-emerald-400/10 rounded px-1.5 py-0.5">
                      live rosters + bye weeks
                    </span>
                  )}
                </p>
                <div className="grid gap-2">
                  {gamesByWeek.get(week)!.map((g) => {
                    const home = teamMap.get(g.homeId);
                    const away = teamMap.get(g.awayId);
                    if (!home || !away) return null;
                    const homeStat = getEffectiveTeamWeekStat(weekProjections, g.homeId, week, nearestWeek, home.projMean, home.projStd);
                    const awayStat = getEffectiveTeamWeekStat(weekProjections, g.awayId, week, nearestWeek, away.projMean, away.projStd);
                    const homeProb = matchupWinProb(homeStat.mean, homeStat.std, awayStat.mean, awayStat.std);
                    const awayProb = 1 - homeProb;
                    const favored = homeProb >= awayProb ? home : away;
                    const favProb = Math.max(homeProb, awayProb);
                    return (
                      <div
                        key={`${g.homeId}-${g.awayId}-${week}`}
                        className="flex items-center gap-3 bg-white/3 rounded-lg px-4 py-3"
                      >
                        {/* Home team */}
                        <div className="flex-1 flex items-center justify-end gap-2 min-w-0">
                          <span className={cn(
                            "text-sm font-medium truncate",
                            homeProb > awayProb ? "text-white" : "text-slate-400",
                          )}>
                            {home.teamName}
                          </span>
                          <span className={cn(
                            "font-mono text-sm font-semibold shrink-0",
                            homeProb >= 0.65 ? "text-emerald-400" : homeProb >= 0.5 ? "text-blue-400" : "text-slate-400",
                          )}>
                            {fmt(homeProb * 100, 1)}%
                          </span>
                        </div>
                        {/* Bar */}
                        <div className="w-28 shrink-0">
                          <div className="h-2 rounded-full overflow-hidden bg-white/5 flex">
                            <div
                              className={cn(
                                "h-full rounded-l-full",
                                homeProb > awayProb ? "bg-emerald-500/70" : "bg-slate-500/50",
                              )}
                              style={{ width: `${homeProb * 100}%` }}
                            />
                            <div
                              className={cn(
                                "h-full rounded-r-full",
                                awayProb > homeProb ? "bg-emerald-500/70" : "bg-slate-500/50",
                              )}
                              style={{ width: `${awayProb * 100}%` }}
                            />
                          </div>
                          <p className="text-center text-[10px] text-slate-600 mt-0.5">
                            {favored.teamName.split(" ")[0]} favored ({fmt(favProb * 100, 1)}%)
                          </p>
                        </div>
                        {/* Away team */}
                        <div className="flex-1 flex items-center gap-2 min-w-0">
                          <span className={cn(
                            "font-mono text-sm font-semibold shrink-0",
                            awayProb >= 0.65 ? "text-emerald-400" : awayProb >= 0.5 ? "text-blue-400" : "text-slate-400",
                          )}>
                            {fmt(awayProb * 100, 1)}%
                          </span>
                          <span className={cn(
                            "text-sm font-medium truncate",
                            awayProb > homeProb ? "text-white" : "text-slate-400",
                          )}>
                            {away.teamName}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              );
            })}
          </div>
        );
      })()}
      </div>
    </div>
  );
}

// ─── Bracket helpers (deterministic, using actual game scores) ───────────────

interface BracketEntry { id: number; name: string; ppg: number; pStd: number }

interface ParallelBracketGame {
  round: string;
  teamAId: number; teamAName: string; teamAScore: number;
  teamBId: number; teamBName: string; teamBScore: number;
  winnerId: number;
  isActualGame: boolean; // false = one or both teams didn't play in that playoff week; fell back to PPG
}

/**
 * Get the score a team posted in a specific playoff week.
 * Uses week_number as the reliable indicator (is_playoff flag is unreliable in DB).
 * Returns null if the team didn't participate in that week.
 */
function getTeamPlayoffWeekScore(
  seasonMatchups: MatchupScoresView[],
  teamId: number,
  week: number,
): number | null {
  for (const m of seasonMatchups) {
    if (m.week_number !== week) continue;
    if (m.home_score == null || m.away_score == null) continue;
    if (m.home_team_id === teamId) return m.home_score;
    if (m.away_team_id === teamId) return m.away_score;
  }
  return null;
}

/**
 * Play out an AP-seeded bracket deterministically.
 * For each round, uses each team's actual score from the corresponding playoff week.
 * If a team didn't play in the real playoffs that week, falls back to their PPG.
 * teams must be sorted by seed (index 0 = #1 seed).
 */
function bPlayBracket(
  teams: BracketEntry[],
  seasonMatchups: MatchupScoresView[],
): { winnerId: number; games: ParallelBracketGame[] } {
  // Detect which playoff weeks are present (week >= 15 is the reliable indicator; is_playoff flag is unreliable)
  const playoffWeeks = [...new Set(
    seasonMatchups
      .filter(m => m.week_number != null && m.week_number >= 15)
      .map(m => m.week_number!)
  )].sort((a, b) => a - b);

  if (playoffWeeks.length === 0) return { winnerId: teams[0]?.id ?? -1, games: [] };

  const games: ParallelBracketGame[] = [];

  const getScore = (t: BracketEntry, week: number): { score: number; isActual: boolean } => {
    const s = getTeamPlayoffWeekScore(seasonMatchups, t.id, week);
    return s != null ? { score: s, isActual: true } : { score: t.ppg, isActual: false };
  };

  const play = (a: BracketEntry, b: BracketEntry, round: string, week: number): BracketEntry => {
    const aR = getScore(a, week);
    const bR = getScore(b, week);
    games.push({
      round,
      teamAId: a.id, teamAName: a.name, teamAScore: aR.score,
      teamBId: b.id, teamBName: b.name, teamBScore: bR.score,
      winnerId: aR.score >= bR.score ? a.id : b.id,
      isActualGame: aR.isActual && bR.isActual,
    });
    return aR.score >= bR.score ? a : b;
  };

  // Week assignments by bracket format
  const w0 = playoffWeeks[0];
  const w1 = playoffWeeks[1] ?? w0;
  const w2 = playoffWeeks[2] ?? w1;

  if (teams.length >= 6) {
    // 6-team: first-round W0, semis W1, championship W2
    const r1a = play(teams[2], teams[5], 'First Round', w0);
    const r1b = play(teams[3], teams[4], 'First Round', w0);
    const sA  = play(teams[0], r1a, 'Semifinal', w1);
    const sB  = play(teams[1], r1b, 'Semifinal', w1);
    const w   = play(sA, sB, 'Championship', w2);
    return { winnerId: w.id, games };
  }
  if (teams.length === 5) {
    // 5-team: play-in W0, semis W1, championship W2
    const pi = play(teams[3], teams[4], 'Play-In', w0);
    const sA = play(teams[0], pi, 'Semifinal', w1);
    const sB = play(teams[1], teams[2], 'Semifinal', w1);
    const w  = play(sA, sB, 'Championship', w2);
    return { winnerId: w.id, games };
  }
  // 4-team: semis W0, championship W1
  const sA = play(teams[0], teams[3], 'Semifinal', w0);
  const sB = play(teams[1], teams[2], 'Semifinal', w0);
  const w  = play(sA, sB, 'Championship', w1);
  return { winnerId: w.id, games };
}

// ─── Parallel Universe ────────────────────────────────────────────────────────

interface ParallelTeam {
  teamId: number; teamName: string;
  allPlayWins: number; allPlayTotal: number; allPlayWinPct: number;
  ppg: number; ppgStd: number;
  actualSeed: number; apSeed: number; seedDelta: number;
}

interface ParallelSeasonResult {
  seasonId: number; year: number;
  actualChampId: number | null; actualChampName: string;
  expectedChampId: number | null; expectedChampName: string;
  isSame: boolean;
  teams: ParallelTeam[];
  bracketGames: ParallelBracketGame[];
}

function computeParallelUniverse(
  allMatchups: MatchupScoresView[],
  yearMap: Map<number, number>,
): ParallelSeasonResult[] {
  const seasonIds = [
    ...new Set(allMatchups.map(m => m.season_id).filter((s): s is number => s != null))
  ].sort((a, b) => a - b);

  const results: ParallelSeasonResult[] = [];

  for (const sid of seasonIds) {
    const seasonMatchups = allMatchups.filter(m => m.season_id === sid);
    // week_number is the reliable indicator; is_playoff/is_consolation flags are unreliable in DB
    const regular  = seasonMatchups.filter(m => (m.week_number ?? 0) < 15);
    const playoffs = seasonMatchups.filter(m => (m.week_number ?? 0) >= 15);
    if (regular.length === 0) continue;

    type TS = { name: string; scores: number[]; actualWins: number; actualPF: number; apWins: number; apTotal: number };
    const ts = new Map<number, TS>();
    const ensureTs = (id: number, name: string) => {
      if (!ts.has(id)) ts.set(id, { name, scores: [], actualWins: 0, actualPF: 0, apWins: 0, apTotal: 0 });
      return ts.get(id)!;
    };

    const weekMap = new Map<number, { teamId: number; name: string; score: number }[]>();
    for (const m of regular) {
      if (!m.home_team_id || !m.away_team_id || m.home_score == null || m.away_score == null) continue;
      const wk = m.week_number!;
      if (!weekMap.has(wk)) weekMap.set(wk, []);
      weekMap.get(wk)!.push({ teamId: m.home_team_id, name: m.home_team_name!, score: m.home_score });
      weekMap.get(wk)!.push({ teamId: m.away_team_id, name: m.away_team_name!, score: m.away_score });
      const h = ensureTs(m.home_team_id, m.home_team_name!);
      const a = ensureTs(m.away_team_id, m.away_team_name!);
      h.scores.push(m.home_score); h.actualPF += m.home_score;
      a.scores.push(m.away_score); a.actualPF += m.away_score;
      if (m.home_score > m.away_score) h.actualWins++;
      else if (m.away_score > m.home_score) a.actualWins++;
    }

    for (const [, scores] of weekMap) {
      const n = scores.length;
      for (const { teamId, name, score } of scores) {
        const d = ensureTs(teamId, name);
        const beaten = scores.filter(o => o.teamId !== teamId && score > o.score).length;
        const tied   = scores.filter(o => o.teamId !== teamId && score === o.score).length;
        d.apWins += beaten + tied * 0.5;
        d.apTotal += n - 1;
      }
    }

    if (ts.size === 0) continue;
    const leagueStd = stdDev([...ts.values()].flatMap(s => s.scores));

    // Actual seeds (by wins; ties broken by a restricted round-robin among
    // just the tied teams — not points-for. This is the league's real
    // tiebreak rule: confirmed against Sleeper's actual historical bracket
    // seeding, where plain win%+PF gets a 3-way tie wrong.)
    const winGroups = new Map<number, number[]>();
    for (const [tid, s] of ts) {
      if (!winGroups.has(s.actualWins)) winGroups.set(s.actualWins, []);
      winGroups.get(s.actualWins)!.push(tid);
    }
    const actualOrder: number[] = [];
    for (const wins of [...winGroups.keys()].sort((a, b) => b - a)) {
      const group = winGroups.get(wins)!;
      if (group.length === 1) { actualOrder.push(group[0]); continue; }
      const h2hWins = new Map<number, number>(group.map((id) => [id, 0]));
      for (const scores of weekMap.values()) {
        const byTeam = new Map(scores.map((s) => [s.teamId, s.score]));
        for (const a of group) {
          const aScore = byTeam.get(a);
          if (aScore == null) continue;
          for (const b of group) {
            if (a === b) continue;
            const bScore = byTeam.get(b);
            if (bScore == null) continue;
            if (aScore > bScore) h2hWins.set(a, (h2hWins.get(a) ?? 0) + 1);
          }
        }
      }
      const sortedGroup = [...group].sort((a, b) => {
        const aw = h2hWins.get(a) ?? 0, bw = h2hWins.get(b) ?? 0;
        if (aw !== bw) return bw - aw;
        return ts.get(b)!.actualPF - ts.get(a)!.actualPF;
      });
      actualOrder.push(...sortedGroup);
    }
    const actualSorted = actualOrder.map((tid) => [tid, ts.get(tid)!] as [number, TS]);
    const actualSeedMap = new Map(actualSorted.map(([tid], i) => [tid, i + 1]));

    // All-play seeds (by all-play win%, PPG tiebreaker)
    const apSorted = [...ts.entries()]
      .map(([tid, s]) => ({
        teamId: tid, teamName: s.name,
        apWinPct: s.apTotal > 0 ? s.apWins / s.apTotal : 0,
        apWins: s.apWins, apTotal: s.apTotal,
        ppg: s.scores.length > 0 ? s.scores.reduce((a, b) => a + b, 0) / s.scores.length : 0,
        ppgStd: s.scores.length >= 2 ? stdDev(s.scores) : leagueStd,
      }))
      .sort((a, b) => b.apWinPct - a.apWinPct || b.ppg - a.ppg);

    const teams: ParallelTeam[] = apSorted.map((t, i) => ({
      teamId: t.teamId, teamName: t.teamName,
      allPlayWins: t.apWins, allPlayTotal: t.apTotal, allPlayWinPct: t.apWinPct,
      ppg: t.ppg, ppgStd: t.ppgStd,
      actualSeed: actualSeedMap.get(t.teamId) ?? 99,
      apSeed: i + 1,
      seedDelta: (actualSeedMap.get(t.teamId) ?? 99) - (i + 1),
    }));

    // Actual champion (from real playoffs)
    const bracketSize = getPlayoffBracketSize(sid);
    const bracketIds = new Set(actualSorted.slice(0, bracketSize).map(([tid]) => tid));
    const seedMap = new Map(actualSorted.map(([tid], i) => [tid, i + 1]));
    const placements = getTeamFinalPlacements(playoffs, bracketIds, seedMap, sid);
    let actualChampId: number | null = null, actualChampName = '';
    for (const [tid, place] of placements) {
      if (place === 1) { actualChampId = tid; actualChampName = ts.get(tid)?.name ?? ''; break; }
    }

    // Play bracket deterministically with AP seeds + actual game scores
    const bracketTeams: BracketEntry[] = teams.slice(0, bracketSize).map(t => ({
      id: t.teamId, name: t.teamName, ppg: t.ppg, pStd: Math.max(t.ppgStd, 8),
    }));

    // Only resolve bracket if enough playoff data exists
    let expectedChampId: number | null = null;
    let expectedChampName = '';
    let bracketGames: ParallelBracketGame[] = [];

    if (playoffs.length > 0 && bracketTeams.length > 0) {
      const result = bPlayBracket(bracketTeams, seasonMatchups);
      expectedChampId = result.winnerId;
      expectedChampName = ts.get(result.winnerId)?.name ?? '';
      bracketGames = result.games;
    }

    results.push({
      seasonId: sid, year: yearMap.get(sid) ?? sid,
      actualChampId, actualChampName,
      expectedChampId, expectedChampName,
      isSame: expectedChampId != null && actualChampId === expectedChampId,
      teams,
      bracketGames,
    });
  }

  return results;
}

const ROUND_ORDER = ['Play-In', 'First Round', 'Semifinal', 'Championship'];
const roundSortKey = (r: string) => ROUND_ORDER.indexOf(r) >= 0 ? ROUND_ORDER.indexOf(r) : 99;

function ParallelUniverseTab({
  allMatchups,
  yearMap,
}: {
  allMatchups: MatchupScoresView[];
  yearMap: Map<number, number>;
}) {
  const results = useMemo(
    () => computeParallelUniverse(allMatchups, yearMap),
    [allMatchups, yearMap],
  );

  // Default to the most recently completed season (has bracket games), not the current in-progress season
  const lastCompletedSid = useMemo(
    () => [...results].reverse().find(r => r.bracketGames.length > 0)?.seasonId
      ?? results[results.length - 1]?.seasonId
      ?? 0,
    [results],
  );
  const [selectedSid, setSelectedSid] = useState<number>(0);
  const sid = selectedSid || lastCompletedSid;
  const season = results.find(r => r.seasonId === sid);

  if (results.length === 0) return <p className="text-slate-400 text-sm">No data available.</p>;

  const completedResults = results.filter(r => r.actualChampId !== null && r.expectedChampId !== null);
  const luckCount = completedResults.filter(r => !r.isSame).length;

  // Group bracket games by round for display
  const gamesByRound = season
    ? [...season.bracketGames].sort((a, b) => roundSortKey(a.round) - roundSortKey(b.round))
    : [];

  return (
    <div className="space-y-6">
      {/* Description */}
      <div className="space-y-1">
        <p className="text-sm text-slate-400">
          Re-seeds the playoff bracket using all-play win% (who <em>deserved</em> each seed based on scoring
          vs the whole league every week), then plays out the bracket using <em>actual playoff scores</em>.
        </p>
        <p className="text-xs text-slate-500">
          In <span className="text-amber-400 font-medium">{luckCount} of {completedResults.length}</span> completed seasons,
          the luck-adjusted expected champion differs from the actual champion.
        </p>
      </div>

      {/* All-seasons summary */}
      <div>
        <h3 className="text-sm font-semibold text-slate-300 mb-2">Championship Luck Index — All Seasons</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-slate-500 text-xs uppercase tracking-wide">
                <th className="text-left py-2 pr-4">Year</th>
                <th className="text-left py-2 pr-4">Actual Champion</th>
                <th className="text-left py-2 pr-4">AP Expected Champion</th>
                <th className="text-left py-2">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {results.map(r => (
                <tr
                  key={r.seasonId}
                  className={cn("border-b border-white/5 cursor-pointer hover:bg-white/3 transition-colors",
                    r.seasonId === sid ? "bg-white/5" : "")}
                  onClick={() => setSelectedSid(r.seasonId)}
                >
                  <td className="py-2 pr-4 text-slate-400 font-mono">{r.year}</td>
                  <td className="py-2 pr-4">
                    {r.actualChampId ? (
                      <span className={r.isSame ? "text-emerald-400 font-medium" : "text-slate-300"}>{r.actualChampName}</span>
                    ) : <span className="text-slate-600 italic">In progress</span>}
                  </td>
                  <td className="py-2 pr-4 font-medium text-amber-400">
                    {r.expectedChampId ? r.expectedChampName : <span className="text-slate-600 italic">—</span>}
                  </td>
                  <td className="py-2">
                    {r.actualChampId == null || r.expectedChampId == null ? (
                      <span className="text-slate-600 text-xs">—</span>
                    ) : r.isSame ? (
                      <span className="text-emerald-400 text-xs font-medium">✓ Fair</span>
                    ) : (
                      <span className="text-red-400 text-xs font-medium">⚡ Lucky</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Season detail */}
      {season && (
        <div className="space-y-4 border-t border-white/10 pt-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h3 className="text-sm font-semibold text-slate-300">
              Season {season.year} — All-Play Seedings &amp; AP Bracket Results
            </h3>
            <Select value={String(sid)} onValueChange={v => setSelectedSid(Number(v))}>
              <SelectTrigger className="w-[130px] h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {results.map(r => (
                  <SelectItem key={r.seasonId} value={String(r.seasonId)}>{r.year}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* All-play standings */}
            <div>
              <p className="text-xs text-slate-500 mb-2">All-play seed vs actual seed. <span className="text-amber-400/70">Gold = playoff bracket teams.</span></p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-slate-500 text-xs">
                    <th className="text-left py-1.5 pr-2">AP#</th>
                    <th className="text-left py-1.5 pr-2">Team</th>
                    <th className="text-right py-1.5 pr-2">All-Play</th>
                    <th className="text-right py-1.5 pr-2">AP%</th>
                    <th className="text-right py-1.5 pr-2">Actual#</th>
                    <th className="text-right py-1.5">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {season.teams.map(t => {
                    const inBracket = t.apSeed <= getPlayoffBracketSize(season.seasonId);
                    return (
                      <tr key={t.teamId} className="border-b border-white/5">
                        <td className={cn("py-1.5 pr-2 font-bold tabular-nums", inBracket ? "text-amber-400" : "text-slate-600")}>{t.apSeed}</td>
                        <td className={cn("py-1.5 pr-2 font-medium", inBracket ? "text-slate-200" : "text-slate-500")}>{t.teamName}</td>
                        <td className="py-1.5 pr-2 text-right font-mono text-slate-400 text-xs">
                          {Math.round(t.allPlayWins)}-{Math.round(t.allPlayTotal - t.allPlayWins)}
                        </td>
                        <td className={cn("py-1.5 pr-2 text-right font-mono text-xs",
                          t.allPlayWinPct >= 0.55 ? "text-emerald-400" : t.allPlayWinPct >= 0.45 ? "text-slate-300" : "text-red-400")}>
                          {fmt(t.allPlayWinPct * 100, 1)}%
                        </td>
                        <td className="py-1.5 pr-2 text-right font-mono text-slate-500 text-xs">{t.actualSeed}</td>
                        <td className={cn("py-1.5 text-right font-mono text-xs font-semibold",
                          t.seedDelta > 0 ? "text-red-400" : t.seedDelta < 0 ? "text-emerald-400" : "text-slate-600")}>
                          {t.seedDelta > 0 ? `+${t.seedDelta}` : t.seedDelta < 0 ? t.seedDelta : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-xs text-slate-600 mt-1.5">Δ = actual seed − deserved seed. Positive = seeded too low (unlucky schedule).</p>
            </div>

            {/* AP bracket game results */}
            <div>
              <p className="text-xs text-slate-500 mb-3">
                Bracket played using actual playoff scores, re-seeded by all-play win%.
                {gamesByRound.some(g => !g.isActualGame) && (
                  <span className="text-amber-400/70 ml-1">† = teams never met; PPG used as tiebreaker.</span>
                )}
              </p>

              {gamesByRound.length === 0 ? (
                <p className="text-slate-600 text-xs italic">No playoff data yet.</p>
              ) : (
                <div className="space-y-2">
                  {gamesByRound.map((g, i) => {
                    const isChamp = g.round === 'Championship';
                    const winnerIsA = g.winnerId === g.teamAId;
                    return (
                      <div
                        key={i}
                        className={cn(
                          "rounded-lg px-4 py-3 border",
                          isChamp
                            ? "bg-amber-500/5 border-amber-500/20"
                            : "bg-white/3 border-white/5",
                        )}
                      >
                        <p className={cn(
                          "text-[10px] uppercase tracking-widest font-semibold mb-2",
                          isChamp ? "text-amber-400/80" : "text-slate-500",
                        )}>
                          {g.round}{!g.isActualGame ? " †" : ""}
                        </p>
                        <div className="flex items-center gap-3">
                          {/* Team A */}
                          <div className="flex-1 min-w-0">
                            <p className={cn(
                              "text-sm font-semibold truncate",
                              winnerIsA ? "text-white" : "text-slate-500",
                            )}>
                              {g.teamAName}
                            </p>
                            <p className={cn(
                              "font-mono text-base font-bold",
                              winnerIsA ? (isChamp ? "text-amber-400" : "text-emerald-400") : "text-slate-600",
                            )}>
                              {fmt(g.teamAScore, 2)}
                            </p>
                          </div>
                          <span className="text-slate-600 text-xs shrink-0">vs</span>
                          {/* Team B */}
                          <div className="flex-1 min-w-0 text-right">
                            <p className={cn(
                              "text-sm font-semibold truncate",
                              !winnerIsA ? "text-white" : "text-slate-500",
                            )}>
                              {g.teamBName}
                            </p>
                            <p className={cn(
                              "font-mono text-base font-bold",
                              !winnerIsA ? (isChamp ? "text-amber-400" : "text-emerald-400") : "text-slate-600",
                            )}>
                              {fmt(g.teamBScore, 2)}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Expected champion callout */}
              {season.expectedChampId && (
                <div className="mt-4 p-3 rounded-lg bg-white/3 border border-white/5">
                  <p className="text-xs text-slate-500">AP Expected Champion</p>
                  <p className="text-lg font-bold text-amber-400">{season.expectedChampName}</p>
                  {season.actualChampId ? (
                    season.isSame
                      ? <p className="text-xs text-emerald-400 mt-0.5">✓ Matches actual champion — outcome was fair</p>
                      : <p className="text-xs text-red-400 mt-0.5">⚡ Actual champion: <span className="font-semibold">{season.actualChampName}</span> — lucky outcome</p>
                  ) : (
                    <p className="text-xs text-slate-500 mt-0.5">Season still in progress</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Career Power Rankings ────────────────────────────────────────────────────

interface CareerPowerRow {
  teamId: number;
  teamName: string;
  seasons: number;
  careerPPG: number;
  allPlayWinPct: number;      // career wins / total possible all-play games
  luckDiff: number;           // actual wins - expected wins over career
  titles: number;             // seasons won
  expectedTitles: number;     // expected title count from all-play bracket sims
  playoffAppearances: number;
  playoffAppPct: number;      // appearances / seasons played
  avgFinishScore: number;     // avg non-linear finish points (0-10) per season — used in power formula
  avgPlace: number;           // avg actual placement (1 = best) across seasons
  powerScore: number;
  rank: number;
}

/** Actual bracket size by season number (DB id matches season_number 1:1) */
function getPlayoffBracketSize(seasonId: number): number {
  if (seasonId >= 11 && seasonId <= 12) return 6;
  if (seasonId >= 13) return 5;
  return 4; // Seasons 1–10
}

/** Non-linear finish points: winning matters much more than just participating */
function finishPts(place: number): number {
  if (place === 1) return 10;
  if (place === 2) return 7;
  if (place === 3) return 5;
  if (place === 4) return 3;
  if (place <= 6)  return 2;
  if (place <= 8)  return 1;
  return 0;
}

function computeCareerPowerRankings(allMatchups: MatchupScoresView[]): CareerPowerRow[] {
  if (allMatchups.length === 0) return [];

  const seasonIds = [...new Set(allMatchups.map((m) => m.season_id).filter((s): s is number => s != null))];

  // Per-team career accumulators
  const teamData = new Map<number, {
    name: string;
    totalScore: number;
    totalGames: number;
    seasonCount: number;
    allPlayWins: number;
    allPlayTotal: number;
    actualWins: number;
    actualGames: number;
    expectedWins: number;
    titles: number;
    expectedTitles: number;
    finishPointsTotal: number;  // sum of non-linear finish points across seasons
    placementsTotal: number;    // sum of actual placements (1st, 2nd, …) across seasons
    finishSeasons: number;      // seasons with a recorded finish
    playoffSeasons: Set<number>;
    regularSeasonIds: Set<number>;
  }>();

  const ensure = (id: number, name: string) => {
    if (!teamData.has(id)) {
      teamData.set(id, {
        name,
        totalScore: 0, totalGames: 0,
        seasonCount: 0,
        allPlayWins: 0, allPlayTotal: 0,
        actualWins: 0, actualGames: 0,
        expectedWins: 0,
        titles: 0,
        expectedTitles: 0,
        finishPointsTotal: 0,
        placementsTotal: 0,
        finishSeasons: 0,
        playoffSeasons: new Set(),
        regularSeasonIds: new Set(),
      });
    }
    return teamData.get(id)!;
  };

  for (const sid of seasonIds) {
    const seasonMatchups = allMatchups.filter((m) => m.season_id === sid);
    const regularSeason = seasonMatchups.filter((m) => m.is_playoff !== true && m.is_consolation !== true);
    const playoffGames = seasonMatchups.filter((m) => m.is_playoff === true);

    // ── Regular season stats ──
    const weekScores = new Map<number, { teamId: number; teamName: string; score: number }[]>();
    for (const m of regularSeason) {
      if (!m.home_team_id || !m.away_team_id || m.home_score == null || m.away_score == null) continue;
      const wk = m.week_number!;
      if (!weekScores.has(wk)) weekScores.set(wk, []);
      weekScores.get(wk)!.push({ teamId: m.home_team_id, teamName: m.home_team_name!, score: m.home_score });
      weekScores.get(wk)!.push({ teamId: m.away_team_id, teamName: m.away_team_name!, score: m.away_score });

      const h = ensure(m.home_team_id, m.home_team_name!);
      const a = ensure(m.away_team_id, m.away_team_name!);
      h.totalScore += m.home_score; h.totalGames++;
      a.totalScore += m.away_score; a.totalGames++;
      h.regularSeasonIds.add(sid);
      a.regularSeasonIds.add(sid);
      if (m.home_score > m.away_score) { h.actualWins++; }
      else if (m.away_score > m.home_score) { a.actualWins++; }
      else { h.actualWins += 0.5; a.actualWins += 0.5; }
      h.actualGames++; a.actualGames++;
    }

    // All-play win% per team per week
    for (const [, scores] of weekScores) {
      const n = scores.length;
      for (const { teamId, teamName, score } of scores) {
        const d = ensure(teamId, teamName);
        const beaten = scores.filter((o) => o.teamId !== teamId && score > o.score).length;
        const tied = scores.filter((o) => o.teamId !== teamId && score === o.score).length;
        d.allPlayWins += beaten + tied * 0.5;
        d.allPlayTotal += n - 1;
        // Expected wins (same as all-play rate × 1 game)
        d.expectedWins += (beaten + tied * 0.5) / (n - 1);
      }
    }

    // ── Rank-based playoff team detection ────────────────────────────────────
    // Use top 60% (min 6) to cover seasons with 6-team brackets (seasons 11-12).
    const rsTeamStats = new Map<number, { wins: number; pf: number }>();
    for (const m of regularSeason) {
      if (!m.home_team_id || !m.away_team_id || m.home_score == null || m.away_score == null) continue;
      if (!rsTeamStats.has(m.home_team_id)) rsTeamStats.set(m.home_team_id, { wins: 0, pf: 0 });
      if (!rsTeamStats.has(m.away_team_id)) rsTeamStats.set(m.away_team_id, { wins: 0, pf: 0 });
      const h = rsTeamStats.get(m.home_team_id)!;
      const a = rsTeamStats.get(m.away_team_id)!;
      h.pf += m.home_score; a.pf += m.away_score;
      if (m.home_score > m.away_score) h.wins++;
      else if (m.away_score > m.home_score) a.wins++;
    }
    const rsSorted = [...rsTeamStats.entries()].sort((x, y) => y[1].wins - x[1].wins || y[1].pf - x[1].pf);
    // Seed map for placement ordering (1 = best)
    const teamSeedsForSeason = new Map(rsSorted.map(([tid], i) => [tid, i + 1]));

    // Use the correct bracket size for this specific season
    const actualBracketSize = getPlayoffBracketSize(sid);
    const bracketTeamIdsForSeason = new Set(rsSorted.slice(0, actualBracketSize).map(([tid]) => tid));

    // ── Playoff appearances: bracket qualifiers only ──────────────────────────
    for (const tid of bracketTeamIdsForSeason) {
      const m0 = regularSeason.find((m) => m.home_team_id === tid || m.away_team_id === tid);
      const name = m0
        ? (m0.home_team_id === tid ? m0.home_team_name : m0.away_team_name)
        : null;
      if (name) {
        ensure(tid, name).playoffSeasons.add(sid);
      }
    }

    // ── Holistic finish scores + titles via getTeamFinalPlacements ──────────
    const placements = getTeamFinalPlacements(playoffGames, bracketTeamIdsForSeason, teamSeedsForSeason, sid);

    // Build a name lookup from all matchups for this season
    const tidToName = new Map<number, string>();
    for (const m of [...regularSeason, ...playoffGames]) {
      if (m.home_team_id && m.home_team_name) tidToName.set(m.home_team_id, m.home_team_name);
      if (m.away_team_id && m.away_team_name) tidToName.set(m.away_team_id, m.away_team_name);
    }

    // Assign placements to every team in the league this season.
    // Teams that played in playoff weeks get their result from getTeamFinalPlacements.
    // Teams with no playoff appearance get their RS-rank position (filling remaining slots).
    const usedPlaces = new Set(placements.values());
    let nextFreePlace = 1;
    const allSeasonTeams = rsSorted.map(([tid]) => tid); // ordered best→worst RS

    // Step 1: record all teams that already have a placement
    for (const [tid, place] of placements.entries()) {
      const tname = tidToName.get(tid) ?? "";
      if (!tname) continue;
      const d = ensure(tid, tname);
      d.finishPointsTotal += finishPts(place);
      d.placementsTotal += place;
      d.finishSeasons++;
      if (place === 1) d.titles++;
    }

    // Step 2: assign missing placements to teams that didn't appear in any playoff game
    const unranked = allSeasonTeams.filter(tid => !placements.has(tid));
    for (const tid of unranked) {
      while (usedPlaces.has(nextFreePlace)) nextFreePlace++;
      const place = nextFreePlace;
      usedPlaces.add(nextFreePlace);
      nextFreePlace++;
      const tname = tidToName.get(tid) ?? "";
      if (!tname) continue;
      const d = ensure(tid, tname);
      d.finishPointsTotal += finishPts(place);
      d.placementsTotal += place;
      d.finishSeasons++;
      if (place === 1) d.titles++;
    }

    // ── Expected title via all-play bracket sim ──────────────────────────────
    // Build per-team score arrays from weekScores (already populated above)
    const teamScoresForSeason = new Map<number, number[]>();
    for (const [, entries] of weekScores) {
      for (const { teamId, score } of entries) {
        if (!teamScoresForSeason.has(teamId)) teamScoresForSeason.set(teamId, []);
        teamScoresForSeason.get(teamId)!.push(score);
      }
    }
    // Compute per-season all-play win% per team
    const apStatsSeason = new Map<number, { apWins: number; apTotal: number }>();
    for (const [, entries] of weekScores) {
      const n = entries.length;
      for (const { teamId, score } of entries) {
        if (!apStatsSeason.has(teamId)) apStatsSeason.set(teamId, { apWins: 0, apTotal: 0 });
        const s = apStatsSeason.get(teamId)!;
        const beaten = entries.filter(o => o.teamId !== teamId && score > o.score).length;
        const tied = entries.filter(o => o.teamId !== teamId && score === o.score).length;
        s.apWins += beaten + tied * 0.5;
        s.apTotal += n - 1;
      }
    }
    const allSeasonScores = [...teamScoresForSeason.values()].flat();
    const leagueStdSeason = allSeasonScores.length >= 2 ? stdDev(allSeasonScores) : 25;
    // Sort by all-play win% (ppg tiebreaker), take top bracketSize teams
    const apBracketTeams: BracketEntry[] = [...apStatsSeason.entries()]
      .sort((a, b) => {
        const aPct = a[1].apTotal > 0 ? a[1].apWins / a[1].apTotal : 0;
        const bPct = b[1].apTotal > 0 ? b[1].apWins / b[1].apTotal : 0;
        if (Math.abs(aPct - bPct) > 1e-9) return bPct - aPct;
        const aArr = teamScoresForSeason.get(a[0]) ?? [];
        const bArr = teamScoresForSeason.get(b[0]) ?? [];
        const aPpg = aArr.length > 0 ? aArr.reduce((s, x) => s + x, 0) / aArr.length : 0;
        const bPpg = bArr.length > 0 ? bArr.reduce((s, x) => s + x, 0) / bArr.length : 0;
        return bPpg - aPpg;
      })
      .slice(0, actualBracketSize)
      .map(([tid]) => {
        const scores = teamScoresForSeason.get(tid) ?? [];
        const ppg = scores.length > 0 ? scores.reduce((s, x) => s + x, 0) / scores.length : 0;
        const pStd = Math.max(scores.length >= 2 ? stdDev(scores) : leagueStdSeason, 8);
        return { id: tid, name: teamData.get(tid)?.name ?? `Team ${tid}`, ppg, pStd };
      });
    if (apBracketTeams.length > 0 && placements.size > 0) {
      const { winnerId } = bPlayBracket(apBracketTeams, seasonMatchups);
      if (winnerId > 0 && teamData.has(winnerId)) {
        teamData.get(winnerId)!.expectedTitles++;
      }
    }
  }

  if (teamData.size === 0) return [];

  const rows = [...teamData.entries()].map(([teamId, d]) => ({
    teamId,
    teamName: d.name,
    seasons: d.regularSeasonIds.size,
    careerPPG: d.totalGames > 0 ? d.totalScore / d.totalGames : 0,
    allPlayWinPct: d.allPlayTotal > 0 ? d.allPlayWins / d.allPlayTotal : 0,
    luckDiff: d.actualGames > 0 ? (d.actualWins - d.expectedWins) : 0,
    titles: d.titles,
    expectedTitles: d.expectedTitles,
    playoffAppearances: d.playoffSeasons.size,
    playoffAppPct: d.regularSeasonIds.size > 0 ? d.playoffSeasons.size / d.regularSeasonIds.size : 0,
    avgFinishScore: d.finishSeasons > 0 ? d.finishPointsTotal / d.finishSeasons : 0,
    avgPlace: d.finishSeasons > 0 ? d.placementsTotal / d.finishSeasons : 0,
    powerScore: 0,
    rank: 0,
  }));

  // Normalise for composite score
  const maxPPG = Math.max(...rows.map((r) => r.careerPPG), 1);
  const minPPG = Math.min(...rows.map((r) => r.careerPPG));
  const maxFinish = Math.max(...rows.map((r) => r.avgFinishScore), 1);
  const maxExpTitleRate = Math.max(...rows.map((r) => r.seasons > 0 ? r.expectedTitles / r.seasons : 0), 1e-9);
  const norm = (v: number, lo: number, hi: number) => hi === lo ? 0.5 : Math.max(0, Math.min(1, (v - lo) / (hi - lo)));

  const scored = rows.map((r) => {
    const expTitleRate = r.seasons > 0 ? r.expectedTitles / r.seasons : 0;
    return {
      ...r,
      powerScore: Math.round(100 * (
        0.25 * r.allPlayWinPct +
        0.15 * norm(r.careerPPG, minPPG, maxPPG) +
        0.35 * norm(r.avgFinishScore, 0, maxFinish) +
        0.20 * r.playoffAppPct +
        0.05 * norm(expTitleRate, 0, maxExpTitleRate)
      )),
    };
  }).sort((a, b) => b.powerScore - a.powerScore);

  return scored.map((r, i) => ({ ...r, rank: i + 1 }));
}

function CareerPowerRankings({ allMatchups }: { allMatchups: MatchupScoresView[] }) {
  const rows = useMemo(() => computeCareerPowerRankings(allMatchups), [allMatchups]);

  if (rows.length === 0) return <p className="text-slate-400 text-sm">No career data available.</p>;

  const maxScore = Math.max(...rows.map((r) => r.powerScore), 1);
  const leader = rows[0];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-400/20 bg-gradient-to-br from-amber-400/[0.07] to-transparent p-5 flex items-center justify-between flex-wrap gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-amber-400/80 mb-1">All-time leader</p>
          <Link to={`/team/${leader.teamId}`} className="text-2xl font-bold text-white hover:text-amber-300 transition-colors">
            {leader.teamName}
          </Link>
          <p className="text-sm text-slate-400 mt-1">
            {leader.titles > 0 ? `${leader.titles} title${leader.titles > 1 ? "s" : ""} · ` : ""}
            {fmt(leader.playoffAppPct * 100, 0)}% playoff rate · {fmt(leader.careerPPG)} career PPG
          </p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold font-mono text-amber-300">{leader.powerScore}</p>
          <p className="text-xs text-slate-500">composite score</p>
        </div>
      </div>
      <p className="text-sm text-slate-400">
        Composite career score: <span className="text-white/70">25% all-play win%</span> + <span className="text-white/70">15% career PPG</span> + <span className="text-white/70">35% avg finish score</span> + <span className="text-white/70">20% playoff rate</span> + <span className="text-white/70">5% expected title rate</span>
      </p>
      <p className="text-xs text-slate-500">Avg Finish = average final placement across all seasons (lower is better) · xTitles = expected championships from all-play bracket sims</p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center">#</TableHead>
              <TableHead>Team</TableHead>
              <TableHead className="text-right">Seasons</TableHead>
              <TableHead className="text-right">PPG</TableHead>
              <TableHead className="text-right">All-Play%</TableHead>
              <TableHead className="text-right">Titles</TableHead>
              <TableHead className="text-right">xTitles</TableHead>
              <TableHead className="text-right">Avg Finish</TableHead>
              <TableHead className="text-right">PO Rate</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead className="w-32"><span className="sr-only">Bar</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.teamId}>
                <TableCell className="text-center">
                  <span className={cn("text-sm font-bold tabular-nums",
                    r.rank === 1 ? "text-amber-400" : r.rank <= 3 ? "text-slate-300" : "text-slate-500")}>
                    {r.rank}
                  </span>
                </TableCell>
                <TableCell>
                  <Link to={`/team/${r.teamId}`} className="text-primary hover:underline font-medium">
                    {r.teamName}
                  </Link>
                </TableCell>
                <TableCell className="text-right text-sm text-slate-400">{r.seasons}</TableCell>
                <TableCell className="text-right font-mono text-sm text-slate-300">{fmt(r.careerPPG)}</TableCell>
                <TableCell className={cn("text-right font-mono text-sm",
                  r.allPlayWinPct >= 0.55 ? "text-emerald-400" : r.allPlayWinPct >= 0.45 ? "text-slate-300" : "text-red-400")}>
                  {fmt(r.allPlayWinPct * 100, 1)}%
                </TableCell>
                <TableCell className="text-right text-sm">
                  {r.titles > 0
                    ? <span className="text-amber-400 font-bold">{r.titles} 🏆</span>
                    : <span className="text-slate-600">—</span>}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {r.expectedTitles > 0
                    ? <span className={cn("font-bold", r.expectedTitles > r.titles ? "text-emerald-400" : r.expectedTitles < r.titles ? "text-red-400" : "text-amber-400")}>{r.expectedTitles}</span>
                    : <span className="text-slate-600">—</span>}
                </TableCell>
                <TableCell className={cn("text-right font-mono text-sm",
                  r.avgPlace > 0 && r.avgPlace <= 3 ? "text-amber-400" : r.avgPlace <= 5 ? "text-emerald-400" : r.avgPlace <= 7 ? "text-slate-300" : "text-slate-500")}>
                  {r.avgPlace > 0 ? fmt(r.avgPlace) : <span className="text-slate-600">—</span>}
                </TableCell>
                <TableCell className={cn("text-right font-mono text-sm",
                  r.playoffAppPct >= 0.6 ? "text-emerald-400" : r.playoffAppPct >= 0.4 ? "text-slate-300" : "text-red-400")}>
                  {r.playoffAppearances}/{r.seasons} ({fmt(r.playoffAppPct * 100, 0)}%)
                </TableCell>
                <TableCell className="text-right font-mono text-sm font-bold text-amber-300">{r.powerScore}</TableCell>
                <TableCell>
                  <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-500 to-amber-400"
                      style={{ width: `${(r.powerScore / maxScore) * 100}%` }}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

const Analytics = () => {
  const seasons = getAllSeasons();
  const latestSeason = seasons[seasons.length - 1].value;
  const [selectedSeason, setSelectedSeason] = useState(latestSeason);

  const { matchups, allMatchups, seasons: dbSeasons, isLoading } = useAnalyticsData(selectedSeason);

  const yearMap = useSeasonYearMap(dbSeasons);
  const seasonLabel = seasons.find((s) => s.value === selectedSeason)?.label ?? `Season ${selectedSeason}`;

  // Unique team list for PPG-by-Opponent selector (derived from all matchups)
  const teamList = useMemo(() => {
    if (!allMatchups) return [];
    const map = new Map<number, string>();
    for (const m of allMatchups) {
      if (m.home_team_id && m.home_team_name) map.set(m.home_team_id, m.home_team_name);
      if (m.away_team_id && m.away_team_name) map.set(m.away_team_id, m.away_team_name);
    }
    return [...map.entries()].map(([teamId, teamName]) => ({ teamId, teamName })).sort((a, b) => a.teamName.localeCompare(b.teamName));
  }, [allMatchups]);

  return (
    <div className="min-h-screen space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Analytics</h1>
          <p className="text-muted-foreground">Advanced stats and insights across all seasons</p>
        </div>
        <Select value={selectedSeason} onValueChange={setSelectedSeason}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[...seasons].reverse().map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      <Tabs defaultValue="luck">
        <TabsList className="bg-white/5 border border-white/10">
          <TabsTrigger value="luck">
            <Target className="h-3.5 w-3.5 mr-1.5" />Luck Meter
          </TabsTrigger>
          <TabsTrigger value="consistency">
            <Award className="h-3.5 w-3.5 mr-1.5" />Consistency
          </TabsTrigger>
          <TabsTrigger value="power">
            <Zap className="h-3.5 w-3.5 mr-1.5" />Power Rankings
          </TabsTrigger>
          <TabsTrigger value="playoff-prob">
            <Target className="h-3.5 w-3.5 mr-1.5" />Playoff Odds
          </TabsTrigger>
          <TabsTrigger value="playoff-sim">
            <Shuffle className="h-3.5 w-3.5 mr-1.5" />Simulated Odds
          </TabsTrigger>
          <TabsTrigger value="career-rankings">
            <Crown className="h-3.5 w-3.5 mr-1.5" />Career Rankings
          </TabsTrigger>
          <TabsTrigger value="parallel-universe">
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />Parallel Universe
          </TabsTrigger>
        </TabsList>

        {/* Luck Meter */}
        <TabsContent value="luck" className="mt-4">
          <Card className="p-6">
            <CardHeader className="px-0 pt-0">
              <CardTitle className="text-lg">Luck Meter — {seasonLabel}</CardTitle>
              <CardDescription>
                Actual wins vs expected wins (based on scoring rank each week)
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {isLoading ? (
                <p className="text-slate-400 text-sm animate-pulse">Loading…</p>
              ) : matchups ? (
                <LuckMeter matchups={matchups} />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Consistency */}
        <TabsContent value="consistency" className="mt-4">
          <Card className="p-6">
            <CardHeader className="px-0 pt-0">
              <CardTitle className="text-lg">Consistency — {seasonLabel}</CardTitle>
              <CardDescription>
                How predictable each team's weekly scoring was
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {isLoading ? (
                <p className="text-slate-400 text-sm animate-pulse">Loading…</p>
              ) : matchups ? (
                <ConsistencyTab matchups={matchups} />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Power Rankings */}
        <TabsContent value="power" className="mt-4">
          <Card className="p-6">
            <CardHeader className="px-0 pt-0">
              <CardTitle className="text-lg">Power Rankings — {seasonLabel}</CardTitle>
              <CardDescription>
                Composite ranking based on win%, season PPG, recent form, and expected wins
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {isLoading ? (
                <p className="text-slate-400 text-sm animate-pulse">Loading…</p>
              ) : matchups ? (
                <PowerRankings matchups={matchups} />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Playoff Probability */}
        <TabsContent value="playoff-prob" className="mt-4">
          <Card className="p-6">
            <CardHeader className="px-0 pt-0">
              <CardTitle className="text-lg">Playoff Probability — Historical</CardTitle>
              <CardDescription>
                Percentage of teams with each regular-season final record that made the playoffs
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {isLoading ? (
                <p className="text-slate-400 text-sm animate-pulse">Loading…</p>
              ) : allMatchups ? (
                <PlayoffProbability allMatchups={allMatchups} />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Career Power Rankings */}
        <TabsContent value="career-rankings" className="mt-4">
          <Card className="p-6">
            <CardHeader className="px-0 pt-0">
              <CardTitle className="text-lg">Career Power Rankings — All Time</CardTitle>
              <CardDescription>
                Composite all-time ranking based on all-play win%, career PPG, titles, playoff rate, and luck.
                For single-season all-play records, see{" "}
                <Link to="/records" className="text-primary hover:underline">
                  Records → Miscellaneous
                </Link>
                .
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {isLoading ? (
                <p className="text-slate-400 text-sm animate-pulse">Loading…</p>
              ) : allMatchups ? (
                <CareerPowerRankings allMatchups={allMatchups} />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Parallel Universe */}
        <TabsContent value="parallel-universe" className="mt-4">
          <Card className="p-6">
            <CardHeader className="px-0 pt-0">
              <CardTitle className="text-lg flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-400" />
                Parallel Universe — All Seasons
              </CardTitle>
              <CardDescription>
                Re-seeds each playoff bracket by all-play win%, then simulates the bracket to find who <em>should</em> have won
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {isLoading ? (
                <p className="text-slate-400 text-sm animate-pulse">Loading…</p>
              ) : allMatchups ? (
                <ParallelUniverseTab allMatchups={allMatchups} yearMap={yearMap} />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Monte Carlo Playoff Sim */}
        <TabsContent value="playoff-sim" className="mt-4">
          <Card className="p-6">
            <CardHeader className="px-0 pt-0">
              <CardTitle className="text-lg">Simulated Playoff Odds — {seasonLabel}</CardTitle>
              <CardDescription>
                Monte Carlo simulation (up to {DEFAULT_NUM_SIMS.toLocaleString()} runs) of the remaining schedule using projected scoring
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {isLoading ? (
                <p className="text-slate-400 text-sm animate-pulse">Loading…</p>
              ) : matchups && allMatchups ? (
                <PlayoffSim matchups={matchups} allMatchups={allMatchups} dbSeasons={dbSeasons} />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Analytics;
