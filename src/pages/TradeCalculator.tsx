import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import AdminGate from "@/components/admin/AdminGate";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { assess, sideTotal, pickOptions, suggestToEven, TIER_LABEL, type CalcAsset } from "@/utils/marketCalc";

// Hidden, admin-only page: prices a trade with the values fitted from completed market trades
// (market_values). Players only appear once they've been in enough trades to get a value.

interface ValueRow { asset_key: string; value: number; n_trades: number }
interface PlayerRow { player_id: string; name: string; position: string | null; team: string | null }

const TIER_STYLE: Record<string, string> = {
  even: "text-emerald-400 border-emerald-400/40 bg-emerald-400/10",
  close: "text-sky-400 border-sky-400/40 bg-sky-400/10",
  edge: "text-amber-400 border-amber-400/40 bg-amber-400/10",
  lop: "text-red-400 border-red-400/40 bg-red-400/10",
};

async function loadValues(format: string): Promise<Map<string, { value: number; n_trades: number }>> {
  const out = new Map<string, { value: number; n_trades: number }>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("market_values" as never).select("asset_key, value, n_trades").eq("format", format).range(from, from + 999);
    if (error) throw error;
    for (const r of (data ?? []) as unknown as ValueRow[]) out.set(r.asset_key, { value: Number(r.value), n_trades: r.n_trades });
    if (!data || data.length < 1000) break;
  }
  return out;
}

function AssetSearch({ values, picks, taken, onAdd }: {
  values: Map<string, { value: number; n_trades: number }>; picks: CalcAsset[]; taken: Set<string>; onAdd: (a: CalcAsset) => void;
}) {
  const [text, setText] = useState("");
  const q = text.trim().toLowerCase();
  const { data: players } = useQuery({
    queryKey: ["calc-player-search", q],
    enabled: q.length >= 2,
    queryFn: async () => {
      const { data } = await supabase.from("sleeper_players" as never).select("player_id, name, position, team").ilike("name", `%${q}%`).limit(25);
      return (data ?? []) as unknown as PlayerRow[];
    },
  });
  const pickHits = picks.filter((p) => !taken.has(p.key) && (q === "" || p.label.toLowerCase().includes(q)));
  const playerHits = (players ?? []).filter((p) => !taken.has(`p:${p.player_id}`));
  return (
    <div className="space-y-2">
      <Input placeholder="Search players & picks…" value={text} onChange={(e) => setText(e.target.value)} />
      {(q.length >= 2 || q === "") && (
        <div className="max-h-48 overflow-y-auto rounded-md border border-white/10 divide-y divide-white/5">
          {pickHits.map((p) => (
            <button key={p.key} type="button" onClick={() => { onAdd(p); setText(""); }} className="w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-white/5">
              <span>{p.label} <span className="text-[10px] text-slate-500">Pick</span></span>
              <span className="font-mono text-xs text-slate-400">{Math.round(p.value).toLocaleString()}</span>
            </button>
          ))}
          {playerHits.map((p) => {
            const v = values.get(`p:${p.player_id}`);
            return (
              <button
                key={p.player_id} type="button" disabled={!v}
                onClick={() => { if (v) { onAdd({ key: `p:${p.player_id}`, label: p.name, sub: [p.position, p.team].filter(Boolean).join(" · "), value: v.value, nTrades: v.n_trades }); setText(""); } }}
                className="w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-white/5 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <span>{p.name} <span className="text-[10px] text-slate-500">{p.position} {p.team}</span></span>
                <span className="font-mono text-xs text-slate-400">{v ? Math.round(v.value).toLocaleString() : "no trades yet"}</span>
              </button>
            );
          })}
          {pickHits.length === 0 && playerHits.length === 0 && <p className="px-3 py-2 text-xs text-slate-500">{q.length >= 2 ? "No match" : "Type to search"}</p>}
        </div>
      )}
    </div>
  );
}

function Side({ title, assets, alpha, onRemove, children }: { title: string; assets: CalcAsset[]; alpha: number; onRemove: (key: string) => void; children: React.ReactNode }) {
  const total = sideTotal(assets, alpha);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-bold tracking-widest text-slate-400 uppercase">{title}</h2>
        <span className="font-mono text-sm">{Math.round(total).toLocaleString()}</span>
      </div>
      {children}
      <div className="space-y-1 min-h-[3rem]">
        {assets.map((a) => (
          <div key={a.key} className="flex items-center justify-between rounded-md border border-white/10 px-3 py-1.5 text-sm">
            <span>
              {a.label} {a.sub && <span className="text-[10px] text-slate-500">{a.sub}</span>}
              {a.nTrades < 3 && <span className="ml-1 text-[10px] text-amber-400" title="Few completed trades behind this value">low data</span>}
            </span>
            <span className="flex items-center gap-2">
              <span className="font-mono text-xs text-slate-300">{Math.round(a.value).toLocaleString()}</span>
              <button type="button" onClick={() => onRemove(a.key)} aria-label={`Remove ${a.label}`} className="text-slate-500 hover:text-white"><X className="h-3.5 w-3.5" /></button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const Calculator = () => {
  const [format, setFormat] = useState<"1qb" | "sf">("1qb");
  const [receive, setReceive] = useState<CalcAsset[]>([]);
  const [send, setSend] = useState<CalcAsset[]>([]);
  const { data: values, isLoading, error } = useQuery({ queryKey: ["calc-values", format], queryFn: () => loadValues(format) });

  const picks = useMemo(() => (values ? pickOptions(new Date(), values) : []), [values]);
  const taken = useMemo(() => new Set([...receive, ...send].map((a) => a.key)), [receive, send]);
  const alpha = values?.get("cfg:alpha")?.value ?? 1;
  const result = assess(receive, send, alpha);
  const pool = useMemo(() => {
    if (!values) return [] as CalcAsset[];
    return [...values].map(([key, v]) => ({ key, label: key, value: v.value, nTrades: v.n_trades })).filter((a) => a.key.startsWith("p:") || picks.some((p) => p.key === a.key));
  }, [values, picks]);
  const { data: names } = useQuery({
    queryKey: ["calc-suggest-names", result.gap > 0 ? "send" : "recv", Math.round(result.gap)],
    enabled: values !== undefined && receive.length + send.length > 0 && result.tier !== "even",
    queryFn: async () => {
      const top = suggestToEven(result.gap, pool, taken);
      const ids = top.filter((a) => a.key.startsWith("p:")).map((a) => a.key.slice(2));
      const { data } = ids.length ? await supabase.from("sleeper_players" as never).select("player_id, name, position, team").in("player_id", ids) : { data: [] };
      const byId = new Map(((data ?? []) as unknown as PlayerRow[]).map((p) => [p.player_id, p]));
      return top.map((a): CalcAsset => {
        const pick = picks.find((p) => p.key === a.key);
        if (pick) return pick;
        const p = byId.get(a.key.slice(2));
        return { ...a, label: p?.name ?? a.key, sub: [p?.position, p?.team].filter(Boolean).join(" · ") };
      });
    },
  });

  const add = (set: typeof setReceive) => (a: CalcAsset) => set((xs) => (xs.some((x) => x.key === a.key) ? xs : [...xs, a]));
  const remove = (set: typeof setReceive) => (key: string) => set((xs) => xs.filter((x) => x.key !== key));
  const empty = receive.length + send.length === 0;
  // If you're ahead, ask them for more; if you're behind, you add to what you send… from your side's view.
  const suggestSide = result.gap > 0 ? "you could add to what you send" : "you could ask for";

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header className="text-center space-y-2">
        <h1 className="text-3xl font-bold">Trade Calculator</h1>
        <p className="text-slate-400 text-sm">Values fitted from completed trades in similar public leagues (admin only).</p>
        <div className="inline-flex gap-0.5 rounded-lg border border-white/10 p-0.5">
          {(["1qb", "sf"] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFormat(f)}
              className={cn("px-3 py-1 text-xs rounded-md", format === f ? "bg-white/10 text-white font-medium" : "text-slate-400 hover:text-white")}>
              {f === "1qb" ? "1QB" : "Superflex"}
            </button>
          ))}
        </div>
      </header>

      {isLoading && <p className="text-center text-slate-500 text-sm animate-pulse">Loading values…</p>}
      {error && <p className="text-center text-red-400 text-sm">Couldn't load values: {error instanceof Error ? error.message : String(error)}. Run the value-fit migration and sign in as admin.</p>}
      {values && values.size === 0 && <p className="text-center text-slate-500 text-sm">No fitted values for this format yet — they appear after the crawler's fit step runs.</p>}

      {values && values.size > 0 && (
        <>
          <Card className="border-white/10 p-5 grid md:grid-cols-2 gap-8">
            <Side title="You receive" assets={receive} alpha={alpha} onRemove={remove(setReceive)}>
              <AssetSearch values={values} picks={picks} taken={taken} onAdd={add(setReceive)} />
            </Side>
            <Side title="You send" assets={send} alpha={alpha} onRemove={remove(setSend)}>
              <AssetSearch values={values} picks={picks} taken={taken} onAdd={add(setSend)} />
            </Side>
          </Card>

          {!empty && (
            <Card className={cn("p-5 border text-center space-y-1", TIER_STYLE[result.tier])}>
              <p className="text-lg font-bold">{TIER_LABEL[result.tier]} · {result.diffPct.toFixed(1)}% gap</p>
              <p className="text-sm opacity-90">
                {result.winner === null ? "Both sides are worth the same."
                  : result.winner === "you" ? `You come out ahead by ${Math.round(result.gap).toLocaleString()}.`
                  : `They come out ahead by ${Math.round(-result.gap).toLocaleString()}.`}
              </p>
            </Card>
          )}

          {!empty && result.tier !== "even" && names && names.length > 0 && (
            <Card className="border-white/10 p-4 space-y-2">
              <p className="text-xs text-slate-400">To even it out, {suggestSide}:</p>
              <div className="flex flex-wrap gap-2">
                {names.map((a) => (
                  <button key={a.key} type="button" onClick={() => (result.gap > 0 ? add(setSend) : add(setReceive))(a)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1 text-xs hover:bg-white/5">
                    <Plus className="h-3 w-3" /> {a.label} <span className="font-mono text-slate-500">{Math.round(a.value).toLocaleString()}</span>
                  </button>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

const TradeCalculator = () => (
  <AdminGate>
    <Calculator />
  </AdminGate>
);

export default TradeCalculator;
