-- One-off cleanup: delete duplicate trades (same season, same two teams, same
-- date and identical items), keeping the oldest row of each group. Run
-- the SELECT first to see how many would go.
-- select count(*) from (...) -- see the dups CTE below

with sig as (
  select t.id, t.season_id,
    least(t.team1_id, t.team2_id) as a, greatest(t.team1_id, t.team2_id) as b, t.trade_date,
    coalesce((
      select string_agg(i.item_description || ':' || coalesce(i.from_team_id, 0) || '>' || coalesce(i.to_team_id, 0),
                        '|' order by i.item_description, i.from_team_id, i.to_team_id)
      from trade_items i where i.trade_id = t.id
    ), '') as items
  from trades t
),
dups as (
  select id from (
    select id, row_number() over (partition by season_id, a, b, trade_date, items order by id) as rn from sig
  ) x where rn > 1
),
del_items as (
  delete from trade_items where trade_id in (select id from dups)
)
delete from trades where id in (select id from dups);
