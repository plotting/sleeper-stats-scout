/** trade_date is a calendar date stored as midnight UTC ("2025-07-26 00:00:00+00"). Reading it with `new Date(...)` and
 *  formatting in local time shows the day before in the Americas, so parse just the date part at local noon instead. */
export function parseTradeDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T12:00:00`);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Jul 26, 2025" for a trade_date, the same day everywhere. */
export function formatTradeDate(value: string): string {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** The league plays on US Eastern time, so a trade is dated by the Eastern calendar day it happened on. (Taking the UTC day
 *  pushes any trade after about 8 PM Eastern onto the next day.) */
export const LEAGUE_TIME_ZONE = 'America/New_York';

/** "YYYY-MM-DD" of an epoch-ms timestamp on the league's calendar. */
export function leagueDateOf(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: LEAGUE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

/** "YYYY-MM-DD" in UTC, which is how trades were dated before. */
export function utcDateOf(ms: number): string {
  return new Date(ms).toISOString().split('T')[0];
}
