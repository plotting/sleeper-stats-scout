// Pure helpers for the Trade Calculator, which prices trades with the values fitted from
// completed market trades (market_values; see scripts/lib/tradeFit.ts for how they are made).

export interface CalcAsset {
  key: string;        // "p:<sleeper id>" | "pk:<years ahead>:<round>"
  label: string;
  sub?: string;       // position / team, or pick note
  value: number;
  nTrades: number;
}

export type FairTier = 'even' | 'close' | 'edge' | 'lop';

export const TIER_LABEL: Record<FairTier, string> = { even: 'Dead even', close: 'Close', edge: 'Clear winner', lop: 'Lopsided' };

/** Same thresholds as the fitted trade scores: gap as a share of the bigger side. */
export function assess(receive: CalcAsset[], send: CalcAsset[]) {
  const recv = receive.reduce((s, a) => s + a.value, 0);
  const sent = send.reduce((s, a) => s + a.value, 0);
  const big = Math.max(recv, sent);
  const diffPct = big > 0 ? (Math.abs(recv - sent) / big) * 100 : 0;
  const tier: FairTier = diffPct <= 10 ? 'even' : diffPct <= 25 ? 'close' : diffPct <= 50 ? 'edge' : 'lop';
  return { recv, sent, gap: recv - sent, diffPct, tier, winner: recv === sent ? null : recv > sent ? ('you' as const) : ('them' as const) };
}

const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

/**
 * Picks you can trade today. Fitted pick keys are relative to the trade's calendar year, so
 * after the draft (June on) this year's class is gone and the next three are offered.
 */
export function pickOptions(now: Date, values: Map<string, { value: number; n_trades: number }>): CalcAsset[] {
  const year = now.getUTCFullYear();
  const first = now.getUTCMonth() >= 5 ? 1 : 0;
  const out: CalcAsset[] = [];
  for (let offset = first; offset <= first + 2; offset++) {
    for (let round = 1; round <= 5; round++) {
      const key = `pk:${offset}:${round}`;
      const v = values.get(key);
      if (!v) continue;
      out.push({ key, label: `${year + offset} ${ordinal(round)}`, sub: 'Pick', value: v.value, nTrades: v.n_trades });
    }
  }
  return out;
}

/** Assets closest to the gap, to even a trade out. Only ones with some trade history. */
export function suggestToEven(gap: number, pool: CalcAsset[], exclude: Set<string>, minTrades = 3, limit = 4): CalcAsset[] {
  const need = Math.abs(gap);
  if (need < 1) return [];
  return pool
    .filter((a) => !exclude.has(a.key) && a.nTrades >= minTrades)
    .sort((a, b) => Math.abs(a.value - need) - Math.abs(b.value - need))
    .slice(0, limit);
}
