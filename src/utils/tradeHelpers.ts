import { displayDesc } from "@/utils/dynastyValue";

export type TradeItem = {
  item_type: string;
  item_description: string;
  to_team_id: number | null;
  from_team_id: number | null;
  from_team?: { name: string } | null;
  to_team?: { name: string } | null;
};

export interface PlayerSeasonVorp {
  player_name: string;
  name_key?: string;
  year: number;
  vorp: number;
}

export interface DraftPickLookupRow {
  round: number;
  pick_number: number;
  player_name: string;
  team_id: number;
  draft_slot: number;
  season_number: number;
}

/** Fallback estimate for unresolved picks when no actual data available */
export function pickFallbackVorp(description: string): number | null {
  const clean = displayDesc(description);
  const m = clean.match(/^(\d{4}) (\d+)(?:st|nd|rd|th) Round/);
  if (!m) return null;
  const round = Number(m[2]);
  return round === 1 ? 100 : round === 2 ? 30 : 10;
}

/** Parse an unresolved [fut:N] pick description → { year, round, futId } or null.
 *  futId is the Sleeper roster_id of the original pick owner, which equals draft_slot in draft_picks.
 */
export function parseUnresolvedPickFut(desc: string): { year: number; round: number; futId: number } | null {
  const m = desc.match(/^(\d{4}) (\d+)(?:st|nd|rd|th) Round Pick \[fut:(\d+)\]/);
  if (!m) return null;
  return { year: Number(m[1]), round: Number(m[2]), futId: Number(m[3]) };
}

/**
 * Returns which NFL calendar week a given date falls in.
 * Week 0 = offseason/preseason. Weeks 1-18 = regular season.
 * NFL Week 1 always starts on the Thursday in the Sep 4-10 window.
 * (The old "on or after Sep 5" base was wrong for 2025, which started Sep 4.)
 */
export function getNFLWeek(date: Date): { week: number; inSeason: boolean } {
  const year = date.getFullYear();
  const sep4 = new Date(year, 8, 4);
  const daysToThursday = (4 - sep4.getDay() + 7) % 7;
  const week1Start = new Date(year, 8, 4 + daysToThursday);

  if (date < week1Start) return { week: 0, inSeason: false };

  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weekNum = Math.floor((date.getTime() - week1Start.getTime()) / msPerWeek) + 1;

  if (weekNum > 18) return { week: 18, inSeason: false };
  return { week: weekNum, inSeason: true };
}

/**
 * Returns the first week a player acquired via trade can actually play.
 * Sunday (0) and Monday (1) fall after the main game slate — the player
 * can't be inserted until the following week.
 * Tuesday–Saturday trades allow playing in the current week.
 */
export function getFirstPlayableWeek(tradeDate: Date, calendarWeek: number): number {
  const day = tradeDate.getDay(); // 0=Sun, 1=Mon
  return (day === 0 || day === 1) ? calendarWeek + 1 : calendarWeek;
}


/**
 * Maps DST nicknames (as stored in trade_items, e.g. "Eagles D/ST") to the
 * full team name used in player_seasons (e.g. "Philadelphia Eagles").
 * Includes common typos and legacy names.
 */
export const DST_NICKNAME_TO_FULL: Record<string, string> = {
  'cardinals':   'Arizona Cardinals',
  'falcons':     'Atlanta Falcons',
  'ravens':      'Baltimore Ravens',
  'bills':       'Buffalo Bills',
  'panthers':    'Carolina Panthers',
  'bears':       'Chicago Bears',
  'bengals':     'Cincinnati Bengals',
  'browns':      'Cleveland Browns',
  'cowboys':     'Dallas Cowboys',
  'broncos':     'Denver Broncos',
  'lions':       'Detroit Lions',
  'packers':     'Green Bay Packers',
  'texans':      'Houston Texans',
  'colts':       'Indianapolis Colts',
  'jaguars':     'Jacksonville Jaguars',
  'chiefs':      'Kansas City Chiefs',
  'cheifs':      'Kansas City Chiefs', // typo variant
  'raiders':     'Las Vegas Raiders',
  'chargers':    'Los Angeles Chargers',
  'rams':        'Los Angeles Rams',
  'dolphins':    'Miami Dolphins',
  'vikings':     'Minnesota Vikings',
  'patriots':    'New England Patriots',
  'saints':      'New Orleans Saints',
  'giants':      'New York Giants',
  'jets':        'New York Jets',
  'eagles':      'Philadelphia Eagles',
  'steelers':    'Pittsburgh Steelers',
  '49ers':       'San Francisco 49ers',
  'seahawks':    'Seattle Seahawks',
  'buccaneers':  'Tampa Bay Buccaneers',
  'titans':      'Tennessee Titans',
  'commanders':  'Washington Commanders',
  'redskins':    'Washington Commanders',
  'football team': 'Washington Commanders',
};

/** Convert "Eagles D/ST" → "Philadelphia Eagles" (for player_seasons lookup). Returns null if not a DST item. */
export function resolveDSTFullName(itemDesc: string): string | null {
  const m = itemDesc.match(/^(.+?)\s+D\/ST$/i);
  if (!m) return null;
  return DST_NICKNAME_TO_FULL[m[1].toLowerCase()] ?? null;
}

