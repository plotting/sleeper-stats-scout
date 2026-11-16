import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { MatchupScoresView, Team } from "@/types/database";
import { dedupeMatchups } from "@/utils/playoffSimModel";
import { getAllSeasons } from "@/utils/seasonUtils";
import { actualMatrix, hypotheticalMatrix, pairWeeks, rowTotal, standings, type PairCell } from "@/utils/seasonH2h";

type Scope = "regular" | "playoffs" | "all";
type Mode = "actual" | "everyone";

const SCOPE_LABEL: Record<Scope, string> = { regular: "Reg. Season", playoffs: "Playoffs", all: "All" };

const rec = (c: { wins: number; losses: number; ties: number }) => `${c.wins}-${c.losses}${c.ties > 0 ? `-${c.ties}` : ""}`;

/**
 * Head-to-head for one season. "Games played" is each team's record against each opponent in the games they really played —
 * the playoff tie-break view. "Every week" plays every team against every other team every week (each week's scores compared),
 * like Team Comparison but for the whole league. Click any cell for the week-by-week scores behind it.
 */
export default function SeasonH2H({ teams, seasonId: fixedSeason }: { teams: Team[]; seasonId?: number }) {
  const seasons = getAllSeasons();
  const [ownSeason, setOwnSeason] = useState(seasons[seasons.length - 1].value);
  const seasonId = fixedSeason ?? Number(ownSeason);
  const [mode, setMode] = useState<Mode>("actual");
  const [scope, setScope] = useState<Scope>("regular");
  const [byStanding, setByStanding] = useState(false);
  const [pair, setPair] = useState<[number, number] | null>(null);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["h2h-season-matchups", seasonId],
    enabled: seasonId > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("matchup_scores_view").select("*").eq("season_id", seasonId).order("week_number");
      if (error) throw error;
      return dedupeMatchups(data as MatchupScoresView[]);
    },
  });

  const teamIds = useMemo(() => teams.map((t) => t.id), [teams]);
  const matrix = useMemo(
    () => (rows ? (mode === "actual" ? actualMatrix(rows, teamIds, scope) : hypotheticalMatrix(rows, teamIds, scope)) : null),
    [rows, teamIds, mode, scope],
  );
  const table = useMemo(() => (rows ? standings(rows, teamIds, scope) : []), [rows, teamIds, scope]);
  const recordOf = useMemo(() => new Map(table.map((s) => [s.teamId, s])), [table]);
  const ordered = useMemo(() => (byStanding ? table.map((s) => teams.find((t) => t.id === s.teamId)!).filter(Boolean) : teams), [byStanding, table, teams]);
  const detail = useMemo(() => (rows && pair ? pairWeeks(rows, pair[0], pair[1], scope) : []), [rows, pair, scope]);
  const nameOf = (id: number) => teams.find((t) => t.id === id)?.name ?? `Team ${id}`;

  const toggle = <T extends string>(options: T[], value: T, set: (v: T) => void, label: (v: T) => string) => (
    <div className="flex gap-1 rounded-lg border border-white/10 p-1">
      {options.map((o) => (
        <button key={o} onClick={() => set(o)} className={cn("px-3 py-1 text-xs rounded-md transition-colors", value === o ? "bg-white/10 text-white font-medium" : "text-slate-400 hover:text-white")}>
          {label(o)}
        </button>
      ))}
    </div>
  );

  const played = detail.filter((w) => w.played);
  const aWins = detail.filter((w) => w.aScore > w.bScore).length;
  const bWins = detail.filter((w) => w.bScore > w.aScore).length;

  return (
    <Card className="border-white/10">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="text-lg">Season Head-to-Head</CardTitle>
            <CardDescription>
              {mode === "actual"
                ? "Each team's record against each opponent in the games they actually played: the playoff tie-break view"
                : "Each team's record against each opponent if every team played every other team every week"}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {fixedSeason == null && (
              <Select value={ownSeason} onValueChange={(v) => { setOwnSeason(v); setPair(null); }}>
                <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
                <SelectContent>{[...seasons].reverse().map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            )}
            {toggle<Mode>(["actual", "everyone"], mode, setMode, (m) => (m === "actual" ? "Games played" : "Every week"))}
            {toggle<Scope>(["regular", "playoffs", "all"], scope, setScope, (s) => SCOPE_LABEL[s])}
            <button
              onClick={() => setByStanding((v) => !v)}
              className={cn("px-3 py-1 text-xs rounded-lg border border-white/10 transition-colors", byStanding ? "bg-white/10 text-white" : "text-slate-400 hover:text-white")}
            >
              Order by standings
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-6">
        {isLoading || !matrix ? (
          <p className="text-slate-400 text-sm animate-pulse py-8 text-center">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <p className="text-xs text-slate-500 mb-3">
              Row team's record <span className="text-emerald-400">W</span>-<span className="text-red-400">L</span> vs each column team. Click a cell for the weekly scores.
            </p>
            <table className="min-w-full text-xs border-collapse">
              <thead>
                <tr>
                  <th className="w-36 min-w-[144px] sticky left-0 z-10 bg-[#020617] border-b border-white/10 pb-2 pr-3 text-left">
                    <span className="text-slate-500 font-normal">vs →</span>
                  </th>
                  {ordered.map((t) => (
                    <th key={t.id} className="min-w-[64px] text-center pb-2 px-1 border-b border-white/10 font-medium text-slate-300" title={t.name}>
                      {t.name.split(" ")[0]}
                    </th>
                  ))}
                  <th className="min-w-[72px] text-center pb-2 px-2 border-b border-white/10 text-slate-500 font-normal">{mode === "actual" ? "Total" : "All-play"}</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((row, ri) => {
                  const total = rowTotal(matrix.get(row.id));
                  const totalPct = total.games > 0 ? (total.wins + total.ties * 0.5) / total.games : 0;
                  const st = recordOf.get(row.id);
                  return (
                    <tr key={row.id} className={ri % 2 === 0 ? "bg-white/[0.02]" : ""}>
                      <td className="sticky left-0 z-10 bg-inherit py-2 pr-3 whitespace-nowrap">
                        <Link to={`/team/${row.id}`} className="font-medium text-slate-300 hover:text-white transition-colors">{row.name}</Link>
                        {st && <span className="ml-2 font-mono text-[10px] text-slate-500">{rec(st)}</span>}
                      </td>
                      {ordered.map((col) => {
                        if (row.id === col.id) return <td key={col.id} className="text-center py-2 px-1 bg-white/[0.04]"><span className="text-slate-600">—</span></td>;
                        const cell: PairCell | undefined = matrix.get(row.id)?.get(col.id);
                        const selected = pair && ((pair[0] === row.id && pair[1] === col.id) || (pair[0] === col.id && pair[1] === row.id));
                        if (!cell || cell.games === 0) {
                          return <td key={col.id} className={cn("text-center py-2 px-1", selected && "bg-primary/10")}><span className="text-slate-600">—</span></td>;
                        }
                        const pct = (cell.wins + cell.ties * 0.5) / cell.games;
                        return (
                          <td key={col.id} className={cn("text-center py-2 px-1 cursor-pointer hover:bg-white/5", selected && "bg-primary/10")} onClick={() => setPair([row.id, col.id])}>
                            <span className={cn("font-mono font-semibold", pct > 0.5 ? "text-emerald-400" : pct < 0.5 ? "text-red-400" : "text-slate-400")}>{rec(cell)}</span>
                          </td>
                        );
                      })}
                      <td className="text-center py-2 px-2 border-l border-white/10">
                        <div className={cn("font-mono font-semibold text-xs", totalPct > 0.5 ? "text-emerald-400" : totalPct < 0.5 ? "text-red-400" : "text-slate-400")}>{rec(total)}</div>
                        <div className="text-slate-500 text-[10px]">{(totalPct * 100).toFixed(0)}%</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {pair && rows && (
          <div className="rounded-lg border border-white/10 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <h3 className="font-medium">
                {nameOf(pair[0])} vs {nameOf(pair[1])}
              </h3>
              <button className="text-xs text-slate-500 hover:text-white" onClick={() => setPair(null)}>Close</button>
            </div>
            {detail.length === 0 ? (
              <p className="text-sm text-slate-400">No weeks where both teams have a score.</p>
            ) : (
              <>
                <p className="text-sm text-slate-300">
                  If they played every week: <span className="font-mono font-semibold">{nameOf(pair[0])} {aWins}-{bWins}{detail.length - aWins - bWins > 0 ? `-${detail.length - aWins - bWins}` : ""}</span>
                  {played.length > 0 ? (
                    <span className="text-slate-500">
                      {" "}· actually met {played.length === 1 ? "once" : `${played.length} times`} (week{played.length > 1 ? "s" : ""} {played.map((w) => w.week).join(", ")}):{" "}
                      {rec({ wins: played.filter((w) => w.aScore > w.bScore).length, losses: played.filter((w) => w.aScore < w.bScore).length, ties: played.filter((w) => w.aScore === w.bScore).length })} for {nameOf(pair[0])}
                    </span>
                  ) : (
                    <span className="text-slate-500"> · they didn't meet in these weeks</span>
                  )}
                </p>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="text-slate-500 text-left">
                        <th className="py-1 pr-4 font-normal">Week</th>
                        <th className="py-1 pr-4 font-normal">{nameOf(pair[0])}</th>
                        <th className="py-1 pr-4 font-normal">{nameOf(pair[1])}</th>
                        <th className="py-1 font-normal">Winner</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.map((w) => (
                        <tr key={w.week} className={cn("border-t border-white/5", w.played && "bg-primary/10")}>
                          <td className="py-1 pr-4 text-slate-400">{w.week}{w.played && <span className="ml-1 text-[10px] text-primary">played</span>}</td>
                          <td className={cn("py-1 pr-4 font-mono", w.aScore > w.bScore && "text-emerald-400")}>{w.aScore.toFixed(2)}</td>
                          <td className={cn("py-1 pr-4 font-mono", w.bScore > w.aScore && "text-emerald-400")}>{w.bScore.toFixed(2)}</td>
                          <td className="py-1 text-slate-300">{w.aScore === w.bScore ? "Tie" : w.aScore > w.bScore ? nameOf(pair[0]) : nameOf(pair[1])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
