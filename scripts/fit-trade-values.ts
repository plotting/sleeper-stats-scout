// Fits trade values from the market_trades table (see scripts/lib/tradeFit.ts) and stores them
// in market_values / market_trade_scores / market_fit_runs. Run by crawl-trades.yml after the
// crawl; by hand:
//   SUPABASE_SERVICE_ROLE_KEY=... TSX_TSCONFIG_PATH=tsconfig.app.json npx tsx scripts/fit-trade-values.ts
// Env: MIN_TRADES (default 30) per format before a fit is stored.

import { fitAndReport, recencyWeight, recentAnnualVorp, scoreTrade, shapeWeight, toFitTrade, type FitTrade, type PlayerFeature } from './lib/tradeFit';
import { computeVorp, type SeasonRow } from './lib/vorp';
import { tierExpectations, type DraftedPick } from './lib/pickCurve';
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
const HALF_LIFE_DAYS = Number(process.env.HALF_LIFE_DAYS ?? 120); // values drift, so older trades count less
const now = new Date();
// Depth discount per extra piece on a side (richest first): a setting, calibrated with the shape-bias line in the panel.
const DEPTH = { players: Number(process.env.DEPTH_PLAYERS ?? 0.85), picks: Number(process.env.DEPTH_PICKS ?? 0.9) };
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

// ── VORP prior: recent VORP (last three seasons, 50/30/20, annualised) and age per Sleeper player ──
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
// VORP comes from player_seasons via computeVorp (a twin of the player_vorp view, which is too slow to
// query from here). The last three seasons feed the player baseline; all seasons feed the pick curve.
const { data: latest, error: latestErr } = await db.from('player_seasons').select('year').order('year', { ascending: false }).limit(1);
if (latestErr) throw latestErr;
const latestYear: number = latest[0].year;
const seasonRows = await pageAll<SeasonRow & { id?: number }>(
  'player_seasons', 'player_name, position, year, total_points, games_played', 'year',
  (q) => q.gte('year', 2013).order('player_name').order('position'), // unique paging order
);
const vorpRows = computeVorp(seasonRows.map((r) => ({ ...r, total_points: Number(r.total_points) })))
  .map((r) => ({ ...r, name_key: nameKey(r.player_name) }));
const seasonsByPlayer = new Map<string, Array<{ yearsAgo: number; vorp: number; seasonGames: number }>>();
for (const r of vorpRows) {
  const key = `${r.name_key}|${r.position}`;
  (seasonsByPlayer.get(key) ?? seasonsByPlayer.set(key, []).get(key)!).push({ yearsAgo: latestYear - r.year, vorp: Number(r.vorp), seasonGames: r.season_games });
}
const recent = new Map<string, number>(); // `${name_key}|${position}` -> annualised, recency-weighted VORP
for (const [key, list] of seasonsByPlayer) {
  const v = recentAnnualVorp(list);
  if (v !== null) recent.set(key, v);
}
const sleeperPlayers = await pageAll<{ player_id: string; name: string; position: string | null; age: number | null }>('sleeper_players', 'player_id, name, position, age', 'player_id');
const feats = new Map<string, PlayerFeature>();
for (const p of sleeperPlayers) {
  const vorp = recent.get(`${nameKey(p.name)}|${p.position}`);
  if (vorp !== undefined) feats.set(`p:${p.player_id}`, { vorp, age: p.age, position: p.position });
}
console.log(`VORP prior: ${feats.size} of ${sleeperPlayers.length} Sleeper players matched to recent VORP (latest season ${latestYear})`);

// ── Pick outcomes: annual VORP over each rookie pick's first five seasons, by round and slot tier ──
const vorpByNameYear = new Map<string, number>();
for (const r of vorpRows) {
  const k = `${r.name_key}|${r.year}`;
  vorpByNameYear.set(k, (vorpByNameYear.get(k) ?? 0) + Number(r.vorp));
}
const seasonYears = new Map<number, number>(
  (await pageAll<{ id: number; year: number }>('seasons', 'id, year', 'id')).map((x) => [x.id, x.year]),
);
const draftRows = await pageAll<{ season_id: number | null; round: number; pick_number: number; player_name: string }>(
  'draft_picks', 'season_id, round, pick_number, player_name', 'id',
);
const LEAGUE_TEAMS = 10;
const draftedPicks: DraftedPick[] = [];
for (const d of draftRows) {
  const year = d.season_id != null ? seasonYears.get(d.season_id) : undefined;
  // the startup draft (first season) isn't a rookie draft; only classes with five seasons of data count
  if (year === undefined || year <= 2013 || year > latestYear - 4) continue;
  let total = 0;
  for (let y = year; y < year + 5; y++) total += vorpByNameYear.get(`${nameKey(d.player_name)}|${y}`) ?? 0;
  draftedPicks.push({ round: d.round, slot: ((d.pick_number - 1) % LEAGUE_TEAMS) + 1, annualVorp: total / 5 });
}
const pickExpect = tierExpectations(draftedPicks);
console.log(`Pick outcomes: ${draftedPicks.length} picks from completed rookie classes`);

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
    const t = toFitTrade(r, lineupWeight(lineups.get(r.league_id), target) * recencyWeight(r.traded_at, now, HALF_LIFE_DAYS));
    if (t) { t.weight = (t.weight ?? 1) * shapeWeight(t.a.length, t.b.length); trades.push(t); }
  }
  if (trades.length < MIN_TRADES) {
    console.log(`${format}: ${trades.length} usable trades (< ${MIN_TRADES}), skipping`);
    continue;
  }
  const { values, baseline, predictValue, report } = fitAndReport(trades, { depth: DEPTH }, feats);
  console.log(`${format}:`, JSON.stringify(report));

  const counts = new Map<string, number>();
  for (const t of trades) for (const k of [...t.a, ...t.b]) counts.set(k, (counts.get(k) ?? 0) + 1);
  const valueRows = [...values].map(([asset_key, value]) => ({
    format, asset_key, value: Math.round(value * 10) / 10, n_trades: counts.get(asset_key) ?? 0, updated_at: new Date().toISOString(),
  }));
  // Pure VORP + age baseline per player ('v:' keys) so the calculator can blend market and VORP.
  for (const [k, value] of baseline) {
    valueRows.push({ format, asset_key: `v:${k.slice(2)}`, value: Math.round(value * 10) / 10, n_trades: 0, updated_at: new Date().toISOString() });
  }
  // Pick baselines from outcomes (vp:<round>:<early|mid|late|any>), on the same scale as player values.
  if (predictValue) {
    for (const [key, e] of pickExpect) {
      valueRows.push({ format, asset_key: `vp:${key}`, value: Math.round(predictValue({ vorp: e.annualVorp, age: 24 }) * 10) / 10, n_trades: e.n, updated_at: new Date().toISOString() });
    }
  }
  // The depth discounts travel with the values (the calculator needs them to price a side).
  valueRows.push(
    { format, asset_key: 'cfg:rho_players', value: Math.round(report.depth.players * 1000) / 1000, n_trades: 0, updated_at: new Date().toISOString() },
    { format, asset_key: 'cfg:rho_picks', value: Math.round(report.depth.picks * 1000) / 1000, n_trades: 0, updated_at: new Date().toISOString() },
  );
  const scoreRows = trades.map((t) => {
    const s = scoreTrade(t, values, false, report.depth)!;
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
    holdout_mean_gap: report.holdoutMeanGap, holdout_coverage: report.holdoutCoverage, tiers: { ...report.tiers, rho_players: Math.round(report.depth.players * 1000) / 1000, rho_picks: Math.round(report.depth.picks * 1000) / 1000,
    ...Object.fromEntries(Object.entries(report.shapeBias).flatMap(([shape, b]) => [[`sb_${shape}`, b.pct], [`sbn_${shape}`, b.n]])), ...(report.vorp ? { vorp_r2: Math.round(report.vorp.r2 * 1000) / 1000, vorp_players: report.vorp.players, ...Object.fromEntries(Object.entries(report.vorp.marketVsVorp).map(([pos, pct]) => [`mv_${pos}`, pct])) } : {}), ...(target ? { lineup: lineupLabel(target) } : {}) },
  });
  if (error) throw error;
}
