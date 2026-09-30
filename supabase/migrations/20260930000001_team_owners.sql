-- Per-season ownership. Teams change hands over the years, so "which Sleeper
-- user is this team" is stored per Sleeper league (one league per season),
-- not once globally on teams.owner_id.
create table if not exists team_owners (
  league_id text not null,
  sleeper_user_id text not null,
  team_id integer not null references teams(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (league_id, sleeper_user_id)
);
alter table team_owners enable row level security;
drop policy if exists "public read" on team_owners;
drop policy if exists "public write" on team_owners;
create policy "public read" on team_owners for select using (true);
create policy "public write" on team_owners for all using (true) with check (true);

-- Carry over existing single-owner mappings for the current league so
-- nothing already saved is lost.
insert into team_owners (league_id, sleeper_user_id, team_id)
select '1319742366797545472', owner_id, id from teams where owner_id is not null
on conflict do nothing;

notify pgrst, 'reload schema';
