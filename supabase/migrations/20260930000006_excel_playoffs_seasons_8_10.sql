-- Playoff brackets for seasons 8-10 (2020-2022) from the league workbook, replacing
-- the Sleeper-synced versions (Sleeper mangled the toilet bowl and some rosters
-- were unmapped). league_id = 'excel' marks them as manual; the Sleeper sync
-- leaves such rows alone. Teams are matched by name; stops if a name is missing.
-- Playoffs: round 1 = wk 15, round 2 = wk 16 (final + 3rd place), consolation
-- ("toilet bowl") has 3 rounds, wk 15-17, with 5th/7th/9th place games.
-- Safe to re-run.

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
select s.id, 'excel', 15, 4, 0, tmp_map_bracket('[{"r":1,"m":1,"t1":"Jeff","t2":"Nate","w":"Jeff","l":"Nate"},{"r":1,"m":2,"t1":"Adam","t2":"Aron","w":"Aron","l":"Adam"},{"r":2,"m":3,"t1":"Jeff","t2":"Aron","w":"Jeff","l":"Aron","p":1},{"r":2,"m":4,"t1":"Nate","t2":"Adam","w":"Adam","l":"Nate","p":3}]'::jsonb), tmp_map_bracket('[{"r":1,"m":1,"t1":"Thom","t2":"Erik","w":"Erik","l":"Thom"},{"r":1,"m":2,"t1":"Brian","t2":"Marshall","w":"Brian","l":"Marshall"},{"r":2,"m":3,"t1":"Erik","t2":"Brian","w":"Brian","l":"Erik","p":5},{"r":2,"m":4,"t1":"CJ","t2":"Thom","w":"Thom","l":"CJ"},{"r":2,"m":5,"t1":"Marshall","t2":"Melissa","w":"Marshall","l":"Melissa"},{"r":3,"m":6,"t1":"Thom","t2":"Marshall","w":"Marshall","l":"Thom","p":7},{"r":3,"m":7,"t1":"CJ","t2":"Melissa","w":"Melissa","l":"CJ","p":9}]'::jsonb), now()
from seasons s where s.id = 8
on conflict (season_id) do update set league_id = excluded.league_id, playoff_week_start = excluded.playoff_week_start,
  playoff_teams = excluded.playoff_teams, round_type = excluded.round_type, winners = excluded.winners,
  losers = excluded.losers, synced_at = excluded.synced_at;

insert into season_playoffs (season_id, league_id, playoff_week_start, playoff_teams, round_type, winners, losers, synced_at)
select s.id, 'excel', 15, 4, 0, tmp_map_bracket('[{"r":1,"m":1,"t1":"Jeff","t2":"Adam","w":"Jeff","l":"Adam"},{"r":1,"m":2,"t1":"Nate","t2":"Thom","w":"Thom","l":"Nate"},{"r":2,"m":3,"t1":"Jeff","t2":"Thom","w":"Jeff","l":"Thom","p":1},{"r":2,"m":4,"t1":"Adam","t2":"Nate","w":"Adam","l":"Nate","p":3}]'::jsonb), tmp_map_bracket('[{"r":1,"m":1,"t1":"Aron","t2":"CJ","w":"CJ","l":"Aron"},{"r":1,"m":2,"t1":"Melissa","t2":"Marshall","w":"Marshall","l":"Melissa"},{"r":2,"m":3,"t1":"CJ","t2":"Marshall","w":"Marshall","l":"CJ","p":5},{"r":2,"m":4,"t1":"Brian","t2":"Aron","w":"Aron","l":"Brian"},{"r":2,"m":5,"t1":"Melissa","t2":"Erik","w":"Erik","l":"Melissa"},{"r":3,"m":6,"t1":"Aron","t2":"Erik","w":"Erik","l":"Aron","p":7},{"r":3,"m":7,"t1":"Brian","t2":"Melissa","w":"Brian","l":"Melissa","p":9}]'::jsonb), now()
from seasons s where s.id = 9
on conflict (season_id) do update set league_id = excluded.league_id, playoff_week_start = excluded.playoff_week_start,
  playoff_teams = excluded.playoff_teams, round_type = excluded.round_type, winners = excluded.winners,
  losers = excluded.losers, synced_at = excluded.synced_at;

insert into season_playoffs (season_id, league_id, playoff_week_start, playoff_teams, round_type, winners, losers, synced_at)
select s.id, 'excel', 15, 4, 0, tmp_map_bracket('[{"r":1,"m":1,"t1":"Jeff","t2":"Marshall","w":"Jeff","l":"Marshall"},{"r":1,"m":2,"t1":"CJ","t2":"Adam","w":"Adam","l":"CJ"},{"r":2,"m":3,"t1":"Jeff","t2":"Adam","w":"Jeff","l":"Adam","p":1},{"r":2,"m":4,"t1":"Marshall","t2":"CJ","w":"Marshall","l":"CJ","p":3}]'::jsonb), tmp_map_bracket('[{"r":1,"m":1,"t1":"Erik","t2":"Nate","w":"Erik","l":"Nate"},{"r":1,"m":2,"t1":"Aron","t2":"Melissa","w":"Melissa","l":"Aron"},{"r":2,"m":3,"t1":"Erik","t2":"Melissa","w":"Melissa","l":"Erik","p":5},{"r":2,"m":4,"t1":"Thom","t2":"Nate","w":"Thom","l":"Nate"},{"r":2,"m":5,"t1":"Aron","t2":"Brian","w":"Aron","l":"Brian"},{"r":3,"m":6,"t1":"Thom","t2":"Aron","w":"Thom","l":"Aron","p":7},{"r":3,"m":7,"t1":"Nate","t2":"Brian","w":"Brian","l":"Nate","p":9}]'::jsonb), now()
from seasons s where s.id = 10
on conflict (season_id) do update set league_id = excluded.league_id, playoff_week_start = excluded.playoff_week_start,
  playoff_teams = excluded.playoff_teams, round_type = excluded.round_type, winners = excluded.winners,
  losers = excluded.losers, synced_at = excluded.synced_at;

drop function tmp_map_bracket(jsonb);
notify pgrst, 'reload schema';
