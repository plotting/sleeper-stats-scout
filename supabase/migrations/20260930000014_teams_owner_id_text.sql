-- teams.owner_id was created as a uuid, but it stores a Sleeper user id (an
-- 18-digit number, not a uuid), so saving the team mapping to the database failed
-- ("invalid input syntax for type uuid"). Only the browser copy of the mapping was
-- ever saved, which is why the scheduled (Node) sync found no mappings.
-- Make it text, dropping anything that was tied to the uuid type. Safe to re-run.
do $$
declare r record;
begin
  -- foreign keys on owner_id (e.g. to auth.users)
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.teams'::regclass and c.contype = 'f'
      and c.conkey = (select array_agg(a.attnum) from pg_attribute a
                      where a.attrelid = 'public.teams'::regclass and a.attname = 'owner_id')
  loop
    execute format('alter table public.teams drop constraint %I', r.conname);
  end loop;
  -- row-level-security policies written in terms of owner_id (they block the type change)
  for r in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'teams'
      and (coalesce(qual, '') || coalesce(with_check, '')) ilike '%owner_id%'
  loop
    execute format('drop policy %I on public.teams', r.policyname);
  end loop;
end $$;

alter table teams alter column owner_id type text using owner_id::text;

notify pgrst, 'reload schema';
