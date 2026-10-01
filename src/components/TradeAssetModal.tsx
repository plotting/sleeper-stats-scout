
import React from "react";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface TradeAssetModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assetDescription: string | null;
}

/** Strip internal markers and provenance info so callers passing either the
 *  raw stored description or the cleaned display description still match. */
function normalizeDesc(raw: string): string {
  return raw
    .replace(/\s*\[fut:\d+\]/g, "")
    .replace(/\s*\(via [^)]+\)/g, "")
    .trim();
}

const TradeAssetModal = ({ open, onOpenChange, assetDescription }: TradeAssetModalProps) => {
  const normalizedTarget = assetDescription ? normalizeDesc(assetDescription) : null;

  const { data: trades, isLoading } = useQuery({
    queryKey: ["trades-by-asset", normalizedTarget],
    queryFn: async () => {
      if (!normalizedTarget) return [];

      const { data, error } = await supabase
        .from("trades")
        .select(`
          *,
          team1:teams!trades_team1_id_fkey(id, name),
          team2:teams!trades_team2_id_fkey(id, name),
          items:trade_items(
            id,
            item_type,
            item_description,
            from_team_id,
            to_team_id,
            from_team:teams!trade_items_from_team_id_fkey(name),
            to_team:teams!trade_items_to_team_id_fkey(name)
          ),
          season:seasons(season_number)
        `);

      if (error) throw error;

      // Filter out trades that don't have the asset in their items
      const filteredTrades = data?.filter(trade =>
        trade.items.some(item => normalizeDesc(item.item_description) === normalizedTarget)
      );

      return filteredTrades || [];
    },
    enabled: !!normalizedTarget && open
  });

  if (!assetDescription) return null;

  const ReceivedList = ({ name, items }: { name: string; items: Array<{ item_description: string }> }) => (
    <div>
      <p className="text-xs font-semibold text-slate-300 mb-2">{name} received</p>
      <div className="space-y-1">
        {items.length > 0 ? (
          items.map((item, index) => {
            const isTarget = normalizeDesc(item.item_description) === normalizedTarget;
            return (
              <div
                key={index}
                className={cn(
                  "py-1.5 px-2 rounded text-sm border-b border-white/[0.04] last:border-0",
                  isTarget ? "bg-blue-500/10 text-blue-400 font-medium" : "text-white",
                )}
              >
                {item.item_description}
              </div>
            );
          })
        ) : (
          <p className="text-sm text-slate-500 px-2">Nothing received</p>
        )}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto bg-slate-950 border-white/10 text-white">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Trades involving "{assetDescription}"</DialogTitle>
          <DialogDescription className="text-slate-400">
            Every trade this asset has been part of
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8 text-slate-400">Loading trades…</div>
        ) : trades && trades.length > 0 ? (
          <div className="space-y-4 mt-2">
            {trades.map((trade) => {
              const targetItem = trade.items.find((item) =>
                normalizeDesc(item.item_description) === normalizedTarget
              );
              if (!targetItem) return null;

              const fromTeamName = targetItem.from_team?.name || "Unknown";
              const toTeamName = targetItem.to_team?.name || "Unknown";
              const team1Items = trade.items.filter((item) => item.to_team_id === trade.team1_id);
              const team2Items = trade.items.filter((item) => item.to_team_id === trade.team2_id);

              return (
                <div key={trade.id} className="rounded-lg border border-white/10 bg-white/[0.03] overflow-hidden">
                  <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/5">
                    <div className="text-sm font-medium">
                      <Link
                        to={`/team/${trade.team1.id}?season=${trade.season.season_number}`}
                        className="text-blue-400 hover:underline"
                      >
                        {trade.team1.name}
                      </Link>
                      <span className="text-slate-500"> ⇄ </span>
                      <Link
                        to={`/team/${trade.team2.id}?season=${trade.season.season_number}`}
                        className="text-blue-400 hover:underline"
                      >
                        {trade.team2.name}
                      </Link>
                    </div>
                    <div className="text-sm text-slate-400 shrink-0">
                      {format(new Date(trade.trade_date), "MMM d, yyyy")}
                    </div>
                  </div>

                  <div className="px-4 py-3 space-y-4 bg-white/[0.03]">
                    <p className="text-xs text-slate-400">
                      <span className="text-blue-400 font-medium">{assetDescription}</span> moved from{" "}
                      <span className="text-slate-200">{fromTeamName}</span> to{" "}
                      <span className="text-slate-200">{toTeamName}</span>
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <ReceivedList name={trade.team1.name} items={team1Items} />
                      <ReceivedList name={trade.team2.name} items={team2Items} />
                    </div>
                    <div className="text-xs text-right">
                      <Link
                        to={`/trades?season=${trade.season.season_number}`}
                        className="text-blue-400 hover:underline"
                      >
                        View season {trade.season.season_number} trades →
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8 text-slate-400">No trades found involving this asset</div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default TradeAssetModal;
