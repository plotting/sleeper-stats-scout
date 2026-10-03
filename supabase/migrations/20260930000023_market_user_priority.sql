-- Visit accounts from matching leagues first: they are far more likely to be in other similar leagues than
-- accounts found in any dynasty league (about 0.6% of leagues seen so far matched). 2 = member of a matching
-- league (or this league's own managers), 1 = member of another dynasty league, 0 = unknown.
alter table market_seen_users add column if not exists priority smallint not null default 0;
create index if not exists market_seen_users_priority_idx on market_seen_users (crawled_at, priority desc, discovered_at);
