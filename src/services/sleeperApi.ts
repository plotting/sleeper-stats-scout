const BASE = 'https://api.sleeper.app/v1';

export const LEAGUE_ID = '1319742366797545472';

// ─── Response types ────────────────────────────────────────────────────────

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  status: 'pre_draft' | 'drafting' | 'in_season' | 'complete';
  previous_league_id: string | null;
  settings: {
    playoff_week_start: number;
    playoff_teams: number;
    num_teams: number;
    leg: number; // current NFL week
    last_scored_leg: number;
  };
  total_rosters: number;
  /** Starting lineup slots in order, e.g. ["QB","RB","RB","WR","WR","TE","FLEX","DEF","BN",...] */
  roster_positions: string[];
}

export interface SleeperUser {
  user_id: string;
  username: string;
  display_name: string;
  metadata?: { team_name?: string };
  avatar?: string;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string | null;
  league_id: string;
  players: string[] | null;
  starters: string[] | null;
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts: number;
    fpts_decimal: number;
    fpts_against?: number;
    fpts_against_decimal?: number;
  };
}

export interface SleeperMatchup {
  roster_id: number;
  matchup_id: number | null;
  points: number;
}

export interface SleeperDraft {
  draft_id: string;
  league_id: string;
  season: string;
  type: string;
  status: string;
  /** Epoch ms when the draft started/is scheduled to start. Null if not yet scheduled. */
  start_time: number | null;
  /** Epoch ms of the most recent pick — the draft's actual end, if complete. */
  last_picked: number | null;
  settings: {
    rounds: number;
    teams: number;
  };
  /** Maps roster_id (string) → draft_slot (number). Invert to get slot → original roster owner. */
  draft_order: Record<string, number> | null;
}

export interface SleeperDraftPick {
  round: number;
  draft_slot: number;
  pick_no: number;
  picked_by: string;
  roster_id: number;
  player_id: string;
  metadata: {
    first_name?: string;
    last_name?: string;
    position?: string;
    team?: string;
  };
}

export interface SleeperTransaction {
  transaction_id: string;
  type: 'trade' | 'free_agent' | 'waiver' | 'commissioner';
  status: 'complete' | 'failed';
  created: number; // epoch ms
  roster_ids: number[];
  adds: Record<string, number> | null;   // player_id → roster_id (receiving)
  drops: Record<string, number> | null;  // player_id → roster_id (sending)
  draft_picks: SleeperTradedPick[];
  waiver_budget: { sender: number; receiver: number; amount: number }[];
  leg: number;
}

export interface SleeperTradedPick {
  season: string;
  round: number;
  roster_id: number;        // original owner
  previous_owner_id: number;
  owner_id: number;         // new owner after trade
}

// ─── Player name cache ─────────────────────────────────────────────────────

const PLAYER_CACHE_KEY = 'sleeper_players_v1';
const PLAYER_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let _playerMap: Record<string, string> | null = null;

async function getPlayerMap(): Promise<Record<string, string>> {
  if (_playerMap) return _playerMap;
  try {
    const raw = localStorage.getItem(PLAYER_CACHE_KEY);
    if (raw) {
      const { timestamp, data } = JSON.parse(raw);
      if (Date.now() - timestamp < PLAYER_CACHE_TTL_MS) {
        _playerMap = data;
        return data;
      }
    }
  } catch { /* ignore */ }

  const allPlayers = await get<Record<string, { full_name?: string; first_name?: string; last_name?: string; position?: string }>>('/players/nfl');
  const slim: Record<string, string> = {};
  for (const [id, p] of Object.entries(allPlayers)) {
    let name = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ');
    // Team defenses have IDs like "PHI", "DAL" — no full_name in the API
    if (!name && /^[A-Z]{2,4}$/.test(id)) name = `${id} D/ST`;
    if (name) slim[id] = name;
  }
  try {
    localStorage.setItem(PLAYER_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: slim }));
  } catch { /* storage quota */ }
  _playerMap = slim;
  return slim;
}

/** Resolve Sleeper player IDs to display names (cached, fetched once per session). */
export async function lookupPlayerNames(playerIds: string[]): Promise<Map<string, string>> {
  const map = await getPlayerMap();
  return new Map(playerIds.map((id) => {
    if (map[id]) return [id, map[id]];
    // DST fallback: IDs like "PHI", "DAL" not in the players endpoint
    if (/^[A-Z]{2,4}$/.test(id)) return [id, `${id} D/ST`];
    return [id, `Player ${id}`];
  }));
}

// ─── Fetch helpers ─────────────────────────────────────────────────────────

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`Sleeper API error ${res.status}: ${path}`);
  return res.json();
}

export const fetchLeague = (id: string) =>
  get<SleeperLeague>(`/league/${id}`);

export const fetchLeagueUsers = (id: string) =>
  get<SleeperUser[]>(`/league/${id}/users`);

export const fetchLeagueRosters = (id: string) =>
  get<SleeperRoster[]>(`/league/${id}/rosters`);

export const fetchMatchups = (id: string, week: number) =>
  get<SleeperMatchup[]>(`/league/${id}/matchups/${week}`);

export const fetchLeagueDrafts = (id: string) =>
  get<SleeperDraft[]>(`/league/${id}/drafts`);

/** Fetch a single draft by ID — always includes draft_order even when the league endpoint omits it. */
export const fetchDraft = (draftId: string) =>
  get<SleeperDraft>(`/draft/${draftId}`);

export const fetchDraftPicks = (draftId: string) =>
  get<SleeperDraftPick[]>(`/draft/${draftId}/picks`);

export const fetchTransactions = (id: string, week: number) =>
  get<SleeperTransaction[]>(`/league/${id}/transactions/${week}`);

/** Walk the previous_league_id chain to collect all historical leagues, oldest first. */
export async function fetchAllLeagues(currentId: string): Promise<SleeperLeague[]> {
  const leagues: SleeperLeague[] = [];
  let id: string | null = currentId;
  const visited = new Set<string>();

  while (id && !visited.has(id)) {
    visited.add(id);
    try {
      const res = await fetch(`${BASE}/league/${id}`);
      if (!res.ok) break; // stop chain on 404 or other error
      const league: SleeperLeague = await res.json();
      if (!league?.league_id) break; // guard against null/malformed response
      leagues.push(league);
      id = league.previous_league_id;
    } catch {
      break; // network error — return whatever we have so far
    }
  }

  return leagues.reverse(); // oldest → newest
}

/**
 * Build a roster_id → Sleeper user_id map for one league.
 * Needed because matchup data only contains roster_id.
 */
export async function buildRosterOwnerMap(leagueId: string): Promise<Map<number, string>> {
  const rosters = await fetchLeagueRosters(leagueId);
  const map = new Map<number, string>();
  for (const r of rosters) {
    if (r.owner_id) map.set(r.roster_id, r.owner_id);
  }
  return map;
}
