import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { nameKey } from "@/utils/dynastyValue";
import { assess, TIER_LABEL, type CalcAsset, type Depth } from "@/utils/marketCalc";

interface Item { item_type: string; item_description: string; to_team_id: number | null }
interface LeagueTrade { id: number; trade_date: string; team1_id: number; team2_id: number; trade_items: Item[] }

const ordinal = (n: number) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);

/** Recent trades in this league priced at today's market values (the same values and consolidation premium as the calculator). */
export function LeagueTrades({ entries, depth, onOpen }: { entries: CalcAsset[]; depth: Depth; onOpen: (receive: CalcAsset[], send: CalcAsset[]) => void }) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["calc-league-trades"],
    enabled: open,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const since = new Date(Date.now() - 548 * 86400000).toISOString();
      const [{ data: trades, error }, { data: teams }] = await Promise.all([
        supabase.from("trades" as never).select("id, trade_date, team1_id, team2_id, trade_items(item_type, item_description, to_team_id)").gte("trade_date", since).order("trade_date", { ascending: false }).limit(40),
        supabase.from("teams").select("id, name"),
      ]);
      if (error) throw error;
      return { trades: (trades ?? []) as unknown as LeagueTrade[], names: new Map((teams ?? []).map((t) => [t.id, t.name])) };
    },
  });

  const byName = useMemo(() => new Map(entries.filter((e) => e.meta?.playerId).map((e) => [nameKey(e.label), e])), [entries]);
  const byLabel = useMemo(() => new Map(entries.filter((e) => e.meta?.pickKey).map((e) => [e.label, e])), [entries]);

  const rows = useMemo(() => (data?.trades ?? []).map((t) => {
    const priced: Record<number, CalcAsset[]> = { [t.team1_id]: [], [t.team2_id]: [] };
    let unpriced = 0;
    for (const it of t.trade_items ?? []) {
      let asset: CalcAsset | undefined;
      if (it.item_type === "player") asset = byName.get(nameKey(it.item_description));
      else {
        const m = it.item_description.match(/^(\d{4}) (\d+)(?:st|nd|rd|th) Round/);
        if (m) asset = byLabel.get(`${m[1]} ${ordinal(Number(m[2]))}`);
      }
      if (asset && it.to_team_id != null && priced[it.to_team_id]) priced[it.to_team_id].push(asset); else unpriced++;
    }
    const got1 = priced[t.team1_id], got2 = priced[t.team2_id];
    return { t, got1, got2, unpriced, r: got1.length + got2.length > 0 ? assess(got1, got2, depth) : null };
  }), [data, byName, byLabel, depth]);

  return (
    <Card className="border-white/10 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Recent league trades</p>
          <p className="text-[11px] text-slate-500">Priced at today's market values (not what they were worth then). Players and upcoming picks only; spent picks and unvalued players are left out.</p>
        </div>
        <button type="button" onClick={() => setOpen(!open)} className="text-xs text-blue-400 hover:underline">{open ? "Hide" : "Show"}</button>
      </div>
      {open && !data && <p className="text-xs text-slate-500 animate-pulse">Loading…</p>}
      {open && data && rows.length === 0 && <p className="text-xs text-slate-500">No trades in the last 18 months.</p>}
      {open && rows.map(({ t, got1, got2, unpriced, r }) => {
        const n1 = data!.names.get(t.team1_id) ?? `Team ${t.team1_id}`, n2 = data!.names.get(t.team2_id) ?? `Team ${t.team2_id}`;
        const winner = r && r.tier !== "even" ? (r.winner === "you" ? n1 : n2) : null;
        return (
          <div key={t.id} className="rounded-lg border border-white/10 px-3 py-2 flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1 space-y-1 text-xs">
              <p className="text-[11px] text-slate-500">{new Date(t.trade_date).toLocaleDateString()}</p>
              <p><span className="text-slate-300 font-medium">{n1}</span> <span className="text-slate-500">got</span> {got1.map((a) => `${a.label} (${Math.round(a.value).toLocaleString()})`).join(", ") || "—"}</p>
              <p><span className="text-slate-300 font-medium">{n2}</span> <span className="text-slate-500">got</span> {got2.map((a) => `${a.label} (${Math.round(a.value).toLocaleString()})`).join(", ") || "—"}</p>
              {unpriced > 0 && <p className="text-[10px] text-amber-400/80">{unpriced} item{unpriced > 1 ? "s" : ""} couldn't be priced</p>}
            </div>
            {r && (
              <div className="text-right text-xs">
                <p className={cn("font-semibold", winner ? "text-amber-300" : "text-emerald-400")}>{winner ? `${winner} won` : TIER_LABEL.even}</p>
                <p className="text-slate-500">{r.tier === "even" ? "" : `${TIER_LABEL[r.tier]} · `}{r.diffPct.toFixed(0)}% gap</p>
              </div>
            )}
            {r && <Button size="sm" variant="outline" onClick={() => onOpen(got1, got2)}>Open</Button>}
          </div>
        );
      })}
    </Card>
  );
}
