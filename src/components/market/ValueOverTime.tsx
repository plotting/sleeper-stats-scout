import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { projectValue, sideTotal, trend, type AgeCurve, type CalcAsset, type Depth } from "@/utils/marketCalc";

const W = 760, H = 280, PAD = { l: 46, r: 74, t: 18, b: 34 };

const k = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));

/** Value of each side now and over the next three seasons, from each position's age curve (picks stay flat). */
export function ValueOverTime({ receive, send, depth, curves }: { receive: CalcAsset[]; send: CalcAsset[]; depth: Depth; curves: Map<string, AgeCurve> }) {
  const year = new Date().getFullYear();
  const labels = ["Now", String(year + 1), String(year + 2), String(year + 3)];
  const data = useMemo(() => {
    const at = (assets: CalcAsset[], t: number) => assets.map((a) => ({ ...a, value: projectValue(a, t, curves) }));
    const totals = (assets: CalcAsset[]) => [0, 1, 2, 3].map((t) => sideTotal(at(assets, t), depth));
    const each = (assets: CalcAsset[]) => assets.map((a) => ({ a, line: [0, 1, 2, 3].map((t) => projectValue(a, t, curves)) }));
    return { get: totals(receive), give: totals(send), getEach: each(receive), giveEach: each(send) };
  }, [receive, send, depth, curves]);

  const all = [...data.get, ...data.give, ...data.getEach.flatMap((x) => x.line), ...data.giveEach.flatMap((x) => x.line)];
  const yMax = Math.max(2000, Math.ceil((Math.max(...all) * 1.08) / 2000) * 2000);
  const x = (i: number) => PAD.l + (i * (W - PAD.l - PAD.r)) / 3;
  const y = (v: number) => PAD.t + (1 - v / yMax) * (H - PAD.t - PAD.b);
  const path = (line: number[]) => line.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const gaps = data.get.map((g, i) => g - data.give[i]);
  const tr = trend(gaps);
  const ticks = Array.from({ length: 4 }, (_, i) => (yMax / 3) * i);
  const gap = (g: number) => `${g >= 0 ? "+" : "−"}${Math.round(Math.abs(g)).toLocaleString()}`;

  return (
    <div className="rounded-xl border border-white/10 p-5 space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-bold">Value over time</p>
        <p className="text-[11px] text-slate-500">Bold = package total · players follow their position's age curve, picks stay flat</p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Value of each side over the next three seasons">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.06)" strokeDasharray="4 4" />
            <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#64748b">{k(t)}</text>
          </g>
        ))}
        {labels.map((l, i) => <text key={l} x={x(i)} y={H - 10} textAnchor="middle" fontSize="12" fill="#94a3b8">{l}</text>)}
        {data.getEach.map((s) => <path key={`g${s.a.key}`} d={path(s.line)} fill="none" stroke="#38bdf8" strokeOpacity="0.55" strokeWidth="1.5" />)}
        {data.giveEach.map((s) => <path key={`s${s.a.key}`} d={path(s.line)} fill="none" stroke="#f87171" strokeOpacity="0.55" strokeWidth="1.5" strokeDasharray="5 4" />)}
        <path d={path(data.get)} fill="none" stroke="#38bdf8" strokeWidth="3.5" strokeLinecap="round" />
        <path d={path(data.give)} fill="none" stroke="#f87171" strokeWidth="3.5" strokeDasharray="7 5" strokeLinecap="round" />
        {[0, 1, 2, 3].map((i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(data.get[i])} r="4.5" fill="#38bdf8" />
            <circle cx={x(i)} cy={y(data.give[i])} r="4.5" fill="#f87171" />
          </g>
        ))}
        <text x={x(3) + 10} y={y(data.get[3]) + 4} fontSize="13" fontWeight="700" fill="#7dd3fc">{k(data.get[3])}</text>
        <text x={x(3) + 10} y={y(data.give[3]) + 4} fontSize="13" fontWeight="700" fill="#fca5a5">{k(data.give[3])}</text>
      </svg>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-400">
        <span><span className="inline-block w-5 border-t-[3px] border-sky-400 align-middle mr-1.5" />You receive</span>
        <span><span className="inline-block w-5 border-t-[3px] border-dashed border-red-400 align-middle mr-1.5" />You send</span>
        {[...data.getEach, ...data.giveEach].map((s, i) => <span key={s.a.key} className={i < data.getEach.length ? "text-sky-300/80" : "text-red-300/80"}>{s.a.label}</span>)}
      </div>
      <div className="grid grid-cols-3 gap-3 text-center">
        {([["Today's gap", gap(gaps[0]), gaps[0]], ["3-year gap", gap(gaps[3]), gaps[3]], ["Trend", tr, tr === "Always ahead" ? 1 : tr === "Always behind" ? -1 : 0]] as const).map(([label, text, n]) => (
          <div key={label} className="rounded-lg border border-white/10 p-3">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
            <p className={cn("text-lg font-bold font-mono", n > 0 ? "text-emerald-400" : n < 0 ? "text-red-400" : "text-amber-300")}>{text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
