-- The browser sync writes player_seasons directly (the old Edge Function used
-- the service role, which bypasses row-level security). Match the other
-- tables: public read and write.
alter table player_seasons enable row level security;
drop policy if exists "public read" on player_seasons;
drop policy if exists "public write" on player_seasons;
create policy "public read" on player_seasons for select using (true);
create policy "public write" on player_seasons for all using (true) with check (true);
notify pgrst, 'reload schema';
