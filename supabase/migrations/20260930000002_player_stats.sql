-- Player stats / VORP, now synced from the browser (Admin → Player Stats).
-- This league already had player_vorp and rookie_draft_grades, so this only
-- makes sure the columns and the unique key the browser sync upserts on exist.
-- (rookie_draft_grades is left untouched.)

create table if not exists player_vorp (
  sleeper_player_id text not null,
  year integer not null,
  player_name text not null,
  position text not null,
  total_points numeric not null,
  season_rank integer not null,
  vorp numeric not null,
  games_played integer not null,
  updated_at timestamptz not null default now(),
  primary key (sleeper_player_id, year)
);
alter table player_vorp add column if not exists games_played integer not null default 0;
alter table player_vorp add column if not exists season_rank integer not null default 0;
alter table player_vorp add column if not exists updated_at timestamptz not null default now();
create unique index if not exists player_vorp_player_year_key
  on player_vorp (sleeper_player_id, year);

alter table draft_picks add column if not exists position text;

notify pgrst, 'reload schema';
