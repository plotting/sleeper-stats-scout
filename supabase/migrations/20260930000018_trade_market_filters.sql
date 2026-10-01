-- Filters for the trade market page, and a fix for the crawler's reach: members are now
-- discovered from every dynasty league seen (not only the ones with similar settings), so
-- the crawl can spread beyond this league's own managers.
alter table market_leagues add column if not exists dynasty boolean;
alter table market_leagues add column if not exists members_synced_at timestamptz;

alter table market_trades add column if not exists shape text;        -- assets per side, biggest first, e.g. '2-1'
alter table market_trades add column if not exists has_picks boolean not null default false;
alter table market_trades add column if not exists has_players boolean not null default false;

-- Backfill trades collected before these columns existed.
update market_trades set
  shape = (select string_agg(n::text, '-' order by n desc)
           from (select jsonb_array_length(s -> 'g') as n from jsonb_array_elements(sides) s) x),
  has_picks = cardinality(pick_keys) > 0,
  has_players = cardinality(player_ids) > 0
where shape is null;

create index if not exists market_trades_filters_idx on market_trades (superflex, ppr, te_premium, num_teams);
create index if not exists market_trades_shape_idx on market_trades (shape);

notify pgrst, 'reload schema';
