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
