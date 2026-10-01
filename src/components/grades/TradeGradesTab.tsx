import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { displayDesc } from "@/utils/dynastyValue";
import { GRADE_STYLE, relativeGrades } from "@/utils/gradeScale";
import { useTradeValuation } from "@/hooks/useTradeValuation";
import type { TradeItem } from "@/utils/tradeHelpers";

// A trade counts as a win/loss for a side when its net VORP clears this margin.
const EVEN_MARGIN = 10;
// Teams with fewer trades than this are listed but not graded (too few trades to judge).
const MIN_TRADES_FOR_GRADE = 3;

type Sort = "net" | "avg";

interface TradeRow {
  id: number;
  season_id: number | null;
  trade_date: string;
  team1_id: number | null;
  team2_id: number | null;
  team1: { name: string } | null;
  team2: { name: string } | null;
  items: TradeItem[];
}

interface TeamTrade {
  tradeId: number;
  date: string;
  partner: string;
  net: number;
  got: string[];
  gave: string[];
}

const fmt = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
const netColor = (v: number) => (v >= 30 ? "text-emerald-400" : v >= -10 ? "text-sky-400" : v >= -75 ? "text-amber-400" : "text-red-400");

function GradeBadge({ grade }: { grade: string | null }) {
  if (!grade) return <span className="text-slate-600 text-xs">—</span>;
  return (
    <span className={cn("inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 text-xs font-bold rounded border", GRADE_STYLE[grade])}>
      {grade}
    </span>
  );
}

const TradeGradesTab = () => {
  const [sort, setSort] = useState<Sort>("net");
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: trades, isLoading, error } = useQuery({
    queryKey: ["all-trades-for-grades"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trades")
        .select(`
          id, season_id, trade_date, team1_id, team2_id,
          team1:teams!trades_team1_id_fkey(name),
          team2:teams!trades_team2_id_fkey(name),
          items:trade_items(item_type, item_description, from_team_id, to_team_id)
        `)
        .order("trade_date", { ascending: true })
        .range(0, 4999);
      if (error) throw error;
      return (data ?? []) as unknown as TradeRow[];
    },
  });

  const valuation = useTradeValuation(trades, true);

  const { teams, tradeCount } = useMemo(() => {
    type Acc = { name: string; trades: TeamTrade[] };
    const byTeam = new Map<string, Acc>();
    let counted = 0;
    for (const t of trades ?? []) {
      if (t.team1_id == null || t.team2_id == null || !t.team1 || !t.team2) continue;
      const date = new Date(t.trade_date);
      const v1 = valuation.computeTeamVorp(t.items, t.team1_id, date, t.id);
      const v2 = valuation.computeTeamVorp(t.items, t.team2_id, date, t.id);
      if (v1 === null && v2 === null) continue;
      counted++;
      const net1 = (v1 ?? 0) - (v2 ?? 0);
      const describe = (teamId: number, received: boolean) =>
        t.items
          .filter((i) => (received ? i.to_team_id === teamId : i.from_team_id === teamId))
          .map((i) => displayDesc(i.item_description));
      const sides: Array<[string, number, number, string]> = [
        [t.team1.name, t.team1_id, net1, t.team2.name],
        [t.team2.name, t.team2_id, -net1, t.team1.name],
      ];
      for (const [name, id, net, partner] of sides) {
        if (!byTeam.has(name)) byTeam.set(name, { name, trades: [] });
        byTeam.get(name)!.trades.push({
          tradeId: t.id, date: t.trade_date, partner, net,
          got: describe(id, true), gave: describe(id, false),
        });
      }
    }
    const rows = [...byTeam.values()].map(({ name, trades: tt }) => {
      const net = tt.reduce((s, x) => s + x.net, 0);
      const wins = tt.filter((x) => x.net > EVEN_MARGIN).length;
      const losses = tt.filter((x) => x.net < -EVEN_MARGIN).length;
      const best = tt.reduce((a, b) => (b.net > a.net ? b : a), tt[0]);
      const worst = tt.reduce((a, b) => (b.net < a.net ? b : a), tt[0]);
      return { name, trades: [...tt].sort((a, b) => b.date.localeCompare(a.date)), n: tt.length, net, avg: net / tt.length, wins, losses, even: tt.length - wins - losses, best, worst };
    });
    const graded = rows.filter((r) => r.n >= MIN_TRADES_FOR_GRADE);
    const grades = relativeGrades(graded.map((r) => r.avg));
    const gradeByName = new Map(graded.map((r, i) => [r.name, grades[i]]));
    const withGrade = rows.map((r) => ({ ...r, grade: gradeByName.get(r.name) ?? null }));
    withGrade.sort((a, b) => (sort === "net" ? b.net - a.net : b.avg - a.avg));
    return { teams: withGrade, tradeCount: counted };
  }, [trades, valuation, sort]);

  if (isLoading) return <p className="py-12 text-center text-slate-500 text-sm animate-pulse">Loading trades…</p>;
  if (error) return <p className="py-12 text-center text-red-400 text-sm">Failed to load trades — please refresh.</p>;

  return (
    <Card className="border-white/10">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="text-base">Trade Grades</CardTitle>
            <p className="text-xs text-slate-500 mt-1">
              Net VORP won or lost across {tradeCount} trades · players = 5 seasons from the trade date, picks = the player drafted
              (or the slot's expected value if re-traded) · graded against the rest of the league · click a team for its trades
            </p>
          </div>
          <div className="flex gap-1 rounded-lg border border-white/10 p-0.5">
            {([["net", "By Net VORP"], ["avg", "By Avg / Trade"]] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSort(key)}
                className={cn(
                  "px-3 py-1 text-xs rounded-md transition-colors",
                  sort === key ? "bg-white/10 text-white font-medium" : "text-slate-400 hover:text-white",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="border-white/10">
              <TableHead className="w-10">#</TableHead>
              <TableHead>Team</TableHead>
              <TableHead className="text-right">Trades</TableHead>
              <TableHead className="text-center">W-L-E</TableHead>
              <TableHead className="text-right">Net VORP</TableHead>
              <TableHead className="text-right">Avg / Trade</TableHead>
              <TableHead className="text-center">Grade</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {teams.map((t, i) => {
              const open = expanded === t.name;
              return (
                <Fragment key={t.name}>
                  <TableRow
                    className="cursor-pointer border-white/5 hover:bg-white/5"
                    onClick={() => setExpanded(open ? null : t.name)}
                  >
                    <TableCell className="text-slate-500 text-sm">{i + 1}</TableCell>
                    <TableCell className="font-semibold text-white">
                      <span className="inline-flex items-center gap-1.5">
                        {open ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500" />}
                        {t.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-slate-300">{t.n}</TableCell>
                    <TableCell className="text-center text-slate-300 text-sm">{t.wins}-{t.losses}-{t.even}</TableCell>
                    <TableCell className={cn("text-right font-mono font-semibold", netColor(t.net))}>{fmt(t.net)}</TableCell>
                    <TableCell className={cn("text-right font-mono", netColor(t.avg))}>{fmt(t.avg)}</TableCell>
                    <TableCell className="text-center"><GradeBadge grade={t.grade} /></TableCell>
                  </TableRow>
                  {open && (
                    <TableRow className="hover:bg-transparent border-white/5">
                      <TableCell colSpan={7} className="bg-white/[0.03] px-4 py-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4 text-xs">
                          <div className="rounded-lg border border-white/10 p-3">
                            <p className="text-slate-500 mb-1">Best trade</p>
                            <p className="text-emerald-400 font-mono font-semibold">{fmt(t.best.net)} <span className="text-slate-400 font-sans font-normal">vs {t.best.partner}, {t.best.date.slice(0, 10)}</span></p>
                            <p className="text-slate-300 mt-1">Got {t.best.got.join(", ") || "—"}</p>
                          </div>
                          <div className="rounded-lg border border-white/10 p-3">
                            <p className="text-slate-500 mb-1">Worst trade</p>
                            <p className="text-red-400 font-mono font-semibold">{fmt(t.worst.net)} <span className="text-slate-400 font-sans font-normal">vs {t.worst.partner}, {t.worst.date.slice(0, 10)}</span></p>
                            <p className="text-slate-300 mt-1">Got {t.worst.got.join(", ") || "—"}</p>
                          </div>
                        </div>
                        <div className="space-y-1">
                          {t.trades.map((x) => (
                            <div key={x.tradeId} className="flex items-start justify-between gap-4 py-1.5 px-2 rounded border-b border-white/[0.04] last:border-0">
                              <div className="min-w-0 text-sm">
                                <p className="text-slate-400 text-xs">{x.date.slice(0, 10)} · with {x.partner}</p>
                                <p className="text-white">Got: <span className="text-slate-300">{x.got.join(", ") || "—"}</span></p>
                                <p className="text-white">Gave: <span className="text-slate-300">{x.gave.join(", ") || "—"}</span></p>
                              </div>
                              <span className={cn("font-mono font-semibold text-sm shrink-0", netColor(x.net))}>{fmt(x.net)}</span>
                            </div>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
        <p className="text-[11px] text-slate-600 mt-4">
          Win/loss = net VORP beyond ±{EVEN_MARGIN}. Teams with fewer than {MIN_TRADES_FOR_GRADE} trades are not graded.
          Future picks without a draft result use a round-based estimate.
        </p>
      </CardContent>
    </Card>
  );
};

export default TradeGradesTab;
