// Fits trade values from the market_trades table (see scripts/lib/tradeFit.ts) and stores them
// in market_values / market_trade_scores / market_fit_runs. Run by crawl-trades.yml after the
// crawl; by hand:
//   SUPABASE_SERVICE_ROLE_KEY=... TSX_TSCONFIG_PATH=tsconfig.app.json npx tsx scripts/fit-trade-values.ts
// Env: MIN_TRADES (default 30) per format before a fit is stored.

import { fitAndReport, scoreTrade, toFitTrade, type FitTrade, type PlayerFeature } from './lib/tradeFit';
import { createThrottle, lineupLabel, lineupOf, lineupWeight, type Lineup, type TradeRow } from './lib/tradeMarket';

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
const { LEAGUE_ID } = await import('../src/services/sleeperApi');
const { nameKey } = await import('../src/utils/dynastyValue');

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set — the market tables are admin-only.');
  process.exit(1);
}
const MIN_TRADES = Number(process.env.MIN_TRADES ?? 30);
const db = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

// ── Lineup weighting: trades from leagues whose lineups look like ours count more ──
async function sleeper<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`https://api.sleeper.app/v1${path}`);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}
const target: Lineup | null = lineupOf((await sleeper<{ roster_positions?: string[] }>(`/league/${LEAGUE_ID}`))?.roster_positions);
console.log(target ? `Target lineup: ${lineupLabel(target)}` : 'Could not read our lineup — trades are weighted equally.');

const lineups = new Map<string, Lineup | null>();
const similar = new Set<string>();
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('market_leagues').select('league_id, lineup, matches').eq('matches', true).order('league_id').range(from, from + 999);
  if (error) throw error;
  for (const l of data as Array<{ league_id: string; lineup: Lineup | null; matches: boolean }>) {
    lineups.set(l.league_id, l.lineup);
    if (l.matches) similar.add(l.league_id);
  }
  if (!data || data.length < 1000) break;
}
if (target) {
  // Only similar leagues have trades, so only they need a lineup (the rest are ~145k leagues).
  const missing = [...lineups].filter(([id, l]) => l === null && similar.has(id)).map(([id]) => id);
  const MAX = Number(process.env.MAX_LINEUP_CALLS ?? 4000);
  const throttle = createThrottle(600);
  let filled = 0;
  for (const id of missing.slice(0, MAX)) {
    await throttle();
    const league = await sleeper<{ roster_positions?: string[] }>(`/league/${id}`);
    const lineup = lineupOf(league?.roster_positions);
    if (!lineup) continue;
    const { error } = await db.from('market_leagues').update({ lineup }).eq('league_id', id);
    if (error) throw error;
    lineups.set(id, lineup);
    filled++;
  }
  console.log(`Lineups: ${filled} filled now, ${Math.max(0, missing.length - MAX)} still missing`);
}

// ── VORP prior: recent VORP (last three seasons, 50/30/20) and age per Sleeper player ──
async function pageAll<T>(table: string, cols: string, order: string, filter?: (q: any) => any): Promise<T[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let data: T[] | null = null;
    for (let attempt = 0; attempt < 3 && !data; attempt++) {
      let q = db.from(table).select(cols).order(order).range(from, from + 999);
      if (filter) q = filter(q);
      const res = await q;
      if (!res.error) data = res.data as T[];
      else if (attempt === 2) throw res.error;
      else await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
    out.push(...data!);
    if (data!.length < 1000) break;
  }
  return out;
}
// player_vorp is a heavy view: ask only for the seasons we use (the filter is pushed into it).
const { data: latest, error: latestErr } = await db.from('player_seasons').select('year').order('year', { ascending: false }).limit(1);
if (latestErr) throw latestErr;
const latestYear: number = latest[0].year;
const vorpRows = await pageAll<{ name_key: string; position: string; year: number; vorp: number }>(
  'player_vorp', 'name_key, position, year, vorp', 'name_key', (q) => q.gte('year', latestYear - 2).order('position').order('year'), // unique paging order
);
const recent = new Map<string, number>(); // `${name_key}|${position}` -> weighted VORP
for (const r of vorpRows) {
  const age = latestYear - r.year;
  if (age > 2) continue;
  const key = `${r.name_key}|${r.position}`;
  recent.set(key, (recent.get(key) ?? 0) + [0.5, 0.3, 0.2][age] * Number(r.vorp));
}
const sleeperPlayers = await pageAll<{ player_id: string; name: string; position: string | null; age: number | null }>('sleeper_players', 'player_id, name, position, age', 'player_id');
const feats = new Map<string, PlayerFeature>();
for (const p of sleeperPlayers) {
  const vorp = recent.get(`${nameKey(p.name)}|${p.position}`);
  if (vorp !== undefined) feats.set(`p:${p.player_id}`, { vorp, age: p.age });
}
console.log(`VORP prior: ${feats.size} of ${sleeperPlayers.length} Sleeper players matched to recent VORP (latest season ${latestYear})`);

type Row = Pick<TradeRow, 'sides' | 'traded_at' | 'superflex' | 'league_id'> & { id: number };
const rows: Row[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('market_trades').select('id, sides, traded_at, superflex, league_id').order('id').range(from, from + 999);
  if (error) throw error;
  rows.push(...(data as Row[]));
  if (!data || data.length < 1000) break;
}
console.log(`Loaded ${rows.length} trades`);

for (const format of ['1qb', 'sf'] as const) {
  const trades: FitTrade[] = [];
  for (const r of rows) {
    if (r.superflex !== (format === 'sf')) continue;
    const t = toFitTrade(r, lineupWeight(lineups.get(r.league_id), target));
    if (t) trades.push(t);
  }
  if (trades.length < MIN_TRADES) {
    console.log(`${format}: ${trades.length} usable trades (< ${MIN_TRADES}), skipping`);
    continue;
  }
  const { values, report } = fitAndReport(trades, {}, feats);
  console.log(`${format}:`, JSON.stringify(report));

  const counts = new Map<string, number>();
  for (const t of trades) for (const k of [...t.a, ...t.b]) counts.set(k, (counts.get(k) ?? 0) + 1);
  const valueRows = [...values].map(([asset_key, value]) => ({
    format, asset_key, value: Math.round(value * 10) / 10, n_trades: counts.get(asset_key) ?? 0, updated_at: new Date().toISOString(),
  }));
  // The consolidation exponent travels with the values (the calculator needs it to price a side).
  valueRows.push({ format, asset_key: 'cfg:alpha', value: report.alpha, n_trades: 0, updated_at: new Date().toISOString() });
  const scoreRows = trades.map((t) => {
    const s = scoreTrade(t, values, false, report.alpha)!;
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
    holdout_mean_gap: report.holdoutMeanGap, holdout_coverage: report.holdoutCoverage, tiers: { ...report.tiers, alpha: report.alpha, ...(report.vorp ? { vorp_r2: Math.round(report.vorp.r2 * 1000) / 1000, vorp_players: report.vorp.players } : {}), ...(target ? { lineup: lineupLabel(target) } : {}) },
  });
  if (error) throw error;
}
