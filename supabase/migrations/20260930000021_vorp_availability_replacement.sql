-- Replacement level from availability instead of fixed ranks (QB10 / RB30 / WR30 / TE10).
--
-- A team needs a starter at each slot every week, but players miss games. So the number of
-- players needed at a position is (starter slots x teams x games in the season) / (average
-- games a relevant player plays), and the next player after those is the replacement.
-- Example: 1 QB slot x 10 teams x 17 games = 170 QB-games; if QBs play 15 games on average
-- that takes 11.33 -> 12 QBs, so the 13th QB is replacement. RBs and WRs miss more games, so
-- their replacement sits deeper (lower points) than a fixed rank would put it.
--
-- Lineup (this league): 10 teams, 1 QB, 2 RB, 2 WR, 1 TE, 3 FLEX (RB/WR/TE), 1 DST.
-- Flex slots are assigned to the best RB/WR/TE left after the base starters, by season points,
-- so the position that actually fills flex gets the extra demand. Average games are measured
-- over the top 1.5 x the position's starter slots, capped at the season length.
-- Otherwise identical to the previous player_vorp (same columns, VORP floored at 0, prorated).
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
cfg as (
  select * from (values
    ('QB'::text, 1, false),
    ('RB'::text, 2, true),
    ('WR'::text, 2, true),
    ('TE'::text, 1, true),
    ('DST'::text, 1, false)
  ) as v("position", base_slots, flex_eligible)
),
flex_pool as (
  select r.year, r."position",
    row_number() over (partition by r.year order by r.total_points desc) as flex_rank
  from ranked r
    join cfg c on c."position" = r."position"
  where c.flex_eligible and r.season_rank > c.base_slots * 10
),
flex_counts as (
  select year, "position", count(*) as flex_n
  from flex_pool
  where flex_rank <= 3 * 10
  group by year, "position"
),
demand as (
  select sl.year, c."position", sl.games,
    c.base_slots * 10 + coalesce(fc.flex_n, 0) as slots
  from season_len sl
    cross join cfg c
    left join flex_counts fc on fc.year = sl.year and fc."position" = c."position"
),
avail as (
  select d.year, d."position", d.games, d.slots,
    (select avg(least(r.games_played, d.games))
     from ranked r
     where r.year = d.year and r."position" = d."position" and r.season_rank <= ceil(d.slots * 1.5)) as avg_games
  from demand d
),
repl_rank as (
  select year, "position",
    -- players needed to fill every slot every week, then one more: the replacement
    ceil(slots * games / greatest(avg_games, 1))::int + 1 as want_rank
  from avail
  where avg_games is not null
),
repl as (
  select rr.year, rr."position",
    r.total_points as repl_points,
    greatest(r.games_played, 1) as repl_games
  from repl_rank rr
    join lateral (
      select x.total_points, x.games_played
      from ranked x
      where x.year = rr.year and x."position" = rr."position"
      order by x.season_rank
      offset greatest(0, least(rr.want_rank, (select count(*) from ranked x2 where x2.year = rr.year and x2."position" = rr."position")::int) - 1)
      limit 1
    ) r on true
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
  lower(regexp_replace(regexp_replace(r.player_name, '\s+(jr|sr|ii|iii|iv|v)\.?$', '', 'i'), '[^a-zA-Z0-9]', '', 'g')) as name_key
from ranked r
  join repl rt on r.year = rt.year and r."position" = rt."position"
  join season_len sl on sl.year = r.year;

notify pgrst, 'reload schema';
