import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MatchupScoresView } from "@/types/database";
import { buildOddsInput, matchupWinProb } from "@/utils/playoffSimModel";
import { simulateSeason, sampleSeason, gameKey, type GameLock } from "@/utils/seasonSim";
import { fmtOdds } from "@/utils/oddsFormat";
import { getPlayoffBracketSize } from "@/utils/playoffRegistry";
import { fetchLeague, fetchLeagueRosters, LEAGUE_ID } from "@/services/sleeperApi";
import { buildRosterToTeamMap } from "@/services/sleeperSync";
import { computeTeamWeekProjections, type TeamWeekProjection } from "@/services/playerProjections";

const NUM_SIMS = 20000;
type Projections = Map<number, Map<number, TeamWeekProjection> | null>;

/** Roster-based weekly projections for the weeks still to play (current season only); empty when Sleeper can't be reached. */
async function loadProjections(weeks: number[], seasonYear: number): Promise<{ projections: Projections; rosterBased: boolean }> {
  const projections: Projections = new Map();
  try {
    const league = await fetchLeague(LEAGUE_ID);
    if (Number(league.season) !== seasonYear) return { projections, rosterBased: false };
    const [rosters, map] = await Promise.all([fetchLeagueRosters(LEAGUE_ID), buildRosterToTeamMap(LEAGUE_ID)]);
    const inputs = rosters
      .map((r) => { const teamId = map.get(r.roster_id); return teamId ? { teamId, players: r.players ?? [], starters: r.starters ?? [] } : null; })
      .filter((r): r is { teamId: number; players: string[]; starters: string[] } => r != null);
    for (const w of weeks) projections.set(w, await computeTeamWeekProjections(league.season, w, inputs, league.roster_positions));
    return { projections, rosterBased: [...projections.values()].some((p) => p != null) };
  } catch {
    return { projections, rosterBased: false };
  }
}

export default function SeasonSim({
  matchups,
  allMatchups,
  dbSeasons,
}: {
  matchups: MatchupScoresView[];
  allMatchups: MatchupScoresView[];
  dbSeasons: { id: number; year: number; season_number: number }[] | undefined;
}) {
  const seasonId = matchups[0]?.season_id ?? 0;
  const seasonYear = dbSeasons?.find((s) => s.id === seasonId)?.year ?? 0;
  const sortedHistIds = useMemo(
    () => (dbSeasons ?? []).filter((s) => s.id !== seasonId).sort((a, b) => b.id - a.id).map((s) => s.id),
    [dbSeasons, seasonId],
  );
  const latestPlayed = useMemo(() => {
    let w = 0;
    for (const m of matchups) if (!m.is_playoff && !m.is_consolation && m.home_score != null && m.away_score != null && m.week_number) w = Math.max(w, m.week_number);
    return w;
  }, [matchups]);

  const bare = useMemo(() => buildOddsInput(matchups, allMatchups, sortedHistIds, latestPlayed, new Map()), [matchups, allMatchups, sortedHistIds, latestPlayed]);
  const weeks = useMemo(() => [...new Set(bare?.futureGames.map((g) => g.week) ?? [])].sort((a, b) => a - b), [bare]);

  const { data: proj, isLoading: projLoading } = useQuery({
    queryKey: ["season-sim-projections", seasonId, latestPlayed],
    queryFn: () => loadProjections(weeks, seasonYear),
    enabled: weeks.length > 0 && seasonYear > 0,
    staleTime: 10 * 60 * 1000,
  });

  const input = useMemo(
    () => (bare ? buildOddsInput(matchups, allMatchups, sortedHistIds, latestPlayed, proj?.projections ?? new Map()) : null),
    [bare, matchups, allMatchups, sortedHistIds, latestPlayed, proj],
  );

  const [locks, setLocks] = useState<Map<string, GameLock>>(new Map());
  const [sample, setSample] = useState<ReturnType<typeof sampleSeason> | null>(null);
  const setLock = (key: string, lock: GameLock | null) => {
    setSample(null);
    setLocks((prev) => { const next = new Map(prev); if (lock) next.set(key, lock); else next.delete(key); return next; });
  };

  const bracketSize = getPlayoffBracketSize(seasonId);
  // The buttons answer instantly; the 20,000-season rerun follows right behind (and the table dims while it catches up).
  const simLocks = useDeferredValue(locks);
  const catchingUp = simLocks !== locks;
  const outlook = useMemo(
    () => (input && !projLoading ? simulateSeason({ teams: input.simTeams, games: input.futureGames, locks: simLocks, numSims: NUM_SIMS, bracketSize }) : []),
    [input, simLocks, bracketSize, projLoading],
  );
  // each team's record counting the results you've picked (they're facts for the table, not part of the simulation)
  const picked = useMemo(() => {
    const m = new Map<number, { w: number; l: number }>();
    for (const g of input?.futureGames ?? []) {
      const lock = locks.get(gameKey(g));
      if (!lock) continue;
      const win = lock === "home" ? g.homeId : g.awayId, lose = lock === "home" ? g.awayId : g.homeId;
      m.set(win, { w: (m.get(win)?.w ?? 0) + 1, l: m.get(win)?.l ?? 0 });
      m.set(lose, { w: m.get(lose)?.w ?? 0, l: (m.get(lose)?.l ?? 0) + 1 });
    }
    return m;
  }, [input, locks]);

  if (!bare || !input) {
    return <p className="text-sm text-slate-400">No games left to simulate for this season.</p>;
  }
  if (projLoading) return <p className="text-slate-400 text-sm animate-pulse">Loading projections…</p>;

  const names = new Map(input.teams.map((t) => [t.teamId, t.teamName]));
  const nameOf = (id: number) => names.get(id) ?? `Team ${id}`;
  const rows = input.teams
    .map((t) => ({ t, o: outlook.find((o) => o.teamId === t.teamId)! }))
    .filter((r) => r.o)
    .sort((a, b) => b.o.avgWins - a.o.avgWins || b.o.avgPf - a.o.avgPf);
  const sampleRank = new Map(sample?.standings.map((s, i) => [s.teamId, i + 1]));
  const sampleRec = new Map(sample?.standings.map((s) => [s.teamId, s]));
  const sampleGame = new Map(sample?.games.map((g) => [g.key, g]));
  const gamesByWeek = weeks.map((w) => ({ week: w, games: input.futureGames.filter((g) => g.week === w) }));
  const lockedCount = locks.size;
  const rec = (w: number, l: number, t: number) => `${w}-${l}${t > 0 ? `-${t}` : ""}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => setSample(sampleSeason({ teams: input.simTeams, games: input.futureGames, locks }))}>
          Play out one season
        </Button>
        {sample && <Button size="sm" variant="outline" onClick={() => setSample(null)}>Clear</Button>}
        {lockedCount > 0 && <Button size="sm" variant="outline" onClick={() => { setLocks(new Map()); setSample(null); }}>Reset {lockedCount} picked game{lockedCount > 1 ? "s" : ""}</Button>}
        <span className="text-xs text-slate-500">
          {NUM_SIMS.toLocaleString()} simulated seasons · {proj?.rosterBased ? "lineup, injury and bye-aware projections" : "team scoring averages (roster projections unavailable)"}
        </span>
      </div>

      <div className={cn("overflow-x-auto transition-opacity", catchingUp && "opacity-50")}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              <TableHead>Team</TableHead>
              <TableHead className="text-right">{lockedCount > 0 ? "With picks" : "Now"}</TableHead>
              <TableHead className="text-right">Proj wins</TableHead>
              <TableHead className="text-right">Likely finish</TableHead>
              <TableHead className="text-right">Range (80%)</TableHead>
              <TableHead className="text-right">Proj PF</TableHead>
              <TableHead className="text-right">Playoff %</TableHead>
              {sample && <TableHead className="text-right text-amber-400">One season</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ t, o }, i) => {
              const gamesLeft = input.futureGames.filter((g) => g.homeId === t.teamId || g.awayId === t.teamId).length;
              const likelyW = o.winsMode, likelyL = t.wins + t.losses + t.ties + gamesLeft - likelyW - t.ties;
              const s = sampleRec.get(t.teamId);
              return (
                <TableRow key={t.teamId} className={cn(i < bracketSize && "bg-amber-400/[0.05]")}>
                  <TableCell className="text-slate-500">{i + 1}</TableCell>
                  <TableCell><Link to={`/team/${t.teamId}`} className="text-primary hover:underline font-medium text-sm">{t.teamName}</Link></TableCell>
                  <TableCell className="text-right font-mono text-sm text-slate-400">{rec(t.wins + (picked.get(t.teamId)?.w ?? 0), t.losses + (picked.get(t.teamId)?.l ?? 0), t.ties)}</TableCell>
                  <TableCell className="text-right font-mono text-sm font-semibold">{(o.avgWins).toFixed(1)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{likelyW % 1 === 0 ? `${likelyW}-${likelyL}` : `${likelyW}`}</TableCell>
                  <TableCell className="text-right font-mono text-sm text-slate-400">{o.winsLow}–{o.winsHigh} W</TableCell>
                  <TableCell className="text-right font-mono text-sm text-slate-400">{o.avgPf.toFixed(0)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{fmtOdds(o.playoffPct)}</TableCell>
                  {sample && s && (
                    <TableCell className="text-right font-mono text-sm text-amber-300">
                      #{sampleRank.get(t.teamId)} · {rec(s.wins, s.losses, s.ties)}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-slate-500">
        Sorted by projected wins (ties broken by points); shaded rows are inside the top {bracketSize}. "Likely finish" is the most common final record;
        the range covers the middle 80% of simulated seasons.
      </p>

      <div>
        <h3 className="text-sm font-semibold text-slate-300 mb-1">Remaining schedule — pick a result to see how it moves the standings</h3>
        <p className="text-xs text-slate-500 mb-3">Choose a winner for any game; everything else keeps being simulated. Leave a game on "Sim" to let it play out.</p>
        <div className="space-y-4">
          {gamesByWeek.map(({ week, games }) => (
            <div key={week}>
              <p className="text-xs font-semibold text-slate-400 mb-1">Week {week}</p>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {games.map((g) => {
                  const key = gameKey(g);
                  const lock = locks.get(key);
                  const pHome = matchupWinProb(g.homeMean, g.homeStd, g.awayMean, g.awayStd);
                  const played = sampleGame.get(key);
                  const btn = (active: boolean) => cn("px-2 py-1 text-[11px] rounded border", active ? "bg-primary text-primary-foreground border-primary" : "border-white/10 text-slate-400 hover:text-white");
                  return (
                    <div key={key} className={cn("rounded-lg border p-2", lock ? "border-primary/50 bg-primary/5" : "border-white/10 bg-white/[0.02]")}>
                      <div className="flex items-center justify-between text-sm">
                        <span className={cn(lock === "home" && "font-semibold text-white")}>{nameOf(g.homeId)} <span className="font-mono text-xs text-slate-500">{(pHome * 100).toFixed(0)}%</span></span>
                        <span className={cn("text-right", lock === "away" && "font-semibold text-white")}><span className="font-mono text-xs text-slate-500">{((1 - pHome) * 100).toFixed(0)}%</span> {nameOf(g.awayId)}</span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <div className="flex gap-1">
                          <button className={btn(lock === "home")} onClick={() => setLock(key, lock === "home" ? null : "home")}>Home wins</button>
                          <button className={btn(!lock)} onClick={() => setLock(key, null)}>Sim</button>
                          <button className={btn(lock === "away")} onClick={() => setLock(key, lock === "away" ? null : "away")}>Away wins</button>
                        </div>
                        {played && <span className="font-mono text-xs text-amber-300">{played.homeScore.toFixed(1)} – {played.awayScore.toFixed(1)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
