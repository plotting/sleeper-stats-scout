-- Adds name_key (the last column) to player_vorp so the Trades page can match
-- players whose names differ only by a suffix or punctuation between sources
-- (e.g. "Todd Gurley II" in a trade vs "Todd Gurley" in the stats). Otherwise
-- identical to the previous player_vorp definition.
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
  greatest(0::numeric, round(r.total_points - rt.repl_points::numeric / rt.repl_games::numeric * sl.games::numeric, 1)) as vorp,
  -- Name with suffix and punctuation removed, so "Todd Gurley II", "Todd Gurley" and
  -- "A.J. Green" / "AJ Green" match each other.
  lower(regexp_replace(regexp_replace(r.player_name, '\s+(jr|sr|ii|iii|iv|v)\.?$', '', 'i'), '[^a-zA-Z0-9]', '', 'g')) as name_key
from ranked r
  join repl rt on r.year = rt.year and r."position" = rt."position"
  join season_len sl on sl.year = r.year;

notify pgrst, 'reload schema';
