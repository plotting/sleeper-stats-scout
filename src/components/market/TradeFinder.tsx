import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { findOffers, type CalcAsset, type Depth, type Offer } from "@/utils/marketCalc";
import { AssetLine, AssetSearch } from "./assetUi";

export interface FinderTeam { rosterId: number; name: string; assets: CalcAsset[] }

/**
 * League-mode trade finder. Sell: pick something you own and see what each leaguemate could pay for it from their roster.
 * Buy: pick something a leaguemate owns and see what you could send for it. Offers are value-matched only (the lineup
 * check comes once you load one into the calculator).
 */
export function TradeFinder({ you, others, depth, onUse, lineupDelta }: {
  you: FinderTeam; others: FinderTeam[]; depth: Depth;
  /** Change in each team's best-lineup score (starter VORP) if `receive` came to you and `send` went to that partner. */
  lineupDelta?: (partnerRosterId: number, receive: CalcAsset[], send: CalcAsset[]) => { you: number; them: number } | null;
  onUse: (partnerRosterId: number, receive: CalcAsset[], send: CalcAsset[]) => void;
}) {
  const [mode, setMode] = useState<"sell" | "buy">("sell");
  const [target, setTarget] = useState<CalcAsset | null>(null);
  const [tol, setTol] = useState(10);
  const [sort, setSort] = useState<"value" | "me" | "both">("value");
  const ownerOf = useMemo(() => new Map(others.flatMap((t) => t.assets.map((a) => [a.key, t] as const))), [others]);
  const pool = useMemo(() => (mode === "sell" ? you.assets : others.flatMap((t) => t.assets).sort((a, b) => b.value - a.value)), [mode, you, others]);

  type Row = { team: FinderTeam; offer: Offer; d: { you: number; them: number } | null };
  const withLineup = (team: FinderTeam, offer: Offer): Row => ({ team, offer, d: target && lineupDelta ? (mode === "sell" ? lineupDelta(team.rosterId, offer.assets, [target]) : lineupDelta(team.rosterId, [target], offer.assets)) : null });
  const rows = useMemo((): Row[] => {
    if (!target) return [];
    const all: Row[] = mode === "sell"
      ? others.flatMap((t) => findOffers(target.value, t.assets, depth, tol / 100, 3).map((o) => withLineup(t, o)))
      : (() => { const owner = ownerOf.get(target.key); return owner ? findOffers(target.value, you.assets, depth, tol / 100, 6).map((o) => withLineup(owner, o)) : []; })();
    const score = (r: Row) => (sort === "me" ? -(r.d?.you ?? 0) : sort === "both" ? -Math.min(r.d?.you ?? 0, r.d?.them ?? 0) : r.offer.diffPct);
    return all.sort((a, b) => score(a) - score(b) || a.offer.diffPct - b.offer.diffPct).slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, mode, others, you, ownerOf, depth, tol, sort, lineupDelta]);

  const use = (team: FinderTeam, offer: Offer) => {
    if (!target) return;
    if (mode === "sell") onUse(team.rosterId, offer.assets, [target]);
    else onUse(team.rosterId, [target], offer.assets);
  };

  return (
    <Card className="border-white/10 p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Trade finder</p>
        <div className="flex items-center gap-3">
          <label className="text-[11px] text-slate-500 flex items-center gap-1.5">Within
            <select value={tol} onChange={(e) => setTol(Number(e.target.value))} className="bg-transparent border border-white/10 rounded-md px-1.5 py-0.5 text-slate-200">
              {[5, 10, 15, 20].map((n) => <option key={n} value={n} className="bg-slate-900">±{n}%</option>)}
            </select>
          </label>
          <div className="inline-flex gap-0.5 rounded-lg border border-white/10 p-0.5">
            {([["sell", "Sell"], ["buy", "Buy"]] as const).map(([m, label]) => (
              <button key={m} type="button" onClick={() => { setMode(m); setTarget(null); }}
                className={cn("px-3 py-1 text-xs rounded-md", mode === m ? "bg-white/10 text-white font-medium" : "text-slate-400 hover:text-white")}>{label}</button>
            ))}
          </div>
        </div>
      </div>
      <p className="text-[11px] text-slate-500">
        {mode === "sell" ? `Pick one of ${you.name}'s assets to see what each leaguemate could pay for it.` : "Pick a leaguemate's asset to see what you could send for it."}
      </p>
      <AssetSearch entries={pool} taken={new Set(target ? [target.key] : [])} onAdd={setTarget} placeholder={mode === "sell" ? "Search your roster & picks…" : "Search leaguemates' rosters & picks…"} />
      {target && (
        <div className="rounded-lg border border-white/10 px-3 py-2"><AssetLine asset={target} right={<button type="button" onClick={() => setTarget(null)} className="text-xs text-slate-500 hover:text-white">Clear</button>} /></div>
      )}
      {target && (rows.length === 0
        ? <p className="text-xs text-slate-500">{mode === "sell" ? `No leaguemate has a package within ±${tol}% — try a wider range.` : `Nothing on your roster matches within ±${tol}% — try a wider range.`}</p>
        : (
          <div className="space-y-2">
            {lineupDelta && (
              <div className="flex items-center gap-2 text-[11px] text-slate-500">Sort by
                {([["value", "Closest value"], ["me", "Helps my lineup"], ["both", "Helps both lineups"]] as const).map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setSort(k)} className={cn("px-2 py-0.5 rounded-md border", sort === k ? "border-white/30 text-white" : "border-white/10 hover:text-slate-300")}>{label}</button>
                ))}
              </div>
            )}
            {rows.map((r, i) => <OfferRow key={`${r.team.rosterId}-${i}`} title={mode === "sell" ? r.team.name : `Offer to ${r.team.name}`} offer={r.offer} d={r.d} onUse={() => use(r.team, r.offer)} />)}
          </div>
        ))}
    </Card>
  );
}

function OfferRow({ title, offer, d, onUse }: { title: string; offer: Offer; d: { you: number; them: number } | null; onUse: () => void }) {
  return (
    <div className="rounded-lg border border-white/10 px-3 py-2 flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-xs font-semibold text-slate-300">{title}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-400">
          {offer.assets.map((a) => <span key={a.key}>{a.label} <span className="font-mono text-slate-500">{Math.round(a.value).toLocaleString()}</span></span>)}
        </div>
        {d && (
          <p className="text-[11px] text-slate-500" title="Change in each team's best starting lineup (annual VORP) if this trade happened">
            Lineup: you <span className={d.you > 0.05 ? "text-emerald-400" : d.you < -0.05 ? "text-red-400" : ""}>{d.you > 0.05 ? "+" : d.you < -0.05 ? "−" : ""}{Math.abs(d.you).toFixed(1)}</span>
            {" · "}them <span className={d.them > 0.05 ? "text-emerald-400" : d.them < -0.05 ? "text-red-400" : ""}>{d.them > 0.05 ? "+" : d.them < -0.05 ? "−" : ""}{Math.abs(d.them).toFixed(1)}</span>
          </p>
        )}
      </div>
      <span className="font-mono text-xs text-slate-400" title="Package total, and what a package this size needs to be worth (the asset plus the consolidation premium)">{Math.round(offer.total).toLocaleString()} <span className="text-slate-600">of {Math.round(offer.need).toLocaleString()} ({offer.diffPct.toFixed(0)}% off)</span></span>
      <Button size="sm" variant="outline" onClick={onUse}>Use</Button>
    </div>
  );
}
