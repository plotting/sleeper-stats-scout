
import React from "react";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { format } from "date-fns";
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Trades involving "{assetDescription}"</DialogTitle>
          <DialogDescription>
            All trades involving this asset
          </DialogDescription>
        </DialogHeader>
        
        {isLoading ? (
          <div className="flex justify-center py-8">
            Loading trades...
          </div>
        ) : trades && trades.length > 0 ? (
          <div className="space-y-6 mt-4">
            {trades.map((trade) => {
              // Find the specific item that matches our asset
              const targetItem = trade.items.find(item => 
                normalizeDesc(item.item_description) === normalizedTarget
              );
              
              if (!targetItem) return null;
              
              // Determine the direction of the trade for this asset
              const assetFromTeamId = targetItem.from_team_id;
              const assetToTeamId = targetItem.to_team_id;
              
              // Get team names for the asset's movement
              const fromTeamName = targetItem.from_team?.name || "Unknown";
              const toTeamName = targetItem.to_team?.name || "Unknown";
              
              // Group items by receiving team
              const team1Items = trade.items.filter(item => item.to_team_id === trade.team1_id);
              const team2Items = trade.items.filter(item => item.to_team_id === trade.team2_id);
              
              return (
                <Card key={trade.id} className="p-4">
                  <div className="flex flex-col space-y-4">
                    <div className="flex justify-between items-center">
                      <div className="font-medium">
                        <span className="text-muted-foreground">Trade between </span>
                        <Link 
                          to={`/team/${trade.team1.id}?season=${trade.season.season_number}`}
                          className="text-primary hover:underline"
                        >
                          {trade.team1.name}
                        </Link>
                        <span className="text-muted-foreground"> and </span>
                        <Link 
                          to={`/team/${trade.team2.id}?season=${trade.season.season_number}`}
                          className="text-primary hover:underline"
                        >
                          {trade.team2.name}
                        </Link>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {format(new Date(trade.trade_date), "MMM d, yyyy")}
                      </div>
                    </div>
                    
                    <div className="bg-muted/30 p-3 rounded-md">
                      <p className="text-sm font-medium mb-2">
                        <span className="text-primary font-bold">{assetDescription}</span> traded from{" "}
                        <span className="font-medium">{fromTeamName}</span> to{" "}
                        <span className="font-medium">{toTeamName}</span>
                      </p>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                      <div>
                        <p className="text-sm font-medium mb-1">{trade.team1.name} received:</p>
                        <ul className="list-disc list-inside text-sm space-y-1">
                          {team1Items.length > 0 ? (
                            team1Items.map((item, index) => (
                              <li key={index} className={
                                normalizeDesc(item.item_description) === normalizedTarget 
                                  ? "font-bold text-primary" 
                                  : "text-muted-foreground"
                              }>
                                {item.item_description}
                              </li>
                            ))
                          ) : (
                            <li className="text-muted-foreground">No items received</li>
                          )}
                        </ul>
                      </div>
                      <div>
                        <p className="text-sm font-medium mb-1">{trade.team2.name} received:</p>
                        <ul className="list-disc list-inside text-sm space-y-1">
                          {team2Items.length > 0 ? (
                            team2Items.map((item, index) => (
                              <li key={index} className={
                                normalizeDesc(item.item_description) === normalizedTarget 
                                  ? "font-bold text-primary" 
                                  : "text-muted-foreground"
                              }>
                                {item.item_description}
                              </li>
                            ))
                          ) : (
                            <li className="text-muted-foreground">No items received</li>
                          )}
                        </ul>
                      </div>
                    </div>
                    
                    <div className="text-sm text-right">
                      <Link 
                        to={`/trades?season=${trade.season.season_number}`}
                        className="text-primary hover:underline"
                      >
                        View season {trade.season.season_number} trades
                      </Link>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            No trades found involving this asset
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default TradeAssetModal;
