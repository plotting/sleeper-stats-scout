// Fits trade values from the market_trades table (see scripts/lib/tradeFit.ts) and stores them
// in market_values / market_trade_scores / market_fit_runs. Run by crawl-trades.yml after the
// crawl; by hand:
//   SUPABASE_SERVICE_ROLE_KEY=... TSX_TSCONFIG_PATH=tsconfig.app.json npx tsx scripts/fit-trade-values.ts
// Env: MIN_TRADES (default 30) per format before a fit is stored.

import { fitAndReport, scoreTrade, toFitTrade, type FitTrade } from './lib/tradeFit';
import type { TradeRow } from './lib/tradeMarket';

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
} as Storage;

const { supabase } = await import('../src/integrations/supabase/client');

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set — the market tables are admin-only.');
  process.exit(1);
}
const MIN_TRADES = Number(process.env.MIN_TRADES ?? 30);
const db = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

type Row = Pick<TradeRow, 'sides' | 'traded_at' | 'superflex'> & { id: number };
const rows: Row[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('market_trades').select('id, sides, traded_at, superflex').order('id').range(from, from + 999);
  if (error) throw error;
  rows.push(...(data as Row[]));
  if (!data || data.length < 1000) break;
}
console.log(`Loaded ${rows.length} trades`);

for (const format of ['1qb', 'sf'] as const) {
  const trades: FitTrade[] = [];
  for (const r of rows) {
    if (r.superflex !== (format === 'sf')) continue;
    const t = toFitTrade(r);
    if (t) trades.push(t);
  }
  if (trades.length < MIN_TRADES) {
    console.log(`${format}: ${trades.length} usable trades (< ${MIN_TRADES}), skipping`);
    continue;
  }
  const { values, report } = fitAndReport(trades);
  console.log(`${format}:`, JSON.stringify(report));

  const counts = new Map<string, number>();
  for (const t of trades) for (const k of [...t.a, ...t.b]) counts.set(k, (counts.get(k) ?? 0) + 1);
  const valueRows = [...values].map(([asset_key, value]) => ({
    format, asset_key, value: Math.round(value * 10) / 10, n_trades: counts.get(asset_key) ?? 0, updated_at: new Date().toISOString(),
  }));
  const scoreRows = trades.map((t) => {
    const s = scoreTrade(t, values)!;
    return { trade_id: t.id, val_a: Math.round(s.valA), val_b: Math.round(s.valB), diff_pct: Math.round(s.diffPct * 10) / 10, fair_tier: s.tier };
  });
  for (const [table, batch, conflict] of [
    ['market_values', valueRows, 'format,asset_key'],
    ['market_trade_scores', scoreRows, 'trade_id'],
  ] as const) {
    for (let i = 0; i < batch.length; i += 500) {
      const { error } = await db.from(table).upsert(batch.slice(i, i + 500), { onConflict: conflict });
      if (error) throw error;
    }
  }
  const { error } = await db.from('market_fit_runs').insert({
    format, n_trades: report.trades, n_assets: report.assets,
    in_sample_mean_gap: report.inSampleMeanGap, prior_mean_gap: report.priorMeanGap,
    holdout_mean_gap: report.holdoutMeanGap, holdout_coverage: report.holdoutCoverage, tiers: report.tiers,
  });
  if (error) throw error;
}
