import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import AdminGate from "@/components/admin/AdminGate";
import { AssetLine, AssetSearch } from "@/components/market/assetUi";
import { loadDirectory, loadValues, loadValuesAgo, useEntries } from "@/components/market/assetData";
import { pickKeyFor, valueChanges, type CalcAsset } from "@/utils/marketCalc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Hidden, admin-only page (not in the navigation; the tables are only readable by the admin).
// Browse the completed trades collected from similar public Sleeper dynasty leagues.

type Asset = { p: string } | { k: [number, number, number] } | { b: number };
interface MarketTrade {
  id: number;
  league_id: string;
  season: number;
  week: number | null;
  traded_at: string;
  num_teams: number | null;
  ppr: number;
  te_premium: number;
  sides: Array<{ r: number; g: Asset[] }>;
  player_ids: string[];
  pick_keys: string[];
  shape: string | null;
  market_trade_scores?: Score | Score[] | null;
}
interface Score { val_a: number; val_b: number; diff_pct: number; fair_tier: string }
interface FitRun {
  id: number; ran_at: string; format: string; n_trades: number; n_assets: number;
  in_sample_mean_gap: number | null; prior_mean_gap: number | null; holdout_mean_gap: number | null;
  holdout_coverage: number | null; tiers: Record<string, number | string> | null;
}
interface ValueRow { asset_key: string; value: number; n_trades: number }
const SCORE_COLS = "val_a, val_b, diff_pct, fair_tier";
const TIERS: Array<[string, string]> = [["any", "Any"], ["even", "Even"], ["close", "Close"], ["edge", "Clear winner"], ["lop", "Lopsided"]];
const TIER_STYLE: Record<string, string> = {
  even: "text-emerald-400 border-emerald-400/30", close: "text-sky-400 border-sky-400/30",
  edge: "text-amber-400 border-amber-400/30", lop: "text-red-400 border-red-400/30",
};
const TIER_LABEL: Record<string, string> = { even: "Dead even", close: "Close", edge: "Clear winner", lop: "Lopsided" };
const scoreOf = (t: MarketTrade): Score | null => (Array.isArray(t.market_trade_scores) ? t.market_trade_scores[0] : t.market_trade_scores) ?? null;
const pct = (x: number | null | undefined) => (x == null ? "–" : `${Number(x).toFixed(1)}%`);
interface PlayerInfo { player_id: string; name: string; position: string | null; team: string | null }

const PAGE = 20;

interface Filters { qb: string; ppr: string; tep: string; teams: string; shape: string; window: string; fair: string }
const DEFAULT_FILTERS: Filters = { qb: "any", ppr: "any", tep: "any", teams: "any", shape: "any", window: "all", fair: "any" };

const SHAPES = ["1-1", "2-1", "2-2", "3-1", "3-2", "3-3"];
const WINDOWS: Array<[string, string]> = [["all", "All time"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"], ["365", "Last year"]];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilters(q: any, f: Filters) {
  if (f.qb === "1qb") q = q.eq("superflex", false);
  if (f.qb === "sf") q = q.eq("superflex", true);
  if (f.ppr === "std") q = q.eq("ppr", 0);
  if (f.ppr === "half") q = q.eq("ppr", 0.5);
  if (f.ppr === "ppr") q = q.gte("ppr", 1);
  if (f.tep === "none") q = q.eq("te_premium", 0);
  if (f.tep === "tep") q = q.gt("te_premium", 0).lt("te_premium", 0.75);
  if (f.tep === "tepp") q = q.gte("te_premium", 0.75);
  if (f.teams !== "any") q = q.eq("num_teams", Number(f.teams));
  if (f.shape === "picks") q = q.eq("has_picks", true);
  else if (f.shape === "players") q = q.eq("has_picks", false);
  else if (f.shape !== "any") q = q.eq("shape", f.shape);
  if (f.fair !== "any") q = q.eq("market_trade_scores.fair_tier", f.fair);
  if (f.window !== "all") q = q.gte("traded_at", new Date(Date.now() - Number(f.window) * 86400000).toISOString());
  return q;
}

function Segmented({ label, value, options, onChange }: {
  label?: string; value: string; options: Array<[string, string]>; onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {label && <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>}
      <div className="flex gap-0.5 rounded-lg border border-white/10 p-0.5">
        {options.map(([key, text]) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={cn(
              "px-2.5 py-1 text-xs rounded-md transition-colors",
              value === key ? "bg-white/10 text-white font-medium" : "text-slate-400 hover:text-white",
            )}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
const ordinal = (n: number) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);

async function countOf(table: string, build?: (q: any) => any): Promise<number> { // eslint-disable-line @typescript-eslint/no-explicit-any
  let q = supabase.from(table as never).select("*", { count: "exact", head: true });
  if (build) q = build(q);
  const { count } = await q;
  return count ?? 0;
}


/** Pick prices three ways, each with the player rank it is equivalent to ("≈ #27" = priced like the 27th most valuable player). */
const PickTable = ({ rows, playerValues }: { rows: Map<string, { value: number; n: number }>; playerValues: number[] }) => {
  const rank = (v: number) => `≈ #${playerValues.filter((x) => x > v).length + 1}`;
  const cell = (key: string) => {
    const r = rows.get(key);
    return r ? (
      <span className="font-mono">{Math.round(r.value).toLocaleString()} <span className="text-slate-600">{rank(r.value)}</span></span>
    ) : <span className="text-slate-700">–</span>;
  };
  const rounds = [1, 2, 3].filter((r) => rows.has(`pk:0:${r}`) || rows.has(`pk:1:${r}`) || rows.has(`vp:${r}:any`));
  const head = "text-[10px] uppercase tracking-wide text-slate-500";
  return (
    <div className="space-y-3 text-xs text-slate-400">
      <div>
        <p className={head}>What trades pay (market fit)</p>
        <div className="grid grid-cols-[3rem_1fr_1fr_1fr] gap-x-2 gap-y-0.5 mt-1">
          <span /><span className={head}>This class</span><span className={head}>+1 yr</span><span className={head}>+2 yr</span>
          {rounds.map((r) => (
            <div key={r} className="contents">
              <span className="text-slate-300">{ordinal(r)}</span>{cell(`pk:0:${r}`)}{cell(`pk:1:${r}`)}{cell(`pk:2:${r}`)}
            </div>
          ))}
        </div>
      </div>
      <div>
        <p className={head}>What picks actually produced (your drafts, as trade value)</p>
        <div className="grid grid-cols-[3rem_1fr_1fr_1fr_1fr] gap-x-2 gap-y-0.5 mt-1">
          <span /><span className={head}>Early 1-3</span><span className={head}>Mid 4-6</span><span className={head}>Late 7-10</span><span className={head}>Average</span>
          {rounds.map((r) => (
            <div key={r} className="contents">
              <span className="text-slate-300">{ordinal(r)}</span>{cell(`vp:${r}:early`)}{cell(`vp:${r}:mid`)}{cell(`vp:${r}:late`)}{cell(`vp:${r}:any`)}
            </div>
          ))}
        </div>
        <p className={cn(head, "mt-2")}>By slot, 1st round</p>
        <div className="grid grid-cols-5 gap-x-2 gap-y-0.5 mt-1">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((slot) => (
            <div key={slot}><span className="text-slate-600">1.{String(slot).padStart(2, "0")}</span> {cell(`vp:1:s${slot}`)}</div>
          ))}
        </div>
        <p className="text-slate-600 mt-1">Picks behind each average: {rounds.map((r) => `${ordinal(r)} ${rows.get(`vp:${r}:any`)?.n ?? 0}`).join(" · ")}</p>
      </div>
    </div>
  );
};

/** Latest fit quality per format plus the top fitted values, for reviewing the model as data grows. */
const FitReview = () => {
  const [open, setOpen] = useState(false);
  const { data: fit } = useQuery({
    queryKey: ["market-fit-runs"],
    queryFn: async () => {
      const { data } = await supabase.from("market_fit_runs" as never).select("*").order("ran_at", { ascending: false }).limit(20);
      const latest = new Map<string, FitRun>();
      const history = new Map<string, number[]>(); // held-out gap per run, newest first
      for (const r of (data ?? []) as unknown as FitRun[]) {
        if (!latest.has(r.format)) latest.set(r.format, r);
        if (r.holdout_mean_gap != null) history.set(r.format, [...(history.get(r.format) ?? []), Number(r.holdout_mean_gap)]);
      }
      return { runs: [...latest.values()], history };
    },
  });
  const { data: values } = useQuery({
    queryKey: ["market-values"],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase.from("market_values" as never).select("asset_key, value, n_trades").eq("format", "1qb").order("value", { ascending: false }).limit(400);
      const rows = (data ?? []) as unknown as ValueRow[];
      const players = rows.filter((r) => r.asset_key.startsWith("p:") && r.n_trades >= 10).slice(0, 25);
      const picks = rows.filter((r) => r.asset_key.startsWith("pk:"));
      const { data: ps } = await supabase.from("sleeper_players" as never).select("player_id, name, position")
        .in("player_id", players.map((p) => p.asset_key.slice(2)));
      const names = new Map(((ps ?? []) as unknown as PlayerInfo[]).map((p) => [p.player_id, p]));
      const allPlayerValues = rows.filter((r) => r.asset_key.startsWith("p:") && r.n_trades >= 10).map((r) => Number(r.value)).sort((x, y) => y - x);
      return { players, picks, names, allPlayerValues };
    },
  });
  const { data: pickRows } = useQuery({
    queryKey: ["market-pick-rows"],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase.from("market_values" as never).select("asset_key, value, n_trades").eq("format", "1qb").or("asset_key.like.pk:*,asset_key.like.vp:*");
      return new Map(((data ?? []) as unknown as ValueRow[]).map((r) => [r.asset_key, { value: Number(r.value), n: r.n_trades }]));
    },
  });
  const runs = fit?.runs;
  if (!runs || runs.length === 0) {
    return <p className="text-xs text-slate-500 text-center">No value fit yet — it runs after each crawl once there are enough trades.</p>;
  }
  return (
    <Card className="p-4 border-white/10 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Value fit</p>
        <button type="button" onClick={() => setOpen(!open)} className="text-xs text-blue-400 hover:underline">{open ? "Hide values" : "Show values"}</button>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {runs.map((r) => (
          <div key={r.id} className="text-xs text-slate-400 space-y-1">
            <p className="text-slate-200 font-medium">{r.format === "sf" ? "Superflex" : "1QB"} · {r.n_trades.toLocaleString()} trades · {r.n_assets.toLocaleString()} assets · {new Date(r.ran_at).toLocaleDateString()}</p>
            <p>Avg gap: fit {pct(r.in_sample_mean_gap)} (guess-everything-equal {pct(r.prior_mean_gap)})</p>
            <p>Held-out gap: {pct(r.holdout_mean_gap)}{r.holdout_coverage != null && ` · ${Math.round(r.holdout_coverage * 100)}% of held-out trades fully valued`}</p>
            {(fit?.history.get(r.format)?.length ?? 0) > 1 && (
              <p title="Newest first. Lower is better; a steady rise means the model or the data got worse">
                Held-out gap, recent fits: {fit!.history.get(r.format)!.slice(0, 8).map((g) => `${g.toFixed(1)}%`).join(" ← ")}
              </p>
            )}
            {r.tiers && <p>{Object.entries(r.tiers).filter(([k]) => k in TIER_LABEL).map(([k, n]) => `${TIER_LABEL[k]} ${n}`).join(" · ")}</p>}
            {r.tiers && typeof r.tiers.lineup === "string" && <p>Weighted toward leagues with a {r.tiers.lineup} lineup</p>}
            {r.tiers && "vorp_r2" in r.tiers && <p>Recent VORP + age explain {Math.round(Number(r.tiers.vorp_r2) * 100)}% of player value ({String(r.tiers.vorp_players)} players); players with few trades lean on it</p>}
            {r.tiers && Object.keys(r.tiers).some((k) => k.startsWith("mv_")) && (
              <p>Market vs VORP: {Object.entries(r.tiers).filter(([k]) => k.startsWith("mv_")).map(([k, n]) => `${k.slice(3)} ${Number(n) > 0 ? "+" : ""}${n}%`).join(" · ")}</p>
            )}
            {r.tiers && "rho_players" in r.tiers && (
              <p>Depth: each extra player on a side counts ×{Number(r.tiers.rho_players).toFixed(2)} of the one before (richest first); extra picks ×{Number(r.tiers.rho_picks).toFixed(2)}</p>
            )}
            {r.tiers && Object.keys(r.tiers).some((k) => k.startsWith("sb_")) && (
              <p title="Measured from accepted trades where the many-piece side's pieces are much lesser than the other side's best asset: how much richer its plain sum was. The calculator, trade finder and trade scores apply it only in that case (scaled by how lesser the pieces are), so a star is not undervalued against a pile of scraps but two starters for one is not penalised">
                Consolidation premium (applied when the extra pieces are much lesser): {Object.entries(r.tiers).filter(([k]) => k.startsWith("sb_")).sort(([a], [b]) => a.localeCompare(b))
                  .map(([k, n]) => `${k.slice(3).replace("-", "-for-")} ${Number(n) > 0 ? "+" : ""}${n}% (${r.tiers![`sbn_${k.slice(3)}`]})`).join(" · ")}
              </p>
            )}
          </div>
        ))}
      </div>
      {open && values && (
        <div className="grid md:grid-cols-2 gap-6 pt-2 border-t border-white/5">
          <div>
            <p className="text-xs font-semibold text-sky-400 mb-1">Top players (1QB, 10+ trades)</p>
            {values.players.map((p) => (
              <div key={p.asset_key} className="flex justify-between text-xs py-0.5">
                <span>{values.names.get(p.asset_key.slice(2))?.name ?? p.asset_key} <span className="text-slate-500">{values.names.get(p.asset_key.slice(2))?.position}</span></span>
                <span className="font-mono text-slate-400">{Math.round(p.value).toLocaleString()} <span className="text-slate-600">({p.n_trades})</span></span>
              </div>
            ))}
          </div>
          <div>
            <p className="text-xs font-semibold text-sky-400 mb-1">Pick values</p>
            {pickRows ? <PickTable rows={pickRows} playerValues={values.players.length ? values.allPlayerValues : []} /> : <p className="text-xs text-slate-500">Loading…</p>}
          </div>
        </div>
      )}
    </Card>
  );
};

/** Biggest risers and fallers in fitted value over the last week or month (needs a few days of saved history). */
const Movers = ({ entries, values }: { entries: CalcAsset[]; values: Map<string, { value: number; n_trades: number }> | undefined }) => {
  const [days, setDays] = useState(7);
  const { data: ago, isLoading } = useQuery({ queryKey: ["calc-values-ago", "1qb", days], queryFn: () => loadValuesAgo("1qb", days), staleTime: 60 * 60 * 1000 });
  const list = useMemo(() => {
    if (!values || !ago) return null;
    const ch = valueChanges(new Map([...values].map(([k, v]) => [k, v.value])), ago.values);
    const rows = entries.filter((a) => a.meta?.playerId && a.value >= 500 && a.nTrades >= 3 && ch.has(a.key))
      .map((a) => ({ a: { ...a, meta: { ...a.meta, change: ch.get(a.key)! } }, pct: ch.get(a.key)!, abs: a.value - (ago.values.get(a.key) ?? a.value) }));
    const by = (f: (x: typeof rows[number]) => number) => [...rows].sort((x, y) => f(y) - f(x));
    return { up: by((r) => r.abs).filter((r) => r.abs > 0).slice(0, 8), down: by((r) => -r.abs).filter((r) => r.abs < 0).slice(0, 8) };
  }, [entries, values, ago]);
  return (
    <Card className="p-4 border-white/10 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Movers</p>
        <Segmented value={String(days)} options={[["7", "7 days"], ["30", "30 days"]]} onChange={(v) => setDays(Number(v))} />
      </div>
      {isLoading ? <p className="text-xs text-slate-500">Loading…</p> : !list ? (
        <p className="text-xs text-slate-500">Not enough history yet — values are saved after every fit, so movers appear once there is a {days}-day-old snapshot.</p>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          {([["Rising", list.up, "text-emerald-400"], ["Falling", list.down, "text-red-400"]] as const).map(([label, rows, color]) => (
            <div key={label} className="space-y-2">
              <p className={cn("text-xs font-semibold", color)}>{label}</p>
              {rows.length === 0 && <p className="text-xs text-slate-500">None</p>}
              {rows.map((r) => <AssetLine key={r.a.key} asset={r.a} right={<span className={cn("text-xs font-mono w-16 text-right", color)}>{r.abs > 0 ? "+" : "−"}{Math.abs(Math.round(r.abs)).toLocaleString()}</span>} />)}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

const TradeMarketInner = () => {
  const [asset, setAsset] = useState<CalcAsset | null>(null); // player or pick the trades are filtered to
  const [limit, setLimit] = useState(PAGE);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const setFilter = (key: keyof Filters, value: string) => { setFilters((f) => ({ ...f, [key]: value })); setLimit(PAGE); };
  const filtersOn = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS);

  const { data: stats } = useQuery({
    queryKey: ["market-stats"],
    queryFn: async () => ({
      trades: await countOf("market_trades"),
      leagues: await countOf("market_leagues"),
      matched: await countOf("market_leagues", (q) => q.eq("matches", true)),
      users: await countOf("market_seen_users"),
      visited: await countOf("market_seen_users", (q) => q.not("crawled_at", "is", null)),
    }),
  });

  const { data: directory } = useQuery({ queryKey: ["calc-directory"], queryFn: loadDirectory, staleTime: 60 * 60 * 1000 });
  const { data: values } = useQuery({ queryKey: ["calc-values", "1qb"], queryFn: () => loadValues("1qb") });
  const entries = useEntries(values, directory);
  const searchable = useMemo(() => entries.filter((a) => a.meta?.playerId || a.meta?.pickKey), [entries]);
  const rankOf = useMemo(() => new Map(entries.filter((a) => a.meta?.rank).map((a) => [a.key, a.meta!.rank!])), [entries]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["market-trades", asset?.key ?? "", limit, filters],
    queryFn: async () => {
      let q = applyFilters(
        supabase.from("market_trades" as never)
          .select(`*, market_trade_scores${filters.fair !== "any" ? "!inner" : ""}(${SCORE_COLS})`, { count: "exact" }).order("traded_at", { ascending: false }).limit(limit),
        filters,
      );
      let label = "Latest trades";
      if (asset?.meta?.pickKey) {
        q = q.contains("pick_keys", [asset.meta.pickKey]);
        label = `Trades involving a ${asset.label} pick`;
      } else if (asset?.meta?.playerId) {
        q = q.contains("player_ids", [asset.meta.playerId]);
        label = `Trades involving ${asset.label}`;
      }
      const { data: rows, error, count } = await q;
      if (error) throw error;
      const trades = (rows ?? []) as unknown as MarketTrade[];
      return { label, trades, total: count ?? trades.length };
    },
  });

  // Same rows as the calculator: headshot, badge, name, rank / team / age and the fitted value.
  const renderAsset = (a: Asset, t: MarketTrade, i: number) => {
    if ("b" in a) {
      return (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300">
          <span className="h-11 w-11 shrink-0 rounded-full bg-white/5 flex items-center justify-center text-slate-400 font-bold">$</span>
          ${a.b} FAAB
        </div>
      );
    }
    let asset: CalcAsset;
    if ("p" in a) {
      const key = `p:${a.p}`;
      const info = directory?.get(a.p);
      asset = {
        key, label: info?.name ?? `Player ${a.p}`, value: values?.get(key)?.value ?? 0, nTrades: values?.get(key)?.n_trades ?? 0,
        meta: { playerId: a.p, position: info?.position, team: info?.team, age: info?.age, rank: rankOf.get(key) },
      };
    } else {
      const key = pickKeyFor(a.k[0], a.k[1], t.traded_at);
      asset = { key, label: `${a.k[0]} ${ordinal(a.k[1])}`, value: values?.get(key)?.value ?? 0, nTrades: values?.get(key)?.n_trades ?? 0 };
    }
    return (
      <div key={i} className="rounded-lg border border-white/10 px-3 py-2">
        <AssetLine asset={asset} />
      </div>
    );
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header className="text-center space-y-2">
        <h1 className="text-3xl font-bold">Trade Market</h1>
        <p className="text-slate-400 text-sm">Completed trades from public dynasty leagues with settings like ours (admin only).</p>
      </header>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
          {([
            ["Trades", stats.trades], ["Leagues seen", stats.leagues], ["Similar leagues", stats.matched],
            ["Accounts found", stats.users], ["Accounts visited", stats.visited],
          ] as const).map(([label, n]) => (
            <Card key={label} className="p-3 border-white/10">
              <p className="text-xl font-bold font-mono">{n.toLocaleString()}</p>
              <p className="text-[11px] text-slate-500">{label}</p>
            </Card>
          ))}
        </div>
      )}

      <FitReview />

      <Movers entries={entries} values={values} />

      <div className="space-y-2">
        <AssetSearch
          entries={searchable} taken={new Set()} placeholder="Filter trades by a player or pick…"
          onAdd={(a) => { setAsset(a); setLimit(PAGE); }}
        />
        {asset && (
          <button
            type="button" onClick={() => { setAsset(null); setLimit(PAGE); }}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1 text-xs text-slate-200 hover:bg-white/5"
          >
            {asset.label} <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Segmented value={filters.qb} onChange={(v) => setFilter("qb", v)} options={[["any", "Any"], ["1qb", "1QB"], ["sf", "SF"]]} />
        <Segmented value={filters.ppr} onChange={(v) => setFilter("ppr", v)} options={[["any", "Any"], ["std", "Std"], ["half", "½"], ["ppr", "PPR"]]} />
        <Segmented value={filters.tep} onChange={(v) => setFilter("tep", v)} options={[["any", "Any"], ["none", "None"], ["tep", "TE+"], ["tepp", "TE++"]]} />
        <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500">
          Teams
          <select
            value={filters.teams}
            onChange={(e) => setFilter("teams", e.target.value)}
            className="bg-transparent border border-white/10 rounded-md px-2 py-1 text-xs normal-case text-slate-200"
          >
            {["any", "8", "10", "12"].map((t) => <option key={t} value={t} className="bg-slate-900">{t === "any" ? "Any" : t}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500">
          Shape
          <select
            value={filters.shape}
            onChange={(e) => setFilter("shape", e.target.value)}
            className="bg-transparent border border-white/10 rounded-md px-2 py-1 text-xs normal-case text-slate-200"
          >
            <option value="any" className="bg-slate-900">Any</option>
            {SHAPES.map((sh) => <option key={sh} value={sh} className="bg-slate-900">{sh.replace("-", " for ")}</option>)}
            <option value="picks" className="bg-slate-900">Picks involved</option>
            <option value="players" className="bg-slate-900">Players only</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500">
          Window
          <select
            value={filters.window}
            onChange={(e) => setFilter("window", e.target.value)}
            className="bg-transparent border border-white/10 rounded-md px-2 py-1 text-xs normal-case text-slate-200"
          >
            {WINDOWS.map(([k, t]) => <option key={k} value={k} className="bg-slate-900">{t}</option>)}
          </select>
        </label>
        <Segmented label="Fairness" value={filters.fair} onChange={(v) => setFilter("fair", v)} options={TIERS} />
        {filtersOn && (
          <button type="button" onClick={() => { setFilters(DEFAULT_FILTERS); setLimit(PAGE); }} className="text-xs text-blue-400 hover:underline">
            Reset filters
          </button>
        )}
      </div>

      {isLoading && <p className="text-center text-slate-500 text-sm animate-pulse py-8">Loading…</p>}
      {error && (
        <p className="text-center text-red-400 text-sm py-8">
          Couldn't load trades: {error instanceof Error ? error.message : String(error)}. Run the trade-market migration and make sure you're signed in as admin.
        </p>
      )}

      {data && (
        <div className="space-y-4">
          <p className="text-sm text-slate-400">{data.label} · {data.total.toLocaleString()} trades · showing 1–{data.trades.length}</p>
          {data.trades.length === 0 && !isLoading && <p className="text-center text-slate-500 py-8">No trades match.</p>}
          {data.trades.map((t) => (
            <Card key={t.id} className="border-white/10 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 text-xs text-slate-400">
                <span>{new Date(t.traded_at).toLocaleDateString()} · {t.season}{t.week ? ` wk ${t.week}` : ""}</span>
                <span className="flex gap-1.5">
                  {scoreOf(t) && (
                    <span className={cn("px-1.5 py-0.5 rounded border", TIER_STYLE[scoreOf(t)!.fair_tier])}>
                      {TIER_LABEL[scoreOf(t)!.fair_tier]} · {pct(scoreOf(t)!.diff_pct)} gap
                    </span>
                  )}
                  {t.shape && <span className="px-1.5 py-0.5 rounded border border-white/10">{t.shape.replace("-", " for ")}</span>}
                  {t.num_teams && <span className="px-1.5 py-0.5 rounded border border-white/10">{t.num_teams}T</span>}
                  <span className="px-1.5 py-0.5 rounded border border-white/10">{t.ppr > 0 ? `${t.ppr} PPR` : "No PPR"}</span>
                  {t.te_premium > 0 && <span className="px-1.5 py-0.5 rounded border border-white/10">TE+</span>}
                </span>
              </div>
              <div className={cn("grid gap-6 p-4", t.sides.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3")}>
                {t.sides.map((s, i) => (
                  <div key={s.r}>
                    <p className="text-xs font-semibold text-sky-400 mb-2">
                      Team {String.fromCharCode(65 + i)} receives
                      {scoreOf(t) && t.sides.length === 2 && (
                        <span className="ml-2 font-mono text-slate-400">{(i === 0 ? scoreOf(t)!.val_a : scoreOf(t)!.val_b).toLocaleString()}</span>
                      )}
                    </p>
                    <div>{s.g.map((a, j) => renderAsset(a, t, j))}</div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
          {data.trades.length >= limit && (
            <div className="text-center"><Button variant="outline" onClick={() => setLimit(limit + PAGE)}>Load more</Button></div>
          )}
        </div>
      )}
    </div>
  );
};

const TradeMarket = () => (
  <AdminGate>
    <TradeMarketInner />
  </AdminGate>
);

export default TradeMarket;
