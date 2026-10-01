-- Expected VORP per season for each overall draft slot, so a re-traded pick can
-- show a year-by-year breakdown (draft year + 0..4) that adds up to its 5-year
-- slot value. Same population as the expected curve: completed classes only (a
-- full 5-season window has been played), startup draft excluded, smoothed over
-- the neighbouring slots (±1).
create or replace view slot_expected_by_year as
with picks as (
  select s.year as draft_year, dp.pick_number as overall_pick, dp.player_name
  from draft_picks dp
  join seasons s on s.id = dp.season_id and not s.startup_draft
  where s.year <= extract(year from current_date)::int - 5
),
per_pick_year as (
  select p.overall_pick, o.k as season_offset, coalesce(pv.vorp, 0) as vorp
  from picks p
  cross join generate_series(0, 4) as o(k)
  left join player_vorp pv
    on lower(pv.player_name) = lower(p.player_name) and pv.year = p.draft_year + o.k
),
slots as (select distinct overall_pick from picks)
select sl.overall_pick, pp.season_offset, avg(pp.vorp)::numeric(10, 2) as avg_vorp
from slots sl
join per_pick_year pp on pp.overall_pick between sl.overall_pick - 1 and sl.overall_pick + 1
group by sl.overall_pick, pp.season_offset;

grant select on slot_expected_by_year to anon, authenticated;
notify pgrst, 'reload schema';
