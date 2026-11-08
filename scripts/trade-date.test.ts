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
