import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { MatchupScoresView } from "@/types/database";
import { computeSeasonStats, type SeasonStats } from "./Recaps";
import { getSeasonYear } from "@/utils/seasonUtils";
import { askHistorian, buildHistorianContext } from "@/services/historian";
import {
  Landmark, Trophy, Flame, Swords, Newspaper, UserSearch, GraduationCap,
  Send, Loader2, Sparkles,
} from "lucide-react";

function fmt(n: number, d = 1): string {
  return n.toFixed(d);
}

// ── All-time superlatives, derived from every season's computed stats ──────

interface AllTimeAwards {
  mostChampionships: { team: string; count: number } | null;
  highestSeasonPpg: { team: string; ppg: number; year: number } | null;
  highestSingleGame: { team: string; score: number; year: number; week: number } | null;
  biggestUpset: { winner: string; loser: string; delta: number; year: number; week: number } | null;
  longestWinStreak: { team: string; length: number; startYear: number; endYear: number } | null;
}

function computeAllTimeAwards(allStats: SeasonStats[], allMatchups: MatchupScoresView[]): AllTimeAwards {
  const championCounts = new Map<string, number>();
  let highestSeasonPpg: AllTimeAwards["highestSeasonPpg"] = null;
  let highestSingleGame: AllTimeAwards["highestSingleGame"] = null;
  let biggestUpset: AllTimeAwards["biggestUpset"] = null;

  for (const s of allStats) {
    if (s.champion) championCounts.set(s.champion, (championCounts.get(s.champion) ?? 0) + 1);
    if (s.highestPpg && (!highestSeasonPpg || s.highestPpg.ppg > highestSeasonPpg.ppg)) {
      highestSeasonPpg = { team: s.highestPpg.team, ppg: s.highestPpg.ppg, year: s.year };
    }
    if (s.highestSingleGame && (!highestSingleGame || s.highestSingleGame.score > highestSingleGame.score)) {
      highestSingleGame = { team: s.highestSingleGame.team, score: s.highestSingleGame.score, year: s.year, week: s.highestSingleGame.week };
    }
    if (s.biggestUpset && (!biggestUpset || s.biggestUpset.delta > biggestUpset.delta)) {
      biggestUpset = { winner: s.biggestUpset.winner, loser: s.biggestUpset.loser, delta: s.biggestUpset.delta, year: s.year, week: s.biggestUpset.week };
    }
  }

  let mostChampionships: AllTimeAwards["mostChampionships"] = null;
  for (const [team, count] of championCounts) {
    if (!mostChampionships || count > mostChampionships.count) mostChampionships = { team, count };
  }

  // Longest regular-season win streak, scanned week-by-week across all seasons.
  const seen = new Set<string>();
  const results = new Map<string, { season: number; week: number; team: string; won: boolean }[]>();
  for (const m of allMatchups) {
    if (m.is_playoff || m.is_consolation) continue;
    if (m.home_score == null || m.away_score == null || m.week_number == null) continue;
    if (m.home_team_id == null || m.away_team_id == null) continue;
    const key = `${m.season_id}-${m.week_number}-${Math.min(m.home_team_id, m.away_team_id)}-${Math.max(m.home_team_id, m.away_team_id)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const push = (team: string | null, won: boolean) => {
      if (!team) return;
      if (!results.has(team)) results.set(team, []);
      results.get(team)!.push({ season: m.season_id, week: m.week_number!, team, won });
    };
    if (m.home_score !== m.away_score) {
      push(m.home_team_name, m.home_score > m.away_score);
      push(m.away_team_name, m.away_score > m.home_score);
    }
  }
  let longestWinStreak: AllTimeAwards["longestWinStreak"] = null;
  for (const [team, games] of results) {
    const sorted = [...games].sort((a, b) => a.season - b.season || a.week - b.week);
    let streak = 0, streakStartIdx = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].won) {
        if (streak === 0) streakStartIdx = i;
        streak++;
        if (!longestWinStreak || streak > longestWinStreak.length) {
          longestWinStreak = {
            team,
            length: streak,
            startYear: getSeasonYear(sorted[streakStartIdx].season),
            endYear: getSeasonYear(sorted[i].season),
          };
        }
      } else {
        streak = 0;
      }
    }
  }

  return { mostChampionships, highestSeasonPpg, highestSingleGame, biggestUpset, longestWinStreak };
}

// ── Ask the Historian widget ────────────────────────────────────────────────

function AskTheHistorian({ allStats, careerLines }: { allStats: SeasonStats[]; careerLines: string[] }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(q: string) {
    if (!q.trim() || loading) return;
    setLoading(true);
    setAnswer(null);
    setError(null);
    setNotConfigured(false);
    try {
      const context = buildHistorianContext(allStats, careerLines);
      const result = await askHistorian(q.trim(), context);
      setAnswer(result);
    } catch (err) {
      const msg = String(err);
      if (msg.includes("not found") || msg.includes("404") || msg.includes("FunctionsFetchError")) {
        setNotConfigured(true);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  const suggestions = [
    "Who's the most dominant champion in league history?",
    "Which team has the worst playoff luck?",
    "What's the biggest choke job we've ever seen?",
  ];

  return (
    <Card className="border-white/10 bg-gradient-to-br from-violet-500/[0.06] to-transparent overflow-hidden">
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="h-4 w-4 text-violet-400" />
          <h2 className="text-lg font-bold text-white">Ask the Historian</h2>
        </div>
        <p className="text-sm text-slate-400 mb-4">Ask a plain-language question about this league's history — champions, streaks, rivalries, turning points.</p>

        <form
          onSubmit={(e) => { e.preventDefault(); ask(question); }}
          className="flex gap-2 mb-3"
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Who choked the hardest in a championship game?"
            className="flex-1 bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50"
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Ask
          </button>
        </form>

        <div className="flex flex-wrap gap-2 mb-4">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => { setQuestion(s); ask(s); }}
              className="text-xs text-slate-400 hover:text-white border border-white/10 hover:border-white/20 rounded-full px-3 py-1 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>

        {notConfigured && (
          <p className="text-sm text-amber-400/90 bg-amber-500/[0.06] border border-amber-500/20 rounded-md px-3 py-2.5">
            Ask the Historian isn't set up yet. An admin needs to deploy the <code className="text-amber-300">ask-historian</code> Supabase
            Edge Function and set an <code className="text-amber-300">ANTHROPIC_API_KEY</code> secret — see{" "}
            <code className="text-amber-300">supabase/functions/ask-historian/README.md</code>.
          </p>
        )}
        {error && !notConfigured && (
          <p className="text-sm text-red-400 bg-red-500/[0.06] border border-red-500/20 rounded-md px-3 py-2.5">{error}</p>
        )}
        {answer && (
          <div className="text-sm text-slate-200 leading-relaxed bg-white/[0.03] border border-white/10 rounded-md px-4 py-3 whitespace-pre-wrap">
            {answer}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

const Hall = () => {
  const { data: seasons } = useQuery({
    queryKey: ["hall-seasons"],
    queryFn: async () => {
      const { data, error } = await supabase.from("seasons").select("id, year, season_number").order("season_number");
      if (error) throw error;
      return data;
    },
  });

  const { data: teams } = useQuery({
    queryKey: ["hall-teams"],
    queryFn: async () => {
      const { data, error } = await supabase.from("teams").select("id, name").order("id");
      if (error) throw error;
      return data as Array<{ id: number; name: string }>;
    },
  });

  const { data: allMatchups } = useQuery({
    queryKey: ["hall-all-matchups"],
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

  const allStats = useMemo<SeasonStats[]>(() => {
    if (!seasons || !allMatchups) return [];
    return seasons
      .filter((s) => s.season_number >= 1 && s.season_number <= 13)
      .map((s) => computeSeasonStats(s.id, s.season_number, s.year ?? getSeasonYear(s.season_number), allMatchups))
      .sort((a, b) => a.seasonNumber - b.seasonNumber);
  }, [seasons, allMatchups]);

  const awards = useMemo(() => computeAllTimeAwards(allStats, allMatchups ?? []), [allStats, allMatchups]);

  // All-time career records, for the historian's context and a quick standings strip.
  const careerRecords = useMemo(() => {
    if (!allMatchups || !teams) return [];
    const seen = new Set<string>();
    const byTeam = new Map<number, { wins: number; losses: number; ties: number; pf: number }>();
    for (const m of allMatchups) {
      if (m.is_playoff || m.is_consolation) continue;
      if (m.home_score == null || m.away_score == null || m.week_number == null) continue;
      if (m.home_team_id == null || m.away_team_id == null) continue;
      const key = `${m.season_id}-${m.week_number}-${Math.min(m.home_team_id, m.away_team_id)}-${Math.max(m.home_team_id, m.away_team_id)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const ensure = (id: number) => { if (!byTeam.has(id)) byTeam.set(id, { wins: 0, losses: 0, ties: 0, pf: 0 }); return byTeam.get(id)!; };
      const h = ensure(m.home_team_id), a = ensure(m.away_team_id);
      if (m.home_score > m.away_score) { h.wins++; a.losses++; }
      else if (m.away_score > m.home_score) { a.wins++; h.losses++; }
      else { h.ties++; a.ties++; }
      h.pf += m.home_score; a.pf += m.away_score;
    }
    return teams
      .map((t) => {
        const r = byTeam.get(t.id) ?? { wins: 0, losses: 0, ties: 0, pf: 0 };
        const total = r.wins + r.losses + r.ties;
        return { name: t.name, ...r, pct: total > 0 ? (r.wins + 0.5 * r.ties) / total : 0 };
      })
      .sort((a, b) => b.pct - a.pct);
  }, [allMatchups, teams]);

  const careerLines = useMemo(
    () => careerRecords.map((r) => `${r.name}: ${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""} (${(r.pct * 100).toFixed(1)}%), ${fmt(r.pf, 0)} career points for`),
    [careerRecords],
  );

  const isLoading = !seasons || !teams || !allMatchups;

  return (
    <div className="min-h-screen space-y-8">
      <header className="text-center max-w-2xl mx-auto">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Landmark className="h-8 w-8 text-amber-400" />
          <h1 className="text-4xl font-bold text-white">The Hall</h1>
        </div>
        <p className="text-slate-400">
          {allStats.length > 0
            ? `${allStats.length} seasons of champions, rivalries, and grudges — walk the whole history.`
            : "Every season, every champion, walked in one place."}
        </p>
      </header>

      {isLoading ? (
        <p className="text-slate-500 text-sm animate-pulse py-12 text-center">Opening the doors…</p>
      ) : (
        <>
          {/* Championship banner timeline */}
          <div>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3 text-center">Champions</h2>
            <div className="flex gap-3 overflow-x-auto pb-2 justify-center flex-wrap">
              {allStats.filter((s) => s.champion).map((s) => (
                <div
                  key={s.seasonId}
                  className="shrink-0 w-32 rounded-lg border border-amber-500/25 bg-gradient-to-b from-amber-500/10 to-transparent px-3 py-4 text-center"
                >
                  <Trophy className="h-5 w-5 text-amber-400 mx-auto mb-1.5" />
                  <p className="text-[11px] text-slate-500">{s.year}</p>
                  <p className="text-sm font-bold text-white leading-tight">{s.champion}</p>
                </div>
              ))}
            </div>
          </div>

          {/* All-time awards */}
          <div>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3 text-center">Records of the Ages</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {awards.mostChampionships && (
                <AwardCard icon={Trophy} label="Most Championships" accent="amber">
                  <p className="text-lg font-bold text-white">{awards.mostChampionships.team}</p>
                  <p className="text-sm text-slate-400">{awards.mostChampionships.count} titles</p>
                </AwardCard>
              )}
              {awards.longestWinStreak && (
                <AwardCard icon={Flame} label="Longest Win Streak" accent="orange">
                  <p className="text-lg font-bold text-white">{awards.longestWinStreak.team}</p>
                  <p className="text-sm text-slate-400">{awards.longestWinStreak.length} straight wins · {awards.longestWinStreak.startYear}–{awards.longestWinStreak.endYear}</p>
                </AwardCard>
              )}
              {awards.highestSeasonPpg && (
                <AwardCard icon={Sparkles} label="Highest Season PPG" accent="emerald">
                  <p className="text-lg font-bold text-white">{awards.highestSeasonPpg.team}</p>
                  <p className="text-sm text-slate-400">{fmt(awards.highestSeasonPpg.ppg)} PPG · {awards.highestSeasonPpg.year}</p>
                </AwardCard>
              )}
              {awards.highestSingleGame && (
                <AwardCard icon={Sparkles} label="Highest Single Game" accent="sky">
                  <p className="text-lg font-bold text-white">{awards.highestSingleGame.team}</p>
                  <p className="text-sm text-slate-400">{fmt(awards.highestSingleGame.score)} pts · Week {awards.highestSingleGame.week}, {awards.highestSingleGame.year}</p>
                </AwardCard>
              )}
              {awards.biggestUpset && (
                <AwardCard icon={Swords} label="Biggest Upset" accent="red">
                  <p className="text-lg font-bold text-white">{awards.biggestUpset.winner} over {awards.biggestUpset.loser}</p>
                  <p className="text-sm text-slate-400">{fmt(awards.biggestUpset.delta)}-pt underdog · {awards.biggestUpset.year}</p>
                </AwardCard>
              )}
            </div>
          </div>

          {/* Ask the Historian */}
          <AskTheHistorian allStats={allStats} careerLines={careerLines} />

          {/* Explore the Hall */}
          <div>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3 text-center">Explore the Hall</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <HallLink to="/records" icon={Trophy} label="Record Book" />
              <HallLink to="/head-to-head" icon={Swords} label="Rivalries" />
              <HallLink to="/draft-grades" icon={GraduationCap} label="Draft Grades" />
              <HallLink to="/gm-scouting" icon={UserSearch} label="GM Scouting" />
              <HallLink to="/dynasty-digest" icon={Newspaper} label="Dynasty Digest" />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

function AwardCard({ icon: Icon, label, accent, children }: {
  icon: typeof Trophy;
  label: string;
  accent: "amber" | "orange" | "emerald" | "sky" | "red";
  children: React.ReactNode;
}) {
  const accentClass = {
    amber: "text-amber-400 bg-amber-400/10 border-amber-400/20",
    orange: "text-orange-400 bg-orange-400/10 border-orange-400/20",
    emerald: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
    sky: "text-sky-400 bg-sky-400/10 border-sky-400/20",
    red: "text-red-400 bg-red-400/10 border-red-400/20",
  }[accent];
  return (
    <Card className="border-white/10 bg-[#1a1a2e]">
      <CardContent className="pt-5 pb-5">
        <div className={cn("inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide rounded-full border px-2 py-1 mb-3", accentClass)}>
          <Icon className="h-3 w-3" />
          {label}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function HallLink({ to, icon: Icon, label }: { to: string; icon: typeof Trophy; label: string }) {
  return (
    <Link
      to={to}
      className="flex flex-col items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/20 px-4 py-5 text-center transition-colors"
    >
      <Icon className="h-5 w-5 text-slate-400" />
      <span className="text-sm text-slate-300 font-medium">{label}</span>
    </Link>
  );
}

export default Hall;
