-- 1. Unique indexes the sync's upserts rely on. Without them Postgres rejects
--    "ON CONFLICT" with "no unique or exclusion constraint matching".
--    (If this errors with "could not create unique index", duplicate rows
--    exist; clear the affected table and re-sync.)
create unique index if not exists scores_season_week_team_key
  on scores (season_id, week_number, team_id);
create unique index if not exists draft_picks_season_round_pick_key
  on draft_picks (season_id, round, pick_number);
create unique index if not exists playoff_sim_history_key
  on playoff_sim_history (season_id, as_of_week, bracket_size, team_id);

-- 2. draft_picks.draft_slot (original owner's Sleeper roster_id) and position.
alter table draft_picks add column if not exists draft_slot integer;
alter table draft_picks add column if not exists position text;

-- 3. Only list a team in a season's standings if it actually has games that
--    season (previously every team appeared in every season with 0-0).
-- Dropped first: CREATE OR REPLACE can't reorder/rename columns of an existing view.
drop view if exists team_records_view;
create view team_records_view as
select
  t.id as team_id,
  t.name as team_name,
  seasons_played.season_id,
  coalesce(sum(case when not m.is_playoff and m.won then 1 else 0 end), 0) as regular_season_wins,
  coalesce(sum(case when not m.is_playoff and m.lost then 1 else 0 end), 0) as regular_season_losses,
  coalesce(sum(case when not m.is_playoff and m.tied then 1 else 0 end), 0) as regular_season_ties,
  coalesce(sum(case when not m.is_playoff then m.pf else 0 end), 0) as regular_season_points_for,
  coalesce(sum(case when not m.is_playoff then m.pa else 0 end), 0) as regular_season_points_against,
  coalesce(sum(case when m.is_playoff and m.won then 1 else 0 end), 0) as playoff_wins,
  coalesce(sum(case when m.is_playoff and m.lost then 1 else 0 end), 0) as playoff_losses,
  coalesce(sum(case when m.is_playoff and m.tied then 1 else 0 end), 0) as playoff_ties,
  coalesce(sum(case when m.is_playoff then m.pf else 0 end), 0) as playoff_points_for,
  coalesce(sum(case when m.is_playoff then m.pa else 0 end), 0) as playoff_points_against
from teams t
join (
  select season_id, home_team_id as team_id from schedules where home_team_id is not null
  union
  select season_id, away_team_id as team_id from schedules where away_team_id is not null
) seasons_played on seasons_played.team_id = t.id
left join (
  select
    season_id, home_team_id as team_id, is_playoff,
    home_score as pf, away_score as pa,
    (home_score > away_score) as won, (home_score < away_score) as lost, (home_score = away_score) as tied
  from matchup_scores_view
  where home_score is not null and away_score is not null
  union all
  select
    season_id, away_team_id as team_id, is_playoff,
    away_score as pf, home_score as pa,
    (away_score > home_score) as won, (away_score < home_score) as lost, (away_score = home_score) as tied
  from matchup_scores_view
  where home_score is not null and away_score is not null
) m on m.team_id = t.id and m.season_id = seasons_played.season_id
group by t.id, t.name, seasons_played.season_id;

grant select on team_records_view to anon, authenticated;

-- Make the API pick up the new column immediately.
notify pgrst, 'reload schema';
