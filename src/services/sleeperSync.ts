import { supabase } from '@/integrations/supabase/client';
import {
  fetchLeagueUsers,
  fetchLeagueRosters,
  fetchMatchups,
  fetchLeagueDrafts,
  fetchDraftPicks,
  fetchTransactions,
  buildRosterOwnerMap,
  lookupPlayerNames,
  type SleeperLeague,
} from './sleeperApi';

export type LogFn = (msg: string, level?: 'info' | 'success' | 'warn' | 'error') => void;

// ─── Persistent mapping store ─────────────────────────────────────────────
// Saved as { [sleeperUserId]: dbTeamId } in localStorage so mappings carry
// forward across seasons without re-mapping every time.

const MAPPINGS_STORAGE_KEY = 'sleeper_team_mappings';

export function loadPersistedMappings(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(MAPPINGS_STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function persistMappings(updates: Record<string, number>) {
  const current = loadPersistedMappings();
  localStorage.setItem(MAPPINGS_STORAGE_KEY, JSON.stringify({ ...current, ...updates }));
}

// ─── Team mapping ──────────────────────────────────────────────────────────

export interface TeamMapping {
  sleeperUserId: string;
  sleeperUsername: string;
  sleeperDisplayName: string;
  dbTeamId: number | null;
  dbTeamName: string | null;
  isNew: boolean; // true if this user has never been mapped before
}

/** Fetch Sleeper users for a league and match them to existing DB teams.
 *  Resolution order: localStorage cache → Supabase owner_id → unmatched (isNew = true).
 */
export async function buildTeamMappings(leagueId: string, log?: LogFn): Promise<TeamMapping[]> {
  log?.(`Calling Sleeper /league/${leagueId}/users…`);
  const users = await fetchLeagueUsers(leagueId);
  log?.(`Sleeper returned ${users?.length ?? 'null'} users`);

  if (!users || users.length === 0) {
    log?.('No users returned from Sleeper — league may be private or ID incorrect', 'warn');
    return [];
  }

  log?.('Fetching teams from Supabase…');
  const dbResult = await supabase.from('teams').select('id, name, owner_id').order('id');
  if (dbResult.error) throw dbResult.error;
  const dbTeams = dbResult.data ?? [];
  log?.(`Found ${dbTeams.length} teams in database`);

  const saved = loadPersistedMappings();

  return users.map((u) => {
    const isNew = !(u.user_id in saved);
    // Prefer localStorage, fall back to Supabase owner_id column
    const savedId = saved[u.user_id];
    const match = savedId
      ? dbTeams.find((t) => t.id === savedId)
      : dbTeams.find((t) => t.owner_id === u.user_id);
    return {
      sleeperUserId: u.user_id,
      sleeperUsername: u.username,
      sleeperDisplayName: u.display_name,
      dbTeamId: match?.id ?? null,
      dbTeamName: match?.name ?? null,
      isNew,
    };
  });
}

/** Persist a user→team mapping to localStorage and Supabase teams.owner_id. */
export async function saveTeamMappings(
  mappings: TeamMapping[],
  log: LogFn,
): Promise<void> {
  const toSave: Record<string, number> = {};

  for (const m of mappings) {
    if (!m.dbTeamId) continue;
    toSave[m.sleeperUserId] = m.dbTeamId;
    const { error } = await supabase
      .from('teams')
      .update({ owner_id: m.sleeperUserId })
      .eq('id', m.dbTeamId);
    if (error) {
      log(`Failed to update team ${m.dbTeamName}: ${error.message}`, 'error');
    } else {
      log(`Mapped "${m.sleeperDisplayName}" → ${m.dbTeamName}`, 'success');
    }
  }

  if (Object.keys(toSave).length) {
    persistMappings(toSave);
    log(`Saved ${Object.keys(toSave).length} mappings to local storage`, 'success');
  }
}

// ─── Roster → DB team ID lookup ─────────────────────────────────────────────

async function buildRosterToTeamMap(
  leagueId: string,
): Promise<Map<number, number>> {
  const [rosterOwnerMap, dbResult] = await Promise.all([
    buildRosterOwnerMap(leagueId),
    supabase.from('teams').select('id, owner_id'),
  ]);

  if (dbResult.error) throw dbResult.error;
  const dbTeams = dbResult.data ?? [];

  // Use localStorage as the primary source (always up-to-date after Save Mappings),
  // then fall back to teams.owner_id in Supabase.
  const persisted = loadPersistedMappings(); // { sleeperUserId → dbTeamId }

  const map = new Map<number, number>();
  for (const [rosterId, sleeperUserId] of rosterOwnerMap) {
    const teamId =
      persisted[sleeperUserId] ??
      dbTeams.find((t) => t.owner_id === sleeperUserId)?.id;
    if (teamId) map.set(rosterId, teamId);
  }
  return map;
}

// ─── Season lookup ──────────────────────────────────────────────────────────

async function findSeasonId(year: number): Promise<number | null> {
  const { data } = await supabase
    .from('seasons')
    .select('id')
    .eq('year', year)
    .single();
  return data?.id ?? null;
}

// ─── Scores & Schedules ─────────────────────────────────────────────────────

export async function syncScoresAndSchedules(
  league: SleeperLeague,
  log: LogFn,
  onProgress?: (pct: number) => void,
): Promise<void> {
  const year = parseInt(league.season, 10);
  const seasonId = await findSeasonId(year);
  if (!seasonId) {
    log(`No season found in DB for year ${year}. Add it first.`, 'error');
    return;
  }

  const rosterMap = await buildRosterToTeamMap(league.league_id);
  if (rosterMap.size === 0) {
    log('No roster→team mappings found. Run Team Mapping first.', 'error');
    return;
  }

  const playoffStart = league.settings.playoff_week_start;
  // Determine highest week with scores (use last_scored_leg, fall back to current leg)
  const lastScoredWeek = league.settings.last_scored_leg || league.settings.leg || 0;
  const totalWeeks = Math.max(lastScoredWeek, playoffStart > 0 ? playoffStart + 3 : 0);

  if (totalWeeks === 0) {
    log(`No weeks to sync for ${year}`, 'warn');
    return;
  }

  log(`Syncing ${totalWeeks} weeks for ${year} (playoff starts week ${playoffStart})…`);

  for (let week = 1; week <= totalWeeks; week++) {
    try {
      const matchups = await fetchMatchups(league.league_id, week);
      if (!matchups || matchups.length === 0) {
        onProgress?.((week / totalWeeks) * 100);
        continue;
      }

      const isPlayoff = playoffStart > 0 && week >= playoffStart;

      // Group into pairs by matchup_id
      const pairs = new Map<number, typeof matchups>();
      for (const m of matchups) {
        if (m.matchup_id === null) continue;
        const g = pairs.get(m.matchup_id) ?? [];
        g.push(m);
        pairs.set(m.matchup_id, g);
      }

      const scoreRows = matchups
        .map((m) => {
          const teamId = rosterMap.get(m.roster_id);
          if (!teamId) return null;
          return { season_id: seasonId, week_number: week, team_id: teamId, score: m.points ?? 0 };
        })
        .filter(Boolean) as { season_id: number; week_number: number; team_id: number; score: number }[];

      const scheduleRows: {
        season_id: number;
        week_number: number;
        home_team_id: number;
        away_team_id: number;
        is_playoff: boolean;
        is_consolation: boolean;
      }[] = [];

      for (const [, pair] of pairs) {
        if (pair.length !== 2) continue;
        const homeId = rosterMap.get(pair[0].roster_id);
        const awayId = rosterMap.get(pair[1].roster_id);
        if (!homeId || !awayId) continue;
        scheduleRows.push({
          season_id: seasonId,
          week_number: week,
          home_team_id: homeId,
          away_team_id: awayId,
          is_playoff: isPlayoff,
          is_consolation: false,
        });
      }

      if (scoreRows.length) {
        const { error: se } = await supabase
          .from('scores')
          .upsert(scoreRows, { onConflict: 'season_id,week_number,team_id' });
        if (se) throw new Error(`scores upsert failed (week ${week}): ${se.message}`);
      }
      if (scheduleRows.length) {
        const { error: sche } = await supabase
          .from('schedules')
          .upsert(scheduleRows, { onConflict: 'season_id,week_number,home_team_id,away_team_id' });
        if (sche) throw new Error(`schedules upsert failed (week ${week}): ${sche.message}`);
      }

      log(
        `Week ${week}: ${scoreRows.length} scores, ${scheduleRows.length} matchups${isPlayoff ? ' (playoff)' : ''}`,
        'success',
      );
    } catch (err) {
      log(`Week ${week} failed: ${String(err)}`, 'error');
    }

    onProgress?.((week / totalWeeks) * 100);
  }

  log(`Scores & schedules sync complete for ${year}`, 'success');
}

// ─── Draft picks ─────────────────────────────────────────────────────────────

export async function syncDraftPicks(
  league: SleeperLeague,
  log: LogFn,
  onProgress?: (pct: number) => void,
): Promise<void> {
  const year = parseInt(league.season, 10);
  const seasonId = await findSeasonId(year);
  if (!seasonId) {
    log(`No season found in DB for year ${year}`, 'error');
    return;
  }

  const rosterMap = await buildRosterToTeamMap(league.league_id);
  const drafts = await fetchLeagueDrafts(league.league_id);

  if (!drafts || drafts.length === 0) {
    log(`No drafts found for ${year}`, 'warn');
    return;
  }

  // Only sync "regular" startup/rookie drafts (not keeper/auction stubs)
  const mainDrafts = drafts.filter((d) => d.status === 'complete');
  if (mainDrafts.length === 0) {
    log(`No completed drafts for ${year}`, 'warn');
    return;
  }

  // Upsert handles re-runs safely — no pre-delete needed

  let totalPicks = 0;
  for (let di = 0; di < mainDrafts.length; di++) {
    const draft = mainDrafts[di];
    try {
      const picks = await fetchDraftPicks(draft.draft_id);
      const rows = picks
        .map((p) => {
          const teamId = rosterMap.get(p.roster_id);
          if (!teamId) return null;
          const firstName = p.metadata?.first_name ?? '';
          const lastName = p.metadata?.last_name ?? '';
          const playerName = [firstName, lastName].filter(Boolean).join(' ') || `Player ${p.player_id}`;
          return {
            season_id: seasonId,
            round: p.round,
            pick_number: p.pick_no,
            team_id: teamId,
            player_name: playerName,
          };
        })
        .filter(Boolean) as {
        season_id: number;
        round: number;
        pick_number: number;
        team_id: number;
        player_name: string;
      }[];

      if (rows.length) {
        await supabase
          .from('draft_picks')
          .upsert(rows, { onConflict: 'season_id,round,pick_number' });
        totalPicks += rows.length;
        log(`Draft ${draft.draft_id}: inserted ${rows.length} picks`, 'success');
      }
    } catch (err) {
      log(`Draft ${draft.draft_id} failed: ${String(err)}`, 'error');
    }

    onProgress?.(((di + 1) / mainDrafts.length) * 100);
  }

  log(`Draft sync complete for ${year}: ${totalPicks} picks`, 'success');
}

// ─── Trades ───────────────────────────────────────────────────────────────────

const SYNCED_TRADES_KEY = (year: number) => `sleeper_synced_trades_${year}`;

function loadSyncedTradeIds(year: number): Set<string> {
  try {
    const raw = localStorage.getItem(SYNCED_TRADES_KEY(year));
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveSyncedTradeId(year: number, txId: string) {
  const ids = loadSyncedTradeIds(year);
  ids.add(txId);
  localStorage.setItem(SYNCED_TRADES_KEY(year), JSON.stringify([...ids]));
}

// Round number → ordinal label
function roundOrdinal(round: number): string {
  const labels = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];
  return labels[round] ?? `${round}th`;
}

export async function syncTrades(
  league: SleeperLeague,
  log: LogFn,
  onProgress?: (pct: number) => void,
): Promise<void> {
  const year = parseInt(league.season, 10);
  const seasonId = await findSeasonId(year);
  if (!seasonId) {
    log(`No season found in DB for year ${year}`, 'error');
    return;
  }

  const rosterMap = await buildRosterToTeamMap(league.league_id);
  if (rosterMap.size === 0) {
    log('No roster→team mappings. Run Team Mapping first.', 'error');
    return;
  }

  // Fetch team names for enriching pick descriptions
  const { data: teamData } = await supabase.from('teams').select('id, name');
  const teamNameMap = new Map<number, string>((teamData ?? []).map((t) => [t.id, t.name]));
  const numTeams = league.total_rosters || 10;

  // Cache findSeasonId calls for pick seasons (may differ from current season)
  const seasonIdCache = new Map<number, number | null>();
  const getSeasonIdCached = async (y: number) => {
    if (!seasonIdCache.has(y)) seasonIdCache.set(y, await findSeasonId(y));
    return seasonIdCache.get(y) ?? null;
  };

  // Helper: resolve the (R.SS) slot for a traded pick from draft_picks table
  const resolvePickSlot = async (
    pickSeason: string,
    round: number,
    originalTeamId: number,
  ): Promise<string | null> => {
    const sid = await getSeasonIdCached(Number(pickSeason));
    if (sid === null) return null;
    const { data } = await supabase
      .from('draft_picks')
      .select('pick_number')
      .eq('season_id', sid)
      .eq('round', round)
      .eq('team_id', originalTeamId)
      .maybeSingle();
    if (!data) return null;
    const slot = ((data.pick_number - 1) % numTeams) + 1;
    return `(${round}.${String(slot).padStart(2, '0')})`;
  };

  log(`Loading player name cache…`);
  // Pre-warm player cache (fetches /players/nfl once and caches 7 days)
  await lookupPlayerNames([]);

  const syncedIds = loadSyncedTradeIds(year);
  const playoffStart = league.settings.playoff_week_start;
  const totalWeeks = Math.max(
    league.settings.last_scored_leg ?? league.settings.leg ?? 17,
    playoffStart > 0 ? playoffStart + 3 : 17,
  );

  let newTrades = 0;

  for (let week = 1; week <= totalWeeks; week++) {
    try {
      const transactions = await fetchTransactions(league.league_id, week);
      const trades = (transactions ?? []).filter(
        (t) => t.type === 'trade' && t.status === 'complete',
      );

      for (const tx of trades) {
        if (syncedIds.has(tx.transaction_id)) continue;

        const rosterIds = tx.roster_ids ?? [];
        const team1Id = rosterIds[0] != null ? rosterMap.get(rosterIds[0]) : undefined;
        const team2Id = rosterIds[1] != null ? rosterMap.get(rosterIds[1]) : undefined;
        if (!team1Id || !team2Id) continue;

        const tradeDate = new Date(tx.created).toISOString().split('T')[0];

        const { data: tradeRow, error: tradeErr } = await supabase
          .from('trades')
          .insert({ season_id: seasonId, team1_id: team1Id, team2_id: team2Id, trade_date: tradeDate })
          .select('id')
          .single();

        if (tradeErr || !tradeRow) {
          log(`Failed to insert trade ${tx.transaction_id}: ${tradeErr?.message}`, 'error');
          continue;
        }

        const tradeId = tradeRow.id;

        // ── Resolve player names in one batch ──────────────────────────────
        const playerIds = tx.adds ? Object.keys(tx.adds) : [];
        const nameMap = playerIds.length ? await lookupPlayerNames(playerIds) : new Map<string, string>();

        const items: {
          trade_id: number;
          from_team_id: number;
          to_team_id: number;
          item_type: string;
          item_description: string;
        }[] = [];

        // Player transfers
        if (tx.adds) {
          for (const [playerId, receivingRosterId] of Object.entries(tx.adds)) {
            const receivingTeamId = rosterMap.get(receivingRosterId);
            const sendingRosterId = tx.drops?.[playerId];
            const sendingTeamId = sendingRosterId != null ? rosterMap.get(sendingRosterId) : undefined;
            if (!receivingTeamId || !sendingTeamId) continue;
            items.push({
              trade_id: tradeId,
              from_team_id: sendingTeamId,
              to_team_id: receivingTeamId,
              item_type: 'player',
              item_description: nameMap.get(playerId) ?? `Player ${playerId}`,
            });
          }
        }

        // Draft pick transfers – try to show (R.SS) if pick has been used
        for (const pick of tx.draft_picks ?? []) {
          const fromTeamId = rosterMap.get(pick.previous_owner_id);
          const toTeamId = rosterMap.get(pick.owner_id);
          if (!fromTeamId || !toTeamId) continue;

          const originalTeamId = rosterMap.get(pick.roster_id);
          const origName = originalTeamId ? teamNameMap.get(originalTeamId) : undefined;
          const origStr = origName ? ` (via ${origName})` : '';

          let pickDesc: string;
          if (originalTeamId) {
            const slot = await resolvePickSlot(pick.season, pick.round, originalTeamId);
            pickDesc = slot
              ? `${pick.season} ${slot}${origStr}`
              : `${pick.season} ${roundOrdinal(pick.round)} Round Pick${origStr}`;
          } else {
            pickDesc = `${pick.season} ${roundOrdinal(pick.round)} Round Pick${origStr}`;
          }

          items.push({
            trade_id: tradeId,
            from_team_id: fromTeamId,
            to_team_id: toTeamId,
            item_type: 'pick',
            item_description: pickDesc,
          });
        }

        if (items.length) {
          await supabase.from('trade_items').insert(items);
        }

        saveSyncedTradeId(year, tx.transaction_id);
        newTrades++;
      }
    } catch (err) {
      log(`Week ${week} trades failed: ${String(err)}`, 'error');
    }

    onProgress?.((week / totalWeeks) * 100);
  }

  log(`Trades sync complete for ${year}: ${newTrades} new trades`, 'success');
}

// ─── Repair existing trade descriptions ──────────────────────────────────────
// Fixes already-synced trades that have "Player XXXX" placeholders.
// Safe to run multiple times — only updates rows that still contain raw IDs.

export async function repairTradeDescriptions(log: LogFn): Promise<void> {
  log('Scanning for trade items with unresolved player IDs…');

  const { data: items, error } = await supabase
    .from('trade_items')
    .select('id, item_description')
    .eq('item_type', 'player')
    .like('item_description', 'Player %');

  if (error) {
    log(`Failed to fetch trade items: ${error.message}`, 'error');
    return;
  }
  if (!items || items.length === 0) {
    log('No unresolved player descriptions found — nothing to fix.', 'success');
    return;
  }

  log(`Found ${items.length} items to repair. Fetching player names…`);

  // Extract numeric player IDs (skip anything already real-named)
  const rawIds = items
    .map((i) => i.item_description.replace(/^Player\s+/, '').trim())
    .filter((id) => /^\d+$/.test(id));

  const nameMap = await lookupPlayerNames([...new Set(rawIds)]);

  let fixed = 0;
  for (const item of items) {
    const playerId = item.item_description.replace(/^Player\s+/, '').trim();
    if (!/^\d+$/.test(playerId)) continue;
    const name = nameMap.get(playerId);
    if (!name || name === `Player ${playerId}`) continue; // no better name available

    const { error: upErr } = await supabase
      .from('trade_items')
      .update({ item_description: name })
      .eq('id', item.id);

    if (upErr) {
      log(`Failed to update item ${item.id}: ${upErr.message}`, 'warn');
    } else {
      fixed++;
    }
  }

  log(`Repaired ${fixed} of ${items.length} player descriptions.`, fixed > 0 ? 'success' : 'warn');
}

// ─── Repair existing pick descriptions ───────────────────────────────────────
// Upgrades "2025 Round 1 Pick" → "2025 (1.02) (via Brian)" where possible.
// Safe to run multiple times — skips picks already in the new format.

export async function repairPickDescriptions(log: LogFn): Promise<void> {
  log('Scanning for pick trade items to upgrade…');

  const { data: items, error } = await supabase
    .from('trade_items')
    .select('id, item_description')
    .eq('item_type', 'pick');

  if (error) { log(`Failed to fetch pick items: ${error.message}`, 'error'); return; }
  if (!items || items.length === 0) { log('No pick trade items found.', 'success'); return; }

  // Only target old "YYYY Round N Pick (via Name)?" format
  const OLD_FORMAT = /^(\d{4}) Round (\d+) Pick(?: \(via (.+?)\))?$/;
  const toRepair = items.filter((i) => OLD_FORMAT.test(i.item_description));
  if (toRepair.length === 0) {
    log('All pick descriptions already use the new format.', 'success');
    return;
  }
  log(`Found ${toRepair.length} picks to upgrade. Resolving draft slots…`);

  // Fetch all teams for name → id lookup (case-insensitive)
  const { data: teamData } = await supabase.from('teams').select('id, name');
  const teamByName = new Map<string, number>(
    (teamData ?? []).map((t) => [t.name.toLowerCase(), t.id]),
  );

  // Fetch all draft picks in one shot for fast slot lookup
  const { data: allPicks } = await supabase
    .from('draft_picks')
    .select('season_id, round, pick_number, team_id');

  // Build: "seasonId:round:teamId" → pick_number
  const pickLookup = new Map<string, number>();
  // Build: seasonId → number of teams (count round-1 picks)
  const teamsPerSeason = new Map<number, number>();
  for (const dp of allPicks ?? []) {
    pickLookup.set(`${dp.season_id}:${dp.round}:${dp.team_id}`, dp.pick_number);
    if (dp.round === 1) {
      teamsPerSeason.set(dp.season_id, (teamsPerSeason.get(dp.season_id) ?? 0) + 1);
    }
  }

  // Cache findSeasonId calls
  const sidCache = new Map<number, number | null>();
  const getSid = async (y: number) => {
    if (!sidCache.has(y)) sidCache.set(y, await findSeasonId(y));
    return sidCache.get(y) ?? null;
  };

  let fixed = 0;
  for (const item of toRepair) {
    const match = item.item_description.match(OLD_FORMAT);
    if (!match) continue;
    const [, yearStr, roundStr, origName] = match;
    const year = Number(yearStr);
    const round = Number(roundStr);
    const origStr = origName ? ` (via ${origName})` : '';

    let newDesc: string;

    if (origName) {
      const sid = await getSid(year);
      const teamId = teamByName.get(origName.toLowerCase());
      const pickNum = sid !== null && teamId !== undefined
        ? pickLookup.get(`${sid}:${round}:${teamId}`)
        : undefined;

      if (pickNum !== undefined && sid !== null) {
        const numTeams = teamsPerSeason.get(sid) ?? 10;
        const slot = ((pickNum - 1) % numTeams) + 1;
        newDesc = `${year} (${round}.${String(slot).padStart(2, '0')})${origStr}`;
      } else {
        // Draft hasn't happened or pick not found — keep year + ordinal
        newDesc = `${year} ${roundOrdinal(round)} Round Pick${origStr}`;
      }
    } else {
      // No original owner known — just improve the format
      newDesc = `${year} ${roundOrdinal(round)} Round Pick`;
    }

    if (newDesc === item.item_description) continue;

    const { error: upErr } = await supabase
      .from('trade_items')
      .update({ item_description: newDesc })
      .eq('id', item.id);

    if (upErr) {
      log(`Failed to update pick ${item.id}: ${upErr.message}`, 'warn');
    } else {
      fixed++;
    }
  }

  log(`Upgraded ${fixed} of ${toRepair.length} pick descriptions.`, fixed > 0 ? 'success' : 'warn');
}

// ─── Clear + re-sync trades for a season ─────────────────────────────────────
// Deletes all trade rows (cascades to trade_items), clears the localStorage
// dedup cache, then runs syncTrades fresh so all picks get the new (R.SS) format.

export async function clearAndResyncTrades(
  league: SleeperLeague,
  log: LogFn,
  onProgress?: (pct: number) => void,
): Promise<void> {
  const year = parseInt(league.season, 10);
  const seasonId = await findSeasonId(year);
  if (!seasonId) { log(`No season found for ${year}`, 'error'); return; }

  log(`Deleting all trades for ${year}…`);

  // Must delete child rows first (trade_items → trades foreign key)
  const { data: tradeRows } = await supabase
    .from('trades')
    .select('id')
    .eq('season_id', seasonId);

  const tradeIds = (tradeRows ?? []).map((r) => r.id);

  if (tradeIds.length > 0) {
    const { error: itemsErr } = await supabase
      .from('trade_items')
      .delete()
      .in('trade_id', tradeIds);
    if (itemsErr) { log(`Failed to delete trade items: ${itemsErr.message}`, 'error'); return; }
  }

  const { error: delErr } = await supabase
    .from('trades')
    .delete()
    .eq('season_id', seasonId);
  if (delErr) { log(`Delete failed: ${delErr.message}`, 'error'); return; }

  // Clear the localStorage dedup set so syncTrades processes every transaction
  localStorage.removeItem(`sleeper_synced_trades_${year}`);
  log('Cleared local trade cache. Re-syncing…');

  await syncTrades(league, log, onProgress);
}

// ─── Convenience: sync everything for one league ────────────────────────────

export async function syncAll(
  league: SleeperLeague,
  log: LogFn,
  onProgress?: (label: string, pct: number) => void,
): Promise<void> {
  log(`=== Syncing ${league.season} (${league.name}) ===`);
  await syncScoresAndSchedules(league, log, (p) => onProgress?.('Scores & Schedules', p));
  await syncDraftPicks(league, log, (p) => onProgress?.('Draft Picks', p));
  await syncTrades(league, log, (p) => onProgress?.('Trades', p));
  log(`=== Done syncing ${league.season} ===`, 'success');
}
