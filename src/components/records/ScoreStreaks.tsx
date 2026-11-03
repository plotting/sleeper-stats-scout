import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MatchupScoresView } from "@/types/database";
import { findRuns, type StreakRun } from "@/utils/scoreStreaks";
import { getAllSeasons } from "@/utils/seasonUtils";

const LENGTHS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

function RunsTable({ title, runs, seasonLabel, tone }: { title: string; runs: StreakRun[]; seasonLabel: (id: number) => string; tone: "hot" | "cold" }) {
  return (
    <div>
      <h3 className={cn("text-sm font-semibold mb-2", tone === "hot" ? "text-emerald-400" : "text-sky-400")}>{title}</h3>
      {runs.length === 0 ? (
        <p className="text-sm text-slate-500">No run of that length.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Season</TableHead>
                <TableHead>Weeks</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Avg</TableHead>
                <TableHead>Scores</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((r, i) => (
                <TableRow key={`${r.seasonId}-${r.teamId}-${r.startWeek}`}>
                  <TableCell className="text-slate-500">{i + 1}</TableCell>
                  <TableCell>
                    <Link to={`/team/${r.teamId}`} className="text-primary hover:underline font-medium text-sm">{r.teamName}</Link>
                  </TableCell>
                  <TableCell className="text-sm text-slate-400 whitespace-nowrap">{seasonLabel(r.seasonId)}</TableCell>
                  <TableCell className="text-sm text-slate-400 whitespace-nowrap">Wk {r.startWeek}–{r.endWeek}</TableCell>
                  <TableCell className="text-right font-mono text-sm font-semibold">{r.total.toFixed(2)}</TableCell>
                  <TableCell className="text-right font-mono text-sm text-slate-400">{r.avg.toFixed(1)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {r.games.map((g) => (
                        <span
                          key={g.week}
                          title={`Wk ${g.week} vs ${g.oppName} (${g.oppScore.toFixed(2)})`}
                          className={cn(
                            "font-mono text-[11px] px-1.5 py-0.5 rounded border",
                            g.won === true ? "border-emerald-500/30 text-emerald-300" : g.won === false ? "border-red-500/30 text-red-300" : "border-white/10 text-slate-400",
                          )}
                        >
                          {g.score.toFixed(1)}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/** Best and worst runs of consecutive weeks, any length from 2 to 10, league-wide or for one team. With `selectedSeason` the
 *  scope can be narrowed to that season; without it the table is all-time. */
export default function ScoreStreaks({ allMatchups, selectedSeason }: { allMatchups: MatchupScoresView[]; selectedSeason?: string }) {
  const [length, setLength] = useState(3);
  const [scope, setScope] = useState<"all" | "season">("all");
  const [teamId, setTeamId] = useState<string>("all");
  const [playoffs, setPlayoffs] = useState(false);

  const labels = useMemo(() => new Map(getAllSeasons().map((s) => [Number(s.value), s.label])), []);
  const seasonLabel = (id: number) => labels.get(id) ?? `Season ${id}`;

  const teams = useMemo(() => {
    const map = new Map<number, string>();
    for (const m of allMatchups) {
      if (m.home_team_id && m.home_team_name) map.set(m.home_team_id, m.home_team_name);
      if (m.away_team_id && m.away_team_name) map.set(m.away_team_id, m.away_team_name);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.id - b.id); // site-wide team order
  }, [allMatchups]);

  const opts = { teamId: teamId === "all" ? undefined : Number(teamId), seasonId: scope === "season" && selectedSeason ? Number(selectedSeason) : undefined, includePlayoffs: playoffs, limit: 10 };
  const high = useMemo(() => findRuns(allMatchups, length, { ...opts, order: "high" }), [allMatchups, length, scope, teamId, playoffs, selectedSeason]); // eslint-disable-line react-hooks/exhaustive-deps
  const low = useMemo(() => findRuns(allMatchups, length, { ...opts, order: "low" }), [allMatchups, length, scope, teamId, playoffs, selectedSeason]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <p className="text-xs text-slate-500 mb-1">Consecutive weeks</p>
          <Select value={String(length)} onValueChange={(v) => setLength(Number(v))}>
            <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
            <SelectContent>{LENGTHS.map((n) => <SelectItem key={n} value={String(n)}>{n} weeks</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">Team</p>
          <Select value={teamId} onValueChange={setTeamId}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All teams</SelectItem>
              {teams.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {selectedSeason && (
          <div>
            <p className="text-xs text-slate-500 mb-1">Seasons</p>
            <Select value={scope} onValueChange={(v) => setScope(v as "all" | "season")}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All seasons</SelectItem>
                <SelectItem value="season">{seasonLabel(Number(selectedSeason))}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <Button variant={playoffs ? "default" : "outline"} size="sm" onClick={() => setPlayoffs((p) => !p)}>
          {playoffs ? "Including playoffs" : "Regular season only"}
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        Highest and lowest total over {length} straight weeks within a season. A team's runs never overlap, so one hot stretch only appears once.
        Scores are green for a win and red for a loss; hover one for the opponent.
      </p>
      <RunsTable title={`Hottest ${length}-week runs`} runs={high} seasonLabel={seasonLabel} tone="hot" />
      <RunsTable title={`Coldest ${length}-week runs`} runs={low} seasonLabel={seasonLabel} tone="cold" />
    </div>
  );
}
