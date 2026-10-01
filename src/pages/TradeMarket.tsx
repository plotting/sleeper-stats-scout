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
}
interface PlayerInfo { player_id: string; name: string; position: string | null; team: string | null }

const PAGE = 20;
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

const TradeMarketInner = () => {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);

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
    queryKey: ["market-trades", query, limit],
    queryFn: async () => {
      let q = supabase.from("market_trades" as never).select("*").order("traded_at", { ascending: false }).limit(limit);
      let label = "Latest trades";
      const pickKey = parsePickQuery(query);
      if (pickKey) {
        q = q.contains("pick_keys", [pickKey]);
        label = `Trades involving a ${pickKey.slice(0, 4)} round ${pickKey.slice(5)} pick`;
      } else if (query.trim()) {
        const { data: found } = await supabase
          .from("sleeper_players" as never).select("player_id, name").ilike("name", `%${query.trim()}%`).limit(10);
        const ids = ((found ?? []) as unknown as Array<{ player_id: string }>).map((p) => p.player_id);
        if (ids.length === 0) return { label: `No player matches "${query}"`, trades: [] as MarketTrade[], players: new Map<string, PlayerInfo>() };
        q = q.overlaps("player_ids", ids);
        label = `Trades involving "${query.trim()}"`;
      }
      const { data: rows, error } = await q;
      if (error) throw error;
      const trades = (rows ?? []) as unknown as MarketTrade[];
      const ids = [...new Set(trades.flatMap((t) => t.player_ids))];
      const players = new Map<string, PlayerInfo>();
      for (let i = 0; i < ids.length; i += 100) {
        const { data: ps } = await supabase.from("sleeper_players" as never).select("player_id, name, position, team").in("player_id", ids.slice(i, i + 100));
        for (const p of (ps ?? []) as unknown as PlayerInfo[]) players.set(p.player_id, p);
      }
      return { label, trades, players };
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

      {isLoading && <p className="text-center text-slate-500 text-sm animate-pulse py-8">Loading…</p>}
      {error && (
        <p className="text-center text-red-400 text-sm py-8">
          Couldn't load trades: {error instanceof Error ? error.message : String(error)}. Run the trade-market migration and make sure you're signed in as admin.
        </p>
      )}

      {data && (
        <div className="space-y-4">
          <p className="text-sm text-slate-400">{data.label} · showing {data.trades.length}</p>
          {data.trades.length === 0 && !isLoading && <p className="text-center text-slate-500 py-8">No trades yet.</p>}
          {data.trades.map((t) => (
            <Card key={t.id} className="border-white/10 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 text-xs text-slate-400">
                <span>{new Date(t.traded_at).toLocaleDateString()} · {t.season}{t.week ? ` wk ${t.week}` : ""}</span>
                <span className="flex gap-1.5">
                  {t.num_teams && <span className="px-1.5 py-0.5 rounded border border-white/10">{t.num_teams}T</span>}
                  <span className="px-1.5 py-0.5 rounded border border-white/10">{t.ppr > 0 ? `${t.ppr} PPR` : "No PPR"}</span>
                  {t.te_premium > 0 && <span className="px-1.5 py-0.5 rounded border border-white/10">TE+</span>}
                </span>
              </div>
              <div className={cn("grid gap-6 p-4", t.sides.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3")}>
                {t.sides.map((s, i) => (
                  <div key={s.r}>
                    <p className="text-xs font-semibold text-sky-400 mb-2">Team {String.fromCharCode(65 + i)} receives</p>
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
