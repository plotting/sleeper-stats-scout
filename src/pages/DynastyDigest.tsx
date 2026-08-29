import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { getAllSeasons, getSeasonYear } from "@/utils/seasonUtils";
import type { MatchupScoresView } from "@/types/database";
import { computeSeasonStats, type SeasonStats } from "./Recaps";
import {
  GRADABLE_POS, displayDesc, parseResolvedPick, buildExpectedVorpCurve, getPickValue,
  buildPlayerLifetimeVorpMap, type HistoricalPick, type PlayerVorpRow,
} from "@/utils/dynastyValue";
import { Newspaper, TrendingUp, TrendingDown, ArrowLeftRight, Sparkles } from "lucide-react";

function fmt(n: number, d = 1): string {
  return n.toFixed(d);
}

// ── Trade summary for one season ────────────────────────────────────────────

interface TradeItemRow {
  trade_id: number;
  item_type: string;
  item_description: string;
  from_team_id: number | null;
  to_team_id: number | null;
}
interface TradeRow {
  id: number;
  team1_id: number | null;
  team2_id: number | null;
  items: TradeItemRow[];
}

interface TradeSummary {
  totalTrades: number;
  mostActive: { teamName: string; count: number } | null;
  biggestSwing: { winnerTeam: string; loserTeam: string; delta: number; gotDesc: string; gaveDesc: string } | null;
}

function computeTradeSummary(
  trades: TradeRow[],
  teamNameById: Map<number, string>,
  pickValueByKey: Map<string, number>,
  lifetimeVorp: Map<string, number>,
): TradeSummary {
  const tradeCountByTeam = new Map<number, number>();
  let biggestSwing: TradeSummary["biggestSwing"] = null;

  function itemValue(item: TradeItemRow): number {
    if (item.item_type === "player") return lifetimeVorp.get(item.item_description.toLowerCase()) ?? 0;
    const resolved = parseResolvedPick(item.item_description);
    if (!resolved) return 0;
    return pickValueByKey.get(`${resolved.year}:${resolved.overall}`) ?? 0;
  }

  for (const t of trades) {
    const teamIds = new Set<number>();
    for (const item of t.items) {
      if (item.from_team_id != null) teamIds.add(item.from_team_id);
      if (item.to_team_id != null) teamIds.add(item.to_team_id);
    }
    for (const id of teamIds) tradeCountByTeam.set(id, (tradeCountByTeam.get(id) ?? 0) + 1);
    if (teamIds.size !== 2) continue; // only score clean 2-team trades for the "biggest swing" callout

    const [teamA, teamB] = [...teamIds];
    let aNet = 0, bNet = 0;
    const aGot: string[] = [], bGot: string[] = [];
    for (const item of t.items) {
      const val = itemValue(item);
      const desc = displayDesc(item.item_description);
      if (item.to_team_id === teamA) { aNet += val; aGot.push(desc); }
      if (item.to_team_id === teamB) { bNet += val; bGot.push(desc); }
    }
    const delta = Math.abs(aNet - bNet);
    if (!biggestSwing || delta > biggestSwing.delta) {
      const winnerIsA = aNet >= bNet;
      biggestSwing = {
        winnerTeam: teamNameById.get(winnerIsA ? teamA : teamB) ?? "Unknown",
        loserTeam: teamNameById.get(winnerIsA ? teamB : teamA) ?? "Unknown",
        delta,
        gotDesc: (winnerIsA ? aGot : bGot).join(", ") || "—",
        gaveDesc: (winnerIsA ? bGot : aGot).join(", ") || "—",
      };
    }
  }

  let mostActive: TradeSummary["mostActive"] = null;
  for (const [teamId, count] of tradeCountByTeam) {
    if (!mostActive || count > mostActive.count) {
      mostActive = { teamName: teamNameById.get(teamId) ?? "Unknown", count };
    }
  }

  return { totalTrades: trades.length, mostActive, biggestSwing };
}

// ── Draft summary for one season ────────────────────────────────────────────

interface DraftGradeRow {
  overall_pick: number;
  round: number;
  team_name: string;
  player_name: string;
  position: string | null;
  five_yr_vorp: number;
  draft_year: number;
}

interface DraftSummary {
  pickCount: number;
  steal: { player: string; team: string; pos: string; value: number } | null;
  reach: { player: string; team: string; pos: string; value: number } | null;
}

function computeDraftSummary(picks: DraftGradeRow[], curve: Map<number, number>): DraftSummary {
  const gradable = picks.filter((p) => p.position && GRADABLE_POS.includes(p.position));
  let steal: DraftSummary["steal"] = null;
  let reach: DraftSummary["reach"] = null;
  for (const p of gradable) {
    const v = getPickValue(curve, p);
    if (v === null) continue;
    if (!steal || v > steal.value) steal = { player: p.player_name, team: p.team_name, pos: p.position!, value: v };
    if (!reach || v < reach.value) reach = { player: p.player_name, team: p.team_name, pos: p.position!, value: v };
  }
  return { pickCount: picks.length, steal, reach };
}

// ── All-time context (championships + playoff record, real bracket only) ────

export interface ChampionshipHistory {
  /** team name -> season numbers won, ascending */
  wins: Map<string, number[]>;
}

export interface PlayoffRecord {
  wins: number;
  losses: number;
  appearances: Set<number>; // season_ids the team played a real-bracket playoff game in
}

export interface PlayoffWeekScore {
  team: string;
  week: number;
  score: number;
}

// ── Narrative generation ────────────────────────────────────────────────────

function swingVerb(delta: number): string {
  if (delta >= 150) return "absolutely fleeced";
  return "clearly got the better of";
}

function ppgVerb(ppg: number): string {
  if (ppg >= 130) return "torched the league";
  if (ppg >= 115) return "put up video-game numbers";
  return "led the league in scoring";
}

function chokeVerb(deficit: number): string {
  if (deficit >= 40) return "completely disappeared";
  if (deficit >= 25) return "no-showed";
  return "went cold at the worst possible time";
}

function buildNarrative(
  stats: SeasonStats,
  trade: TradeSummary,
  draft: DraftSummary,
  championships: ChampionshipHistory,
  playoffRecords: Map<string, PlayoffRecord>,
  playoffWeekScores: PlayoffWeekScore[],
  seasonAvgScore: number | null,
): string[] {
  const lines: string[] = [];

  const winsBefore = (team: string, uptoSeason: number) => (championships.wins.get(team) ?? []).filter((s) => s <= uptoSeason);

  if (stats.champion) {
    const priorWins = winsBefore(stats.champion, stats.seasonNumber - 1);
    let champLine = stats.runnerUp
      ? `${stats.champion} took home the title, beating out ${stats.runnerUp} for the crown.`
      : `${stats.champion} took home the title.`;
    if (priorWins.length === 0) {
      champLine += ` First championship in franchise history.`;
    } else {
      champLine += ` Title number ${priorWins.length + 1}, and the first since Season ${priorWins[priorWins.length - 1]}.`;
    }
    lines.push(champLine);
  }

  if (stats.bestRegularRecord) {
    const { team, wins, losses, ties } = stats.bestRegularRecord;
    const record = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
    const isAlsoChamp = team === stats.champion;
    if (isAlsoChamp) {
      lines.push(`${team} backed it up with the league's best regular-season record too (${record}) — no fluke.`);
    } else {
      const record_ = playoffRecords.get(team);
      const priorWins = winsBefore(team, stats.seasonNumber);
      let chokeLine = `${team} owned the regular season at ${record} and still found a way to blow it.`;
      if (priorWins.length === 0 && record_ && record_.appearances.size >= 3) {
        chokeLine += ` That's ${record_.appearances.size} playoff trips and zero championships to show for it (${record_.wins}-${record_.losses} in the bracket) — the choke is officially a pattern, not a fluke.`;
      } else if (priorWins.length === 0 && stats.seasonNumber > 1) {
        chokeLine += ` Still hasn't won it all, ${stats.seasonNumber - 1} season${stats.seasonNumber - 1 === 1 ? "" : "s"} into this thing.`;
      }
      lines.push(chokeLine);
    }
  }

  // Playoff no-shows: real-bracket games this season, well below the team's own season average.
  if (seasonAvgScore != null) {
    const chokes = playoffWeekScores
      .map((s) => ({ ...s, deficit: seasonAvgScore - s.score }))
      .filter((s) => s.deficit >= 15)
      .sort((a, b) => b.deficit - a.deficit)
      .slice(0, 2);
    for (const c of chokes) {
      lines.push(`${c.team} ${chokeVerb(c.deficit)} in Week ${c.week}, managing just ${fmt(c.score)} points (${fmt(c.deficit)} under the week's average) — exactly when it mattered most.`);
    }
  }

  if (stats.highestPpg) {
    lines.push(`${stats.highestPpg.team} ${ppgVerb(stats.highestPpg.ppg)}, averaging ${fmt(stats.highestPpg.ppg)} points a week.`);
  }
  if (stats.highestSingleGame) {
    lines.push(`The single-week high belongs to ${stats.highestSingleGame.team}, who dropped ${fmt(stats.highestSingleGame.score)} in Week ${stats.highestSingleGame.week}.`);
  }
  if (stats.biggestUpset) {
    lines.push(`Biggest upset: ${stats.biggestUpset.winner} knocked off ${stats.biggestUpset.loser} in Week ${stats.biggestUpset.week} despite a ${fmt(stats.biggestUpset.delta)}-point form disadvantage.`);
  }

  // A chronic underachiever check among this season's real playoff field — the "13 years, no rings" callout.
  const fieldNames = new Set<string>();
  if (stats.champion) fieldNames.add(stats.champion);
  if (stats.runnerUp) fieldNames.add(stats.runnerUp);
  let worstDrought: { team: string; record: PlayoffRecord; seasonsSince: number } | null = null;
  for (const name of fieldNames) {
    const record = playoffRecords.get(name);
    if (!record || record.appearances.size < 3) continue;
    if (winsBefore(name, stats.seasonNumber).length > 0) continue; // has a ring, not a choker
    const cand = { team: name, record, seasonsSince: stats.seasonNumber };
    if (!worstDrought || record.appearances.size > worstDrought.record.appearances.size) worstDrought = cand;
  }
  if (worstDrought && worstDrought.team !== stats.champion) {
    lines.push(
      `Spare a thought for ${worstDrought.team}: ${worstDrought.record.appearances.size} career playoff appearances, a ${worstDrought.record.wins}-${worstDrought.record.losses} bracket record, and still no championship. The drought continues.`,
    );
  }

  if (trade.biggestSwing && trade.biggestSwing.delta > 40) {
    lines.push(
      `Trade of the year: ${trade.biggestSwing.winnerTeam} ${swingVerb(trade.biggestSwing.delta)} ${trade.biggestSwing.loserTeam}, ` +
      `landing ${trade.biggestSwing.gotDesc} for ${trade.biggestSwing.gaveDesc}.`,
    );
  }

  if (draft.steal) {
    lines.push(`Draft-day steal: ${draft.steal.team} landed ${draft.steal.player} (${draft.steal.pos}), outproducing his draft slot by ${fmt(draft.steal.value)} VORP.`);
  }
  if (draft.reach && draft.reach !== draft.steal && draft.reach.value < -20) {
    lines.push(`Draft-day disaster: ${draft.reach.team} spent a pick on ${draft.reach.player} (${draft.reach.pos}) who fell ${fmt(Math.abs(draft.reach.value))} VORP short of expectations for that slot.`);
  }

  return lines;
}

// ── Page ─────────────────────────────────────────────────────────────────────

const DynastyDigest = () => {
  const [selectedSeason, setSelectedSeason] = useState("13");
  const seasonNumber = parseInt(selectedSeason, 10);
  const year = getSeasonYear(seasonNumber);

  const { data: seasons } = useQuery({
    queryKey: ["digest-seasons"],
    queryFn: async () => {
      const { data, error } = await supabase.from("seasons").select("id, year, season_number").order("season_number");
      if (error) throw error;
      return data;
    },
  });
  const seasonId = seasons?.find((s) => s.season_number === seasonNumber)?.id;

  const { data: allMatchups } = useQuery({
    queryKey: ["digest-all-matchups"],
    queryFn: async () => {
      const PAGE = 1000;
      let rows: MatchupScoresView[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase.from("matchup_scores_view").select("*").order("season_id").order("week_number").range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        rows = rows.concat(data as MatchupScoresView[]);
        if (data.length < PAGE) break;
        from += PAGE;
      }
      return rows;
    },
  });

  const { data: teams } = useQuery({
    queryKey: ["digest-teams"],
    queryFn: async () => {
      const { data, error } = await supabase.from("teams").select("id, name");
      if (error) throw error;
      return data as Array<{ id: number; name: string }>;
    },
  });
  const teamNameById = useMemo(() => new Map((teams ?? []).map((t) => [t.id, t.name])), [teams]);

  const { data: trades } = useQuery({
    queryKey: ["digest-trades", seasonId],
    queryFn: async () => {
      const [tradesRes, itemsRes] = await Promise.all([
        supabase.from("trades").select("id, team1_id, team2_id").eq("season_id", seasonId!),
        supabase.from("trade_items").select("trade_id, item_type, item_description, from_team_id, to_team_id"),
      ]);
      if (tradesRes.error) throw tradesRes.error;
      if (itemsRes.error) throw itemsRes.error;
      const itemsByTrade = new Map<number, TradeItemRow[]>();
      for (const item of itemsRes.data as TradeItemRow[]) {
        if (!itemsByTrade.has(item.trade_id)) itemsByTrade.set(item.trade_id, []);
        itemsByTrade.get(item.trade_id)!.push(item);
      }
      return (tradesRes.data ?? []).map((t) => ({
        id: t.id, team1_id: t.team1_id, team2_id: t.team2_id,
        items: itemsByTrade.get(t.id) ?? [],
      })) as TradeRow[];
    },
    enabled: seasonId != null,
  });

  const { data: draftPicksRaw } = useQuery({
    queryKey: ["digest-draft-picks", seasonId],
    queryFn: async () => {
      const { data, error } = await supabase.from("draft_picks").select("player_name, round, pick_number, team_id").eq("season_id", seasonId!);
      if (error) throw error;
      return data as Array<{ player_name: string; round: number; pick_number: number; team_id: number }>;
    },
    enabled: seasonId != null,
  });

  const { data: rookieGrades } = useQuery({
    queryKey: ["digest-rookie-grades", year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rookie_draft_grades" as never)
        .select("overall_pick, round, team_name, player_name, position, five_yr_vorp, draft_year")
        .eq("draft_year", year);
      if (error) throw error;
      return data as unknown as DraftGradeRow[];
    },
    enabled: !!year,
  });

  const { data: historicalPicks } = useQuery({
    queryKey: ["digest-historical-picks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rookie_draft_grades" as never)
        .select("overall_pick, five_yr_vorp, draft_year, position")
        .gte("draft_year", 2014)
        .in("position", GRADABLE_POS);
      if (error) throw error;
      return data as unknown as HistoricalPick[];
    },
  });

  const tradePlayerNames = useMemo(
    () => [...new Set((trades ?? []).flatMap((t) => t.items).filter((i) => i.item_type === "player").map((i) => i.item_description))],
    [trades],
  );
  const { data: lifetimeVorpRows } = useQuery({
    queryKey: ["digest-player-vorp", tradePlayerNames],
    queryFn: async () => {
      const { data, error } = await supabase.from("player_vorp" as never).select("player_name, position, year, vorp").in("player_name", tradePlayerNames);
      if (error) throw error;
      return data as unknown as PlayerVorpRow[];
    },
    enabled: tradePlayerNames.length > 0,
  });

  const resolvedPickKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const t of trades ?? []) {
      for (const item of t.items) {
        if (item.item_type !== "pick") continue;
        const resolved = parseResolvedPick(item.item_description);
        if (resolved) keys.add(String(resolved.year));
      }
    }
    return [...keys].map(Number);
  }, [trades]);
  const { data: pickGradesForTrades } = useQuery({
    queryKey: ["digest-pick-grades", resolvedPickKeys],
    queryFn: async () => {
      const { data, error } = await supabase.from("rookie_draft_grades" as never).select("draft_year, overall_pick, five_yr_vorp").in("draft_year", resolvedPickKeys);
      if (error) throw error;
      return data as unknown as Array<{ draft_year: number; overall_pick: number; five_yr_vorp: number }>;
    },
    enabled: resolvedPickKeys.length > 0,
  });

  const stats = useMemo(() => {
    if (!allMatchups || !seasonId) return null;
    return computeSeasonStats(seasonId, seasonNumber, year, allMatchups);
  }, [allMatchups, seasonId, seasonNumber, year]);

  // Championship history across every completed season — powers drought/dynasty callouts.
  const championships = useMemo<ChampionshipHistory>(() => {
    const wins = new Map<string, number[]>();
    if (!allMatchups || !seasons) return { wins };
    for (const s of seasons) {
      if (s.season_number < 1 || s.season_number > 13) continue;
      const st = computeSeasonStats(s.id, s.season_number, s.year ?? getSeasonYear(s.season_number), allMatchups);
      if (st.champion) {
        if (!wins.has(st.champion)) wins.set(st.champion, []);
        wins.get(st.champion)!.push(s.season_number);
      }
    }
    for (const arr of wins.values()) arr.sort((a, b) => a - b);
    return { wins };
  }, [allMatchups, seasons]);

  // Real-bracket playoff record per team, through the SELECTED season only (excludes
  // consolation/toilet-bowl games, and never counts seasons that haven't happened yet
  // relative to the one being recapped — Season 1's digest can't reference future history).
  const seasonNumberBySeasonId = useMemo(() => new Map((seasons ?? []).map((s) => [s.id, s.season_number])), [seasons]);
  const playoffRecords = useMemo(() => {
    const map = new Map<string, PlayoffRecord>();
    if (!allMatchups) return map;
    const seen = new Set<string>();
    const ensure = (name: string) => {
      if (!map.has(name)) map.set(name, { wins: 0, losses: 0, appearances: new Set() });
      return map.get(name)!;
    };
    for (const m of allMatchups) {
      if (!m.is_playoff_bracket || m.home_score == null || m.away_score == null) continue;
      if (m.home_team_id == null || m.away_team_id == null || m.season_id == null || m.week_number == null) continue;
      const sn = seasonNumberBySeasonId.get(m.season_id);
      if (sn == null || sn > seasonNumber) continue;
      const key = `${m.season_id}-${m.week_number}-${Math.min(m.home_team_id, m.away_team_id)}-${Math.max(m.home_team_id, m.away_team_id)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (m.home_team_name) {
        const e = ensure(m.home_team_name);
        e.appearances.add(m.season_id);
        if (m.home_score > m.away_score) e.wins++; else if (m.home_score < m.away_score) e.losses++;
      }
      if (m.away_team_name) {
        const e = ensure(m.away_team_name);
        e.appearances.add(m.season_id);
        if (m.away_score > m.home_score) e.wins++; else if (m.away_score < m.home_score) e.losses++;
      }
    }
    return map;
  }, [allMatchups, seasonNumberBySeasonId, seasonNumber]);

  // Real-bracket playoff scores for the selected season — feeds the "playoff no-show" callouts.
  const playoffWeekScoresForSeason = useMemo<PlayoffWeekScore[]>(() => {
    if (!allMatchups || !seasonId) return [];
    const seen = new Set<string>();
    const entries: PlayoffWeekScore[] = [];
    for (const m of allMatchups) {
      if (m.season_id !== seasonId || !m.is_playoff_bracket) continue;
      if (m.home_team_id == null || m.away_team_id == null || m.week_number == null) continue;
      const key = `${m.week_number}-${Math.min(m.home_team_id, m.away_team_id)}-${Math.max(m.home_team_id, m.away_team_id)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (m.home_score != null && m.home_team_name) entries.push({ team: m.home_team_name, week: m.week_number, score: m.home_score });
      if (m.away_score != null && m.away_team_name) entries.push({ team: m.away_team_name, week: m.week_number, score: m.away_score });
    }
    return entries;
  }, [allMatchups, seasonId]);

  // Regular-season scoring average for the selected season — the baseline a "choke" score is measured against.
  const seasonAvgScoreForSeason = useMemo(() => {
    if (!allMatchups || !seasonId) return null;
    const seen = new Set<string>();
    const scores: number[] = [];
    for (const m of allMatchups) {
      if (m.season_id !== seasonId || m.is_playoff || (m.week_number ?? 0) >= 15) continue;
      if (m.home_team_id == null || m.away_team_id == null || m.week_number == null) continue;
      const key = `${m.week_number}-${Math.min(m.home_team_id, m.away_team_id)}-${Math.max(m.home_team_id, m.away_team_id)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (m.home_score != null) scores.push(m.home_score);
      if (m.away_score != null) scores.push(m.away_score);
    }
    return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  }, [allMatchups, seasonId]);

  const expectedVorpCurve = useMemo(() => buildExpectedVorpCurve(historicalPicks ?? []), [historicalPicks]);

  const pickValueByKey = useMemo(() => new Map((pickGradesForTrades ?? []).map((p) => [`${p.draft_year}:${p.overall_pick}`, Number(p.five_yr_vorp)])), [pickGradesForTrades]);
  const lifetimeVorp = useMemo(() => buildPlayerLifetimeVorpMap(lifetimeVorpRows ?? []), [lifetimeVorpRows]);

  const tradeSummary = useMemo(
    () => computeTradeSummary(trades ?? [], teamNameById, pickValueByKey, lifetimeVorp),
    [trades, teamNameById, pickValueByKey, lifetimeVorp],
  );

  const draftGradeRows: DraftGradeRow[] = useMemo(() => {
    if (rookieGrades && rookieGrades.length > 0) return rookieGrades;
    // Fall back to raw draft_picks (no VORP data yet for this class) so the pick count still shows.
    return (draftPicksRaw ?? []).map((p) => ({
      overall_pick: (p.round - 1) * 20 + p.pick_number,
      round: p.round,
      team_name: teamNameById.get(p.team_id) ?? "Unknown",
      player_name: p.player_name,
      position: null,
      five_yr_vorp: 0,
      draft_year: year,
    }));
  }, [rookieGrades, draftPicksRaw, teamNameById, year]);

  const draftSummary = useMemo(() => computeDraftSummary(draftGradeRows, expectedVorpCurve), [draftGradeRows, expectedVorpCurve]);

  const narrative = useMemo(
    () => (stats ? buildNarrative(stats, tradeSummary, draftSummary, championships, playoffRecords, playoffWeekScoresForSeason, seasonAvgScoreForSeason) : []),
    [stats, tradeSummary, draftSummary, championships, playoffRecords, playoffWeekScoresForSeason, seasonAvgScoreForSeason],
  );

  const isLoading = !allMatchups || !seasons || !stats;

  return (
    <div className="min-h-screen space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3">
            <Newspaper className="h-8 w-8 text-amber-400" />
            Dynasty Digest
          </h1>
          <p className="text-slate-400">Who won, who choked, and who's still waiting for a ring — the season, unfiltered.</p>
        </div>
        <Select value={selectedSeason} onValueChange={setSelectedSeason}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select Season" />
          </SelectTrigger>
          <SelectContent>
            {getAllSeasons().filter((s) => Number(s.value) <= 13).map((season) => (
              <SelectItem key={season.value} value={season.value}>{season.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      {isLoading ? (
        <p className="text-slate-500 text-sm animate-pulse py-12 text-center">Loading the digest…</p>
      ) : (
        <div className="max-w-3xl">
          <Card className="border-white/10 bg-[#1a1a2e] overflow-hidden">
            <div className="px-6 pt-6 pb-4 border-b border-white/10 bg-gradient-to-br from-amber-500/10 to-transparent">
              <p className="text-xs font-medium text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" /> Season {seasonNumber} Recap
              </p>
              <h2 className="text-2xl font-bold text-white mt-1">{year} Season Digest</h2>
            </div>
            <CardContent className="pt-5 space-y-4">
              {narrative.map((line, i) => (
                <p key={i} className="text-slate-300 leading-relaxed">{line}</p>
              ))}
              {narrative.length === 0 && <p className="text-slate-500 text-sm">Not enough data for this season yet.</p>}
            </CardContent>
          </Card>

          {/* Quick-hit stat strip */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-5">
            {tradeSummary.totalTrades > 0 && (
              <div className="bg-white/[0.03] border border-white/10 rounded-lg p-3 flex items-center gap-2.5">
                <ArrowLeftRight className="h-4 w-4 text-sky-400 shrink-0" />
                <div>
                  <p className="text-[11px] text-slate-500 uppercase tracking-wide">Trades</p>
                  <p className="text-sm font-bold text-white">{tradeSummary.totalTrades}</p>
                </div>
              </div>
            )}
            {draftSummary.steal && (
              <div className="bg-white/[0.03] border border-white/10 rounded-lg p-3 flex items-center gap-2.5">
                <TrendingUp className="h-4 w-4 text-emerald-400 shrink-0" />
                <div>
                  <p className="text-[11px] text-slate-500 uppercase tracking-wide">Best Steal</p>
                  <p className="text-sm font-bold text-white truncate">{draftSummary.steal.player}</p>
                </div>
              </div>
            )}
            {draftSummary.reach && (
              <div className="bg-white/[0.03] border border-white/10 rounded-lg p-3 flex items-center gap-2.5">
                <TrendingDown className="h-4 w-4 text-red-400 shrink-0" />
                <div>
                  <p className="text-[11px] text-slate-500 uppercase tracking-wide">Biggest Reach</p>
                  <p className="text-sm font-bold text-white truncate">{draftSummary.reach.player}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DynastyDigest;
