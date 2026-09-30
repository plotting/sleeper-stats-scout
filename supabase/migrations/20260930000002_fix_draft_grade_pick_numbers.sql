-- draft_picks.pick_number holds the OVERALL pick (round 2 starts at 11), but
-- rookie_draft_grades treated it as the pick within the round, so overall_pick
-- was inflated from round 2 on (R2P1 became 21) and the UI showed "2.11".
-- Here: overall_pick = pick_number, pick_number = pick within the round.
-- Same columns, names and types as before, so CREATE OR REPLACE works.
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
    when five_yr_vorp >= 0 then 'B-'::text
    when five_yr_vorp >= -50 then 'C'::text
    when five_yr_vorp >= -150 then 'D'::text
    else 'F'::text
  end as vorp_grade
from pick_vorp;

notify pgrst, 'reload schema';
