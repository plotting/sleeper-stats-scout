-- Playoff brackets for seasons 1-7 (2013-2019), which predate the Sleeper league
-- and so have nothing to sync. Taken from the league's Excel workbook (Season 1-7
-- sheets). Teams are matched by name; the script stops if any name is not found.
-- Round 1 = week 15, round 2 = week 16. Consolation (losers) places are
-- absolute (5th/7th/9th place games). Safe to re-run.

create or replace function tmp_map_bracket(arr jsonb) returns jsonb
language plpgsql as $$
declare
  e jsonb; res jsonb := '[]'::jsonb; k text; id int; o jsonb;
begin
  for e in select value from jsonb_array_elements(arr) loop
    o := e;
    foreach k in array array['t1','t2','w','l'] loop
      select t.id into id from teams t where lower(t.name) = lower(e->>k) limit 1;
      if id is null then raise exception 'No team named %', e->>k; end if;
      o := jsonb_set(o, array[k], to_jsonb(id));
    end loop;
    res := res || jsonb_build_array(o);
  end loop;
  return res;
end $$;

insert into season_playoffs (season_id, league_id, playoff_week_start, playoff_teams, round_type, winners, losers, synced_at)
select s.id, 'excel', 15, 4, 0, tmp_map_bracket('[{"r":1,"m":1,"t1":"Marshall","t2":"Brian","w":"Brian","l":"Marshall"},{"r":1,"m":2,"t1":"Erik","t2":"Jeff","w":"Jeff","l":"Erik"},{"r":2,"m":3,"t1":"Brian","t2":"Jeff","w":"Jeff","l":"Brian","p":1},{"r":2,"m":4,"t1":"Marshall","t2":"Erik","w":"Marshall","l":"Erik","p":3}]'::jsonb), tmp_map_bracket('[{"r":1,"m":1,"t1":"Thom","t2":"Aron","w":"Thom","l":"Aron"},{"r":1,"m":2,"t1":"Adam","t2":"Nate","w":"Adam","l":"Nate"},{"r":1,"m":3,"t1":"Melissa","t2":"CJ","w":"CJ","l":"Melissa"},{"r":2,"m":4,"t1":"Thom","t2":"Adam","w":"Adam","l":"Thom","p":5},{"r":2,"m":5,"t1":"Aron","t2":"CJ","w":"CJ","l":"Aron","p":7},{"r":2,"m":6,"t1":"Nate","t2":"Melissa","w":"Nate","l":"Melissa","p":9}]'::jsonb), now()
from seasons s where s.id = 1
on conflict (season_id) do update set league_id = excluded.league_id, playoff_week_start = excluded.playoff_week_start,
  playoff_teams = excluded.playoff_teams, round_type = excluded.round_type, winners = excluded.winners,
  losers = excluded.losers, synced_at = excluded.synced_at;

insert into season_playoffs (season_id, league_id, playoff_week_start, playoff_teams, round_type, winners, losers, synced_at)
select s.id, 'excel', 15, 4, 0, tmp_map_bracket('[{"r":1,"m":1,"t1":"Marshall","t2":"Thom","w":"Marshall","l":"Thom"},{"r":1,"m":2,"t1":"Jeff","t2":"Aron","w":"Aron","l":"Jeff"},{"r":2,"m":3,"t1":"Marshall","t2":"Aron","w":"Aron","l":"Marshall","p":1},{"r":2,"m":4,"t1":"Thom","t2":"Jeff","w":"Jeff","l":"Thom","p":3}]'::jsonb), tmp_map_bracket('[{"r":1,"m":1,"t1":"Melissa","t2":"Brian","w":"Melissa","l":"Brian"},{"r":1,"m":2,"t1":"Erik","t2":"Adam","w":"Erik","l":"Adam"},{"r":1,"m":3,"t1":"CJ","t2":"Nate","w":"CJ","l":"Nate"},{"r":2,"m":4,"t1":"Melissa","t2":"Erik","w":"Erik","l":"Melissa","p":5},{"r":2,"m":5,"t1":"Brian","t2":"CJ","w":"Brian","l":"CJ","p":7},{"r":2,"m":6,"t1":"Adam","t2":"Nate","w":"Adam","l":"Nate","p":9}]'::jsonb), now()
from seasons s where s.id = 2
on conflict (season_id) do update set league_id = excluded.league_id, playoff_week_start = excluded.playoff_week_start,
  playoff_teams = excluded.playoff_teams, round_type = excluded.round_type, winners = excluded.winners,
  losers = excluded.losers, synced_at = excluded.synced_at;

insert into season_playoffs (season_id, league_id, playoff_week_start, playoff_teams, round_type, winners, losers, synced_at)
select s.id, 'excel', 15, 4, 0, tmp_map_bracket('[{"r":1,"m":1,"t1":"Erik","t2":"Brian","w":"Brian","l":"Erik"},{"r":1,"m":2,"t1":"Marshall","t2":"Nate","w":"Nate","l":"Marshall"},{"r":2,"m":3,"t1":"Brian","t2":"Nate","w":"Nate","l":"Brian","p":1},{"r":2,"m":4,"t1":"Erik","t2":"Marshall","w":"Marshall","l":"Erik","p":3}]'::jsonb), tmp_map_bracket('[{"r":1,"m":1,"t1":"Thom","t2":"Jeff","w":"Thom","l":"Jeff"},{"r":1,"m":2,"t1":"Adam","t2":"Aron","w":"Adam","l":"Aron"},{"r":1,"m":3,"t1":"CJ","t2":"Melissa","w":"CJ","l":"Melissa"},{"r":2,"m":4,"t1":"Thom","t2":"Adam","w":"Adam","l":"Thom","p":5},{"r":2,"m":5,"t1":"Jeff","t2":"CJ","w":"Jeff","l":"CJ","p":7},{"r":2,"m":6,"t1":"Aron","t2":"Melissa","w":"Aron","l":"Melissa","p":9}]'::jsonb), now()
from seasons s where s.id = 3
on conflict (season_id) do update set league_id = excluded.league_id, playoff_week_start = excluded.playoff_week_start,
  playoff_teams = excluded.playoff_teams, round_type = excluded.round_type, winners = excluded.winners,
  losers = excluded.losers, synced_at = excluded.synced_at;

insert into season_playoffs (season_id, league_id, playoff_week_start, playoff_teams, round_type, winners, losers, synced_at)
select s.id, 'excel', 15, 4, 0, tmp_map_bracket('[{"r":1,"m":1,"t1":"Adam","t2":"Brian","w":"Brian","l":"Adam"},{"r":1,"m":2,"t1":"Jeff","t2":"Nate","w":"Nate","l":"Jeff"},{"r":2,"m":3,"t1":"Brian","t2":"Nate","w":"Brian","l":"Nate","p":1},{"r":2,"m":4,"t1":"Adam","t2":"Jeff","w":"Adam","l":"Jeff","p":3}]'::jsonb), tmp_map_bracket('[{"r":1,"m":1,"t1":"CJ","t2":"Marshall","w":"Marshall","l":"CJ"},{"r":1,"m":2,"t1":"Erik","t2":"Aron","w":"Aron","l":"Erik"},{"r":1,"m":3,"t1":"Thom","t2":"Melissa","w":"Thom","l":"Melissa"},{"r":2,"m":4,"t1":"Marshall","t2":"Aron","w":"Marshall","l":"Aron","p":5},{"r":2,"m":5,"t1":"CJ","t2":"Thom","w":"CJ","l":"Thom","p":7},{"r":2,"m":6,"t1":"Erik","t2":"Melissa","w":"Erik","l":"Melissa","p":9}]'::jsonb), now()
from seasons s where s.id = 4
on conflict (season_id) do update set league_id = excluded.league_id, playoff_week_start = excluded.playoff_week_start,
  playoff_teams = excluded.playoff_teams, round_type = excluded.round_type, winners = excluded.winners,
  losers = excluded.losers, synced_at = excluded.synced_at;

insert into season_playoffs (season_id, league_id, playoff_week_start, playoff_teams, round_type, winners, losers, synced_at)
select s.id, 'excel', 15, 4, 0, tmp_map_bracket('[{"r":1,"m":1,"t1":"Erik","t2":"Marshall","w":"Marshall","l":"Erik"},{"r":1,"m":2,"t1":"Jeff","t2":"Adam","w":"Adam","l":"Jeff"},{"r":2,"m":3,"t1":"Marshall","t2":"Adam","w":"Marshall","l":"Adam","p":1},{"r":2,"m":4,"t1":"Erik","t2":"Jeff","w":"Erik","l":"Jeff","p":3}]'::jsonb), tmp_map_bracket('[{"r":1,"m":1,"t1":"Thom","t2":"Brian","w":"Brian","l":"Thom"},{"r":1,"m":2,"t1":"Melissa","t2":"CJ","w":"Melissa","l":"CJ"},{"r":1,"m":3,"t1":"Aron","t2":"Nate","w":"Aron","l":"Nate"},{"r":2,"m":4,"t1":"Brian","t2":"Melissa","w":"Melissa","l":"Brian","p":5},{"r":2,"m":5,"t1":"Thom","t2":"Aron","w":"Thom","l":"Aron","p":7},{"r":2,"m":6,"t1":"CJ","t2":"Nate","w":"Nate","l":"CJ","p":9}]'::jsonb), now()
from seasons s where s.id = 5
on conflict (season_id) do update set league_id = excluded.league_id, playoff_week_start = excluded.playoff_week_start,
  playoff_teams = excluded.playoff_teams, round_type = excluded.round_type, winners = excluded.winners,
  losers = excluded.losers, synced_at = excluded.synced_at;

insert into season_playoffs (season_id, league_id, playoff_week_start, playoff_teams, round_type, winners, losers, synced_at)
select s.id, 'excel', 15, 4, 0, tmp_map_bracket('[{"r":1,"m":1,"t1":"Jeff","t2":"CJ","w":"Jeff","l":"CJ"},{"r":1,"m":2,"t1":"Adam","t2":"Erik","w":"Adam","l":"Erik"},{"r":2,"m":3,"t1":"Jeff","t2":"Adam","w":"Adam","l":"Jeff","p":1},{"r":2,"m":4,"t1":"CJ","t2":"Erik","w":"CJ","l":"Erik","p":3}]'::jsonb), tmp_map_bracket('[{"r":1,"m":1,"t1":"Nate","t2":"Melissa","w":"Melissa","l":"Nate"},{"r":1,"m":2,"t1":"Thom","t2":"Marshall","w":"Thom","l":"Marshall"},{"r":1,"m":3,"t1":"Brian","t2":"Aron","w":"Brian","l":"Aron"},{"r":2,"m":4,"t1":"Melissa","t2":"Thom","w":"Thom","l":"Melissa","p":5},{"r":2,"m":5,"t1":"Nate","t2":"Brian","w":"Brian","l":"Nate","p":7},{"r":2,"m":6,"t1":"Marshall","t2":"Aron","w":"Aron","l":"Marshall","p":9}]'::jsonb), now()
from seasons s where s.id = 6
on conflict (season_id) do update set league_id = excluded.league_id, playoff_week_start = excluded.playoff_week_start,
  playoff_teams = excluded.playoff_teams, round_type = excluded.round_type, winners = excluded.winners,
  losers = excluded.losers, synced_at = excluded.synced_at;

insert into season_playoffs (season_id, league_id, playoff_week_start, playoff_teams, round_type, winners, losers, synced_at)
select s.id, 'excel', 15, 4, 0, tmp_map_bracket('[{"r":1,"m":1,"t1":"Jeff","t2":"Adam","w":"Adam","l":"Jeff"},{"r":1,"m":2,"t1":"Thom","t2":"CJ","w":"CJ","l":"Thom"},{"r":2,"m":3,"t1":"Adam","t2":"CJ","w":"Adam","l":"CJ","p":1},{"r":2,"m":4,"t1":"Jeff","t2":"Thom","w":"Thom","l":"Jeff","p":3}]'::jsonb), tmp_map_bracket('[{"r":1,"m":1,"t1":"Aron","t2":"Marshall","w":"Aron","l":"Marshall"},{"r":1,"m":2,"t1":"Erik","t2":"Brian","w":"Erik","l":"Brian"},{"r":1,"m":3,"t1":"Nate","t2":"Melissa","w":"Melissa","l":"Nate"},{"r":2,"m":4,"t1":"Aron","t2":"Erik","w":"Aron","l":"Erik","p":5},{"r":2,"m":5,"t1":"Marshall","t2":"Melissa","w":"Marshall","l":"Melissa","p":7},{"r":2,"m":6,"t1":"Brian","t2":"Nate","w":"Brian","l":"Nate","p":9}]'::jsonb), now()
from seasons s where s.id = 7
on conflict (season_id) do update set league_id = excluded.league_id, playoff_week_start = excluded.playoff_week_start,
  playoff_teams = excluded.playoff_teams, round_type = excluded.round_type, winners = excluded.winners,
  losers = excluded.losers, synced_at = excluded.synced_at;

drop function tmp_map_bracket(jsonb);
notify pgrst, 'reload schema';
