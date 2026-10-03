import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { CalcAsset } from "@/utils/marketCalc";
import type { FinderTeam } from "@/utils/winWin";
import { AssetLine } from "./assetUi";

const MIN_VALUE = 1000; // ignore players too cheap to matter
const MIN_CHANGE = 3;   // percent over the last 7 days

/** Your players whose value jumped this week (sell-high candidates) and leaguemates' players whose value dropped (buy-low candidates). */
export function SellHighBuyLow({ you, others }: { you: FinderTeam; others: FinderTeam[] }) {
  const { sell, buy, haveHistory } = useMemo(() => {
    const player = (a: CalcAsset) => a.meta?.playerId && a.value >= MIN_VALUE && a.meta.change != null;
    const mine = you.assets.filter(player);
    const theirs = others.flatMap((t) => t.assets.filter(player).map((a) => ({ a, team: t.name })));
    return {
      haveHistory: you.assets.concat(others.flatMap((t) => t.assets)).some((a) => a.meta?.change != null),
      sell: mine.filter((a) => a.meta!.change! >= MIN_CHANGE).sort((x, y) => y.meta!.change! - x.meta!.change!).slice(0, 5),
      buy: theirs.filter((r) => r.a.meta!.change! <= -MIN_CHANGE).sort((x, y) => x.a.meta!.change! - y.a.meta!.change!).slice(0, 5),
    };
  }, [you, others]);

  return (
    <Card className="border-white/10 p-5 space-y-3">
      <div>
        <p className="text-sm font-semibold">Sell high / buy low</p>
        <p className="text-[11px] text-slate-500">Value moves over the last 7 days (players worth 1,000+). Values follow trades, so a riser may just be a hot week; treat these as prompts, not signals.</p>
      </div>
      {!haveHistory ? (
        <p className="text-xs text-slate-500">Not enough value history yet: 7-day changes appear a week after the daily fit started saving values.</p>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-emerald-400">Sell high: yours that rose</p>
            {sell.length === 0 && <p className="text-xs text-slate-500">None up {MIN_CHANGE}%+</p>}
            {sell.map((a) => <AssetLine key={a.key} asset={a} />)}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-red-400">Buy low: leaguemates' that fell</p>
            {buy.length === 0 && <p className="text-xs text-slate-500">None down {MIN_CHANGE}%+</p>}
            {buy.map(({ a, team }) => <AssetLine key={a.key} asset={a} right={<span className={cn("text-[10px] text-slate-500 max-w-24 truncate")}>{team}</span>} />)}
          </div>
        </div>
      )}
    </Card>
  );
}
