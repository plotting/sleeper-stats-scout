import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FIRST_SEASON_YEAR, LEAGUE_SIZE } from "@/utils/seasonUtils";
import {
  buildExpectedVorpCurve,
  getExpectedVorp,
  nameKey,
  displayDesc,
  parseResolvedPick,
  type HistoricalPick,
} from "@/utils/dynastyValue";
import {
  getNFLWeek,
  parseUnresolvedPickFut,
  pickFallbackVorp,
  resolveDSTFullName,
  type DraftPickLookupRow,
  type PlayerSeasonVorp,
  type TradeItem,
} from "@/utils/tradeHelpers";

/** Run a `.in()` query in chunks so a long list of names never overflows the request URL. */
async function selectInChunks<T>(
  table: string,
  columns: string,
  column: string,
  values: string[],
  size = 120,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < values.length; i += size) {
    const { data, error } = await supabase
      .from(table as never)
      .select(columns)
      .in(column, values.slice(i, i + size));
    if (error) throw error;
    out.push(...((data ?? []) as unknown as T[]));
  }
  return out;
}

/**
 * VORP valuation for trades: players = 5 seasons from the trade date (first year prorated by
 * week), kept picks = the drafted player's 5-year VORP, re-traded picks = the slot's expected
 * VORP, unresolved picks = estimates. Shared by the Trades page and the Trade Grades tab.
 */
export function useTradeValuation(
  trades: Array<{ id: number; items?: TradeItem[] | null }> | undefined,
  enabled: boolean,
) {
  const playerNames = (() => {
    if (!trades || !enabled) return [];
    const names = new Set<string>();
    for (const t of trades) {
      for (const item of t.items ?? []) {
        if (item.item_type === "player") {
          // DST items are stored as "Eagles D/ST" but player_seasons uses "Philadelphia Eagles"
          const dstFull = resolveDSTFullName(item.item_description);
          names.add(nameKey(dstFull ?? item.item_description));
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
      return selectInChunks<PlayerSeasonVorp>("player_vorp", "player_name, name_key, year, vorp", "name_key", playerNames);
    },
    enabled: enabled && playerNames.length > 0,
  });

  // Build lookup: player name (lower) → seasons[]
  const playerVorpByName = new Map<string, Array<{ year: number; vorp: number }>>();
  for (const row of playerSeasonVorps ?? []) {
    const key = row.name_key ?? nameKey(row.player_name);
    if (!playerVorpByName.has(key)) playerVorpByName.set(key, []);
    playerVorpByName.get(key)!.push({ year: Number(row.year), vorp: Number(row.vorp) });
  }

  function lookupPlayerVorp(name: string): Array<{ year: number; vorp: number }> | undefined {
    const dstFull = resolveDSTFullName(name);
    return playerVorpByName.get(nameKey(dstFull ?? name));
  }

  // Resolved pick grades
  const resolvedPickKeys = (() => {
    if (!trades || !enabled) return [] as Array<{ year: number; pick: number }>;
    const keys: Array<{ year: number; pick: number }> = [];
    for (const t of trades) {
      for (const item of t.items ?? []) {
        if (item.item_type === "pick") {
          const parsed = parseResolvedPick(item.item_description);
          if (parsed) keys.push({ year: parsed.year, pick: (parsed.round - 1) * LEAGUE_SIZE + parsed.pick });
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
    enabled: enabled && resolvedPickKeys.length > 0,
  });

  const pickGradeByKey = new Map<string, { draft_year: number; overall_pick: number; player_name: string; five_yr_vorp: number; vorp_grade: string }>(
    (pickGrades ?? []).map(p => [`${p.draft_year}:${p.overall_pick}`, p])
  );

  // Year-by-year expected VORP for a slot (draft year + 0..4), shown on re-traded picks.
  const { data: slotYearRows } = useQuery({
    queryKey: ["slot-expected-by-year"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("slot_expected_by_year" as never)
        .select("overall_pick, season_offset, avg_vorp");
      if (error) throw error;
      return data as unknown as Array<{ overall_pick: number; season_offset: number; avg_vorp: number }>;
    },
    enabled: enabled,
    retry: false,
  });
  const slotYearsBySlot = new Map<number, Array<{ offset: number; vorp: number }>>();
  for (const row of slotYearRows ?? []) {
    const slot = Number(row.overall_pick);
    slotYearsBySlot.set(slot, [...(slotYearsBySlot.get(slot) ?? []), { offset: Number(row.season_offset), vorp: Number(row.avg_vorp) }]);
  }
  function getSlotExpectedSeasons(draftYear: number, overall: number) {
    return (slotYearsBySlot.get(overall) ?? [])
      .sort((a, b) => a.offset - b.offset)
      .map((o) => ({ year: draftYear + o.offset, vorp: o.vorp, prorated: o.vorp, mult: 1 }));
  }

  // Per-season VORP of the players drafted with resolved picks (for the year-by-year line).
  const draftedNames = [...new Set((pickGrades ?? []).map((p) => p.player_name))];
  const { data: draftedSeasonRows } = useQuery({
    queryKey: ["drafted-player-seasons", draftedNames],
    queryFn: async () => {
      if (!draftedNames.length) return [] as PlayerSeasonVorp[];
      return selectInChunks<PlayerSeasonVorp>("player_vorp", "player_name, year, vorp", "player_name", draftedNames);
    },
    enabled: enabled && draftedNames.length > 0,
  });
  const draftedSeasonsByName = new Map<string, Array<{ year: number; vorp: number }>>();
  for (const row of draftedSeasonRows ?? []) {
    const key = row.player_name.toLowerCase();
    draftedSeasonsByName.set(key, [...(draftedSeasonsByName.get(key) ?? []), { year: Number(row.year), vorp: Number(row.vorp) }]);
  }
  /** The drafted player's season-by-season VORP over the 5-season window from the draft year. */
  function getDraftedPlayerSeasons(playerName: string, draftYear: number) {
    return (draftedSeasonsByName.get(playerName.toLowerCase()) ?? [])
      .filter((s) => s.year >= draftYear && s.year <= draftYear + 4)
      .sort((a, b) => a.year - b.year)
      .map((s) => ({ year: s.year, vorp: s.vorp, prorated: s.vorp, mult: 1 }));
  }

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
      const seasonNumbers = [...new Set(unresolvedPastPickKeys.map(k => k.year - (FIRST_SEASON_YEAR - 1)))];
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
    enabled: enabled && unresolvedPickYears.length > 0,
  });

  // Expected 5yr VORP by overall pick: the same smoothed (±1 slot) curve the Draft
  // Grades page uses, built from completed draft classes only (no startup draft, no
  // classes with fewer than 5 seasons). Credited for picks the receiver re-traded.
  const { data: slotCurveRows } = useQuery({
    queryKey: ["slot-curve-rows"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rookie_draft_grades" as never)
        .select("overall_pick, five_yr_vorp, draft_year, position")
        .range(0, 9999);
      if (error) throw error;
      return data as unknown as HistoricalPick[];
    },
    enabled: enabled,
  });
  const slotCurve = useMemo(() => buildExpectedVorpCurve(slotCurveRows ?? []), [slotCurveRows]);

  // Build lookups
  // "year-round-draftSlot" → the pick used by the original slot owner in that year/round.
  // draft_slot = futId from [fut:N] description = Sleeper roster_id of original pick owner.
  const draftPickByFutKey = new Map<string, DraftPickLookupRow[]>();
  for (const dp of draftPickLookups ?? []) {
    const year = dp.season_number + FIRST_SEASON_YEAR - 1;
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
        .eq("item_type", "pick")
        .range(0, 9999);
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
        const overall = (resolved.round - 1) * LEAGUE_SIZE + resolved.pick;
        const desc = displayDesc(item.item_description);
        // If the receiver re-traded this pick, credit them with the historical slot average
        const isRetraded =
          tradeId != null &&
          item.to_team_id != null &&
          retradedPicks.has(`${tradeId}:${desc}:${item.to_team_id}`);
        if (isRetraded) {
          return getExpectedVorp(slotCurve, overall);
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


  return {
    getItemVorp,
    getPlayerSeasons,
    computeTeamVorp,
    getSlotExpectedSeasons,
    getDraftedPlayerSeasons,
    pickGradeByKey,
    retradedPicks,
    draftPickByFutKey,
    getSeasonMultiplier,
  };
}
