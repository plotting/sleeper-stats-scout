-- Fitted trade values (scripts/fit-trade-values.ts): one value per player / pick per format,
-- the per-trade balance score, and a log of each fit so quality can be reviewed as data grows.
-- Admin-only like the other market tables; the fit job writes with the service role.

create table if not exists market_values (
  format text not null check (format in ('1qb', 'sf')),
  asset_key text not null,          -- 'p:<sleeper id>' | 'pk:<years ahead>:<round>'
  value numeric not null,           -- current-class 1st-round pick = 1000
  n_trades integer not null,
  updated_at timestamptz not null default now(),
  primary key (format, asset_key)
);

create table if not exists market_trade_scores (
  trade_id bigint primary key references market_trades (id) on delete cascade,
  val_a numeric not null,
  val_b numeric not null,
  diff_pct numeric not null,        -- |a-b| / max(a,b) * 100
  fair_tier text not null check (fair_tier in ('even', 'close', 'edge', 'lop'))
);
create index if not exists market_trade_scores_tier_idx on market_trade_scores (fair_tier);

create table if not exists market_fit_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  format text not null,
  n_trades integer not null,
  n_assets integer not null,
  in_sample_mean_gap numeric,
  prior_mean_gap numeric,
  holdout_mean_gap numeric,
  holdout_coverage numeric,
  tiers jsonb
);

do $$
declare t text;
begin
  foreach t in array array['market_values', 'market_trade_scores', 'market_fit_runs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "admin read" on %I', t);
    execute format('create policy "admin read" on %I for select to authenticated using (is_admin())', t);
    execute format('revoke all on %I from anon', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
