// Fits trade values from the market_trades table (see scripts/lib/tradeFit.ts) and stores them
// in market_values / market_trade_scores / market_fit_runs. Run by crawl-trades.yml after the
// crawl; by hand:
//   SUPABASE_SERVICE_ROLE_KEY=... TSX_TSCONFIG_PATH=tsconfig.app.json npx tsx scripts/fit-trade-values.ts
// Env: MIN_TRADES (default 30) per format before a fit is stored.

import { fitAndReport, recencyWeight, recentAnnualVorp, scoreTrade, shapeWeight, toFitTrade, type FitTrade, type PlayerFeature } from './lib/tradeFit';
import { computeVorp, type SeasonRow } from './lib/vorp';
import { tierExpectations, type DraftedPick } from './lib/pickCurve';
import { fitAgeCurves } from './lib/aging';
import { outcomeBuckets, type SeasonPair } from './lib/volatility';
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
const MAX_AGE_DAYS = Number(process.env.MAX_AGE_DAYS ?? 548); // ~18 months: older trades reflect a different market
const HALF_LIFE_DAYS = Number(process.env.HALF_LIFE_DAYS ?? 120); // values drift, so older trades count less
const now = new Date();
// Depth discount per extra piece on a side (richest first). Default 1 = none: values fit to real trades already
// contain the market's consolidation premium. Only lower it if the panel's uneven-trade line stays consistently positive.
const DEPTH = { players: Number(process.env.DEPTH_PLAYERS ?? 1), picks: Number(process.env.DEPTH_PICKS ?? 1) };
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

// ── Year-over-year changes in production (annual VORP) by position and age, for the outcome range ──
const ageNow = new Map<string, number>();
for (const p of sleeperPlayers) if (p.age && p.position) ageNow.set(`${nameKey(p.name)}|${p.position}`, p.age);
const vorpByPlayer = new Map<string, Map<number, number>>();
for (const r of vorpRows) {
  const key = `${r.name_key}|${r.position}`;
  (vorpByPlayer.get(key) ?? vorpByPlayer.set(key, new Map()).get(key)!).set(r.year, Number(r.vorp));
}
const seasonPairs: SeasonPair[] = [];
for (const [key, years] of vorpByPlayer) {
  const age = ageNow.get(key);
  if (!age) continue;
  for (const [year, v] of years) {
    const next = years.get(year + 1);
    const ageThen = age - (latestYear - year);
    // completed seasons only (the current one is still being played); skip players too far from relevance
    if (next === undefined || year + 1 > latestYear - 1 || v < 15 || ageThen < 20 || ageThen > 38) continue;
    seasonPairs.push({ position: key.split('|')[1], age: ageThen, delta: Math.log(1 + next) - Math.log(1 + v) });
  }
}
console.log(`Outcome range: ${seasonPairs.length} season-to-season pairs`);

type Row = Pick<TradeRow, 'sides' | 'traded_at' | 'superflex' | 'league_id'> & { id: number };
const rows: Row[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('market_trades').select('id, sides, traded_at, superflex, league_id').order('id').range(from, from + 999);
  if (error) throw error;
  rows.push(...(data as Row[]));
  if (!data || data.length < 1000) break;
}
console.log(`Loaded ${rows.length} trades (fitting only those from the last ${MAX_AGE_DAYS} days)`);

// SWEEP=1: does recency weighting or a shorter / longer window predict newer trades better? Fits on trades older than TEST_DAYS
// with each (half-life, window) pair and scores the newest trades (equal weights, same test set for every pair) by how evenly the
// fitted values balance them. Prints a table and stores nothing.
if (process.env.SWEEP === '1') {
  const TEST_DAYS = Number(process.env.TEST_DAYS ?? 45);
  const cutoff = new Date(now.getTime() - TEST_DAYS * 86400000);
  const day = 86400000;
  const halfLives = (process.env.SWEEP_HALF_LIVES ?? '60,120,240,100000').split(',').map(Number);
  const windows = (process.env.SWEEP_WINDOWS ?? '270,548,900').split(',').map(Number);
  const inFormat = rows.filter((r) => !r.superflex);
  const testRows = inFormat.filter((r) => new Date(r.traded_at) > cutoff && now.getTime() - new Date(r.traded_at).getTime() <= TEST_DAYS * day);
  const tests = testRows.map((r) => toFitTrade(r, 1)).filter((t): t is FitTrade => t != null);
  console.log(`Sweep: testing on ${tests.length} 1QB trades from the last ${TEST_DAYS} days; fitting on older trades as of ${cutoff.toISOString().slice(0, 10)}.`);
  console.log('half-life | window | train | tested | covered | mean gap % | median gap %');
  for (const windowDays of windows) {
    for (const h of halfLives) {
      const train: FitTrade[] = [];
      for (const r of inFormat) {
        const age = cutoff.getTime() - new Date(r.traded_at).getTime();
        if (age < 0 || age > windowDays * day) continue;
        const t = toFitTrade(r, lineupWeight(lineups.get(r.league_id), target) * recencyWeight(r.traded_at, cutoff, h));
        if (t) { t.weight = (t.weight ?? 1) * shapeWeight(t.a.length, t.b.length); train.push(t); }
      }
      if (train.length < MIN_TRADES) { console.log(`${h} | ${windowDays} | ${train.length} | too few`); continue; }
      const { values, depth } = fitAndReport(train, { depth: DEPTH }, feats);
      const gaps = tests.map((t) => scoreTrade(t, values, false, depth)).filter((x): x is NonNullable<typeof x> => x != null).map((x) => x.diffPct).sort((a, b) => a - b);
      const mean = gaps.reduce((a, b) => a + b, 0) / Math.max(gaps.length, 1);
      console.log(`${h >= 100000 ? 'none' : h} | ${windowDays} | ${train.length} | ${tests.length} | ${gaps.length} | ${mean.toFixed(2)} | ${(gaps[Math.floor(gaps.length / 2)] ?? NaN).toFixed(2)}`);
    }
  }
  process.exit(0);
}

for (const format of ['1qb', 'sf'] as const) {
  const trades: FitTrade[] = [];
  for (const r of rows) {
    if (r.superflex !== (format === 'sf')) continue;
    if (now.getTime() - new Date(r.traded_at).getTime() > MAX_AGE_DAYS * 86400000) continue;
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
  // Recent annual VORP per player ('cr:' = current production), used for lineup impact in the calculator's league mode.
  for (const [k, f] of feats) {
    valueRows.push({ format, asset_key: `cr:${k.slice(2)}`, value: Math.round(f.vorp * 10) / 10, n_trades: 0, updated_at: new Date().toISOString() });
  }
  // Pick baselines from outcomes (vp:<round>:<early|mid|late|any>), on the same scale as player values.
  if (predictValue) {
    for (const [key, e] of pickExpect) {
      valueRows.push({ format, asset_key: `vp:${key}`, value: Math.round(predictValue({ vorp: e.annualVorp, age: 24 }) * 10) / 10, n_trades: e.n, updated_at: new Date().toISOString() });
    }
  }
  // Value-by-age curves per position (for the calculator's value-over-time chart).
  const tradeCounts = new Map<string, number>();
  for (const t of trades) for (const k of [...t.a, ...t.b]) tradeCounts.set(k, (tradeCounts.get(k) ?? 0) + 1);
  const agePoints = sleeperPlayers.flatMap((p) => {
    const value = values.get(`p:${p.player_id}`);
    return p.age && p.position && value ? [{ position: p.position, age: p.age, value, trades: tradeCounts.get(`p:${p.player_id}`) ?? 0 }] : [];
  });
  for (const [pos, c] of fitAgeCurves(agePoints)) {
    valueRows.push(
      { format, asset_key: `cfg:age:${pos}:b1`, value: Math.round(c.b1 * 10000) / 10000, n_trades: 0, updated_at: new Date().toISOString() },
      { format, asset_key: `cfg:age:${pos}:b2`, value: Math.round(c.b2 * 10000) / 10000, n_trades: 0, updated_at: new Date().toISOString() },
    );
  }
  // Next-season value change distribution (ceiling / expected / floor and breakout / bust odds) per position and age group.
  if (report.vorp) {
    for (const [group, o] of outcomeBuckets(seasonPairs, report.vorp.slope)) {
      for (const [stat, x] of [['p10', o.p10], ['p50', o.p50], ['p90', o.p90], ['up', o.up], ['down', o.down]] as const) {
        valueRows.push({ format, asset_key: `cfg:vol:${group}:${stat}`, value: Math.round(x * 10000) / 10000, n_trades: o.n, updated_at: new Date().toISOString() });
      }
    }
  }
  // The depth discounts travel with the values (the calculator needs them to price a side).
  valueRows.push(
    { format, asset_key: 'cfg:rho_players', value: Math.round(report.depth.players * 1000) / 1000, n_trades: 0, updated_at: new Date().toISOString() },
    { format, asset_key: 'cfg:rho_picks', value: Math.round(report.depth.picks * 1000) / 1000, n_trades: 0, updated_at: new Date().toISOString() },
  );
  // Consolidation premium: in real trades the side with fewer pieces (the better asset) is accepted at a plain-sum value
  // this much lower than the many-piece side. Stored per shape so the calculator can apply it; trades are scored with it too.
  const premium = new Map<string, number>();
  for (const [shape, b] of Object.entries(report.shapeBias)) {
    const ratio = Math.round((1 + b.pct / 100) * 1000) / 1000;
    premium.set(shape, ratio);
    valueRows.push({ format, asset_key: `cfg:shape:${shape}`, value: ratio, n_trades: b.n, updated_at: new Date().toISOString() });
  }
  const scoreRows = trades.map((t) => {
    const s = scoreTrade(t, values, false, report.depth, premium)!;
    return { trade_id: t.id, val_a: Math.round(s.valA), val_b: Math.round(s.valB), diff_pct: Math.round(s.diffPct * 10) / 10, fair_tier: s.tier };
  });
  for (const [table, batch, conflict] of [
    ['market_values', valueRows, 'format,asset_key'],
    ['market_trade_scores', scoreRows, 'trade_id'],
    // today's value per player / pick, so the site can show who is rising or falling (one row per day, last fit of the day wins)
    ['market_value_history', valueRows.filter((r) => /^(p|pk):/.test(r.asset_key)).map((r) => ({ format, asset_key: r.asset_key, as_of: now.toISOString().slice(0, 10), value: r.value })), 'format,asset_key,as_of'],
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
