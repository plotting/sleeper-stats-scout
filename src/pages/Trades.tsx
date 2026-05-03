
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
import { cn } from "@/lib/utils";

/** Strip internal [fut:N] machine-readable markers before showing to users. */
function displayDesc(raw: string): string {
  return raw.replace(/\s*\[fut:\d+\]/g, '').trim();
}

/** Sort key for a pick description — players come first, then picks by year/round/slot. */
function pickSortKey(itemType: string, desc: string): [number, number, number, number, string] {
  if (itemType === 'player') return [0, 0, 0, 0, desc.toLowerCase()];
  const clean = displayDesc(desc);
  const resolved = clean.match(/^(\d{4}) \((\d+)\.(\d+)\)/);
  if (resolved) return [1, Number(resolved[1]), Number(resolved[2]), Number(resolved[3]), ''];
  const unresolved = clean.match(/^(\d{4}) (\d+)(?:st|nd|rd|th) Round/);
  if (unresolved) return [1, Number(unresolved[1]), Number(unresolved[2]), 999, ''];
  return [1, 9999, 999, 999, ''];
}

type TradeItem = {
  item_type: string;
  item_description: string;
  to_team_id: number | null;
  from_team_id: number | null;
  from_team?: { name: string } | null;
  to_team?: { name: string } | null;
};

function sortItems(items: TradeItem[]): TradeItem[] {
  return [...items].sort((a, b) => {
    const ka = pickSortKey(a.item_type, a.item_description);
    const kb = pickSortKey(b.item_type, b.item_description);
    for (let i = 0; i < ka.length; i++) {
      const av = ka[i], bv = kb[i];
      if (av < bv) return -1;
      if (av > bv) return 1;
    }
    return 0;
  });
}

interface VorpRow {
  player_name: string;
  career_vorp: number;
  avg_season_vorp: number;
  peak_season_vorp: number;
  seasons_played: number;
  first_year: number;
  last_year: number;
}

/** Estimated VORP value for an unresolved pick by round */
function pickEstimateVorp(description: string): number | null {
  const clean = displayDesc(description);
  const m = clean.match(/^(\d{4}) (\d+)(?:st|nd|rd|th) Round/);
  if (!m) return null;
  const round = Number(m[2]);
  // Historical median 5yr VORP: 1st round ~100, 2nd round ~30
  return round === 1 ? 100 : round === 2 ? 30 : 10;
}

/** Parse resolved pick: "2025 (1.08)" → { year: 2025, round: 1, pick: 8 } */
function parseResolvedPick(description: string): { year: number; round: number; pick: number } | null {
  const clean = displayDesc(description);
  const m = clean.match(/^(\d{4}) \((\d+)\.(\d+)\)/);
  if (!m) return null;
  return { year: Number(m[1]), round: Number(m[2]), pick: Number(m[3]) };
}

function VorpBadge({ vorp, title }: { vorp: number | null; title?: string }) {
  if (vorp === null) return null;
  const color =
    vorp >= 200 ? "text-emerald-300"
    : vorp >= 75 ? "text-emerald-400"
    : vorp >= 0  ? "text-sky-400"
    : vorp >= -75 ? "text-amber-400"
    : "text-red-400";
  return (
    <span
      className={cn("text-[10px] font-mono font-semibold ml-1 opacity-75", color)}
      title={title}
    >
      {vorp >= 0 ? "+" : ""}{vorp.toFixed(0)}
    </span>
  );
}

function WinnerBadge({ winner }: { winner: string | null }) {
  if (!winner) return null;
  return (
    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 ml-1">
      W
    </span>
  );
}

const Trades = () => {
  const [selectedSeason, setSelectedSeason] = useState("14");
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [assetModalOpen, setAssetModalOpen] = useState(false);
  const [showVorp, setShowVorp] = useState(false);

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
        .order("trade_date", { ascending: true });

      if (error) throw error;
      return tradesData;
    },
  });

  // Collect all player names across all loaded trades for VORP batch fetch
  const playerNames = (() => {
    if (!trades || !showVorp) return [];
    const names = new Set<string>();
    for (const t of trades) {
      for (const item of t.items ?? []) {
        if (item.item_type === "player") names.add(item.item_description);
      }
    }
    return [...names];
  })();

  const { data: vorpData } = useQuery({
    queryKey: ["player-vorp-summary", playerNames],
    queryFn: async () => {
      if (!playerNames.length) return [] as VorpRow[];
      const { data, error } = await supabase
        .from("player_vorp_summary" as never)
        .select("player_name,career_vorp,avg_season_vorp,peak_season_vorp,seasons_played,first_year,last_year")
        .in("player_name", playerNames);
      if (error) throw error;
      return data as VorpRow[];
    },
    enabled: showVorp && playerNames.length > 0,
  });

  // Also load resolved pick grades when VORP mode is on
  const resolvedPickKeys = (() => {
    if (!trades || !showVorp) return [] as Array<{ year: number; pick: number }>;
    const keys: Array<{ year: number; pick: number }> = [];
    for (const t of trades) {
      for (const item of t.items ?? []) {
        if (item.item_type === "pick") {
          const parsed = parseResolvedPick(item.item_description);
          if (parsed) keys.push({ year: parsed.year, pick: (parsed.round - 1) * 10 + parsed.pick });
        }
      }
    }
    return keys;
  })();

  const { data: pickGrades } = useQuery({
    queryKey: ["pick-vorp-grades", resolvedPickKeys],
    queryFn: async () => {
      if (!resolvedPickKeys.length) return [];
      const yearPickPairs = resolvedPickKeys.map(k => `(${k.year},${k.pick})`).join(",");
      const { data, error } = await supabase
        .from("rookie_draft_grades" as never)
        .select("draft_year,overall_pick,player_name,five_yr_vorp,vorp_grade")
        .in("draft_year", [...new Set(resolvedPickKeys.map(k => k.year))]);
      if (error) throw error;
      return data as Array<{ draft_year: number; overall_pick: number; player_name: string; five_yr_vorp: number; vorp_grade: string }>;
    },
    enabled: showVorp && resolvedPickKeys.length > 0,
  });

  const vorpByName = new Map<string, VorpRow>(
    (vorpData ?? []).map(v => [v.player_name.toLowerCase(), v])
  );

  const pickGradeByKey = new Map<string, typeof pickGrades extends Array<infer T> ? T : never>(
    (pickGrades ?? []).map(p => [`${p.draft_year}:${p.overall_pick}`, p as never])
  );

  function getItemVorp(item: TradeItem): number | null {
    if (!showVorp) return null;
    if (item.item_type === "player") {
      const v = vorpByName.get(item.item_description.toLowerCase());
      return v ? Number(v.career_vorp) : null;
    }
    if (item.item_type === "pick") {
      const resolved = parseResolvedPick(item.item_description);
      if (resolved) {
        const overall = (resolved.round - 1) * 10 + resolved.pick;
        const pg = pickGradeByKey.get(`${resolved.year}:${overall}`);
        return pg ? Number(pg.five_yr_vorp) : null;
      }
      return pickEstimateVorp(item.item_description);
    }
    return null;
  }

  function computeTeamVorp(items: TradeItem[], teamId: number | null): number | null {
    if (!showVorp || teamId === null) return null;
    const received = items.filter(i => i.to_team_id === teamId);
    if (!received.length) return null;
    let total = 0;
    let hasAny = false;
    for (const item of received) {
      const v = getItemVorp(item);
      if (v !== null) { total += v; hasAny = true; }
    }
    return hasAny ? total : null;
  }

  const handleAssetClick = (assetDescription: string) => {
    setSelectedAsset(assetDescription);
    setAssetModalOpen(true);
  };

  return (
    <div className="min-h-screen">
      <header className="mb-8">
        <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">Trade History</h1>
            <p className="text-muted-foreground">View all trades across seasons</p>
          </div>
          <div className="flex items-center gap-2">
            {/* VORP toggle */}
            <button
              onClick={() => setShowVorp(v => !v)}
              className={cn(
                "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border transition-all",
                showVorp
                  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                  : "border-white/10 text-slate-400 hover:text-white hover:border-white/25",
              )}
            >
              {showVorp ? "▶ VORP On" : "▶ VORP Off"}
            </button>
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
        </div>
        {showVorp && (
          <p className="text-xs text-slate-500">
            VORP values shown inline: players = career total VORP, resolved picks = 5yr VORP of player drafted, unresolved picks = estimated value by round
          </p>
        )}
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
                const participants = new Map<number, string>();
                trade.items?.forEach((item) => {
                  if (item.to_team_id != null && item.to_team?.name) {
                    participants.set(item.to_team_id, item.to_team.name);
                  }
                });
                const entries = [...participants.entries()];
                const isMultiTeam = entries.length > 2;

                // Compute per-team VORP for winner determination
                const teamVorps = showVorp
                  ? entries.map(([id]) => ({
                      id,
                      vorp: computeTeamVorp(trade.items ?? [], id),
                    }))
                  : [];
                const maxVorp = teamVorps.reduce((best, tv) =>
                  tv.vorp !== null && (best === null || tv.vorp > best) ? tv.vorp : best,
                null as number | null);
                const winnerIds = new Set(
                  teamVorps.filter(tv => tv.vorp !== null && tv.vorp === maxVorp).map(tv => tv.id)
                );

                if (isMultiTeam) {
                  return entries.map(([teamId, teamName], rowIdx) => {
                    const teamVorp = showVorp ? computeTeamVorp(trade.items ?? [], teamId) : null;
                    const isWinner = winnerIds.has(teamId);
                    return (
                      <TableRow key={`${trade.id}-${teamId}`} className={rowIdx > 0 ? "border-t-0" : ""}>
                        {rowIdx === 0 && (
                          <TableCell
                            rowSpan={entries.length}
                            className="align-top text-muted-foreground text-sm pt-4 whitespace-nowrap"
                          >
                            {format(new Date(trade.trade_date), "MMM d, yyyy")}
                          </TableCell>
                        )}
                        <TableCell className="font-medium align-top pt-3">
                          <Link
                            to={`/team/${teamId}?season=${selectedSeason}`}
                            className="text-primary hover:underline"
                          >
                            {teamName}
                          </Link>
                          {showVorp && teamVorp !== null && (
                            <span className={cn(
                              "block text-[10px] font-mono mt-0.5",
                              isWinner ? "text-emerald-400" : "text-slate-500"
                            )}>
                              {teamVorp >= 0 ? "+" : ""}{teamVorp.toFixed(0)} VORP
                              {isWinner && entries.length > 1 && <span className="ml-1 text-emerald-400">★</span>}
                            </span>
                          )}
                        </TableCell>
                        <TableCell colSpan={3} className="align-top pt-3">
                          <ul className="list-disc list-inside space-y-0.5">
                            {sortItems(trade.items?.filter((i) => i.to_team_id === teamId) ?? [])
                              .map((item, idx) => {
                                const vorp = getItemVorp(item);
                                return (
                                  <li
                                    key={idx}
                                    className="text-sm cursor-pointer hover:text-primary hover:underline"
                                    onClick={() => handleAssetClick(displayDesc(item.item_description))}
                                  >
                                    {displayDesc(item.item_description)}
                                    {showVorp && <VorpBadge vorp={vorp} title="VORP" />}
                                  </li>
                                );
                              })}
                          </ul>
                        </TableCell>
                      </TableRow>
                    );
                  });
                }

                // Standard 2-team trade
                const [[t1Id, t1Name] = [null, null], [t2Id, t2Name] = [null, null]] = entries;
                const t1Vorp = showVorp ? computeTeamVorp(trade.items ?? [], t1Id!) : null;
                const t2Vorp = showVorp ? computeTeamVorp(trade.items ?? [], t2Id!) : null;
                const t1Wins = t1Vorp !== null && t2Vorp !== null && t1Vorp > t2Vorp;
                const t2Wins = t2Vorp !== null && t1Vorp !== null && t2Vorp > t1Vorp;

                return (
                  <TableRow key={trade.id}>
                    <TableCell className="text-muted-foreground text-sm whitespace-nowrap align-top pt-3">
                      {format(new Date(trade.trade_date), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className="font-medium align-top pt-3">
                      {t1Id != null ? (
                        <>
                          <Link
                            to={`/team/${t1Id}?season=${selectedSeason}`}
                            className="text-primary hover:underline"
                          >
                            {t1Name}
                          </Link>
                          {showVorp && t1Vorp !== null && (
                            <span className={cn(
                              "block text-[10px] font-mono mt-0.5",
                              t1Wins ? "text-emerald-400" : "text-slate-500"
                            )}>
                              {t1Vorp >= 0 ? "+" : ""}{t1Vorp.toFixed(0)} VORP
                              {t1Wins && <span className="ml-1 text-emerald-400">★</span>}
                            </span>
                          )}
                        </>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="align-top pt-3">
                      <ul className="list-disc list-inside space-y-0.5">
                        {sortItems(trade.items?.filter((i) => i.to_team_id === t1Id) ?? [])
                          .map((item, idx) => {
                            const vorp = getItemVorp(item);
                            return (
                              <li
                                key={idx}
                                className="text-sm cursor-pointer hover:text-primary hover:underline"
                                onClick={() => handleAssetClick(displayDesc(item.item_description))}
                              >
                                {displayDesc(item.item_description)}
                                {showVorp && <VorpBadge vorp={vorp} title="VORP" />}
                              </li>
                            );
                          })}
                      </ul>
                    </TableCell>
                    <TableCell className="font-medium align-top pt-3">
                      {t2Id != null ? (
                        <>
                          <Link
                            to={`/team/${t2Id}?season=${selectedSeason}`}
                            className="text-primary hover:underline"
                          >
                            {t2Name}
                          </Link>
                          {showVorp && t2Vorp !== null && (
                            <span className={cn(
                              "block text-[10px] font-mono mt-0.5",
                              t2Wins ? "text-emerald-400" : "text-slate-500"
                            )}>
                              {t2Vorp >= 0 ? "+" : ""}{t2Vorp.toFixed(0)} VORP
                              {t2Wins && <span className="ml-1 text-emerald-400">★</span>}
                            </span>
                          )}
                        </>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="align-top pt-3">
                      <ul className="list-disc list-inside space-y-0.5">
                        {sortItems(trade.items?.filter((i) => i.to_team_id === t2Id) ?? [])
                          .map((item, idx) => {
                            const vorp = getItemVorp(item);
                            return (
                              <li
                                key={idx}
                                className="text-sm cursor-pointer hover:text-primary hover:underline"
                                onClick={() => handleAssetClick(displayDesc(item.item_description))}
                              >
                                {displayDesc(item.item_description)}
                                {showVorp && <VorpBadge vorp={vorp} title="VORP" />}
                              </li>
                            );
                          })}
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
