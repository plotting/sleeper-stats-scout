import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MatchupScoresView } from "@/types/database";
import { allTeamGames, luckTallies, type LuckTally, type TeamGame } from "@/utils/luckStats";

type Metric = "topLosses" | "bottomWins" | "topScorerLosses" | "lowScorerWins";

const METRICS: Array<{ key: Metric; title: string; blurb: string }> = [
  { key: "topLosses", title: "Highest-scoring loser of the week", blurb: "Lost, but scored more than every other losing team that week." },
  { key: "bottomWins", title: "Lowest-scoring winner of the week", blurb: "Won, but scored less than every other winning team that week." },
  { key: "topScorerLosses", title: "Losses as 2nd/3rd highest scorer", blurb: "Had one of the best scores of the week and still lost." },
  { key: "lowScorerWins", title: "Wins as 2nd/3rd lowest scorer", blurb: "Had one of the worst scores of the week and still won." },
];

const fmt = (n: number) => n.toFixed(2);

/** Leaders of a count within a group, keeping ties (nobody is listed for a count of zero). */
function leaders(rows: LuckTally[], key: Metric): { names: string[]; n: number } | null {
  const best = Math.max(0, ...rows.map((r) => r[key]));
  if (best === 0) return null;
  return { names: rows.filter((r) => r[key] === best).map((r) => r.teamName), n: best };
}

const extreme = (games: TeamGame[], pick: (g: TeamGame) => boolean, better: (a: number, b: number) => boolean): TeamGame | null =>
  games.filter(pick).reduce<TeamGame | null>((best, g) => (!best || better(g.score, best.score) ? g : best), null);

/** League-wide luck records: how often teams were the week's highest-scoring loser / lowest-scoring winner, and the unluckiest results, career and year by year. Regular season, official scores. */
export const LuckRecordsSection = ({ matchups, yearMap }: { matchups: MatchupScoresView[]; yearMap: Map<number, number> }) => {
  const year = (id: number | null) => (id == null ? "" : String(yearMap.get(id) ?? id));
  const { tallies, games, seasonIds } = useMemo(() => {
    const games = allTeamGames(matchups);
    return { games, tallies: luckTallies(games), seasonIds: [...new Set(games.map((g) => g.seasonId))].sort((a, b) => b - a) };
  }, [matchups]);

  if (games.length === 0) return <p className="text-sm text-muted-foreground">No regular-season games yet.</p>;

  const top = (rows: LuckTally[], key: Metric, n = 5) => [...rows].filter((r) => r[key] > 0).sort((a, b) => b[key] - a[key]).slice(0, n);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        {METRICS.map((m) => (
          <Card key={m.key} className="p-6 border-white/10 bg-[#0f172a]">
            <h3 className="text-lg font-semibold">{m.title}</h3>
            <p className="text-xs text-muted-foreground mb-3">{m.blurb}</p>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">Career</p>
                {top(tallies.career, m.key).map((r) => (
                  <div key={r.teamId} className="flex justify-between text-sm py-0.5"><span>{r.teamName}</span><span className="font-mono">{r[m.key]}</span></div>
                ))}
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">Single season</p>
                {top(tallies.seasons, m.key).map((r) => (
                  <div key={`${r.teamId}-${r.seasonId}`} className="flex justify-between text-sm py-0.5"><span>{r.teamName} <span className="text-muted-foreground">{year(r.seasonId)}</span></span><span className="font-mono">{r[m.key]}</span></div>
                ))}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-6 border-white/10 bg-[#0f172a]">
        <h3 className="text-lg font-semibold">Year by year</h3>
        <p className="text-xs text-muted-foreground mb-3">The team with the most of each in the season (ties listed together), and the season's most points in a loss and fewest points in a win.</p>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Season</TableHead>
                <TableHead>Top-scoring loser</TableHead>
                <TableHead>Lowest-scoring winner</TableHead>
                <TableHead>Lost as 2nd/3rd</TableHead>
                <TableHead>Won as 2nd/3rd lowest</TableHead>
                <TableHead>Most pts in a loss</TableHead>
                <TableHead>Fewest pts in a win</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {seasonIds.map((id) => {
                const rows = tallies.seasons.filter((r) => r.seasonId === id);
                const sg = games.filter((g) => g.seasonId === id);
                const hl = extreme(sg, (g) => g.lost, (a, b) => a > b);
                const lw = extreme(sg, (g) => g.won, (a, b) => a < b);
                const cellFor = (key: Metric) => {
                  const l = leaders(rows, key);
                  return l ? <>{l.names.join(", ")} <span className="text-muted-foreground">({l.n})</span></> : <span className="text-muted-foreground">–</span>;
                };
                return (
                  <TableRow key={id}>
                    <TableCell className="font-medium">{year(id)}</TableCell>
                    <TableCell>{cellFor("topLosses")}</TableCell>
                    <TableCell>{cellFor("bottomWins")}</TableCell>
                    <TableCell>{cellFor("topScorerLosses")}</TableCell>
                    <TableCell>{cellFor("lowScorerWins")}</TableCell>
                    <TableCell>{hl ? <>{hl.teamName} <span className="font-mono">{fmt(hl.score)}</span> <span className="text-muted-foreground">wk {hl.week}</span></> : "–"}</TableCell>
                    <TableCell>{lw ? <>{lw.teamName} <span className="font-mono">{fmt(lw.score)}</span> <span className="text-muted-foreground">wk {lw.week}</span></> : "–"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
};
