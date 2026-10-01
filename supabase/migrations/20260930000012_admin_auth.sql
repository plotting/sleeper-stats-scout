-- Step 1 of locking down writes: the admin allow-list and the policies that let
-- an admin write. Purely additive (nothing is removed yet), so it is safe to run
-- while the site still works as before. Safe to re-run.
--
-- Order:  1) run this file   2) run supabase/admin_user_setup.sql (creates your login)
--         3) deploy the app, sign in at /admin, confirm it works
--         4) run 20260930000013_lock_writes.sql (removes public write access)

create table if not exists admin_emails (
  email text primary key
);
alter table admin_emails enable row level security;
-- No policies on purpose: nobody can read it directly, only is_admin() can.

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from admin_emails
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function is_admin() from public, anon;
grant execute on function is_admin() to authenticated;

-- On every data table: make sure public reads have a policy of their own (so they
-- keep working once the old catch-all policies go), and add the admin write policy.
do $$
declare r record;
begin
  for r in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'admin_emails'
  loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = r.table_name and policyname = 'public read'
    ) then
      execute format('create policy "public read" on public.%I for select using (true)', r.table_name);
    end if;
    execute format('drop policy if exists "admin write" on public.%I', r.table_name);
    execute format(
      'create policy "admin write" on public.%I for all to authenticated using (is_admin()) with check (is_admin())',
      r.table_name
    );
  end loop;
end $$;

notify pgrst, 'reload schema';
