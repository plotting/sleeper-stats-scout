
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getTeamFinalPlacements } from "@/components/playoff-bracket/utils/placementUtils";
import { getSeasonYear } from "@/utils/seasonUtils";
import type { MatchupScoresView } from "@/types/database";
import {
  Trophy,
  Medal,
  Zap,
  TrendingUp,
  Skull,
  Target,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 1): string {
  return n.toFixed(decimals);
}

/** Number of teams in the real playoff bracket for a given season number */
function getPlayoffBracketSize(seasonNumber: number): number {
  if (seasonNumber >= 11 && seasonNumber <= 12) return 6;
  if (seasonNumber >= 13) return 5;
  return 4;
}

const PLAYOFF_START_WEEK = 15;

// ─── Per-season stats ─────────────────────────────────────────────────────────

interface SeasonStats {
  seasonId: number;
  seasonNumber: number;
  year: number;
  champion: string | null;
  runnerUp: string | null;
  bestRegularRecord: { team: string; wins: number; losses: number; ties: number; pf: number } | null;
  highestPpg: { team: string; ppg: number } | null;
  highestSingleGame: { team: string; score: number; week: number } | null;
  biggestUpset: { winner: string; loser: string; delta: number; week: number } | null;
  totalPointsScored: number;
}

function computeSeasonStats(
  seasonId: number,
  seasonNumber: number,
  year: number,
  matchups: MatchupScoresView[]
): SeasonStats {
  const seasonMatchups = matchups.filter((m) => m.season_id === seasonId);
  const regMatchups = seasonMatchups.filter(
    (m) => m.week_number != null && m.week_number < PLAYOFF_START_WEEK
  );
  const playoffMatchups = seasonMatchups.filter(
    (m) => m.week_number != null && m.week_number >= PLAYOFF_START_WEEK
  );

  // ── Deduplicated regular-season entries ────────────────────────────────────
  const seenReg = new Set<string>();
  const dedupedReg: MatchupScoresView[] = [];
  for (const m of regMatchups) {
    if (m.home_team_id == null || m.away_team_id == null) continue;
    const key = `${m.week_number}-${Math.min(m.home_team_id, m.away_team_id)}-${Math.max(m.home_team_id, m.away_team_id)}`;
    if (seenReg.has(key)) continue;
    seenReg.add(key);
    dedupedReg.push(m);
  }

  // ── Per-team reg-season aggregates ─────────────────────────────────────────
  interface TeamAgg {
    teamId: number;
    teamName: string;
    wins: number;
    losses: number;
    ties: number;
    pf: number;
    games: number;
  }
  const teamAgg = new Map<number, TeamAgg>();

  const ensureTeam = (id: number, name: string | null): TeamAgg => {
    if (!teamAgg.has(id)) {
      teamAgg.set(id, {
        teamId: id,
        teamName: name ?? String(id),
        wins: 0,
        losses: 0,
        ties: 0,
        pf: 0,
        games: 0,
      });
    }
    return teamAgg.get(id)!;
  };

  for (const m of dedupedReg) {
    if (m.home_score == null || m.away_score == null) continue;
    const h = ensureTeam(m.home_team_id!, m.home_team_name);
    const a = ensureTeam(m.away_team_id!, m.away_team_name);

    const hw = m.home_score > m.away_score ? 1 : 0;
    const aw = m.away_score > m.home_score ? 1 : 0;
    const t = m.home_score === m.away_score ? 1 : 0;

    h.wins += hw; h.losses += aw; h.ties += t; h.pf += m.home_score; h.games++;
    a.wins += aw; a.losses += hw; a.ties += t; a.pf += m.away_score; a.games++;
  }

  // ── Build bracketTeamIds (top N by reg-season record) ──────────────────────
  const bracketSize = getPlayoffBracketSize(seasonNumber);
  const sortedTeams = [...teamAgg.values()].sort((a, b) => {
    const aTotal = a.wins + a.losses + a.ties;
    const bTotal = b.wins + b.losses + b.ties;
    const aPct = aTotal === 0 ? 0 : (a.wins + 0.5 * a.ties) / aTotal;
    const bPct = bTotal === 0 ? 0 : (b.wins + 0.5 * b.ties) / bTotal;
    if (aPct !== bPct) return bPct - aPct;
    return b.pf - a.pf;
  });
  const bracketTeamIds = new Set<number>(
    sortedTeams.slice(0, bracketSize).map((t) => t.teamId)
  );
  const teamSeeds = new Map<number, number>(
    sortedTeams.map((t, i) => [t.teamId, i + 1])
  );

  // ── Placements ─────────────────────────────────────────────────────────────
  const placements = getTeamFinalPlacements(
    playoffMatchups,
    bracketTeamIds.size > 0 ? bracketTeamIds : undefined,
    teamSeeds,
    seasonNumber
  );

  const findByPlace = (place: number): string | null => {
    for (const [tid, p] of placements.entries()) {
      if (p === place) {
        return teamAgg.get(tid)?.teamName ?? null;
      }
    }
    // Fallback: search in matchup data for team name
    for (const [tid, p] of placements.entries()) {
      if (p === place) {
        const m = seasonMatchups.find(
          (x) => x.home_team_id === tid || x.away_team_id === tid
        );
        if (m) {
          return m.home_team_id === tid ? m.home_team_name : m.away_team_name;
        }
      }
    }
    return null;
  };

  const champion = findByPlace(1);
  const runnerUp = findByPlace(2);

  // ── Best regular-season record ─────────────────────────────────────────────
  const bestRecordEntry = sortedTeams[0] ?? null;
  const bestRegularRecord = bestRecordEntry
    ? {
        team: bestRecordEntry.teamName,
        wins: bestRecordEntry.wins,
        losses: bestRecordEntry.losses,
        ties: bestRecordEntry.ties,
        pf: bestRecordEntry.pf,
      }
    : null;

  // ── Highest PPG ─────────────────────────────────────────────────────────────
  let highestPpg: SeasonStats["highestPpg"] = null;
  for (const t of teamAgg.values()) {
    if (t.games === 0) continue;
    const ppg = t.pf / t.games;
    if (!highestPpg || ppg > highestPpg.ppg) {
      highestPpg = { team: t.teamName, ppg };
    }
  }

  // ── Highest single game ────────────────────────────────────────────────────
  let highestSingleGame: SeasonStats["highestSingleGame"] = null;
  for (const m of dedupedReg) {
    if (m.home_score != null) {
      if (!highestSingleGame || m.home_score > highestSingleGame.score) {
        highestSingleGame = {
          team: m.home_team_name ?? "Unknown",
          score: m.home_score,
          week: m.week_number ?? 0,
        };
      }
    }
    if (m.away_score != null) {
      if (!highestSingleGame || m.away_score > highestSingleGame.score) {
        highestSingleGame = {
          team: m.away_team_name ?? "Unknown",
          score: m.away_score,
          week: m.week_number ?? 0,
        };
      }
    }
  }

  // ── Biggest upset ──────────────────────────────────────────────────────────
  // For each regular-season week, compute rolling cumulative PPG through week W-1
  // then flag games where the winner had the lower PPG.
  const weeks = [
    ...new Set(
      dedupedReg
        .map((m) => m.week_number)
        .filter((w): w is number => w != null)
    ),
  ].sort((a, b) => a - b);

  // rolling: running totals per team through week W-1
  const rollingPF = new Map<number, number>();
  const rollingGames = new Map<number, number>();
  let biggestUpset: SeasonStats["biggestUpset"] = null;

  for (const week of weeks) {
    const weekGames = dedupedReg.filter((m) => m.week_number === week);

    for (const m of weekGames) {
      if (m.home_score == null || m.away_score == null) continue;
      const hid = m.home_team_id!;
      const aid = m.away_team_id!;

      const hGames = rollingGames.get(hid) ?? 0;
      const aGames = rollingGames.get(aid) ?? 0;

      // Only consider games where both teams have prior data
      if (hGames > 0 && aGames > 0) {
        const hPpg = (rollingPF.get(hid) ?? 0) / hGames;
        const aPpg = (rollingPF.get(aid) ?? 0) / aGames;

        const [winnerId, loserId, winnerPpg, loserPpg, winnerScore, loserScore] =
          m.home_score >= m.away_score
            ? [hid, aid, hPpg, aPpg, m.home_score, m.away_score]
            : [aid, hid, aPpg, hPpg, m.away_score, m.home_score];

        const delta = loserPpg - winnerPpg;
        if (delta > 0 && (!biggestUpset || delta > biggestUpset.delta)) {
          // winner had LOWER PPG — genuine upset
          const winnerName =
            winnerId === hid ? (m.home_team_name ?? "Unknown") : (m.away_team_name ?? "Unknown");
          const loserName =
            loserId === hid ? (m.home_team_name ?? "Unknown") : (m.away_team_name ?? "Unknown");
          biggestUpset = {
            winner: winnerName,
            loser: loserName,
            delta,
            week,
          };
        }
      }
    }

    // Update rolling totals after processing this week
    for (const m of weekGames) {
      if (m.home_score == null || m.away_score == null) continue;
      const hid = m.home_team_id!;
      const aid = m.away_team_id!;
      rollingPF.set(hid, (rollingPF.get(hid) ?? 0) + m.home_score);
      rollingPF.set(aid, (rollingPF.get(aid) ?? 0) + m.away_score);
      rollingGames.set(hid, (rollingGames.get(hid) ?? 0) + 1);
      rollingGames.set(aid, (rollingGames.get(aid) ?? 0) + 1);
    }
  }

  // ── Total points scored ─────────────────────────────────────────────────────
  let totalPointsScored = 0;
  for (const m of dedupedReg) {
    if (m.home_score != null) totalPointsScored += m.home_score;
    if (m.away_score != null) totalPointsScored += m.away_score;
  }

  return {
    seasonId,
    seasonNumber,
    year,
    champion,
    runnerUp,
    bestRegularRecord,
    highestPpg,
    highestSingleGame,
    biggestUpset,
    totalPointsScored,
  };
}

// ─── Skeleton card ────────────────────────────────────────────────────────────

function RecapCardSkeleton() {
  return (
    <div className="bg-[#1a1a2e] border border-white/10 rounded-xl p-5 space-y-4">
      <Skeleton className="h-6 w-32 bg-white/10" />
      <Skeleton className="h-8 w-48 bg-white/10" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-full bg-white/10" />
        ))}
      </div>
    </div>
  );
}

// ─── Recap card ───────────────────────────────────────────────────────────────

function RecapCard({ stats }: { stats: SeasonStats }) {
  const { seasonNumber, year, champion, runnerUp, bestRegularRecord, highestPpg, highestSingleGame, biggestUpset, totalPointsScored } = stats;

  return (
    <div className="bg-[#1a1a2e] border border-white/10 rounded-xl overflow-hidden">
      {/* Card header */}
      <div className="px-5 pt-5 pb-3 border-b border-white/10">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Season {seasonNumber}
            </p>
            <h2 className="text-xl font-bold text-white leading-tight">{year} Season</h2>
          </div>
          <Badge
            className="shrink-0 bg-amber-500/15 text-amber-400 border border-amber-500/30 text-xs px-2 py-0.5"
            variant="outline"
          >
            S{seasonNumber}
          </Badge>
        </div>
      </div>

      {/* Stats body */}
      <div className="px-5 py-4 space-y-3">
        {/* Champion */}
        <div className="flex items-start gap-2.5">
          <Trophy className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider leading-none mb-0.5">
              Champion
            </p>
            <p className="text-sm font-semibold text-amber-400 truncate font-mono">
              {champion ?? "—"}
            </p>
          </div>
        </div>

        {/* Runner-up */}
        <div className="flex items-start gap-2.5">
          <Medal className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider leading-none mb-0.5">
              Runner-up
            </p>
            <p className="text-sm text-slate-300 truncate font-mono">
              {runnerUp ?? "—"}
            </p>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-white/5 pt-1" />

        {/* Best regular-season record */}
        {bestRegularRecord && (
          <div className="flex items-start gap-2.5">
            <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider leading-none mb-0.5">
                Best Regular Season
              </p>
              <p className="text-sm text-slate-300 truncate">
                <span className="font-semibold text-white font-mono">
                  {bestRegularRecord.team}
                </span>
                <span className="ml-1.5 text-emerald-400 font-mono text-xs">
                  {bestRegularRecord.wins}–{bestRegularRecord.losses}
                  {bestRegularRecord.ties > 0 ? `–${bestRegularRecord.ties}` : ""}
                </span>
              </p>
            </div>
          </div>
        )}

        {/* Highest PPG */}
        {highestPpg && (
          <div className="flex items-start gap-2.5">
            <Zap className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider leading-none mb-0.5">
                Highest Season PPG
              </p>
              <p className="text-sm text-slate-300 truncate">
                <span className="font-semibold text-white font-mono">
                  {highestPpg.team}
                </span>
                <span className="ml-1.5 text-sky-400 font-mono text-xs">
                  {fmt(highestPpg.ppg)} pts/gm
                </span>
              </p>
            </div>
          </div>
        )}

        {/* Highest single game */}
        {highestSingleGame && (
          <div className="flex items-start gap-2.5">
            <Target className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider leading-none mb-0.5">
                Highest Single Game
              </p>
              <p className="text-sm text-slate-300 truncate">
                <span className="font-semibold text-white font-mono">
                  {highestSingleGame.team}
                </span>
                <span className="ml-1.5 text-violet-400 font-mono text-xs">
                  {fmt(highestSingleGame.score)} pts
                </span>
                <span className="ml-1 text-slate-500 text-xs">
                  (Wk {highestSingleGame.week})
                </span>
              </p>
            </div>
          </div>
        )}

        {/* Biggest upset */}
        {biggestUpset && (
          <div className="flex items-start gap-2.5">
            <Skull className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider leading-none mb-0.5">
                Biggest Upset (Wk {biggestUpset.week})
              </p>
              <p className="text-sm text-slate-300 truncate">
                <span className="font-semibold text-white font-mono">
                  {biggestUpset.winner}
                </span>
                <span className="mx-1 text-slate-500 text-xs">def.</span>
                <span className="text-slate-400 font-mono text-xs">
                  {biggestUpset.loser}
                </span>
                <span className="ml-1.5 text-rose-400 font-mono text-xs">
                  (−{fmt(biggestUpset.delta)} PPG)
                </span>
              </p>
            </div>
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-white/5 pt-1" />

        {/* Total points */}
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
            Total Reg-Season Points
          </p>
          <p className="text-sm font-bold text-slate-300 font-mono">
            {totalPointsScored.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const Recaps = () => {
  // Fetch seasons list
  const { data: seasons, isLoading: seasonsLoading } = useQuery({
    queryKey: ["recaps-seasons"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("seasons")
        .select("id, year, season_number")
        .order("season_number");
      if (error) throw error;
      return data;
    },
  });

  // Fetch all matchups (paginated)
  const { data: allMatchups, isLoading: matchupsLoading } = useQuery({
    queryKey: ["recaps-all-matchups"],
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
      return rows;
    },
  });

  const isLoading = seasonsLoading || matchupsLoading;

  // Compute stats per season (memoised — only reruns when data changes)
  const seasonStats = useMemo<SeasonStats[]>(() => {
    if (!seasons || !allMatchups) return [];

    return seasons
      .filter((s) => s.season_number >= 1 && s.season_number <= 13)
      .map((s) =>
        computeSeasonStats(
          s.id,
          s.season_number,
          s.year ?? getSeasonYear(s.season_number),
          allMatchups
        )
      )
      // Newest first
      .sort((a, b) => b.seasonNumber - a.seasonNumber);
  }, [seasons, allMatchups]);

  return (
    <div className="min-h-screen">
      {/* Page header */}
      <header className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">Season Recaps</h1>
        <p className="text-slate-400">
          Key stats and highlights from every completed season (2013–2025).
        </p>
      </header>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <RecapCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {seasonStats.map((stats) => (
            <RecapCard key={stats.seasonId} stats={stats} />
          ))}
        </div>
      )}
    </div>
  );
};

export default Recaps;
