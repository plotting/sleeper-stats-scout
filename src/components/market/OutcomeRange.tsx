import { cn } from "@/lib/utils";
import { AssetLine } from "@/components/market/assetUi";
import { outcomeRange, rankEquivalent, type CalcAsset, type Outcome } from "@/utils/marketCalc";

/** Ceiling / expected / floor for each player entering next season, with breakout and bust odds. */
export function OutcomeRangeCard({ players, entries, vol }: { players: Array<CalcAsset & { side: "get" | "give" }>; entries: CalcAsset[]; vol: Map<string, Outcome> }) {
  const rows = players.flatMap((p) => { const r = outcomeRange(p, vol); return r ? [{ p, r }] : []; });
  if (rows.length === 0) return null;
  const box = (label: string, hint: string, a: CalcAsset, value: number, tone: string) => (
    <div className={cn("rounded-lg border p-3", tone)}>
      <p className="text-[10px] uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-[10px] text-slate-500">{hint}</p>
      <p className="text-xl font-bold mt-1">{rankEquivalent(entries, a.meta!.position!, value)}</p>
      <p className="font-mono text-sm opacity-90">{Math.round(value).toLocaleString()}</p>
    </div>
  );
  return (
    <div className="rounded-xl border border-white/10 p-5 space-y-4">
      <div>
        <p className="text-sm font-bold">Outcome range</p>
        <p className="text-xs text-slate-500">Where each player's trade value could be entering next season, from how players of the same position and age have actually moved year to year. Green = breakout odds (value up 10%+), blue = steady, red = bust odds (down 15%+).</p>
      </div>
      {rows.map(({ p, r }) => {
        const steady = Math.max(0, 1 - r.up - r.down);
        return (
          <div key={p.key} className="rounded-lg border border-white/10 p-3 space-y-3">
            <div className="flex items-center gap-3">
              <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", p.side === "get" ? "bg-sky-400/10 text-sky-300" : "bg-red-400/10 text-red-300")}>{p.side === "get" ? "IN" : "OUT"}</span>
              <div className="flex-1 min-w-0"><AssetLine asset={p} /></div>
              <p className="text-xs whitespace-nowrap"><span className="text-emerald-400">↑{Math.round(r.up * 100)}%</span> <span className="text-red-400">↓{Math.round(r.down * 100)}%</span></p>
            </div>
            <div className="flex h-2 rounded-full overflow-hidden">
              <div className="bg-emerald-500" style={{ width: `${r.up * 100}%` }} />
              <div className="bg-sky-500" style={{ width: `${steady * 100}%` }} />
              <div className="bg-red-500" style={{ width: `${r.down * 100}%` }} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {box("Ceiling", "~10% chance", p, r.ceiling, "border-emerald-500/20 bg-emerald-500/[0.04] text-emerald-300")}
              {box("Expected", "most likely", p, r.expected, "border-sky-500/20 bg-sky-500/[0.04] text-sky-300")}
              {box("Floor", "~10% chance", p, r.floor, "border-red-500/20 bg-red-500/[0.04] text-red-300")}
            </div>
            <p className="text-[10px] text-slate-600">Based on {r.n.toLocaleString()} past seasons of {p.meta?.position} players this age.</p>
          </div>
        );
      })}
    </div>
  );
}
