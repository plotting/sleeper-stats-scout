import { cn } from "@/lib/utils";
import { bestLineup, lineupScore, positionRanks, positionTotals, type RosterPlayer } from "@/utils/rosterLineup";

export interface TeamSide { rosterId: number; name: string; before: RosterPlayer[]; after: RosterPlayer[] }

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const sign = (x: number) => (x > 0.05 ? "+" : x < -0.05 ? "−" : "");

/** Starting lineup before and after the trade for one team, plus how each position group ranks in the league. */
function TeamCard({ side, slots, league }: { side: TeamSide; slots: string[]; league: Map<number, Record<string, number>> }) {
  const before = bestLineup(side.before, slots);
  const after = bestLineup(side.after, slots);
  const delta = lineupScore(after) - lineupScore(before);
  const afterLeague = new Map(league);
  afterLeague.set(side.rosterId, positionTotals(after));
  const rb = positionRanks(league, side.rosterId), ra = positionRanks(afterLeague, side.rosterId);
  const beforeIds = new Set(before.map((x) => x.player?.id));
  return (
    <div className="rounded-lg border border-white/10 p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold truncate">{side.name}</p>
        <p className={cn("font-mono text-sm font-bold", delta > 0.05 ? "text-emerald-400" : delta < -0.05 ? "text-red-400" : "text-slate-400")}>{sign(delta)}{fmt(Math.abs(delta))} <span className="text-[10px] font-sans font-normal text-slate-500">starter VORP</span></p>
      </div>
      <div className="space-y-1">
        {after.map((slot, i) => {
          const was = before[i].player;
          const changed = slot.player?.id !== was?.id;
          return (
            <div key={i} className={cn("flex items-center justify-between rounded px-2 py-1 text-xs", changed ? "bg-white/[0.06]" : "")}>
              <span className="w-12 text-[10px] uppercase tracking-wide text-slate-500">{slot.slot.replace("_FLEX", "").replace("WRRB", "W/R").replace("REC", "W/T")}</span>
              <span className="flex-1 truncate">
                {changed && was && <span className="text-slate-500 line-through mr-1.5">{was.name ?? was.id}</span>}
                <span className={cn(changed && !beforeIds.has(slot.player?.id) && "text-emerald-300 font-medium")}>{slot.player ? (slot.player.name ?? slot.player.id) : <span className="text-slate-600">empty</span>}</span>
              </span>
              <span className="font-mono text-slate-400">{slot.player ? fmt(slot.player.score) : "–"}</span>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-4 gap-2 pt-1 border-t border-white/5">
        {(["QB", "RB", "WR", "TE"] as const).map((pos) => {
          const d = (ra[pos] ?? 0) - (rb[pos] ?? 0);
          return (
            <div key={pos} className="text-center">
              <p className="text-[10px] text-slate-500">{pos} rank</p>
              <p className="font-mono text-sm">{rb[pos] ?? "–"}{d !== 0 && <> → <span className={d < 0 ? "text-emerald-400" : "text-red-400"}>{ra[pos]}</span></>}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function LineupImpact({ you, partner, slots, league }: { you: TeamSide; partner: TeamSide; slots: string[]; league: Map<number, Record<string, number>> }) {
  return (
    <div className="rounded-xl border border-white/10 p-5 space-y-3">
      <div>
        <p className="text-sm font-bold">Lineup impact</p>
        <p className="text-xs text-slate-500">Each team's best starting lineup for your format before and after the trade, scored by recent production (annual VORP). Position rank is among all teams (1 = strongest). Rookies and players with no stats count as bench.</p>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <TeamCard side={you} slots={slots} league={league} />
        <TeamCard side={partner} slots={slots} league={league} />
      </div>
    </div>
  );
}
