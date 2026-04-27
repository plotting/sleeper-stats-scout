
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getAllSeasons } from "@/utils/seasonUtils";
import { format } from "date-fns";
import TradeAssetModal from "@/components/TradeAssetModal";

const Trades = () => {
  const [selectedSeason, setSelectedSeason] = useState("1");
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [assetModalOpen, setAssetModalOpen] = useState(false);

  const { data: trades, isLoading } = useQuery({
    queryKey: ["trades", selectedSeason],
    queryFn: async () => {
      const { data: tradesData, error } = await supabase
        .from("trades")
        .select(`
          *,
          team1:teams!trades_team1_id_fkey(name),
          team2:teams!trades_team2_id_fkey(name),
          items:trade_items(
            item_type,
            item_description,
            from_team_id,
            to_team_id,
            from_team:teams!trade_items_from_team_id_fkey(name),
            to_team:teams!trade_items_to_team_id_fkey(name)
          )
        `)
        .eq("season_id", parseInt(selectedSeason))
        .order("trade_date", { ascending: true }); // Changed to ascending order

      if (error) throw error;
      
      console.log("Trades data:", tradesData);
      return tradesData;
    },
  });

  const handleAssetClick = (assetDescription: string) => {
    setSelectedAsset(assetDescription);
    setAssetModalOpen(true);
  };

  return (
    <div className="min-h-screen">
      <header className="mb-8">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">Trade History</h1>
            <p className="text-muted-foreground">View all trades across seasons</p>
          </div>
          <Select value={selectedSeason} onValueChange={setSelectedSeason}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select Season" />
            </SelectTrigger>
            <SelectContent>
              {getAllSeasons()
                .reverse()
                .map((season) => (
                  <SelectItem key={season.value} value={season.value}>
                    {season.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      <Card className="p-6">
        {isLoading ? (
          <div className="text-center py-4">Loading trades...</div>
        ) : trades && trades.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">Date</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.map((trade) => {
                // Derive participating teams from items (supports 2-team and N-team trades)
                const participants = new Map<number, string>();
                trade.items?.forEach((item) => {
                  if (item.to_team_id != null && item.to_team?.name) {
                    participants.set(item.to_team_id, item.to_team.name);
                  }
                });
                const entries = [...participants.entries()];
                const isMultiTeam = entries.length > 2;

                if (isMultiTeam) {
                  // 3+ team trade: span the four team/received columns into one flex row
                  return (
                    <TableRow key={trade.id}>
                      <TableCell className="align-top text-muted-foreground text-sm pt-4 whitespace-nowrap">
                        {format(new Date(trade.trade_date), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell colSpan={4}>
                        <div className="flex flex-wrap gap-10 py-1">
                          {entries.map(([teamId, teamName]) => (
                            <div key={teamId}>
                              <Link
                                to={`/team/${teamId}?season=${selectedSeason}`}
                                className="text-primary hover:underline font-medium block mb-1"
                              >
                                {teamName}
                              </Link>
                              <ul className="list-disc list-inside space-y-0.5">
                                {trade.items
                                  ?.filter((i) => i.to_team_id === teamId)
                                  .map((item, idx) => (
                                    <li
                                      key={idx}
                                      className="text-sm cursor-pointer hover:text-primary hover:underline"
                                      onClick={() => handleAssetClick(item.item_description)}
                                    >
                                      {item.item_description}
                                    </li>
                                  ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                }

                // Standard 2-team trade — original 5-column layout
                const [[t1Id, t1Name] = [null, null], [t2Id, t2Name] = [null, null]] = entries;
                return (
                  <TableRow key={trade.id}>
                    <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                      {format(new Date(trade.trade_date), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className="font-medium">
                      {t1Id != null ? (
                        <Link
                          to={`/team/${t1Id}?season=${selectedSeason}`}
                          className="text-primary hover:underline"
                        >
                          {t1Name}
                        </Link>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <ul className="list-disc list-inside space-y-0.5">
                        {trade.items
                          ?.filter((i) => i.to_team_id === t1Id)
                          .map((item, idx) => (
                            <li
                              key={idx}
                              className="text-sm cursor-pointer hover:text-primary hover:underline"
                              onClick={() => handleAssetClick(item.item_description)}
                            >
                              {item.item_description}
                            </li>
                          ))}
                      </ul>
                    </TableCell>
                    <TableCell className="font-medium">
                      {t2Id != null ? (
                        <Link
                          to={`/team/${t2Id}?season=${selectedSeason}`}
                          className="text-primary hover:underline"
                        >
                          {t2Name}
                        </Link>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <ul className="list-disc list-inside space-y-0.5">
                        {trade.items
                          ?.filter((i) => i.to_team_id === t2Id)
                          .map((item, idx) => (
                            <li
                              key={idx}
                              className="text-sm cursor-pointer hover:text-primary hover:underline"
                              onClick={() => handleAssetClick(item.item_description)}
                            >
                              {item.item_description}
                            </li>
                          ))}
                      </ul>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <div className="text-center py-4 text-muted-foreground">
            No trades found for this season
          </div>
        )}
      </Card>

      <TradeAssetModal 
        open={assetModalOpen} 
        onOpenChange={setAssetModalOpen} 
        assetDescription={selectedAsset} 
      />
    </div>
  );
};

export default Trades;
