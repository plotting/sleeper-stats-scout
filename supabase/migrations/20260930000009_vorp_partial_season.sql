-- player_vorp multiplied the replacement player's points-per-game by a full
-- season (16/17 games) even for the season in progress, so every player in the
-- current year showed a large negative VORP (e.g. -115 after 3 weeks). The
-- season length is now capped at the most games anyone has played that year
-- (= weeks completed), so partial seasons are compared over the same games.
-- Completed seasons are unchanged (max games = 16/17). Same columns as before,
-- so player_vorp_summary and rookie_draft_grades keep working.
create or replace view player_vorp as
with ranked as (
  select player_seasons.player_name,
    player_seasons."position",
    player_seasons.year,
    player_seasons.total_points,
    player_seasons.games_played,
    player_seasons.ppg,
    row_number() over (partition by player_seasons.year, player_seasons."position" order by player_seasons.total_points desc) as season_rank
  from player_seasons
  where player_seasons."position" = any (array['QB'::text, 'RB'::text, 'WR'::text, 'TE'::text, 'DST'::text])
    and player_seasons.games_played > 0
),
season_len as (
  select year,
    least(case when year >= 2021 then 17 else 16 end, max(games_played)) as games
  from ranked
  group by year
),
repl as (
  select ranked.year,
    ranked."position",
    ranked.total_points as repl_points,
    greatest(ranked.games_played, 1) as repl_games
  from ranked
  where ranked."position" = 'QB'::text and ranked.season_rank = 10
     or ranked."position" = 'RB'::text and ranked.season_rank = 30
     or ranked."position" = 'WR'::text and ranked.season_rank = 30
     or ranked."position" = 'TE'::text and ranked.season_rank = 10
     or ranked."position" = 'DST'::text and ranked.season_rank = 10
)
select r.player_name,
  r."position",
  r.year,
  r.total_points,
  r.games_played,
  r.ppg,
  r.season_rank,
  rt.repl_points,
  round(r.total_points - rt.repl_points::numeric / rt.repl_games::numeric * sl.games::numeric, 1) as vorp
from ranked r
  join repl rt on r.year = rt.year and r."position" = rt."position"
  join season_len sl on sl.year = r.year;

notify pgrst, 'reload schema';
