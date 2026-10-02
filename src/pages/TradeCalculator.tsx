import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Target, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import AdminGate from "@/components/admin/AdminGate";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { assess, effectiveValue, sideTotal, pickOptions, suggestToEven, TIER_LABEL, type CalcAsset } from "@/utils/marketCalc";

// Hidden, admin-only page: prices a trade with the values fitted from completed market trades
// (market_values). Players only appear once they've been in enough trades to get a value.

interface ValueRow { asset_key: string; value: number; n_trades: number }
interface PlayerRow { player_id: string; name: string; position: string | null; team: string | null; age: number | null }

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

const POS_BADGE: Record<string, string> = {
  QB: "text-red-400 bg-red-500/15 border-red-500/30",
  RB: "text-emerald-400 bg-emerald-500/15 border-emerald-500/30",
  WR: "text-sky-400 bg-sky-500/15 border-sky-500/30",
  TE: "text-orange-400 bg-orange-500/15 border-orange-500/30",
};

async function loadDirectory(): Promise<Map<string, PlayerRow>> {
  const out = new Map<string, PlayerRow>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("sleeper_players" as never).select("player_id, name, position, team, age").order("player_id").range(from, from + 999);
    if (error) throw error;
    for (const p of (data ?? []) as unknown as PlayerRow[]) out.set(p.player_id, p);
    if (!data || data.length < 1000) break;
  }
  return out;
}

function AssetIcon({ asset }: { asset: CalcAsset }) {
  const id = asset.meta?.playerId;
  if (!id) {
    return <span className="h-11 w-11 shrink-0 rounded-full bg-teal-500/10 flex items-center justify-center"><Target className="h-5 w-5 text-teal-400" /></span>;
  }
  return (
    <span className="h-11 w-11 shrink-0 rounded-md bg-white/5 overflow-hidden">
      <img
        src={`https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`} alt="" loading="lazy" className="h-full w-full object-cover"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
      />
    </span>
  );
}

/** One player or pick: headshot / target icon, position badge, name, rank · team · age, value. */
function AssetLine({ asset, right }: { asset: CalcAsset; right?: React.ReactNode }) {
  const m = asset.meta;
  const detail = [m?.rank, m?.team, m?.age ? `${m.age}y` : null].filter(Boolean).join(" · ");
  return (
    <div className="flex items-center gap-3">
      <AssetIcon asset={asset} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {m?.position && <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded border", POS_BADGE[m.position] ?? "text-slate-400 border-white/10")}>{m.position}</span>}
          <span className="text-sm font-semibold text-white truncate">{asset.label}</span>
          {asset.nTrades < 3 && asset.meta?.playerId && <span className="text-[10px] text-amber-400" title="Few completed trades behind this value">low data</span>}
        </div>
        {detail && <p className="text-[11px] text-slate-500 mt-0.5">{detail}</p>}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="font-mono text-sm text-slate-200">{Math.round(asset.value).toLocaleString()}</span>
        {right}
      </div>
    </div>
  );
}

/** Opens on focus with everything sorted by value (like Roster Audit); typing filters by name. */
function AssetSearch({ entries, taken, onAdd }: { entries: CalcAsset[]; taken: Set<string>; onAdd: (a: CalcAsset) => void }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const q = text.trim().toLowerCase();
  const hits = useMemo(
    () => entries.filter((a) => !taken.has(a.key) && (q === "" || a.label.toLowerCase().includes(q))).slice(0, 60),
    [entries, taken, q],
  );
  return (
    <div className="relative">
      <Input
        placeholder="Search players & picks…" value={text}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)} // click too: after a pick the box keeps focus, so no focus event fires
        onBlur={() => setOpen(false)} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
      />
      {open && (
        <div
          className="absolute z-20 left-0 right-0 mt-1 max-h-96 overflow-y-auto rounded-lg border border-white/10 bg-[#0e1018] shadow-xl divide-y divide-white/5"
          onMouseDown={(e) => e.preventDefault()} // keep focus so a click registers before the list closes
        >
          {hits.map((a) => (
            <button key={a.key} type="button" onClick={() => { onAdd(a); setText(""); setOpen(false); }} className="w-full px-3 py-2 text-left hover:bg-white/5">
              <AssetLine asset={a} />
            </button>
          ))}
          {hits.length === 0 && <p className="px-3 py-3 text-xs text-slate-500">No match</p>}
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
        <span className="font-mono text-lg font-bold text-emerald-400">{Math.round(total).toLocaleString()}</span>
      </div>
      {children}
      <div className="space-y-1.5 min-h-[3rem]">
        {assets.map((a) => (
          <div key={a.key} className="rounded-lg border border-white/10 px-3 py-2">
            <AssetLine asset={a} right={<button type="button" onClick={() => onRemove(a.key)} aria-label={`Remove ${a.label}`} className="text-slate-500 hover:text-white"><X className="h-4 w-4" /></button>} />
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
  const [vorpPct, setVorpPct] = useState<number>(() => {
    try { const v = Number(localStorage.getItem("calc-vorp-weight")); return Number.isFinite(v) && v >= 0 && v <= 100 && localStorage.getItem("calc-vorp-weight") !== null ? v : 50; } catch { return 50; }
  });
  const [pickPct, setPickPct] = useState<number>(() => {
    try { const raw = localStorage.getItem("calc-pick-scale"); const v = Number(raw); return raw !== null && Number.isFinite(v) && v >= 50 && v <= 250 ? v : 100; } catch { return 100; }
  });
  const setPick = (n: number) => { setPickPct(n); try { localStorage.setItem("calc-pick-scale", String(n)); } catch { /* optional */ } };
  const setVorp = (n: number) => { setVorpPct(n); try { localStorage.setItem("calc-vorp-weight", String(n)); } catch { /* optional */ } };
  const { data: raw, isLoading, error } = useQuery({ queryKey: ["calc-values", format], queryFn: () => loadValues(format) });
  // Player values blended between the market (fit to trades) and the VORP + age baseline.
  const values = useMemo(() => {
    if (!raw) return undefined;
    const out = new Map<string, { value: number; n_trades: number }>();
    const w = vorpPct / 100;
    for (const [key, v] of raw) {
      if (key.startsWith("v:") || key.startsWith("vp:")) continue;
      const baseline = key.startsWith("p:") ? raw.get(`v:${key.slice(2)}`)?.value : undefined;
      let priced = effectiveValue({ key, value: v.value, nTrades: v.n_trades, baseline }, w);
      if (key.startsWith("pk:")) {
        // Picks: scale the market value by how a typical pick of that round actually turned out (outcome
        // value vs what this class trades for), then split by slot tier (early / mid / late in the round).
        const round = key.split(":")[2];
        const vpAny = raw.get(`vp:${round}:any`)?.value;
        const m0 = raw.get(`pk:0:${round}`)?.value;
        if (vpAny && m0) priced *= Math.pow(vpAny / m0, w);
        for (const tier of ["early", "mid", "late"]) {
          const vpT = raw.get(`vp:${round}:${tier}`)?.value;
          if (vpAny && vpT) out.set(`${key}:${tier}`, { value: priced * (vpT / vpAny) * (pickPct / 100), n_trades: v.n_trades });
        }
        priced *= pickPct / 100;
      }
      out.set(key, { value: priced, n_trades: v.n_trades });
    }
    for (const [key, v] of raw) if (key.startsWith("v:") && !out.has(`p:${key.slice(2)}`)) out.set(`p:${key.slice(2)}`, { value: v.value, n_trades: 0 });
    return out;
  }, [raw, vorpPct, pickPct]);
  const reprice = (a: CalcAsset): CalcAsset => ({ ...a, value: values?.get(a.key)?.value ?? a.value });

  const { data: directory } = useQuery({ queryKey: ["calc-directory"], queryFn: loadDirectory, staleTime: 60 * 60 * 1000 });
  // Every player with a value, plus the pick options, richest first (this is what the search lists).
  const entries = useMemo(() => {
    if (!values) return [] as CalcAsset[];
    const players: CalcAsset[] = [];
    for (const [key, v] of values) {
      if (!key.startsWith("p:")) continue;
      const info = directory?.get(key.slice(2));
      if (!info || !["QB", "RB", "WR", "TE"].includes(info.position ?? "")) continue;
      players.push({ key, label: info.name, value: v.value, nTrades: v.n_trades, meta: { playerId: info.player_id, position: info.position, team: info.team, age: info.age } });
    }
    const byPos = new Map<string, CalcAsset[]>();
    for (const a of players) (byPos.get(a.meta!.position!) ?? byPos.set(a.meta!.position!, []).get(a.meta!.position!)!).push(a);
    for (const [pos, list] of byPos) list.sort((x, y) => y.value - x.value).forEach((a, i) => { a.meta!.rank = `${pos}${i + 1}`; });
    return [...players, ...pickOptions(new Date(), values)].sort((x, y) => y.value - x.value);
  }, [values, directory]);
  const taken = useMemo(() => new Set([...receive, ...send].map((a) => a.key)), [receive, send]);
  const alpha = values?.get("cfg:alpha")?.value ?? 1;
  const receiveP = receive.map(reprice);
  const sendP = send.map(reprice);
  const result = assess(receiveP, sendP, alpha);
  const names = useMemo(
    () => (receive.length + send.length > 0 && result.tier !== "even" ? suggestToEven(result.gap, entries, taken) : []),
    [entries, taken, result.gap, result.tier, receive.length, send.length],
  );

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
        <div className="flex items-center justify-center gap-3 text-xs text-slate-400">
          <span>Market</span>
          <input type="range" min={0} max={100} step={5} value={vorpPct} onChange={(e) => setVorp(Number(e.target.value))} className="w-40" aria-label="VORP weight" />
          <span>VORP</span>
          <span className="font-mono text-slate-200 w-10 text-left">{vorpPct}%</span>
        </div>
        <div className="flex items-center justify-center gap-3 text-xs text-slate-400">
          <span>Pick value</span>
          <input type="range" min={50} max={250} step={5} value={pickPct} onChange={(e) => setPick(Number(e.target.value))} className="w-40" aria-label="Pick value multiplier" />
          <span className="font-mono text-slate-200 w-12 text-left">×{(pickPct / 100).toFixed(2)}</span>
        </div>
        <p className="text-[10px] text-slate-600">build {__BUILD_ID__}</p>
        <p className="text-[11px] text-slate-500">Player values blend what trades pay with what recent VORP + age imply; picks are priced by how rookie picks of that round and slot actually turned out, times the pick multiplier.</p>
      </header>

      {isLoading && <p className="text-center text-slate-500 text-sm animate-pulse">Loading values…</p>}
      {error && <p className="text-center text-red-400 text-sm">Couldn't load values: {error instanceof Error ? error.message : String(error)}. Run the value-fit migration and sign in as admin.</p>}
      {values && values.size === 0 && <p className="text-center text-slate-500 text-sm">No fitted values for this format yet — they appear after the crawler's fit step runs.</p>}

      {values && values.size > 0 && (
        <>
          <Card className="border-white/10 p-5 grid md:grid-cols-2 gap-8">
            <Side title="You receive" assets={receiveP} alpha={alpha} onRemove={remove(setReceive)}>
              <AssetSearch entries={entries} taken={taken} onAdd={add(setReceive)} />
            </Side>
            <Side title="You send" assets={sendP} alpha={alpha} onRemove={remove(setSend)}>
              <AssetSearch entries={entries} taken={taken} onAdd={add(setSend)} />
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

          {!empty && result.tier !== "even" && names.length > 0 && (
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
