-- Each season's playoff structure, copied from Sleeper (winners_bracket /
-- losers_bracket) with roster ids translated to team ids. The app reads this
-- instead of assuming a playoff format from the season number, so it works
-- for any league size or format.
create table if not exists season_playoffs (
  season_id integer primary key references seasons(id) on delete cascade,
  league_id text not null,
  playoff_week_start integer not null default 15,
  playoff_teams integer not null default 0,
  round_type integer not null default 0,
  winners jsonb not null default '[]'::jsonb,
  losers jsonb not null default '[]'::jsonb,
  synced_at timestamptz not null default now()
);
alter table season_playoffs enable row level security;
drop policy if exists "public read" on season_playoffs;
drop policy if exists "public write" on season_playoffs;
create policy "public read" on season_playoffs for select using (true);
create policy "public write" on season_playoffs for all using (true) with check (true);
notify pgrst, 'reload schema';
