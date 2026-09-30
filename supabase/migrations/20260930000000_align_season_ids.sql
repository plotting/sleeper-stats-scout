-- Make seasons.id always equal seasons.season_number (= year - 2012, so
-- 2013 = 1). Much of the app addresses a season by "season number" in URLs
-- and filters on season_id with that same number, so the two must match.
-- Safe to re-run; handles any existing id layout.

-- 1. Let child tables follow when a season id changes.
do $$
declare r record;
begin
  for r in
    select conrelid::regclass as tbl, conname, pg_get_constraintdef(oid) as def
    from pg_constraint
    where contype = 'f' and confrelid = 'seasons'::regclass
      and pg_get_constraintdef(oid) not ilike '%on update cascade%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format('alter table %s add constraint %I %s on update cascade', r.tbl, r.conname, r.def);
  end loop;
end $$;

-- 2. Renumber: season_number from the year, then id from season_number
--    (two steps so ids never collide mid-update).
alter table seasons drop constraint if exists seasons_id_matches_number;
-- Any leftover pre-2013 placeholder seasons move out of the id range first.
update seasons set id = id + 200000 where year < 2013 and id < 100000;
update seasons set season_number = year - 2012 where year >= 2013;
update seasons set id = id + 100000 where year >= 2013 and id <> season_number;
update seasons set id = season_number where year >= 2013 and id <> season_number;
select setval(pg_get_serial_sequence('seasons', 'id'), greatest((select max(id) from seasons), 1));

-- 3. Keep it that way: new seasons derive their number and id from the year,
--    and the two can never drift apart again.
create or replace function seasons_align() returns trigger
language plpgsql as $$
begin
  new.season_number := new.year - 2012;
  new.id := new.season_number;
  return new;
end $$;
drop trigger if exists seasons_align_trg on seasons;
create trigger seasons_align_trg before insert on seasons
  for each row execute function seasons_align();

alter table seasons add constraint seasons_id_matches_number check (year < 2013 or id = season_number);

notify pgrst, 'reload schema';
