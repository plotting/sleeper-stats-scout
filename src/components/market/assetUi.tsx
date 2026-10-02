import { useMemo, useState } from "react";
import { Target } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { CalcAsset } from "@/utils/marketCalc";
import { POS_BADGE } from "./assetData";

// Shared by the Trade Calculator and the Trade Market: player / pick rows with headshots, position
// badges, team and value, and the click-to-open search that lists everything richest first.

export function AssetIcon({ asset }: { asset: CalcAsset }) {
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
export function AssetLine({ asset, right }: { asset: CalcAsset; right?: React.ReactNode }) {
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
export function AssetSearch({ entries, taken, onAdd, placeholder = "Search players & picks…" }: { entries: CalcAsset[]; taken: Set<string>; onAdd: (a: CalcAsset) => void; placeholder?: string }) {
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
        placeholder={placeholder} value={text}
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


