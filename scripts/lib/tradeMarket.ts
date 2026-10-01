// Pure helpers for the trade-market crawler (kept free of network/database code so they can be tested).

export interface SleeperLeagueLite {
  league_id: string;
  season: string;
  previous_league_id?: string | null;
  total_rosters?: number;
  roster_positions?: string[];
  scoring_settings?: Record<string, number>;
  settings?: { type?: number; num_teams?: number };
}

export interface LeagueProfile {
  league_id: string;
  season: number;
  num_teams: number | null;
  superflex: boolean;
  ppr: number;
  te_premium: number;
  pass_td: number | null;
  matches: boolean;
  dynasty: boolean;
  previous_league_id: string | null;
}

// "Similar to Matzie's Dynasty League": dynasty, 10-12 teams, one QB (no superflex),
// no PPR beyond half a point, no big tight-end premium, 4-6 point passing TDs.
export const SIMILARITY = {
  dynastyType: 2,
  minTeams: 10,
  maxTeams: 12,
  maxPpr: 0.5,
  maxTePremium: 0.5,
  minPassTd: 4,
  maxPassTd: 6,
};

export function profileLeague(l: SleeperLeagueLite): LeagueProfile {
  const scoring = l.scoring_settings ?? {};
  const positions = l.roster_positions ?? [];
  const num_teams = l.settings?.num_teams ?? l.total_rosters ?? null;
  const superflex = positions.includes('SUPER_FLEX') || positions.filter((p) => p === 'QB').length > 1;
  const ppr = scoring.rec ?? 0;
  const te_premium = scoring.bonus_rec_te ?? 0;
  const pass_td = scoring.pass_td ?? null;
  const dynasty = l.settings?.type === SIMILARITY.dynastyType;
  const matches =
    dynasty &&
    num_teams != null && num_teams >= SIMILARITY.minTeams && num_teams <= SIMILARITY.maxTeams &&
    !superflex &&
    ppr <= SIMILARITY.maxPpr &&
    te_premium <= SIMILARITY.maxTePremium &&
    pass_td != null && pass_td >= SIMILARITY.minPassTd && pass_td <= SIMILARITY.maxPassTd;
  return {
    league_id: l.league_id,
    season: parseInt(l.season, 10),
    num_teams,
    superflex,
    ppr,
    te_premium,
    pass_td,
    matches,
    dynasty,
    previous_league_id: l.previous_league_id ?? null,
  };
}

export interface SleeperTransactionLite {
  transaction_id: string;
  type: string;
  status: string;
  created: number;
  leg?: number;
  roster_ids?: number[];
  adds?: Record<string, number> | null;
  draft_picks?: Array<{ season: string; round: number; roster_id: number; owner_id: number }>;
  waiver_budget?: Array<{ sender: number; receiver: number; amount: number }>;
}

export type Asset = { p: string } | { k: [number, number, number] } | { b: number };
export interface TradeSide { r: number; g: Asset[] }

export interface TradeRow {
  league_id: string;
  transaction_id: string;
  season: number;
  week: number | null;
  traded_at: string;
  num_teams: number | null;
  superflex: boolean;
  ppr: number;
  te_premium: number;
  sides: TradeSide[];
  player_ids: string[];
  pick_keys: string[];
  shape: string;
  has_picks: boolean;
  has_players: boolean;
}

/** Turn a completed Sleeper trade into a row, or null if it isn't a usable two-or-more-sided trade. */
export function parseTrade(tx: SleeperTransactionLite, league: LeagueProfile): TradeRow | null {
  if (tx.type !== 'trade' || tx.status !== 'complete') return null;
  const rosters = tx.roster_ids ?? [];
  if (rosters.length < 2) return null;

  const sides: TradeSide[] = rosters.map((r) => ({ r, g: [] }));
  const side = (r: number) => sides.find((s) => s.r === r);
  for (const [playerId, rid] of Object.entries(tx.adds ?? {})) side(rid)?.g.push({ p: playerId });
  for (const pick of tx.draft_picks ?? []) {
    side(pick.owner_id)?.g.push({ k: [parseInt(pick.season, 10), pick.round, pick.roster_id] });
  }
  for (const b of tx.waiver_budget ?? []) {
    if (b.amount > 0) side(b.receiver)?.g.push({ b: b.amount });
  }
  // Every side must receive something, otherwise it isn't a real exchange.
  if (sides.some((s) => s.g.length === 0)) return null;

  const player_ids = [...new Set(sides.flatMap((s) => s.g.filter((a): a is { p: string } => 'p' in a).map((a) => a.p)))];
  const pick_keys = [...new Set(sides.flatMap((s) => s.g.filter((a): a is { k: [number, number, number] } => 'k' in a).map((a) => `${a.k[0]}-${a.k[1]}`)))];
  return {
    league_id: league.league_id,
    transaction_id: tx.transaction_id,
    season: league.season,
    week: tx.leg ?? null,
    traded_at: new Date(tx.created).toISOString(),
    num_teams: league.num_teams,
    superflex: league.superflex,
    ppr: league.ppr,
    te_premium: league.te_premium,
    sides,
    player_ids,
    pick_keys,
    shape: sides.map((s) => s.g.length).sort((a, b) => b - a).join('-'),
    has_picks: pick_keys.length > 0,
    has_players: player_ids.length > 0,
  };
}

/** Keeps calls under a per-minute budget (Sleeper asks for fewer than 1000 per minute). */
export function createThrottle(callsPerMinute: number) {
  const gap = 60000 / callsPerMinute;
  let next = 0;
  return async () => {
    const now = Date.now();
    const wait = Math.max(0, next - now);
    next = Math.max(now, next) + gap;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  };
}
