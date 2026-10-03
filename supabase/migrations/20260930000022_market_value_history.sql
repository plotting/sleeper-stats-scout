-- One row per asset per day: what the fitted value was, so the calculator and Trade Market can show
-- movers (who is rising or falling). Written by scripts/fit-trade-values.ts after each fit.
create table if not exists market_value_history (
  format text not null check (format in ('1qb', 'sf')),
  asset_key text not null,          -- 'p:<sleeper id>' | 'pk:<years ahead>:<round>'
  as_of date not null,
  value numeric not null,
  primary key (format, asset_key, as_of)
);
create index if not exists market_value_history_asof_idx on market_value_history (format, as_of);

alter table market_value_history enable row level security;
drop policy if exists "admin read" on market_value_history;
create policy "admin read" on market_value_history for select to authenticated using (is_admin());
revoke all on market_value_history from anon;
