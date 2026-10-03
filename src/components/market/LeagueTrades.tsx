import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { displayDesc, nameKey, parseResolvedPick } from "@/utils/dynastyValue";
import { assess, TIER_LABEL, type CalcAsset, type Depth } from "@/utils/marketCalc";
import { loadValuesOn } from "./assetData";

interface Item { item_type: string; item_description: string; to_team_id: number | null }
interface LeagueTrade { id: number; trade_date: string; team1_id: number; team2_id: number; trade_items: Item[] }
interface DraftPick { season_id: number; round: number; pick_number: number; player_name: string }

const ordinal = (n: number) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);
const PAGE = 15;

async function all<T>(table: string, columns: string, order: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table as never).select(columns).order(order, { ascending: false }).range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * Every trade in the league priced at today's market values (the same values and consolidation premium as the calculator):
 * a hindsight view of who came out ahead. A pick that has since been used is priced as the player it became; players with
 * no current value (retired, never valued) count as zero and are marked.
 */
export function LeagueTrades({ entries, depth, onOpen }: { entries: CalcAsset[]; depth: Depth; onOpen: (receive: CalcAsset[], send: CalcAsset[]) => void }) {
  const [open, setOpen] = useState(false);
  const [shownCount, setShownCount] = useState(PAGE);
  const { data } = useQuery({
    queryKey: ["calc-league-trades-all"],
    enabled: open,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const trades: LeagueTrade[] = [];
      for (let from = 0; ; from += 500) {
        const { data: page, error } = await supabase.from("trades" as never)
          .select("id, trade_date, team1_id, team2_id, trade_items(item_type, item_description, to_team_id)")
          .order("trade_date", { ascending: false }).range(from, from + 499);
        if (error) throw error;
        trades.push(...((page ?? []) as unknown as LeagueTrade[]));
        if (!page || page.length < 500) break;
      }
      const [{ data: teams }, { data: seasons }, picks] = await Promise.all([
        supabase.from("teams").select("id, name"),
        supabase.from("seasons").select("id, year"),
        all<DraftPick>("draft_picks", "season_id, round, pick_number, player_name", "id"),
      ]);
      return {
        trades,
        names: new Map((teams ?? []).map((t) => [t.id, t.name])),
        seasonByYear: new Map((seasons ?? []).map((s) => [s.year, s.id])),
        drafted: new Map(picks.map((p) => [`${p.season_id}:${p.round}:${p.pick_number}`, p.player_name])),
      };
    },
  });

  // Market values as they stood on each trade's date, for trades made since the daily value history began
  const { data: snapshots } = useQuery({
    queryKey: ["calc-trade-snapshots", data?.trades.length ?? 0],
    enabled: !!data,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data: first } = await supabase.from("market_value_history" as never).select("as_of").eq("format", "1qb").order("as_of", { ascending: true }).limit(1);
      const firstDay = (first as unknown as Array<{ as_of: string }> | null)?.[0]?.as_of;
      const out = new Map<string, { asOf: string; values: Map<string, number> }>();
      if (!firstDay) return out;
      const days = [...new Set((data?.trades ?? []).map((t) => t.trade_date.slice(0, 10)).filter((d) => d >= firstDay))].slice(0, 40);
      await Promise.all(days.map(async (d) => { const snap = await loadValuesOn("1qb", d, 7); if (snap) out.set(d, snap); }));
      return out;
    },
  });

  const byName = useMemo(() => new Map(entries.filter((e) => e.meta?.playerId).map((e) => [nameKey(e.label), e])), [entries]);
  const byLabel = useMemo(() => new Map(entries.filter((e) => e.meta?.pickKey).map((e) => [e.label, e])), [entries]);

  const graded = useMemo(() => (data?.trades ?? []).map((t) => {
    type Line = { asset: CalcAsset; note?: string };
    const got: Record<number, Line[]> = { [t.team1_id]: [], [t.team2_id]: [] };
    for (const it of t.trade_items ?? []) {
      if (it.to_team_id == null || !got[it.to_team_id]) continue;
      const unvalued = (label: string, note: string): Line => ({ asset: { key: `x:${label}`, label, value: 0, nTrades: 0 }, note });
      let line: Line;
      if (it.item_type === "player") {
        const a = byName.get(nameKey(it.item_description));
        line = a ? { asset: a } : unvalued(displayDesc(it.item_description), "no current value");
      } else {
        const fut = displayDesc(it.item_description).match(/^(\d{4}) (\d+)(?:st|nd|rd|th) Round/);
        const done = parseResolvedPick(it.item_description);
        if (done) {
          const sid = data?.seasonByYear.get(done.year);
          const who = sid != null ? data?.drafted.get(`${sid}:${done.round}:${done.overall}`) : undefined;
          const a = who ? byName.get(nameKey(who)) : undefined;
          line = a ? { asset: a, note: `pick ${done.year} ${done.round}.${String(done.pick).padStart(2, "0")}` } : unvalued(who ? `${who} (${done.year} ${done.round}.${String(done.pick).padStart(2, "0")})` : displayDesc(it.item_description), "no current value");
        } else if (fut) {
          const a = byLabel.get(`${fut[1]} ${ordinal(Number(fut[2]))}`);
          line = a ? { asset: a } : unvalued(displayDesc(it.item_description), "pick not priceable");
        } else line = unvalued(displayDesc(it.item_description), "not priceable");
      }
      got[it.to_team_id].push(line);
    }
    const priced = (ls: Line[]) => ls.map((l) => l.asset).filter((a) => a.value > 0);
    const g1 = got[t.team1_id], g2 = got[t.team2_id];
    const r = priced(g1).length + priced(g2).length > 0 ? assess(priced(g1), priced(g2), depth) : null;
    // the same trade at the market values of its day (players and upcoming picks only; a pick that was still a pick then is priced by round and years ahead)
    let then: ReturnType<typeof assess> | null = null;
    const snap = snapshots?.get(t.trade_date.slice(0, 10));
    if (snap && g1.length + g2.length > 0) {
      const asOfYear = Number(snap.asOf.slice(0, 4));
      const at = (l: Line): CalcAsset | null => {
        const a = l.asset;
        const key = a.key.startsWith("p:") ? a.key : a.meta?.pickKey ? `pk:${Number(a.meta.pickKey.split("-")[0]) - asOfYear}:${a.meta.pickKey.split("-")[1]}` : null;
        const v = key ? snap.values.get(key) : undefined;
        return v && !l.note?.startsWith("pick ") ? { key: a.key, label: a.label, value: v, nTrades: 0 } : null; // a used pick was a different asset then
      };
      const t1 = g1.map(at), t2 = g2.map(at);
      if (t1.every(Boolean) && t2.every(Boolean)) then = assess(t1 as CalcAsset[], t2 as CalcAsset[], depth);
    }
    return { t, g1, g2, r, then, priced1: priced(g1), priced2: priced(g2) };
  }), [data, byName, byLabel, depth, snapshots]);

  // per-team record across every trade: net value gained (after the premium) and trades won
  const table = useMemo(() => {
    const m = new Map<number, { id: number; trades: number; wins: number; losses: number; net: number }>();
    const row = (id: number) => m.get(id) ?? (m.set(id, { id, trades: 0, wins: 0, losses: 0, net: 0 }), m.get(id)!);
    for (const { t, r } of graded) {
      if (!r) continue;
      const a = row(t.team1_id), b = row(t.team2_id);
      a.trades++; b.trades++; a.net += r.gap; b.net -= r.gap;
      if (r.tier !== "even") { if (r.gap > 0) { a.wins++; b.losses++; } else { b.wins++; a.losses++; } }
    }
    return [...m.values()].sort((x, y) => y.net - x.net);
  }, [graded]);

  const name = (id: number) => data?.names.get(id) ?? `Team ${id}`;
  return (
    <Card className="border-white/10 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">League trade grades</p>
          <p className="text-[11px] text-slate-500">Every trade, priced at today's market values (hindsight, not what they were worth then). Used picks count as the player they became; players with no current value count as zero.</p>
        </div>
        <button type="button" onClick={() => setOpen(!open)} className="text-xs text-blue-400 hover:underline">{open ? "Hide" : "Show"}</button>
      </div>
      {open && !data && <p className="text-xs text-slate-500 animate-pulse">Loading every trade…</p>}
      {open && data && graded.length === 0 && <p className="text-xs text-slate-500">No trades found.</p>}
      {open && table.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-slate-500"><th className="font-normal py-1">Team</th><th className="font-normal text-right">Trades</th><th className="font-normal text-right">Won</th><th className="font-normal text-right">Lost</th><th className="font-normal text-right" title="Sum of the value edge (after the consolidation premium) across all graded trades">Net value</th></tr></thead>
            <tbody>
              {table.map((r) => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="py-1 text-slate-200">{name(r.id)}</td>
                  <td className="text-right font-mono text-slate-400">{r.trades}</td>
                  <td className="text-right font-mono text-emerald-400">{r.wins}</td>
                  <td className="text-right font-mono text-red-400">{r.losses}</td>
                  <td className={cn("text-right font-mono", r.net >= 0 ? "text-emerald-400" : "text-red-400")}>{r.net >= 0 ? "+" : "−"}{Math.round(Math.abs(r.net)).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && graded.slice(0, shownCount).map(({ t, g1, g2, r, then, priced1, priced2 }) => {
        const n1 = name(t.team1_id), n2 = name(t.team2_id);
        const winner = r && r.tier !== "even" ? (r.winner === "you" ? n1 : n2) : null;
        const list = (ls: typeof g1) => ls.length === 0 ? "—" : ls.map((l, i) => (
          <span key={i}>{i > 0 && ", "}{l.asset.label} <span className={l.asset.value > 0 ? "text-slate-500" : "text-amber-400/80"}>({l.asset.value > 0 ? Math.round(l.asset.value).toLocaleString() : l.note})</span>{l.asset.value > 0 && l.note ? <span className="text-slate-600"> · {l.note}</span> : null}</span>
        ));
        return (
          <div key={t.id} className="rounded-lg border border-white/10 px-3 py-2 flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1 space-y-1 text-xs">
              <p className="text-[11px] text-slate-500">{new Date(t.trade_date).toLocaleDateString()}</p>
              <p><span className="text-slate-300 font-medium">{n1}</span> <span className="text-slate-500">got</span> {list(g1)}</p>
              <p><span className="text-slate-300 font-medium">{n2}</span> <span className="text-slate-500">got</span> {list(g2)}</p>
            </div>
            {r && (
              <div className="text-right text-xs">
                <p className={cn("font-semibold", winner ? "text-amber-300" : "text-emerald-400")}>{winner ? `${winner} won` : TIER_LABEL.even}</p>
                <p className="text-slate-500">{r.tier === "even" ? "" : `${TIER_LABEL[r.tier]} · `}{r.diffPct.toFixed(0)}% gap</p>
                {then && (
                  <p className="text-[10px] text-slate-600 mt-1" title="The same trade at market values on the day it happened (from the daily value history)">
                    At the time: {then.tier === "even" ? "even" : `${then.winner === "you" ? n1 : n2} won · ${then.diffPct.toFixed(0)}%`}
                    {then.tier !== "even" && r.tier !== "even" && then.winner !== r.winner && <span className="text-amber-400/80"> · flipped</span>}
                  </p>
                )}
              </div>
            )}
            {r && <Button size="sm" variant="outline" onClick={() => onOpen(priced1, priced2)}>Open</Button>}
          </div>
        );
      })}
      {open && graded.length > shownCount && (
        <Button variant="outline" size="sm" onClick={() => setShownCount((n) => n + PAGE)}>Show more ({graded.length - shownCount} left)</Button>
      )}
    </Card>
  );
}
