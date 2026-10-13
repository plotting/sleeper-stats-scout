import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import type { MatchupScoresView } from "@/types/database";
import { getSeasonYear } from "@/utils/seasonUtils";
import { luckSummary, teamGames, type TeamGame } from "@/utils/luckStats";

const fmt = (n: number) => n.toFixed(2);
const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][(n % 100 >= 11 && n % 100 <= 13) ? 0 : Math.min(n % 10, 4) % 4]}`;

/** Every regular-season matchup in the league's history (ranking a score needs everyone else's scores that week). */
function useRegularSeasonMatchups() {
  return useQuery({
    queryKey: ["luck-regular-season-matchups"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const rows: MatchupScoresView[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from("matchup_scores_view").select("*").eq("is_playoff", false).eq("is_consolation", false).range(from, from + 999);
        if (error) throw error;
        rows.push(...((data ?? []) as MatchupScoresView[]));
        if (!data || data.length < 1000) break;
      }
      return rows;
    },
  });
}

const Tile = ({ title, value, lines }: { title: string; value: string; lines: string[] }) => (
  <div className="rounded-lg border border-white/10 p-4">
    <p className="text-xs text-muted-foreground">{title}</p>
    <p className="text-2xl font-bold mt-1">{value}</p>
    {lines.map((l) => <p key={l} className="text-xs text-muted-foreground mt-0.5">{l}</p>)}
  </div>
);

/** Scoring oddities for one team: points in losses and wins at the extremes, and games decided against the weekly ranking. */
const TeamLuckStats = ({ teamId, selectedSeason }: { teamId: number; selectedSeason: string }) => {
  const { data: matchups } = useRegularSeasonMatchups();

  const all = useMemo(() => (matchups ? teamGames(matchups, teamId) : []), [matchups, teamId]);

  const games = useMemo(() => (selectedSeason === "career" ? all : all.filter((g) => g.seasonId === Number(selectedSeason))), [all, selectedSeason]);
  const s = useMemo(() => luckSummary(games), [games]);
  const bySeason = useMemo(() => {
    const ids = [...new Set(all.map((g) => g.seasonId))].sort((a, b) => b - a);
    return ids.map((id) => ({ id, ...luckSummary(all.filter((g) => g.seasonId === id)) }));
  }, [all]);

  if (!matchups || games.length === 0) return null;

  const sizes = new Set(games.map((g) => g.teams));
  const n = sizes.size === 1 ? [...sizes][0] : null; // league size when constant, so the low end can be named "9th / 8th"
  const lowLabel = n ? `${ordinal(n - 1)}/${ordinal(n - 2)} highest` : "2nd/3rd lowest";
  const when = (g: TeamGame) => `${getSeasonYear(g.seasonId)} wk ${g.week}`;
  const listOf = (title: string, rows: TeamGame[], hint: string) => (
    <details className="rounded-lg border border-white/10 px-4 py-3">
      <summary className="cursor-pointer text-sm">{title} <span className="text-muted-foreground">({rows.length})</span></summary>
      <p className="text-xs text-muted-foreground mt-2">{hint}</p>
      {rows.length === 0 ? <p className="text-xs text-muted-foreground mt-2">None.</p> : (
        <table className="w-full text-sm mt-2">
          <tbody>
            {[...rows].reverse().map((g) => (
              <tr key={`${g.seasonId}-${g.week}`} className="border-t border-white/5">
                <td className="py-1 text-muted-foreground">{when(g)}</td>
                <td className="font-mono text-right">{fmt(g.score)}</td>
                <td className="text-right text-muted-foreground">vs {g.oppName} <span className="font-mono">{fmt(g.oppScore)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
  const cell = (g: TeamGame | null) => (g ? <>{fmt(g.score)} <span className="text-muted-foreground">({fmt(g.oppScore)})</span></> : "–");

  return (
    <Card className="p-6 mb-8">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">Scoring quirks <span className="font-normal">· regular season, official scores, {selectedSeason === "career" ? "career" : `${getSeasonYear(Number(selectedSeason))}`}</span></h3>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Tile
          title="Highest-scoring loser of the week" value={String(s.topLosses.length)}
          lines={[s.highestLoss ? `Most points in a loss: ${fmt(s.highestLoss.score)} (${when(s.highestLoss)})` : "No losses", "Best score among that week's losing teams"]}
        />
        <Tile
          title="Lowest-scoring winner of the week" value={String(s.bottomWins.length)}
          lines={[s.lowestWin ? `Fewest points in a win: ${fmt(s.lowestWin.score)} (${when(s.lowestWin)})` : "No wins", "Worst score among that week's winning teams"]}
        />
        <Tile
          title="Losses as 2nd/3rd highest scorer" value={String(s.topScorerLosses.total)}
          lines={[`2nd: ${s.topScorerLosses.second} · 3rd: ${s.topScorerLosses.third}`, "Scored well, still lost"]}
        />
        <Tile
          title={`Wins as ${lowLabel} scorer`} value={String(s.lowScorerWins.total)}
          lines={[`${n ? ordinal(n - 1) : "2nd lowest"}: ${s.lowScorerWins.secondLowest} · ${n ? ordinal(n - 2) : "3rd lowest"}: ${s.lowScorerWins.thirdLowest}`, "Scored poorly, still won"]}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 mt-4">
        {listOf("Every time the highest-scoring loser", s.topLosses, "Weeks this team lost but scored more than every other losing team, newest first.")}
        {listOf("Every time the lowest-scoring winner", s.bottomWins, "Weeks this team won but scored less than every other winning team, newest first.")}
      </div>

      {selectedSeason === "career" && bySeason.length > 1 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-blue-400">By season</summary>
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground text-xs">
                  <th className="font-normal py-1">Season</th>
                  <th className="font-normal text-right">Top-scoring loser</th>
                  <th className="font-normal text-right">Lowest-scoring winner</th>
                  <th className="font-normal text-right">Most pts in a loss (opp)</th>
                  <th className="font-normal text-right">Fewest pts in a win (opp)</th>
                  <th className="font-normal text-right">Lost as 2nd/3rd</th>
                  <th className="font-normal text-right">Won as {lowLabel.replace(" highest", "")}</th>
                </tr>
              </thead>
              <tbody>
                {bySeason.map((r) => (
                  <tr key={r.id} className="border-t border-white/5">
                    <td className="py-1">{getSeasonYear(r.id)}</td>
                    <td className="text-right font-mono">{r.topLosses.length}</td>
                    <td className="text-right font-mono">{r.bottomWins.length}</td>
                    <td className="text-right font-mono">{cell(r.highestLoss)}</td>
                    <td className="text-right font-mono">{cell(r.lowestWin)}</td>
                    <td className="text-right font-mono">{r.topScorerLosses.total}</td>
                    <td className="text-right font-mono">{r.lowScorerWins.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </Card>
  );
};

export default TeamLuckStats;
