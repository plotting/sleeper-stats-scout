
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
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

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

interface PlayerSeasonVorp {
  player_name: string;
  year: number;
  vorp: number;
}

interface DraftPickLookupRow {
  round: number;
  pick_number: number;
  player_name: string;
  team_id: number;
  draft_slot: number;
  season_number: number;
}

/** Fallback estimate for unresolved picks when no actual data available */
function pickFallbackVorp(description: string): number | null {
  const clean = displayDesc(description);
  const m = clean.match(/^(\d{4}) (\d+)(?:st|nd|rd|th) Round/);
  if (!m) return null;
  const round = Number(m[2]);
  return round === 1 ? 100 : round === 2 ? 30 : 10;
}

/** Parse an unresolved [fut:N] pick description → { year, round, futId } or null.
 *  futId is the Sleeper roster_id of the original pick owner, which equals draft_slot in draft_picks.
 */
function parseUnresolvedPickFut(desc: string): { year: number; round: number; futId: number } | null {
  const m = desc.match(/^(\d{4}) (\d+)(?:st|nd|rd|th) Round Pick \[fut:(\d+)\]/);
  if (!m) return null;
  return { year: Number(m[1]), round: Number(m[2]), futId: Number(m[3]) };
}

/**
 * Returns which NFL calendar week a given date falls in.
 * Week 0 = offseason/preseason. Weeks 1-18 = regular season.
 * NFL Week 1 always starts on the Thursday in the Sep 4-10 window.
 * (The old "on or after Sep 5" base was wrong for 2025, which started Sep 4.)
 */
function getNFLWeek(date: Date): { week: number; inSeason: boolean } {
  const year = date.getFullYear();
  const sep4 = new Date(year, 8, 4);
  const daysToThursday = (4 - sep4.getDay() + 7) % 7;
  const week1Start = new Date(year, 8, 4 + daysToThursday);

  if (date < week1Start) return { week: 0, inSeason: false };

  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weekNum = Math.floor((date.getTime() - week1Start.getTime()) / msPerWeek) + 1;

  if (weekNum > 18) return { week: 18, inSeason: false };
  return { week: weekNum, inSeason: true };
}

/**
 * Returns the first week a player acquired via trade can actually play.
 * Sunday (0) and Monday (1) fall after the main game slate — the player
 * can't be inserted until the following week.
 * Tuesday–Saturday trades allow playing in the current week.
 */
function getFirstPlayableWeek(tradeDate: Date, calendarWeek: number): number {
  const day = tradeDate.getDay(); // 0=Sun, 1=Mon
  return (day === 0 || day === 1) ? calendarWeek + 1 : calendarWeek;
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

/**
 * Maps DST nicknames (as stored in trade_items, e.g. "Eagles D/ST") to the
 * full team name used in player_seasons (e.g. "Philadelphia Eagles").
 * Includes common typos and legacy names.
 */
const DST_NICKNAME_TO_FULL: Record<string, string> = {
  'cardinals':   'Arizona Cardinals',
  'falcons':     'Atlanta Falcons',
  'ravens':      'Baltimore Ravens',
  'bills':       'Buffalo Bills',
  'panthers':    'Carolina Panthers',
  'bears':       'Chicago Bears',
  'bengals':     'Cincinnati Bengals',
  'browns':      'Cleveland Browns',
  'cowboys':     'Dallas Cowboys',
  'broncos':     'Denver Broncos',
  'lions':       'Detroit Lions',
  'packers':     'Green Bay Packers',
  'texans':      'Houston Texans',
  'colts':       'Indianapolis Colts',
  'jaguars':     'Jacksonville Jaguars',
  'chiefs':      'Kansas City Chiefs',
  'cheifs':      'Kansas City Chiefs', // typo variant
  'raiders':     'Las Vegas Raiders',
  'chargers':    'Los Angeles Chargers',
  'rams':        'Los Angeles Rams',
  'dolphins':    'Miami Dolphins',
  'vikings':     'Minnesota Vikings',
  'patriots':    'New England Patriots',
  'saints':      'New Orleans Saints',
  'giants':      'New York Giants',
  'jets':        'New York Jets',
  'eagles':      'Philadelphia Eagles',
  'steelers':    'Pittsburgh Steelers',
  '49ers':       'San Francisco 49ers',
  'seahawks':    'Seattle Seahawks',
  'buccaneers':  'Tampa Bay Buccaneers',
  'titans':      'Tennessee Titans',
  'commanders':  'Washington Commanders',
  'redskins':    'Washington Commanders',
  'football team': 'Washington Commanders',
};

/** Convert "Eagles D/ST" → "Philadelphia Eagles" (for player_seasons lookup). Returns null if not a DST item. */
function resolveDSTFullName(itemDesc: string): string | null {
  const m = itemDesc.match(/^(.+?)\s+D\/ST$/i);
  if (!m) return null;
  return DST_NICKNAME_TO_FULL[m[1].toLowerCase()] ?? null;
}

const Trades = () => {
  const [selectedSeason, setSelectedSeason] = useState("14");
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

  const playerNames = (() => {
    if (!trades || !needsVorp) return [];
    const names = new Set<string>();
    for (const t of trades) {
      for (const item of t.items ?? []) {
        if (item.item_type === "player") {
          // DST items are stored as "Eagles D/ST" but player_seasons uses "Philadelphia Eagles"
          const dstFull = resolveDSTFullName(item.item_description);
          names.add(dstFull ?? item.item_description);
        }
      }
    }
    return [...names];
  })();

  // Per-season VORP (for 5yr-from-trade-date calculation)
  const { data: playerSeasonVorps } = useQuery({
    queryKey: ["player-season-vorp", playerNames],
    queryFn: async () => {
      if (!playerNames.length) return [] as PlayerSeasonVorp[];
      const { data, error } = await supabase
        .from("player_vorp" as never)
        .select("player_name, year, vorp")
        .in("player_name", playerNames);
      if (error) throw error;
      return data as PlayerSeasonVorp[];
    },
    enabled: needsVorp && playerNames.length > 0,
  });

  // Build lookup: player name (lower) → seasons[]
  const playerVorpByName = new Map<string, Array<{ year: number; vorp: number }>>();
  for (const row of playerSeasonVorps ?? []) {
    const key = row.player_name.toLowerCase();
    if (!playerVorpByName.has(key)) playerVorpByName.set(key, []);
    playerVorpByName.get(key)!.push({ year: Number(row.year), vorp: Number(row.vorp) });
  }

  /**
   * Strip generational suffixes (Jr., Sr., II, III, IV, V, VI) for fallback matching.
   * Handles cases where trade_items stored names without suffixes (synced before full_name
   * was used) while player_seasons uses the full Sleeper name.
   */
  function stripNameSuffix(name: string): string {
    return name.replace(/\s+(Jr\.?|Sr\.?|II|III|IV|V|VI)$/i, '').trim();
  }

  // Secondary lookup keyed by suffix-stripped lowercase name (fallback for mismatches)
  const playerVorpByStrippedName = new Map<string, Array<{ year: number; vorp: number }>>();
  for (const [key, seasons] of playerVorpByName) {
    const stripped = stripNameSuffix(key).toLowerCase();
    if (!playerVorpByStrippedName.has(stripped)) {
      playerVorpByStrippedName.set(stripped, seasons);
    }
  }

  function lookupPlayerVorp(name: string): Array<{ year: number; vorp: number }> | undefined {
    return playerVorpByName.get(name.toLowerCase())
      ?? playerVorpByStrippedName.get(stripNameSuffix(name).toLowerCase())
      ?? (() => {
        const dstFull = resolveDSTFullName(name);
        return dstFull ? playerVorpByName.get(dstFull.toLowerCase()) : undefined;
      })();
  }

  // Resolved pick grades
  const resolvedPickKeys = (() => {
    if (!trades || !needsVorp) return [] as Array<{ year: number; pick: number }>;
    const keys: Array<{ year: number; pick: number }> = [];
    for (const t of trades) {
      for (const item of t.items ?? []) {
        if (item.item_type === "pick") {
          const parsed = parseResolvedPick(item.item_description);
          if (parsed) keys.push({ year: parsed.year, pick: (parsed.round - 1) * 20 + parsed.pick });
        }
      }
    }
    return keys;
  })();

  const { data: pickGrades } = useQuery({
    queryKey: ["pick-vorp-grades", resolvedPickKeys],
    queryFn: async () => {
      if (!resolvedPickKeys.length) return [];
      const { data, error } = await supabase
        .from("rookie_draft_grades" as never)
        .select("draft_year,overall_pick,player_name,five_yr_vorp,vorp_grade")
        .in("draft_year", [...new Set(resolvedPickKeys.map(k => k.year))]);
      if (error) throw error;
      return data as Array<{ draft_year: number; overall_pick: number; player_name: string; five_yr_vorp: number; vorp_grade: string }>;
    },
    enabled: needsVorp && resolvedPickKeys.length > 0,
  });

  const pickGradeByKey = new Map<string, { draft_year: number; overall_pick: number; player_name: string; five_yr_vorp: number; vorp_grade: string }>(
    (pickGrades ?? []).map(p => [`${p.draft_year}:${p.overall_pick}`, p])
  );

  // ── Unresolved [fut:N] picks from past drafts ──────────────────────────────
  // The [fut:N] number IS the Sleeper roster_id of the original pick owner, which equals
  // draft_picks.draft_slot (the original draft slot, never changes when picks are traded).
  // Key by (year, round, futId) so we can look up by draft_slot for exact slot resolution.
  const unresolvedPastPickKeys = (() => {
    if (!trades) return [] as Array<{ year: number; round: number; futId: number }>;
    const currentYear = new Date().getFullYear();
    const seen = new Set<string>();
    const result: Array<{ year: number; round: number; futId: number }> = [];
    for (const t of trades) {
      for (const item of t.items ?? []) {
        if (item.item_type !== "pick") continue;
        const fut = parseUnresolvedPickFut(item.item_description);
        if (!fut || fut.year >= currentYear) continue;
        const key = `${fut.year}-${fut.round}-${fut.futId}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push({ year: fut.year, round: fut.round, futId: fut.futId });
        }
      }
    }
    return result;
  })();

  // Fetch actual draft picks by draft_slot (original owner's roster_id, never changes with trades).
  // This resolves [fut:N] picks precisely — draft_slot = futId from the description.
  const { data: draftPickLookups } = useQuery({
    queryKey: ["draft-pick-lookups", unresolvedPastPickKeys],
    queryFn: async () => {
      if (!unresolvedPastPickKeys.length) return [] as DraftPickLookupRow[];
      const seasonNumbers = [...new Set(unresolvedPastPickKeys.map(k => k.year - 2012))];
      const rounds = [...new Set(unresolvedPastPickKeys.map(k => k.round))];
      const draftSlots = [...new Set(unresolvedPastPickKeys.map(k => k.futId))];
      const { data, error } = await supabase
        .from("draft_picks")
        .select("round, pick_number, player_name, team_id, draft_slot, seasons!inner(season_number)")
        .in("round", rounds)
        .in("draft_slot", draftSlots);
      if (error) throw error;
      const validSeasons = new Set(seasonNumbers);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data as any[])
        .filter((d: any) => validSeasons.has(d.seasons?.season_number))
        .map((d: any) => ({
          round: d.round as number,
          pick_number: d.pick_number as number,
          player_name: d.player_name as string,
          team_id: d.team_id as number,
          draft_slot: d.draft_slot as number,
          season_number: d.seasons.season_number as number,
        })) as DraftPickLookupRow[];
    },
    // Always enabled — pick slot labels need this data regardless of VORP toggle
    enabled: unresolvedPastPickKeys.length > 0,
  });

  // Fetch average 5yr VORP by (draft_year, round) from rookie_draft_grades for unresolved past picks
  const unresolvedPickYears = [...new Set(unresolvedPastPickKeys.map(k => k.year))];
  const { data: roundAvgVorps } = useQuery({
    queryKey: ["round-avg-vorp", unresolvedPickYears],
    queryFn: async () => {
      if (!unresolvedPickYears.length) return [] as Array<{ draft_year: number; round: number; avg_vorp: number }>;
      const { data, error } = await supabase
        .from("rookie_draft_grades" as never)
        .select("draft_year, round, five_yr_vorp")
        .in("draft_year", unresolvedPickYears);
      if (error) throw error;
      // Group and average client-side
      const byKey = new Map<string, number[]>();
      for (const row of data as Array<{ draft_year: number; round: number; five_yr_vorp: number }>) {
        const key = `${row.draft_year}-${row.round}`;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key)!.push(Number(row.five_yr_vorp));
      }
      return [...byKey.entries()].map(([key, vorps]) => {
        const [year, round] = key.split("-").map(Number);
        return { draft_year: year, round, avg_vorp: vorps.reduce((a, b) => a + b, 0) / vorps.length };
      });
    },
    enabled: needsVorp && unresolvedPickYears.length > 0,
  });

  // Historical slot-average VORP: avg five_yr_vorp by overall_pick across all draft years.
  // Used for picks that were re-traded (receiver passed the pick on rather than drafting with it).
  const { data: slotAvgData } = useQuery({
    queryKey: ["slot-avg-vorp"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rookie_draft_grades" as never)
        .select("overall_pick, five_yr_vorp");
      if (error) throw error;
      const bySlot = new Map<number, number[]>();
      for (const row of data as Array<{ overall_pick: number; five_yr_vorp: number }>) {
        const slot = Number(row.overall_pick);
        if (!bySlot.has(slot)) bySlot.set(slot, []);
        bySlot.get(slot)!.push(Number(row.five_yr_vorp));
      }
      return [...bySlot.entries()].map(([overall_pick, vorps]) => ({
        overall_pick,
        avg_vorp: vorps.reduce((a, b) => a + b, 0) / vorps.length,
      }));
    },
    enabled: needsVorp,
  });

  const slotAvgByOverallPick = new Map<number, number>(
    (slotAvgData ?? []).map(r => [r.overall_pick, r.avg_vorp])
  );

  // Build lookups
  // "year-round-draftSlot" → the pick used by the original slot owner in that year/round.
  // draft_slot = futId from [fut:N] description = Sleeper roster_id of original pick owner.
  const draftPickByFutKey = new Map<string, DraftPickLookupRow[]>();
  for (const dp of draftPickLookups ?? []) {
    const year = dp.season_number + 2012;
    const key = `${year}-${dp.round}-${dp.draft_slot}`;
    if (!draftPickByFutKey.has(key)) draftPickByFutKey.set(key, []);
    draftPickByFutKey.get(key)!.push(dp);
  }
  // "year-round" → average 5yr VORP for that year/round
  const roundAvgVorpByKey = new Map<string, number>(
    (roundAvgVorps ?? []).map(r => [`${r.draft_year}-${r.round}`, r.avg_vorp])
  );

  /**
   * Fetch ALL pick trade_items across every season so we can detect cross-season pick chains.
   * A pick received in Season 12 and re-traded in Season 13 still counts as "re-traded" —
   * the receiver should get slot-average VORP, not the actual player's VORP.
   */
  const { data: allPickItems } = useQuery({
    queryKey: ["all-pick-movements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trade_items")
        .select("trade_id, item_description, from_team_id, to_team_id")
        .eq("item_type", "pick");
      if (error) throw error;
      return data as Array<{ trade_id: number; item_description: string; from_team_id: number; to_team_id: number }>;
    },
    staleTime: 5 * 60 * 1000, // stable data — cache for 5 min
  });

  /**
   * Build the re-traded set from the global pick-movement list.
   * Key: "tradeId:normalizedDesc:toTeamId" — present when the receiver later sent this pick away.
   */
  const retradedPicks = (() => {
    if (!allPickItems) return new Set<string>();
    const movements = new Map<string, Array<{ tradeId: number; fromTeam: number; toTeam: number }>>();
    for (const item of allPickItems) {
      if (!parseResolvedPick(item.item_description)) continue;
      const desc = displayDesc(item.item_description);
      if (!movements.has(desc)) movements.set(desc, []);
      if (item.from_team_id != null && item.to_team_id != null) {
        movements.get(desc)!.push({ tradeId: item.trade_id, fromTeam: item.from_team_id, toTeam: item.to_team_id });
      }
    }
    const retraded = new Set<string>();
    for (const [desc, movs] of movements) {
      for (const mov of movs) {
        // Re-traded: this receiver (mov.toTeam) later appears as the sender of the same pick
        if (movs.some(m => m.tradeId !== mov.tradeId && m.fromTeam === mov.toTeam)) {
          retraded.add(`${mov.tradeId}:${desc}:${mov.toTeam}`);
        }
      }
    }
    return retraded;
  })();

  /**
   * Prorate a season's VORP based on remaining NFL weeks at time of trade.
   * Returns multiplier 0–1. Offseason trades = 1 (full year counts).
   */
  function getSeasonMultiplier(tradeDate: Date, seasonYear: number): number {
    if (new Date(tradeDate).getFullYear() !== seasonYear) return 1;
    const { week, inSeason } = getNFLWeek(tradeDate);
    if (!inSeason) return 1;
    const totalWeeks = seasonYear >= 2021 ? 17 : 16;
    const remaining = Math.max(0, totalWeeks - week);
    return remaining / totalWeeks;
  }

  /** Get VORP for a trade item — 5yr window from trade date, first year prorated by week.
   *  For resolved picks: if the receiver re-traded the pick, use historical slot-average VORP;
   *  if the receiver kept and drafted, use the actual player's 5yr VORP. */
  function getItemVorp(item: TradeItem, tradeDate: Date, tradeId?: number): number | null {
    const tradeYear = tradeDate.getFullYear();
    if (item.item_type === "player") {
      const seasons = lookupPlayerVorp(item.item_description);
      if (!seasons) return null;
      const window = seasons.filter(s => s.year >= tradeYear && s.year <= tradeYear + 4);
      if (!window.length) return null;
      return window.reduce((sum, s) => {
        const mult = getSeasonMultiplier(tradeDate, s.year);
        return sum + s.vorp * mult;
      }, 0);
    }
    if (item.item_type === "pick") {
      const resolved = parseResolvedPick(item.item_description);
      if (resolved) {
        const overall = (resolved.round - 1) * 20 + resolved.pick;
        const desc = displayDesc(item.item_description);
        // If the receiver re-traded this pick, credit them with the historical slot average
        const isRetraded =
          tradeId != null &&
          item.to_team_id != null &&
          retradedPicks.has(`${tradeId}:${desc}:${item.to_team_id}`);
        if (isRetraded) {
          return slotAvgByOverallPick.get(overall) ?? null;
        }
        // Final holder — use actual player's 5yr VORP
        const pg = pickGradeByKey.get(`${resolved.year}:${overall}`);
        return pg ? Number(pg.five_yr_vorp) : null;
      }
      // Unresolved [fut:N] pick from a past draft — use actual avg VORP for that year/round
      const fut = parseUnresolvedPickFut(item.item_description);
      if (fut) {
        const currentYear = new Date().getFullYear();
        if (fut.year < currentYear) {
          const avgVorp = roundAvgVorpByKey.get(`${fut.year}-${fut.round}`);
          if (avgVorp !== undefined) {
            // Prorate first year if in-season trade
            const mult = getSeasonMultiplier(tradeDate, fut.year);
            return avgVorp * mult;
          }
        }
      }
      return pickFallbackVorp(item.item_description);
    }
    return null;
  }

  /**
   * Get per-season breakdown for a player in the 5yr window.
   * Returns raw vorp + prorated vorp for display.
   */
  function getPlayerSeasons(
    playerName: string,
    tradeDate: Date,
  ): Array<{ year: number; vorp: number; prorated: number; mult: number }> {
    const tradeYear = tradeDate.getFullYear();
    const seasons = lookupPlayerVorp(playerName);
    if (!seasons) return [];
    return seasons
      .filter(s => s.year >= tradeYear && s.year <= tradeYear + 4)
      .sort((a, b) => a.year - b.year)
      .map(s => {
        const mult = getSeasonMultiplier(tradeDate, s.year);
        return { year: s.year, vorp: s.vorp, prorated: s.vorp * mult, mult };
      });
  }

  function computeTeamVorp(items: TradeItem[], teamId: number | null, tradeDate: Date, tradeId?: number): number | null {
    if (teamId === null) return null;
    const received = items.filter(i => i.to_team_id === teamId);
    if (!received.length) return null;
    let total = 0;
    let hasAny = false;
    for (const item of received) {
      const v = getItemVorp(item, tradeDate, tradeId);
      if (v !== null) { total += v; hasAny = true; }
    }
    return hasAny ? total : null;
  }

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
                                  const seasons = item.item_type === "player"
                                    ? getPlayerSeasons(item.item_description, tradeDate)
                                    : null;
                                  const resolvedPick = item.item_type === "pick"
                                    ? parseResolvedPick(item.item_description)
                                    : null;
                                  const isRetradedPick = resolvedPick != null &&
                                    item.to_team_id != null &&
                                    retradedPicks.has(`${trade.id}:${displayDesc(item.item_description)}:${item.to_team_id}`);
                                  const pickGrade = resolvedPick && !isRetradedPick
                                    ? pickGradeByKey.get(`${resolvedPick.year}:${(resolvedPick.round - 1) * 20 + resolvedPick.pick}`)
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
