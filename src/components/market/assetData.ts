import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { daysBetween, pickOptions, type CalcAsset } from "@/utils/marketCalc";

// Data helpers shared by the Trade Calculator and the Trade Market (components live in assetUi.tsx).

export interface PlayerRow { player_id: string; name: string; position: string | null; team: string | null; age: number | null }
interface ValueRow { asset_key: string; value: number; n_trades: number }

export async function loadValues(format: string): Promise<Map<string, { value: number; n_trades: number }>> {
  const out = new Map<string, { value: number; n_trades: number }>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("market_values" as never).select("asset_key, value, n_trades").eq("format", format).range(from, from + 999);
    if (error) throw error;
    for (const r of (data ?? []) as unknown as ValueRow[]) out.set(r.asset_key, { value: Number(r.value), n_trades: r.n_trades });
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Fitted values as they stood about `days` days ago (the closest saved day at or before then; null until that much history exists). */
export async function loadValuesAgo(format: string, days: number): Promise<{ asOf: string; values: Map<string, number> } | null> {
  const target = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const { data: day } = await supabase.from("market_value_history" as never).select("as_of").eq("format", format).lte("as_of", target).order("as_of", { ascending: false }).limit(1);
  const asOf = (day as unknown as Array<{ as_of: string }> | null)?.[0]?.as_of;
  if (!asOf || daysBetween(asOf, target) > 3) return null; // too stale to call it "N days ago"
  const values = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("market_value_history" as never).select("asset_key, value").eq("format", format).eq("as_of", asOf).order("asset_key").range(from, from + 999);
    if (error) throw error;
    for (const r of (data ?? []) as unknown as Array<{ asset_key: string; value: number }>) values.set(r.asset_key, Number(r.value));
    if (!data || data.length < 1000) break;
  }
  return { asOf, values };
}

export const POS_BADGE: Record<string, string> = {
  QB: "text-red-400 bg-red-500/15 border-red-500/30",
  RB: "text-emerald-400 bg-emerald-500/15 border-emerald-500/30",
  WR: "text-sky-400 bg-sky-500/15 border-sky-500/30",
  TE: "text-orange-400 bg-orange-500/15 border-orange-500/30",
};

export async function loadDirectory(): Promise<Map<string, PlayerRow>> {
  const out = new Map<string, PlayerRow>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("sleeper_players" as never).select("player_id, name, position, team, age").order("player_id").range(from, from + 999);
    if (error) throw error;
    for (const p of (data ?? []) as unknown as PlayerRow[]) out.set(p.player_id, p);
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Every valued player (QB/RB/WR/TE) with headshot info and a position rank, plus the plain pick options, richest first. */
export function buildEntries(values: Map<string, { value: number; n_trades: number }>, directory: Map<string, PlayerRow> | undefined, changes?: Map<string, number>): CalcAsset[] {
  const players: CalcAsset[] = [];
  for (const [key, v] of values) {
    if (!key.startsWith("p:")) continue;
    const info = directory?.get(key.slice(2));
    if (!info || !["QB", "RB", "WR", "TE"].includes(info.position ?? "")) continue;
    players.push({ key, label: info.name, value: v.value, nTrades: v.n_trades, meta: { change: changes?.get(key) ?? null, playerId: info.player_id, position: info.position, team: info.team, age: info.age } });
  }
  const byPos = new Map<string, CalcAsset[]>();
  for (const a of players) (byPos.get(a.meta!.position!) ?? byPos.set(a.meta!.position!, []).get(a.meta!.position!)!).push(a);
  for (const [pos, list] of byPos) list.sort((x, y) => y.value - x.value).forEach((a, i) => { a.meta!.rank = `${pos}${i + 1}`; });
  return [...players, ...pickOptions(new Date(), values)].sort((x, y) => y.value - x.value);
}

/** Hook-free memo helper so pages can share the same entry list. */
export function useEntries(values: Map<string, { value: number; n_trades: number }> | undefined, directory: Map<string, PlayerRow> | undefined, changes?: Map<string, number>): CalcAsset[] {
  return useMemo(() => (values ? buildEntries(values, directory, changes) : []), [values, directory, changes]);
}
