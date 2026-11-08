import assert from 'node:assert/strict';
import { formatTradeDate, parseTradeDate } from '../src/utils/tradeDate';

// trade_date comes back as midnight UTC; the day shown must not depend on the viewer's time zone
for (const tz of ['America/Los_Angeles', 'America/New_York', 'UTC', 'Asia/Tokyo']) {
  process.env.TZ = tz;
  const d = parseTradeDate('2025-07-26 00:00:00+00');
  assert.equal(d.getDate(), 26, tz);
  assert.equal(d.getMonth(), 6, tz);
}
assert.equal(formatTradeDate('2025-07-26 00:00:00+00'), 'Jul 26, 2025');
assert.equal(formatTradeDate('2026-01-01'), 'Jan 1, 2026');
console.log('trade date: ok');

// league day: Eastern, not UTC — a trade at 9 PM Eastern on Oct 31 is Nov 1 in UTC
import { leagueDateOf, utcDateOf } from '../src/utils/tradeDate';
const ninePmEdt = Date.UTC(2026, 10, 1, 1, 0, 0); // 2026-11-01 01:00 UTC = Oct 31, 9 PM EDT
assert.equal(utcDateOf(ninePmEdt), '2026-11-01');
assert.equal(leagueDateOf(ninePmEdt), '2026-10-31');
assert.equal(leagueDateOf(Date.UTC(2026, 6, 26, 18, 0, 0)), '2026-07-26'); // afternoon: same day
assert.equal(leagueDateOf(Date.UTC(2026, 0, 15, 4, 59, 0)), '2026-01-14'); // before midnight EST (UTC-5)
console.log('league date: ok');
