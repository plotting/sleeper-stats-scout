-- Trades remember which Sleeper transaction they came from, so re-syncing
-- (from any browser, or the scheduled job) never inserts a trade twice.
alter table trades add column if not exists sleeper_transaction_id text;
create unique index if not exists trades_sleeper_transaction_id_key
  on trades (sleeper_transaction_id) where sleeper_transaction_id is not null;
notify pgrst, 'reload schema';
