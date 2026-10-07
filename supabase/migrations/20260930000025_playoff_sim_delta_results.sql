-- Change in playoff odds caused by the results of the week just played, as a fraction like playoff_pct:
-- the odds now minus the previous week replayed with the same rosters and projections. Whatever is left of the
-- saved week-over-week change is lineups, injuries and projection updates (see scripts/sim-playoff-odds.ts).
alter table playoff_sim_history add column if not exists delta_results numeric;
