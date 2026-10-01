
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
import { getAllSeasons, CURRENT_SEASON_NUMBER, LEAGUE_SIZE } from "@/utils/seasonUtils";
import { format } from "date-fns";
import TradeAssetModal from "@/components/TradeAssetModal";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTradeValuation } from "@/hooks/useTradeValuation";
import {
  getNFLWeek, getFirstPlayableWeek, parseUnresolvedPickFut,
  type TradeItem,
} from "@/utils/tradeHelpers";

/** Strip internal markers and provenance info before showing to users.
 *  [fut:N] = machine-readable roster-id for pick tracking (never shown).
 *  (via X)  = provenance note stored for reference but not displayed.
 */
function displayDesc(raw: string): string {
  return raw
    .replace(/\s*\[fut:\d+\]/g, '')
    .replace(/\s*\(via [^)]+\)/g, '')
    .trim();
}

/**
 * Parse a trade_date string from Supabase (stored as midnight UTC, e.g. "2025-07-26 00:00:00+00")
 * into a local Date at noon to avoid the UTC→local-time day-shift.
 */
function parseTradeDateLocal(isoStr: string): Date {
  const datePart = isoStr.slice(0, 10); // "2025-07-26"
  return new Date(`${datePart}T12:00:00`); // noon local — safely within the correct day
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

function VorpValue({ vorp, className }: { vorp: number | null; className?: string }) {
  if (vorp === null) return <span className="text-slate-500 font-mono text-sm">—</span>;
  const color =
    vorp >= 200 ? "text-emerald-300"
    : vorp >= 75 ? "text-emerald-400"
    : vorp >= 0  ? "text-sky-400"
    : vorp >= -75 ? "text-amber-400"
    : "text-red-400";
  return (
    <span className={cn("font-mono font-semibold text-sm", color, className)}>
      {vorp >= 0 ? "+" : ""}{vorp.toFixed(1)}
    </span>
  );
}

const Trades = () => {
  const [selectedSeason, setSelectedSeason] = useState(String(CURRENT_SEASON_NUMBER));
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [assetModalOpen, setAssetModalOpen] = useState(false);
  const [showVorp, setShowVorp] = useState(false);
  const [expandedTradeId, setExpandedTradeId] = useState<number | null>(null);

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
        .order("trade_date", { ascending: true })
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true });

      if (error) throw error;
      return tradesData;
    },
  });

  // Fetch VORP data when toggle is on OR a trade is expanded
  const needsVorp = showVorp || expandedTradeId !== null;
  const {
    getItemVorp, getPlayerSeasons, computeTeamVorp, getSlotExpectedSeasons,
    getDraftedPlayerSeasons, pickGradeByKey, retradedPicks, draftPickByFutKey,
  } = useTradeValuation(trades, needsVorp);

  /**
   * Returns the display label for a pick item.
   * For past unresolved [fut:N] picks, converts to "YYYY (R.PP)" slot notation.
   */
  function getPickLabel(item: TradeItem): React.ReactNode {
    if (item.item_type !== "pick") return displayDesc(item.item_description);

    // Already in resolved format "2024 (1.02)" — keep as-is
    if (parseResolvedPick(item.item_description)) return displayDesc(item.item_description);

    // Unresolved [fut:N] from a past draft — look up by draft_slot (= futId = original roster_id)
    const fut = parseUnresolvedPickFut(item.item_description);
    if (fut && fut.year < new Date().getFullYear()) {
      // Key by futId (original Sleeper roster_id) which equals draft_slot in draft_picks
      const picks = draftPickByFutKey.get(`${fut.year}-${fut.round}-${fut.futId}`);
      if (picks && picks.length >= 1) {
        // draft_slot is unique per season/round, so there should always be exactly 1
        // pick_number from Sleeper is overall pick number (e.g. 12 for slot 2 in round 2 of 10 teams)
        // Convert to position-within-round: ((pick_no - 1) % numTeams) + 1
        const numTeams = 10;
        const slot = ((picks[0].pick_number - 1) % numTeams) + 1;
        return `${fut.year} (${fut.round}.${String(slot).padStart(2, '0')})`;
      }
    }

    return displayDesc(item.item_description);
  }

  const handleAssetClick = (assetDescription: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedAsset(assetDescription);
    setAssetModalOpen(true);
  };

  const toggleTrade = (tradeId: number) => {
    setExpandedTradeId(prev => prev === tradeId ? null : tradeId);
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
            VORP values shown inline: players = 5yr VORP from trade date, resolved picks = player VORP if kept / slot avg if re-traded, unresolved picks = estimated by round · click any trade row to see full breakdown
          </p>
        )}
        {!showVorp && (
          <p className="text-xs text-slate-500">
            Click any trade row to see VORP breakdown
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
                <TableHead className="w-[130px]">Date</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.map((trade) => {
                const tradeDate = parseTradeDateLocal(trade.trade_date);
                const tradeYear = tradeDate.getFullYear();
                const { week: tradeWeek, inSeason: tradeInSeason } = getNFLWeek(tradeDate);
                // First week the acquired player can actually play (Sun/Mon trades push to next week)
                const displayWeek = tradeInSeason ? getFirstPlayableWeek(tradeDate, tradeWeek) : tradeWeek;
                const participants = new Map<number, string>();
                trade.items?.forEach((item) => {
                  if (item.to_team_id != null && item.to_team?.name) {
                    participants.set(item.to_team_id, item.to_team.name);
                  }
                });
                const entries = [...participants.entries()];
                const isMultiTeam = entries.length > 2;
                const isExpanded = expandedTradeId === trade.id;

                // Compute per-team VORP
                const teamVorps = entries.map(([id]) => ({
                  id,
                  vorp: computeTeamVorp(trade.items ?? [], id, tradeDate, trade.id),
                }));
                const maxVorp = teamVorps.reduce((best, tv) =>
                  tv.vorp !== null && (best === null || tv.vorp > best) ? tv.vorp : best,
                null as number | null);
                const winnerIds = new Set(
                  teamVorps.filter(tv => tv.vorp !== null && tv.vorp === maxVorp).map(tv => tv.id)
                );

                // Expanded VORP detail row
                const detailRow = isExpanded ? (
                  <TableRow key={`${trade.id}-detail`} className="hover:bg-transparent">
                    <TableCell colSpan={5} className="bg-white/[0.03] border-t border-white/5 px-4 py-4">
                      <div className={cn("grid gap-6", entries.length === 2 ? "grid-cols-2" : "grid-cols-1")}>
                        {entries.map(([teamId, teamName]) => {
                          const teamTotal = computeTeamVorp(trade.items ?? [], teamId, tradeDate, trade.id);
                          const isWinner = winnerIds.has(teamId);
                          const received = sortItems((trade.items ?? []).filter(i => i.to_team_id === teamId));
                          return (
                            <div key={teamId}>
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-xs font-semibold text-slate-300">{teamName} received</p>
                                {teamTotal !== null && (
                                  <span className={cn(
                                    "text-xs font-mono font-bold",
                                    isWinner ? "text-emerald-400" : "text-slate-400"
                                  )}>
                                    {teamTotal >= 0 ? "+" : ""}{teamTotal.toFixed(1)} VORP
                                    {isWinner && entries.length > 1 && <span className="ml-1">★</span>}
                                  </span>
                                )}
                              </div>
                              <div className="space-y-1">
                                {received.map((item, idx) => {
                                  const vorp = getItemVorp(item, tradeDate, trade.id);
                                  const resolvedPick = item.item_type === "pick"
                                    ? parseResolvedPick(item.item_description)
                                    : null;
                                  const isRetradedPick = resolvedPick != null &&
                                    item.to_team_id != null &&
                                    retradedPicks.has(`${trade.id}:${displayDesc(item.item_description)}:${item.to_team_id}`);
                                  const pickGrade = resolvedPick && !isRetradedPick
                                    ? pickGradeByKey.get(`${resolvedPick.year}:${(resolvedPick.round - 1) * LEAGUE_SIZE + resolvedPick.pick}`)
                                    : null;
                                  const seasons = item.item_type === "player"
                                    ? getPlayerSeasons(item.item_description, tradeDate)
                                    : pickGrade && resolvedPick
                                      ? getDraftedPlayerSeasons(pickGrade.player_name, resolvedPick.year)
                                      : isRetradedPick && resolvedPick
                                        ? getSlotExpectedSeasons(resolvedPick.year, (resolvedPick.round - 1) * LEAGUE_SIZE + resolvedPick.pick)
                                        : null;
                                  const futPick = item.item_type === "pick"
                                    ? parseUnresolvedPickFut(item.item_description)
                                    : null;
                                  const currentYear = new Date().getFullYear();
                                  // Picks from past drafts that were [fut:N] — look up by draft_slot (= futId)
                                  const futActualPlayers = futPick && futPick.year < currentYear
                                    ? (draftPickByFutKey.get(`${futPick.year}-${futPick.round}-${futPick.futId}`) ?? [])
                                    : [];
                                  return (
                                    <div
                                      key={idx}
                                      className="flex items-start justify-between py-1.5 px-2 rounded hover:bg-white/5 cursor-pointer group border-b border-white/[0.04] last:border-0"
                                      onClick={(e) => handleAssetClick(displayDesc(item.item_description), e)}
                                    >
                                      <div className="min-w-0">
                                        <span className="text-sm text-white group-hover:text-blue-400 transition-colors">
                                          {displayDesc(item.item_description)}
                                        </span>
                                        {/* Show actual slot(s) for resolved [fut:N] past picks */}
                                        {futActualPlayers.length > 0 && futPick && (() => {
                                          const numTeams = 10;
                                          const p = futActualPlayers[0];
                                          const slot = ((p.pick_number - 1) % numTeams) + 1;
                                          return (
                                            <div className="text-[10px] text-slate-400 mt-0.5">
                                              → {futPick.year} ({futPick.round}.{String(slot).padStart(2, '0')}) · {p.player_name}
                                            </div>
                                          );
                                        })()}
                                      </div>
                                      <div className="text-right ml-4 shrink-0">
                                        <VorpValue vorp={vorp} />
                                        {seasons && seasons.length > 0 && (
                                          <div className="text-[10px] text-slate-500 mt-0.5 space-x-2">
                                            {seasons.map(s => (
                                              <span key={s.year}>
                                                <span className="text-slate-600">{s.year}:</span>
                                                {s.mult < 1 ? (
                                                  <span className={s.prorated >= 0 ? "text-sky-500" : "text-amber-600"}>
                                                    {s.prorated >= 0 ? "+" : ""}{s.prorated.toFixed(1)}
                                                    <span className="text-slate-600 text-[9px] ml-0.5">
                                                      ({s.vorp >= 0 ? "+" : ""}{s.vorp.toFixed(1)} × {Math.round(s.mult * 100)}%)
                                                    </span>
                                                  </span>
                                                ) : (
                                                  <span className={s.vorp >= 0 ? "text-sky-500" : "text-amber-600"}>
                                                    {s.vorp >= 0 ? "+" : ""}{s.vorp.toFixed(1)}
                                                  </span>
                                                )}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                        {seasons && seasons.length === 0 && item.item_type === "player" && (
                                          <div className="text-[10px] text-slate-600 mt-0.5">no data yet</div>
                                        )}
                                        {isRetradedPick && (
                                          <div className="text-[10px] text-slate-500 mt-0.5">slot avg</div>
                                        )}
                                        {pickGrade && !isRetradedPick && (
                                          <div className="text-[10px] text-slate-500 mt-0.5">
                                            {pickGrade.player_name}
                                          </div>
                                        )}
                                        {futPick && futPick.year < currentYear && (
                                          <div className="text-[10px] text-slate-600 mt-0.5">avg. actual</div>
                                        )}
                                        {item.item_type === "pick" && !resolvedPick && !futPick && (
                                          <div className="text-[10px] text-slate-600 mt-0.5">est.</div>
                                        )}
                                        {futPick && futPick.year >= currentYear && (
                                          <div className="text-[10px] text-slate-600 mt-0.5">est.</div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-[10px] text-slate-600 mt-3">
                        Players: 5yr VORP from trade date
                        {tradeInSeason && <span className="text-slate-700"> · first available Wk {displayWeek} — {tradeYear} season prorated to remaining {(tradeYear >= 2021 ? 17 : 16) - tradeWeek} weeks</span>}
                        {" · "}Resolved picks: player VORP if kept, slot avg if re-traded · Unresolved picks: estimated
                      </p>
                    </TableCell>
                  </TableRow>
                ) : null;

                if (isMultiTeam) {
                  const multiTeamRow = (
                    <TableRow
                      key={trade.id}
                      className="cursor-pointer hover:bg-white/[0.02]"
                      onClick={() => toggleTrade(trade.id)}
                    >
                      <TableCell className="align-top text-muted-foreground text-sm pt-4 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {isExpanded
                            ? <ChevronDown className="h-3 w-3 text-slate-400" />
                            : <ChevronRight className="h-3 w-3 text-slate-500" />
                          }
                          {format(parseTradeDateLocal(trade.trade_date), "MMM d, yyyy")}{tradeInSeason && <span className="block text-[10px] text-slate-500 mt-0.5">Wk {displayWeek}</span>}
                        </div>
                      </TableCell>
                      <TableCell colSpan={4} className="pt-3 pb-3">
                        <div
                          className="grid gap-3"
                          style={{ gridTemplateColumns: `repeat(auto-fit, minmax(180px, 1fr))` }}
                        >
                          {entries.map(([teamId, teamName]) => {
                            const teamVorp = computeTeamVorp(trade.items ?? [], teamId, tradeDate, trade.id);
                            const isWinner = winnerIds.has(teamId);
                            const received = sortItems(trade.items?.filter((i) => i.to_team_id === teamId) ?? []);
                            const tradedAway = sortItems(trade.items?.filter((i) => i.from_team_id === teamId) ?? []);
                            return (
                              <div key={teamId} className="rounded-lg border border-white/10 p-3">
                                <div className="flex items-center justify-between gap-2 mb-2">
                                  <Link
                                    to={`/team/${teamId}?season=${selectedSeason}`}
                                    className="font-medium text-primary hover:underline text-sm"
                                    onClick={e => e.stopPropagation()}
                                  >
                                    {teamName}
                                  </Link>
                                  {showVorp && teamVorp !== null && (
                                    <span className={cn(
                                      "text-[10px] font-mono shrink-0",
                                      isWinner ? "text-emerald-400" : "text-slate-500"
                                    )}>
                                      {teamVorp >= 0 ? "+" : ""}{teamVorp.toFixed(0)} VORP
                                      {isWinner && <span className="ml-1 text-emerald-400">★</span>}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Received</div>
                                <ul className="list-disc list-inside space-y-0.5 mb-2.5">
                                  {received.map((item, idx) => {
                                    const vorp = getItemVorp(item, tradeDate, trade.id);
                                    return (
                                      <li
                                        key={idx}
                                        className="text-sm cursor-pointer hover:text-primary hover:underline"
                                        onClick={(e) => handleAssetClick(displayDesc(item.item_description), e)}
                                      >
                                        {getPickLabel(item)}
                                        {showVorp && <VorpBadge vorp={vorp} title="VORP" />}
                                      </li>
                                    );
                                  })}
                                </ul>
                                <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Traded away</div>
                                <ul className="list-disc list-inside space-y-0.5">
                                  {tradedAway.map((item, idx) => (
                                    <li
                                      key={idx}
                                      className="text-sm text-slate-400 cursor-pointer hover:text-primary hover:underline"
                                      onClick={(e) => handleAssetClick(displayDesc(item.item_description), e)}
                                    >
                                      {getPickLabel(item)}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            );
                          })}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                  return [multiTeamRow, detailRow].filter(Boolean);
                }

                // Standard 2-team trade
                const [[t1Id, t1Name] = [null, null], [t2Id, t2Name] = [null, null]] = entries;
                const t1Vorp = computeTeamVorp(trade.items ?? [], t1Id!, tradeDate, trade.id);
                const t2Vorp = computeTeamVorp(trade.items ?? [], t2Id!, tradeDate, trade.id);
                const t1Wins = t1Vorp !== null && t2Vorp !== null && t1Vorp > t2Vorp;
                const t2Wins = t2Vorp !== null && t1Vorp !== null && t2Vorp > t1Vorp;

                return [
                  <TableRow
                    key={trade.id}
                    className="cursor-pointer hover:bg-white/[0.02]"
                    onClick={() => toggleTrade(trade.id)}
                  >
                    <TableCell className="text-muted-foreground text-sm whitespace-nowrap align-top pt-3">
                      <div className="flex items-center gap-1">
                        {isExpanded
                          ? <ChevronDown className="h-3 w-3 text-slate-400" />
                          : <ChevronRight className="h-3 w-3 text-slate-500" />
                        }
                        {format(parseTradeDateLocal(trade.trade_date), "MMM d, yyyy")}{tradeInSeason && <span className="block text-[10px] text-slate-500 mt-0.5">Wk {displayWeek}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium align-top pt-3">
                      {t1Id != null ? (
                        <>
                          <Link
                            to={`/team/${t1Id}?season=${selectedSeason}`}
                            className="text-primary hover:underline"
                            onClick={e => e.stopPropagation()}
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
                            const vorp = getItemVorp(item, tradeDate, trade.id);
                            return (
                              <li
                                key={idx}
                                className="text-sm cursor-pointer hover:text-primary hover:underline"
                                onClick={(e) => handleAssetClick(displayDesc(item.item_description), e)}
                              >
                                {getPickLabel(item)}
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
                            onClick={e => e.stopPropagation()}
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
                            const vorp = getItemVorp(item, tradeDate, trade.id);
                            return (
                              <li
                                key={idx}
                                className="text-sm cursor-pointer hover:text-primary hover:underline"
                                onClick={(e) => handleAssetClick(displayDesc(item.item_description), e)}
                              >
                                {getPickLabel(item)}
                                {showVorp && <VorpBadge vorp={vorp} title="VORP" />}
                              </li>
                            );
                          })}
                      </ul>
                    </TableCell>
                  </TableRow>,
                  detailRow,
                ].filter(Boolean);
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
