import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Target } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { PlayerRow } from "@/components/market/assetData";
import type { CalcAsset } from "@/utils/marketCalc";

type Asset = { p: string } | { k: [number, number, number] } | { b: number };
interface Trade {
  id: number; traded_at: string; num_teams: number | null; superflex: boolean; ppr: number; te_premium: number;
  sides: Array<{ r: number; g: Asset[] }>;
}

const ordinal = (n: number) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);
const ago = (iso: string) => { const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); return d <= 0 ? "today" : `${d}d ago`; };

function Mini({ a, directory, hot }: { a: Asset; directory?: Map<string, PlayerRow>; hot?: boolean }) {
  if ("b" in a) return <div className="px-2 py-1 text-xs text-slate-400">${a.b} FAAB</div>;
  const isPlayer = "p" in a;
  const info = isPlayer ? directory?.get(a.p) : undefined;
  return (
    <div className={cn("flex items-center gap-2 rounded-md px-2 py-1", hot && "bg-white/[0.06]")}>
      {isPlayer ? (
        <span className="h-8 w-8 shrink-0 rounded-full bg-white/5 overflow-hidden ring-1 ring-white/10">
          <img src={`https://sleepercdn.com/content/nfl/players/thumb/${a.p}.jpg`} alt="" loading="lazy" className="h-full w-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} />
        </span>
      ) : (
        <span className="h-8 w-8 shrink-0 rounded-full bg-teal-500/10 flex items-center justify-center"><Target className="h-4 w-4 text-teal-400" /></span>
      )}
      <span className="text-sm text-white truncate">{isPlayer ? (info?.name ?? `Player ${a.p}`) : `${a.k[0]} ${ordinal(a.k[1])}`}</span>
    </div>
  );
}

function MiniCalc({ a }: { a: CalcAsset }) {
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1">
      {a.meta?.playerId ? (
        <span className="h-8 w-8 shrink-0 rounded-full bg-white/5 overflow-hidden ring-1 ring-white/10">
          <img src={`https://sleepercdn.com/content/nfl/players/thumb/${a.meta.playerId}.jpg`} alt="" loading="lazy" className="h-full w-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} />
        </span>
      ) : (
        <span className="h-8 w-8 shrink-0 rounded-full bg-teal-500/10 flex items-center justify-center"><Target className="h-4 w-4 text-teal-400" /></span>
      )}
      <span className="text-sm text-white truncate">{a.label}</span>
    </div>
  );
}

/** Real recent trades involving one of the trade's players, so a value can be checked against what managers actually did. */
export function PriceCheck({ players, directory, trade }: { players: CalcAsset[]; directory?: Map<string, PlayerRow>; trade: { get: CalcAsset[]; give: CalcAsset[] } }) {
  const [pick, setPick] = useState<string | null>(null);
  const chosen = players.find((p) => p.meta?.playerId === pick) ?? players[0];
  const id = chosen?.meta?.playerId;

  const { data } = useQuery({
    queryKey: ["price-check", id],
    enabled: !!id,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const [recent, count] = await Promise.all([
        supabase.from("market_trades" as never).select("id, traded_at, num_teams, superflex, ppr, te_premium, sides").contains("player_ids", [id]).order("traded_at", { ascending: false }).limit(6),
        supabase.from("market_trades" as never).select("id", { count: "exact", head: true }).contains("player_ids", [id]).gte("traded_at", since),
      ]);
      return { trades: (recent.data ?? []) as unknown as Trade[], last30: count.count ?? 0 };
    },
  });

  if (!chosen || !id) return null;
  const tag = (t: Trade) => `${t.num_teams ?? "?"}T ${t.superflex ? "SF" : "1QB"} · ${t.ppr >= 1 ? "PPR" : t.ppr > 0 ? "½PPR" : "Std"}${t.te_premium > 0 ? " · TE+" : ""}`;

  return (
    <div className="rounded-xl border border-white/10 p-5 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-bold">Price check: {chosen.label}</p>
          <p className="text-xs text-slate-500">{data ? `${data.last30} trade${data.last30 === 1 ? "" : "s"} in the last 30 days` : "Loading…"}</p>
        </div>
        {players.length > 1 && (
          <div className="flex gap-1 flex-wrap">
            {players.map((p) => (
              <button key={p.key} type="button" onClick={() => setPick(p.meta!.playerId!)}
                className={cn("text-xs rounded-full border px-2.5 py-1", p.meta?.playerId === id ? "border-sky-400/50 text-sky-300 bg-sky-400/10" : "border-white/10 text-slate-400 hover:text-white")}>
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-sky-400/20 bg-sky-400/[0.04] p-3">
        <p className="text-[10px] uppercase tracking-widest text-sky-400 mb-2">Your trade</p>
        <div className="grid md:grid-cols-2 gap-3">
          <div><p className="text-[11px] text-slate-500 mb-1">You get</p>{trade.get.map((a) => <MiniCalc key={a.key} a={a} />)}</div>
          <div><p className="text-[11px] text-slate-500 mb-1">You send</p>{trade.give.map((a) => <MiniCalc key={a.key} a={a} />)}</div>
        </div>
      </div>

      <p className="text-[10px] uppercase tracking-widest text-slate-500">Recent comparable trades</p>
      {data && data.trades.length === 0 && <p className="text-sm text-slate-500">No completed trades involving {chosen.label} in the collected data.</p>}
      <div className="grid md:grid-cols-2 gap-3">
        {data?.trades.map((t) => {
          const mine = t.sides.find((s) => s.g.some((a) => "p" in a && a.p === id)) ?? t.sides[0];
          const others = t.sides.filter((s) => s !== mine).flatMap((s) => s.g);
          return (
            <div key={t.id} className="rounded-lg border border-white/10 overflow-hidden">
              <div className="flex justify-between px-3 py-1.5 border-b border-white/5 text-[11px] text-slate-500"><span>{tag(t)}</span><span>{ago(t.traded_at)}</span></div>
              <div className="grid grid-cols-2 divide-x divide-white/5">
                <div className="p-2"><p className="text-[10px] font-bold tracking-wider text-emerald-400 mb-1">GOT</p>{mine.g.map((a, i) => <Mini key={i} a={a} directory={directory} hot={"p" in a && a.p === id} />)}</div>
                <div className="p-2"><p className="text-[10px] font-bold tracking-wider text-red-400 mb-1">SENT</p>{others.map((a, i) => <Mini key={i} a={a} directory={directory} />)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
