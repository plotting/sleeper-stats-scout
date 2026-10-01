-- Step 2 of locking down writes. Run ONLY after you have signed in at /admin with
-- the new login and seen it work (see 20260930000012_admin_auth.sql).
--
-- After this: reads stay public; only a signed-in user whose email is in
-- admin_emails can write; the scheduled GitHub job keeps working through the
-- service-role key (it bypasses RLS). Safe to re-run.
--
-- TO UNDO (if you get locked out), run the block at the bottom of this file
-- (the commented "UNDO" section).

do $$
declare r record; p record;
begin
  -- Every data table: row-level security on, and no policy except public read
  -- and admin write (this drops "public write" and any other catch-all policy).
  for r in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'admin_emails'
  loop
    execute format('alter table public.%I enable row level security', r.table_name);
    for p in
      select policyname, tablename from pg_policies
      where schemaname = 'public' and tablename = r.table_name
        and policyname not in ('public read', 'admin write')
    loop
      execute format('drop policy %I on public.%I', p.policyname, p.tablename);
    end loop;
  end loop;
end $$;

-- Belt and braces: the anonymous key can never write, whatever the policies say.
revoke insert, update, delete, truncate on all tables in schema public from anon;

notify pgrst, 'reload schema';

-- UNDO (uncomment and run to restore public write access):
-- do $$ declare r record; begin
--   for r in select table_name from information_schema.tables
--            where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'admin_emails' loop
--     execute format('create policy "public write" on public.%I for all using (true) with check (true)', r.table_name);
--   end loop;
-- end $$;
-- grant insert, update, delete on all tables in schema public to anon;
