-- Starting lineup of each crawled league (e.g. {"qb":1,"rb":2,"wr":2,"te":1,"flex":2,"sf":0}), so
-- trade values can be fitted for leagues with lineups like ours: more flex slots lower the
-- replacement level at RB/WR, which changes what each position is worth. Filled in by the crawler
-- for new leagues and by scripts/fit-trade-values.ts for leagues saved earlier.
alter table market_leagues add column if not exists lineup jsonb;

notify pgrst, 'reload schema';
