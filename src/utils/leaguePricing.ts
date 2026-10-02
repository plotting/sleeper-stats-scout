import type { CalcAsset } from "@/utils/marketCalc";
import type { LeagueTeam } from "@/utils/leagueTeams";

const ordinal = (n: number) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * What a team can put in a trade: every player it owns that has a value, and every draft pick it owns
 * (priced by the slot tier when the draft order is projected, else by the round average). Richest first.
 * Pick assets keep the `pk:` prefix so side totals treat them as picks; `meta.priceKey` says which value row prices them.
 */
export function teamAssets(
  team: LeagueTeam, entries: CalcAsset[], values: Map<string, { value: number; n_trades: number }>, teamNames: Map<number, string>, now: Date,
): CalcAsset[] {
  const owned = new Set(team.players);
  const out: CalcAsset[] = entries.filter((e) => e.meta?.playerId && owned.has(e.meta.playerId));
  for (const p of team.picks) {
    const off = p.season - now.getUTCFullYear();
    if (off < 0 || off > 3 || p.round < 1 || p.round > 5) continue;
    const base = `pk:${off}:${p.round}`;
    const tiered = p.tier ? `${base}:${p.tier}` : null;
    const priceKey = tiered && values.has(tiered) ? tiered : base;
    const v = values.get(priceKey);
    if (!v) continue;
    const from = p.originalRosterId === team.rosterId ? "" : ` (${teamNames.get(p.originalRosterId) ?? `Team ${p.originalRosterId}`})`;
    out.push({
      key: `${base}:${p.tier ?? "any"}:${p.originalRosterId}`,
      label: `${p.season} ${tiered && priceKey === tiered ? `${cap(p.tier!)} ` : ""}${ordinal(p.round)}${from}`,
      sub: "Pick", value: v.value, nTrades: v.n_trades, meta: { priceKey },
    });
  }
  return out.sort((a, b) => b.value - a.value);
}
