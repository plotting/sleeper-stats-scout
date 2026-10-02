import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import AdminGate from "@/components/admin/AdminGate";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
const POS_STYLE: Record<string, string> = {
  QB: "text-amber-400 bg-amber-400/10 border-amber-400/30",
  RB: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
  WR: "text-sky-400 bg-sky-400/10 border-sky-400/30",
  TE: "text-violet-400 bg-violet-400/10 border-violet-400/30",
};
const ordinal = (n: number) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);

/** "2027 1st", "2027 round 2" → pick key "2027-1". */
function parsePickQuery(q: string): string | null {
  const m = q.trim().match(/^(\d{4})\s*(?:round\s*)?(\d)(?:st|nd|rd|th)?$/i);
  return m ? `${m[1]}-${m[2]}` : null;
}

async function countOf(table: string, build?: (q: any) => any): Promise<number> { // eslint-disable-line @typescript-eslint/no-explicit-any
  let q = supabase.from(table as never).select("*", { count: "exact", head: true });
  if (build) q = build(q);
  const { count } = await q;
  return count ?? 0;
}


/** Latest fit quality per format plus the top fitted values, for reviewing the model as data grows. */
const FitReview = () => {
  const [open, setOpen] = useState(false);
  const { data: runs } = useQuery({
    queryKey: ["market-fit-runs"],
    queryFn: async () => {
      const { data } = await supabase.from("market_fit_runs" as never).select("*").order("ran_at", { ascending: false }).limit(20);
      const latest = new Map<string, FitRun>();
      for (const r of (data ?? []) as unknown as FitRun[]) if (!latest.has(r.format)) latest.set(r.format, r);
      return [...latest.values()];
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
      return { players, picks, names };
    },
  });
  if (!runs || runs.length === 0) {
    return <p className="text-xs text-slate-500 text-center">No value fit yet — it runs after each crawl once there are enough trades.</p>;
  }
  const pickLabel = (k: string) => { const [, off, rd] = k.split(":").map(Number); return `${off === 0 ? "This" : `+${off}yr`} ${ordinal(rd)}`; };
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
            {r.tiers && <p>{Object.entries(r.tiers).filter(([k]) => k in TIER_LABEL).map(([k, n]) => `${TIER_LABEL[k]} ${n}`).join(" · ")}</p>}
            {r.tiers && typeof r.tiers.lineup === "string" && <p>Weighted toward leagues with a {r.tiers.lineup} lineup</p>}
            {r.tiers && "vorp_r2" in r.tiers && <p>Recent VORP + age explain {Math.round(Number(r.tiers.vorp_r2) * 100)}% of player value ({String(r.tiers.vorp_players)} players); players with few trades lean on it</p>}
            {r.tiers && Object.keys(r.tiers).some((k) => k.startsWith("mv_")) && (
              <p>Market vs VORP: {Object.entries(r.tiers).filter(([k]) => k.startsWith("mv_")).map(([k, n]) => `${k.slice(3)} ${Number(n) > 0 ? "+" : ""}${n}%`).join(" · ")}</p>
            )}
            {r.tiers && "alpha" in r.tiers && Number(r.tiers.alpha) !== 1 && <p>Consolidation exponent {Number(r.tiers.alpha).toFixed(2)} {Number(r.tiers.alpha) > 1 ? "(stars beat several lesser pieces)" : "(plain sum)"}</p>}
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
            <p className="text-xs font-semibold text-sky-400 mb-1">Pick curve</p>
            {values.picks.sort((a, b) => a.asset_key.localeCompare(b.asset_key)).map((p) => (
              <div key={p.asset_key} className="flex justify-between text-xs py-0.5">
                <span>{pickLabel(p.asset_key)}</span>
                <span className="font-mono text-slate-400">{Math.round(p.value).toLocaleString()} <span className="text-slate-600">({p.n_trades})</span></span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
};

const TradeMarketInner = () => {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
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

  const { data, isLoading, error } = useQuery({
    queryKey: ["market-trades", query, limit, filters],
    queryFn: async () => {
      let q = applyFilters(
        supabase.from("market_trades" as never)
          .select(`*, market_trade_scores${filters.fair !== "any" ? "!inner" : ""}(${SCORE_COLS})`, { count: "exact" }).order("traded_at", { ascending: false }).limit(limit),
        filters,
      );
      let label = "Latest trades";
      const pickKey = parsePickQuery(query);
      if (pickKey) {
        q = q.contains("pick_keys", [pickKey]);
        label = `Trades involving a ${pickKey.slice(0, 4)} round ${pickKey.slice(5)} pick`;
      } else if (query.trim()) {
        const { data: found } = await supabase
          .from("sleeper_players" as never).select("player_id, name").ilike("name", `%${query.trim()}%`).limit(10);
        const ids = ((found ?? []) as unknown as Array<{ player_id: string }>).map((p) => p.player_id);
        if (ids.length === 0) return { label: `No player matches "${query}"`, trades: [] as MarketTrade[], players: new Map<string, PlayerInfo>(), total: 0 };
        q = q.overlaps("player_ids", ids);
        label = `Trades involving "${query.trim()}"`;
      }
      const { data: rows, error, count } = await q;
      if (error) throw error;
      const trades = (rows ?? []) as unknown as MarketTrade[];
      const ids = [...new Set(trades.flatMap((t) => t.player_ids))];
      const players = new Map<string, PlayerInfo>();
      for (let i = 0; i < ids.length; i += 100) {
        const { data: ps } = await supabase.from("sleeper_players" as never).select("player_id, name, position, team").in("player_id", ids.slice(i, i + 100));
        for (const p of (ps ?? []) as unknown as PlayerInfo[]) players.set(p.player_id, p);
      }
      return { label, trades, players, total: count ?? trades.length };
    },
  });

  const renderAsset = (a: Asset, players: Map<string, PlayerInfo>, i: number) => {
    if ("p" in a) {
      const info = players.get(a.p);
      return (
        <div key={i} className="flex items-center gap-2 py-1.5 px-2 border-b border-white/[0.04] last:border-0">
          <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded border", POS_STYLE[info?.position ?? ""] ?? "text-slate-400 border-white/10")}>
            {info?.position ?? "?"}
          </span>
          <span className="text-sm text-white">{info?.name ?? `Player ${a.p}`}</span>
          {info?.team && <span className="text-[10px] text-slate-500">{info.team}</span>}
        </div>
      );
    }
    if ("k" in a) {
      return (
        <div key={i} className="flex items-center gap-2 py-1.5 px-2 border-b border-white/[0.04] last:border-0">
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border text-indigo-300 bg-indigo-400/10 border-indigo-400/30">PK</span>
          <span className="text-sm text-white">{a.k[0]} {ordinal(a.k[1])}</span>
        </div>
      );
    }
    return (
      <div key={i} className="flex items-center gap-2 py-1.5 px-2">
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border text-slate-300 border-white/10">$</span>
        <span className="text-sm text-white">${a.b} FAAB</span>
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

      <form
        className="flex gap-2"
        onSubmit={(e) => { e.preventDefault(); setQuery(input); setLimit(PAGE); }}
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input className="pl-9" placeholder="Search a player or pick (e.g. Breece Hall, 2027 1st)…" value={input} onChange={(e) => setInput(e.target.value)} />
        </div>
        <Button type="submit">Search</Button>
      </form>

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
                    <div>{s.g.map((a, j) => renderAsset(a, data.players, j))}</div>
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
