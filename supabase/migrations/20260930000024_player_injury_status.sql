-- Sleeper's current injury designation (Out, IR, Doubtful, Questionable, …), refreshed with the player
-- directory so the calculator can flag injured players next to their value. Null = healthy / unknown.
alter table sleeper_players add column if not exists injury_status text;
