import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { durabilityOf, type CalcAsset, type Durability as D } from "@/utils/marketCalc";

const TONE: Record<D["label"], string> = {
  Ironman: "text-emerald-400 border-emerald-400/30", Durable: "text-sky-400 border-sky-400/30",
  "Some risk": "text-amber-400 border-amber-400/30", "Injury-prone": "text-red-400 border-red-400/30",
};

/** Games missed per season from our own season stats (a stand-in for injury history, which we don't have). */
export function DurabilityCard({ players }: { players: Array<CalcAsset & { side: "get" | "give" }> }) {
  const names = players.map((p) => p.label);
  const { data } = useQuery({
    queryKey: ["durability", names.join("|")],
    enabled: names.length > 0,
    queryFn: async () => {
      const { data: rows } = await supabase.from("player_seasons" as never).select("player_name, year, games_played").in("player_name", names);
      const by = new Map<string, Array<{ year: number; games_played: number }>>();
      for (const r of (rows ?? []) as unknown as Array<{ player_name: string; year: number; games_played: number }>) {
        (by.get(r.player_name) ?? by.set(r.player_name, []).get(r.player_name)!).push(r);
      }
      return by;
    },
  });
  if (players.length === 0) return null;
  const year = new Date().getFullYear();
  return (
    <div className="rounded-xl border border-white/10 p-5 space-y-3">
      <div>
        <p className="text-sm font-bold">Durability</p>
        <p className="text-xs text-slate-500">Games missed per completed season. Seasons with no games between a player's first and last count as fully missed; this is not an injury report.</p>
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        {players.map((p) => {
          const d = data ? durabilityOf(data.get(p.label) ?? [], year) : null;
          return (
            <div key={p.key} className="rounded-lg border border-white/10 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold truncate">{p.label}</p>
                <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded border", p.side === "get" ? "text-sky-300 border-sky-400/30" : "text-red-300 border-red-400/30")}>{p.side === "get" ? "GET" : "GIVE"}</span>
              </div>
              {d ? (
                <>
                  <p className="mt-2 text-3xl font-bold font-mono">{d.score}<span className="text-xs text-slate-500 font-sans ml-1">/ 100</span></p>
                  <p className={cn("inline-block mt-1 text-xs rounded border px-1.5 py-0.5", TONE[d.label])}>{d.label}</p>
                  <p className="text-[11px] text-slate-500 mt-2">{d.avgMissed.toFixed(1)} games missed / season · {d.seasons} season{d.seasons === 1 ? "" : "s"}</p>
                </>
              ) : <p className="text-xs text-slate-500 mt-2">{data ? "No completed seasons on record" : "Loading…"}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
