import { cn } from "@/lib/utils";
import { AssetLine } from "@/components/market/assetUi";
import { assess, verdictOf, type CalcAsset, type Depth } from "@/utils/marketCalc";

const SEGMENTS = ["Smash", "", "Win", "Even", "Lose", "", "Robbery"]; // labels under the seven steps

/** Seven-step verdict bar from Smash to Robbery with the active step lit. */
export function VerdictMeter({ recv, sent }: { recv: number; sent: number }) {
  const v = verdictOf(recv, sent);
  const lit = v.tone === "win" ? "bg-sky-400 shadow-[0_0_14px_rgba(56,189,248,0.6)]" : v.tone === "lose" ? "bg-red-400 shadow-[0_0_14px_rgba(248,113,113,0.6)]" : "bg-slate-300";
  const dim = (i: number) => (i < 3 ? "bg-emerald-900/40" : i === 3 ? "bg-slate-700/60" : "bg-red-900/40");
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-7 gap-1.5">
        {SEGMENTS.map((_, i) => <div key={i} className={cn("h-2.5 rounded-full transition-all", i === v.segment ? lit : dim(i), i === v.segment && "scale-y-125")} />)}
      </div>
      <div className="grid grid-cols-7 gap-1.5 text-[10px] uppercase tracking-wider text-slate-500 text-center">
        {SEGMENTS.map((l, i) => <span key={i} className={i === v.segment ? "text-slate-200" : ""}>{l}</span>)}
      </div>
      <p className={cn("text-center text-xl font-bold", v.tone === "win" ? "text-sky-300" : v.tone === "lose" ? "text-red-300" : "text-slate-200")}>{v.headline}</p>
    </div>
  );
}

/** The trade written out: who wins, by how much, and each side's pieces with totals. */
export function TradeReport({ receive, send, depth, subtitle }: { receive: CalcAsset[]; send: CalcAsset[]; depth: Depth; subtitle: string }) {
  const r = assess(receive, send, depth);
  const injured = [...receive, ...send].filter((a) => a.meta?.injury);
  const v = verdictOf(r.recv, r.sent);
  const title = v.tone === "win" ? "You Win" : v.tone === "lose" ? "You Lose" : "Even Trade";
  const color = v.tone === "win" ? "text-emerald-400" : v.tone === "lose" ? "text-red-400" : "text-slate-200";
  const list = (assets: CalcAsset[], total: number, label: string, tone: string) => (
    <div className="rounded-lg border border-white/10 p-3">
      <p className={cn("text-[11px] font-semibold uppercase tracking-widest mb-2", tone)}>{label}</p>
      <div className="space-y-1.5">{assets.map((a) => <AssetLine key={a.key} asset={a} />)}</div>
      <p className={cn("text-right font-mono text-xl font-bold mt-3 pt-2 border-t border-white/5", total === Math.max(r.recv, r.sent) ? "text-emerald-400" : "text-red-400")}>{Math.round(total).toLocaleString()}</p>
    </div>
  );
  return (
    <div className="rounded-xl border border-white/10 p-5 space-y-4">
      <div>
        <p className="text-sm font-bold tracking-wide uppercase">Trade report</p>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>
      <div className="text-center">
        <p className={cn("text-4xl font-bold", color)}>{title}</p>
        <p className="text-sm text-slate-400">{r.winner === null ? "Both sides are worth the same" : `${r.winner === "you" ? "+" : "−"}${Math.round(Math.abs(r.gap)).toLocaleString()} value edge`}</p>
      </div>
      {injured.length > 0 && (
        <p className="text-xs text-amber-300/90 border border-amber-400/20 rounded-md px-3 py-2">
          Injury watch: {injured.map((a) => `${a.label} (${a.meta!.injury})`).join(", ")}. Values don't adjust for injuries.
        </p>
      )}
      <div className="grid md:grid-cols-2 gap-3">
        {list(receive, r.recv, "You receive", "text-emerald-400")}
        {list(send, r.sent, "You send", "text-red-400")}
      </div>
    </div>
  );
}
