-- Trade market database: completed trades collected from public Sleeper dynasty leagues
-- with settings similar to this league, used to value trades from what managers actually
-- accept. Only league ids, roster numbers and player/pick ids are stored (no names or
-- user details). Written by the crawler (scripts/crawl-trades.ts) with the service role;
-- readable only by the signed-in admin.

create table if not exists market_leagues (
  league_id text primary key,
  season integer not null,
  num_teams integer,
  superflex boolean not null default false,
  ppr numeric not null default 0,
  te_premium numeric not null default 0,
  pass_td numeric,
  matches boolean not null default false,   -- similar enough to this league to collect trades from
  previous_league_id text,
  trades_synced_at timestamptz,
  discovered_at timestamptz not null default now()
);
create index if not exists market_leagues_matches_idx on market_leagues (matches, trades_synced_at);

-- Sleeper accounts seen while crawling (ids only), so each is visited once.
create table if not exists market_seen_users (
  user_id text primary key,
  discovered_at timestamptz not null default now(),
  crawled_at timestamptz
);
create index if not exists market_seen_users_todo_idx on market_seen_users (crawled_at, discovered_at);

-- One row per completed trade. `sides` is [{r: roster_id, g: [asset...]}] where an asset is
-- {p: "<sleeper player id>"} | {k: [season, round, original_roster_id]} | {b: faab_amount}.
create table if not exists market_trades (
  id bigint generated always as identity primary key,
  league_id text not null references market_leagues (league_id) on delete cascade,
  transaction_id text not null,
  season integer not null,
  week integer,
  traded_at timestamptz not null,
  num_teams integer,
  superflex boolean not null default false,
  ppr numeric not null default 0,
  te_premium numeric not null default 0,
  sides jsonb not null,
  player_ids text[] not null default '{}',   -- every player in the trade, for search
  pick_keys text[] not null default '{}',    -- e.g. '2027-1' (season-round), for search
  unique (league_id, transaction_id)
);
create index if not exists market_trades_season_idx on market_trades (season, traded_at desc);
create index if not exists market_trades_players_idx on market_trades using gin (player_ids);
create index if not exists market_trades_picks_idx on market_trades using gin (pick_keys);

-- Player directory (QB/RB/WR/TE) so ids can be shown as names.
create table if not exists sleeper_players (
  player_id text primary key,
  name text not null,
  position text,
  team text,
  age integer,
  updated_at timestamptz not null default now()
);
create index if not exists sleeper_players_name_idx on sleeper_players (lower(name));

-- Private: only the signed-in admin can read (no public access at all); the crawler writes
-- with the service role, which bypasses RLS. Needs is_admin() from the admin-auth migration.
do $$
declare t text;
begin
  foreach t in array array['market_leagues', 'market_seen_users', 'market_trades', 'sleeper_players'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "public read" on %I', t);
    execute format('drop policy if exists "admin read" on %I', t);
    execute format('create policy "admin read" on %I for select to authenticated using (is_admin())', t);
  end loop;
end $$;

revoke all on market_leagues, market_seen_users, market_trades, sleeper_players from anon;

notify pgrst, 'reload schema';
