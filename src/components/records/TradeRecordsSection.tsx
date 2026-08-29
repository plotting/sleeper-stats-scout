
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";

const NUM_TEAMS = 10;

/** Strip internal markers and provenance info before counting. */
function displayDesc(raw: string): string {
  return raw
    .replace(/\s*\[fut:\d+\]/g, "")
    .replace(/\s*\(via [^)]+\)/g, "")
    .trim();
}

/** Parse a resolved pick description "2024 (1.02)" -> overall pick number (e.g. 2). */
function parseOverallPick(desc: string): number | null {
  const clean = displayDesc(desc);
  const m = clean.match(/^\d{4} \((\d+)\.(\d+)\)/);
  if (!m) return null;
  const round = Number(m[1]);
  const pick = Number(m[2]);
  return (round - 1) * NUM_TEAMS + pick;
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd", "th", "th", "th", "th", "th", "th"][n % 10] ?? "th"}`;
}

type TradeItemRow = {
  trade_id: number;
  item_type: string;
  item_description: string;
  from_team_id: number | null;
  to_team_id: number | null;
};

export function TradeRecordsSection() {
  const { data: teams } = useQuery({
    queryKey: ["teams-trade-records"],
    queryFn: async () => {
      const { data, error } = await supabase.from("teams").select("id, name");
      if (error) throw error;
      return data as Array<{ id: number; name: string }>;
    },
  });

  const { data: items } = useQuery({
    queryKey: ["all-trade-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trade_items")
        .select("trade_id, item_type, item_description, from_team_id, to_team_id");
      if (error) throw error;
      return data as TradeItemRow[];
    },
  });

  const teamNameById = useMemo(
    () => new Map((teams ?? []).map((t) => [t.id, t.name])),
    [teams],
  );

  const { teamCounts, playerCounts, pickCounts } = useMemo(() => {
    const teamTradeIds = new Map<number, Set<number>>();
    const playerCounts = new Map<string, number>();
    const pickCounts = new Map<number, number>();

    for (const item of items ?? []) {
      // Team participation: count each distinct trade a team appears in
      // (as either sender or receiver), not each item within it.
      for (const teamId of [item.from_team_id, item.to_team_id]) {
        if (teamId == null) continue;
        if (!teamTradeIds.has(teamId)) teamTradeIds.set(teamId, new Set());
        teamTradeIds.get(teamId)!.add(item.trade_id);
      }

      if (item.item_type === "player") {
        const name = displayDesc(item.item_description);
        playerCounts.set(name, (playerCounts.get(name) ?? 0) + 1);
      } else if (item.item_type === "pick") {
        const overall = parseOverallPick(item.item_description);
        if (overall != null) {
          pickCounts.set(overall, (pickCounts.get(overall) ?? 0) + 1);
        }
      }
    }

    const teamCounts = [...teamTradeIds.entries()]
      .map(([teamId, tradeIds]) => ({
        teamId,
        teamName: teamNameById.get(teamId) ?? `Team ${teamId}`,
        count: tradeIds.size,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const playerCountsSorted = [...playerCounts.entries()]
      .map(([player, count]) => ({ player, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const pickCountsSorted = [...pickCounts.entries()]
      .map(([overall, count]) => ({ overall, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return { teamCounts, playerCounts: playerCountsSorted, pickCounts: pickCountsSorted };
  }, [items, teamNameById]);

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">Most Trades by Team</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Team</TableHead>
              <TableHead className="text-right">Trades</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {teamCounts.map((row) => (
              <TableRow key={row.teamId}>
                <TableCell className="font-medium">{row.teamName}</TableCell>
                <TableCell className="text-right font-mono">{row.count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">Most Traded Players</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Player</TableHead>
              <TableHead className="text-right">Times Traded</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {playerCounts.map((row) => (
              <TableRow key={row.player}>
                <TableCell className="font-medium">{row.player}</TableCell>
                <TableCell className="text-right font-mono">{row.count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">Most Traded Pick Slots</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pick</TableHead>
              <TableHead className="text-right">Times Traded</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pickCounts.map((row) => (
              <TableRow key={row.overall}>
                <TableCell className="font-medium">{ordinal(row.overall)} overall</TableCell>
                <TableCell className="text-right font-mono">{row.count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
