-- With VORP floored at 0, five-year totals can no longer be negative, so the
-- old C/D/F cutoffs (below 0) would never trigger. Same view as before with
-- grade cutoffs recalibrated for non-negative totals:
--   A+ >=400, A >=250, A- >=150, B+ >=75, B >=25, B- >=15, C >=5, D >0, F =0
-- (F = never beat replacement level in the five-year window.)
create or replace view rookie_draft_grades as
with pick_vorp as (
  select dp.id as pick_id,
    s.year as draft_year,
    ((dp.pick_number - 1) % 10) + 1 as pick_number,
    dp.round,
    dp.pick_number as overall_pick,
    dp.team_id,
    t.name as team_name,
    dp.player_name,
    coalesce(ra."position", ps_pos."position") as "position",
    coalesce(ra.adp, dp.pick_number::numeric) as adp,
    coalesce(sum(pv.vorp), 0::numeric) as five_yr_vorp,
    count(pv.year) as seasons_with_data
  from draft_picks dp
    join seasons s on s.id = dp.season_id
    join teams t on t.id = dp.team_id
    left join rookie_adp ra on ra.year = s.year and lower(ra.name) = lower(dp.player_name::text)
    left join lateral (
      select ps2."position" from player_seasons ps2
      where lower(ps2.player_name) = lower(dp.player_name::text)
        and ps2."position" = any (array['QB'::text, 'RB'::text, 'WR'::text, 'TE'::text])
      limit 1
    ) ps_pos on true
    left join player_vorp pv on lower(pv.player_name) = lower(dp.player_name::text)
      and pv.year >= s.year and pv.year < (s.year + 5)
  group by dp.id, s.year, dp.pick_number, dp.round, dp.team_id, t.name, dp.player_name, ra."position", ps_pos."position", ra.adp
)
select pick_id, draft_year, pick_number, round, overall_pick, team_id, team_name,
  player_name, "position", adp, five_yr_vorp, seasons_with_data,
  case
    when five_yr_vorp >= 400 then 'A+'::text
    when five_yr_vorp >= 250 then 'A'::text
    when five_yr_vorp >= 150 then 'A-'::text
    when five_yr_vorp >= 75 then 'B+'::text
    when five_yr_vorp >= 25 then 'B'::text
    when five_yr_vorp >= 15 then 'B-'::text
    when five_yr_vorp >= 5 then 'C'::text
    when five_yr_vorp > 0 then 'D'::text
    else 'F'::text
  end as vorp_grade
from pick_vorp;

notify pgrst, 'reload schema';
