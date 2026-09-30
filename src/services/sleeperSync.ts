import { supabase } from '@/integrations/supabase/client';
import {
  fetchLeagueUsers,
  fetchLeagueRosters,
  fetchMatchups,
  fetchLeagueDrafts,
  fetchDraft,
  fetchDraftPicks,
  fetchTransactions,
  buildRosterOwnerMap,
  lookupPlayerNames,
  LEAGUE_ID,
  type SleeperLeague,
} from './sleeperApi';

export type LogFn = (msg: string, level?: 'info' | 'success' | 'warn' | 'error') => void;

// ─── Legacy mapping cache ─────────────────────────────────────────────────
// Ownership is stored per Sleeper league (season) in the `team_owners` table,
// because teams change hands over the years. The old browser-local
// { [sleeperUserId]: dbTeamId } cache and teams.owner_id are only used as
// *suggestions* for leagues that haven't been mapped yet.

const MAPPINGS_STORAGE_KEY = 'matzie_sleeper_team_mappings';

export function loadPersistedMappings(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(MAPPINGS_STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

async function loadLeagueOwners(leagueId: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('team_owners')
    .select('sleeper_user_id, team_id')
    .eq('league_id', leagueId);
  if (error) {
    throw new Error(
      `Could not read team_owners (${error.message}). Run supabase/migrations/20260930000001_team_owners.sql in the Supabase SQL editor.`,
    );
  }
  return new Map((data ?? []).map((r) => [r.sleeper_user_id, r.team_id]));
}

// ─── Team mapping ──────────────────────────────────────────────────────────

export interface TeamMapping {
  sleeperUserId: string;
  sleeperUsername: string;
  sleeperDisplayName: string;
  sleeperTeamName: string | null;
  dbTeamId: number | null;
  dbTeamName: string | null;
  isNew: boolean; // true if this user isn't mapped to any existing team
}

/** Fetch Sleeper users for a league and match them to DB teams *for that season*.
 *  Saved rows for this league win. Otherwise the user's team from another
 *  season is suggested (isNew = true until saved), since most owners keep
 *  their team; reassign it if the team changed hands that year.
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

  const leagueOwners = await loadLeagueOwners(leagueId);
  const legacy = loadPersistedMappings();

  return users.map((u) => {
    const savedId = leagueOwners.get(u.user_id);
    const saved = dbTeams.find((t) => t.id === savedId);
    const suggested = saved
      ? undefined
      : dbTeams.find((t) => t.id === legacy[u.user_id]) ??
        dbTeams.find((t) => t.owner_id === u.user_id);
    const match = saved ?? suggested;
    return {
      sleeperUserId: u.user_id,
      sleeperUsername: u.username,
      sleeperDisplayName: u.display_name,
      sleeperTeamName: u.metadata?.team_name?.trim() || null,
      dbTeamId: match?.id ?? null,
      dbTeamName: match?.name ?? null,
      isNew: !saved,
    };
  });
}

/** Persist this league's user→team mapping to team_owners. Rows for users
 *  left unset are removed. teams.owner_id is only touched for the current
 *  league (it means "current owner"). */
export async function saveTeamMappings(
  leagueId: string,
  mappings: TeamMapping[],
  log: LogFn,
): Promise<void> {
  const rows = mappings
    .filter((m) => m.dbTeamId)
    .map((m) => ({ league_id: leagueId, sleeper_user_id: m.sleeperUserId, team_id: m.dbTeamId as number }));

  const unset = mappings.filter((m) => !m.dbTeamId).map((m) => m.sleeperUserId);
  if (unset.length) {
    const { error } = await supabase
      .from('team_owners')
      .delete()
      .eq('league_id', leagueId)
      .in('sleeper_user_id', unset);
    if (error) throw new Error(`Failed to clear unset mappings: ${error.message}`);
  }

  if (rows.length) {
    const { error } = await supabase
      .from('team_owners')
      .upsert(rows, { onConflict: 'league_id,sleeper_user_id' });
    if (error) throw new Error(`Failed to save mappings: ${error.message}`);
  }
  for (const m of mappings) {
    if (m.dbTeamId) log(`Mapped "${m.sleeperDisplayName}" → ${m.dbTeamName}`, 'success');
  }
  log(`Saved ${rows.length} mappings for league ${leagueId}`, 'success');

  if (leagueId === LEAGUE_ID) {
    for (const m of mappings) {
      if (!m.dbTeamId) continue;
      const { error } = await supabase.from('teams').update({ owner_id: m.sleeperUserId }).eq('id', m.dbTeamId);
      if (error) log(`Could not update current owner of ${m.dbTeamName}: ${error.message}`, 'warn');
    }
  }
}

/** Create a DB team for each Sleeper user that isn't mapped yet, owned by that user.
 *  Used to populate an empty teams table from the Sleeper league. */
export async function createTeamsForUnmapped(
  leagueId: string,
  mappings: TeamMapping[],
  log: LogFn,
): Promise<number> {
  const unmapped = mappings.filter((m) => m.dbTeamId == null);
  if (unmapped.length === 0) {
    log('Every Sleeper user is already mapped to a team', 'info');
    return 0;
  }

  const { data, error } = await supabase
    .from('teams')
    .insert(
      unmapped.map((m) => ({
        name: m.sleeperTeamName ?? m.sleeperDisplayName,
        owner_id: m.sleeperUserId,
      })),
    )
    .select('id, owner_id');
  if (error) throw error;

  const ownerRows = (data ?? [])
    .filter((t) => t.owner_id)
    .map((t) => ({ league_id: leagueId, sleeper_user_id: t.owner_id as string, team_id: t.id }));
  const { error: ownerErr } = await supabase
    .from('team_owners')
    .upsert(ownerRows, { onConflict: 'league_id,sleeper_user_id' });
  if (ownerErr) throw new Error(`Failed to save mappings: ${ownerErr.message}`);
  log(`Created ${data?.length ?? 0} teams from Sleeper users`, 'success');
  return data?.length ?? 0;
}

/** Map every past season from the current one using Sleeper's roster_id.
 *
 *  A roster_id is the franchise: when a league renews, each roster keeps its
 *  id and a new owner simply takes it over. So if roster 4 is "2021 Champs" in
 *  the newest season, roster 4 is that same team in every earlier season, no
 *  matter who owned it then. Walks newest → oldest, filling in any Sleeper
 *  user that hasn't been saved for that season, and logs a review line per
 *  roster (owner, Sleeper team name, record) so it can be checked by eye.
 *  Existing saved mappings are never overwritten — conflicts are only flagged.
 *
 *  `leagues` must be oldest → newest (as fetchAllLeagues returns). The newest
 *  season must already be mapped. */
export async function autoMapSeasonsByRoster(leagues: SleeperLeague[], log: LogFn): Promise<void> {
  if (leagues.length < 2) {
    log('Only one Sleeper season exists — nothing to carry back.', 'info');
    return;
  }
  const newest = leagues[leagues.length - 1];

  const { data: teams, error: teamsErr } = await supabase.from('teams').select('id, name');
  if (teamsErr) throw teamsErr;
  const teamName = new Map((teams ?? []).map((t) => [t.id, t.name]));
  const norm = (n: string | null | undefined) => (n ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

  const newestOwners = await loadLeagueOwners(newest.league_id);
  if (newestOwners.size === 0) {
    throw new Error(`Map the ${newest.season} season first (Load Mappings → Save Mappings), then run this.`);
  }

  // roster_id → DB team, for the season just processed (starts with newest).
  const chain = new Map<number, number>();
  const newestRosters = await fetchLeagueRosters(newest.league_id);
  for (const r of newestRosters) {
    const t = r.owner_id ? newestOwners.get(r.owner_id) : undefined;
    if (t) chain.set(r.roster_id, t);
  }
  log(`${newest.season}: ${chain.size} of ${newestRosters.length} rosters mapped — carrying back by roster_id`);
  if (chain.size < newestRosters.length) {
    log(`${newest.season}: some rosters have no mapped owner; those franchises can't be carried back`, 'warn');
  }

  for (let i = leagues.length - 2; i >= 0; i--) {
    const league = leagues[i];
    const [rosters, users, saved] = await Promise.all([
      fetchLeagueRosters(league.league_id),
      fetchLeagueUsers(league.league_id),
      loadLeagueOwners(league.league_id),
    ]);
    const userById = new Map((users ?? []).map((u) => [u.user_id, u]));
    const next = new Map<number, number>();
    const rows: { league_id: string; sleeper_user_id: string; team_id: number }[] = [];
    log(`── ${league.season} ──`);

    for (const r of rosters) {
      const teamId = chain.get(r.roster_id);
      const user = r.owner_id ? userById.get(r.owner_id) : undefined;
      const who = user?.display_name ?? r.owner_id ?? '(no owner)';
      const sleeperTeam = user?.metadata?.team_name?.trim() || null;
      const record = `${r.settings.wins}-${r.settings.losses}${r.settings.ties ? `-${r.settings.ties}` : ''}, ${(r.settings.fpts + (r.settings.fpts_decimal ?? 0) / 100).toFixed(1)} PF`;
      const label = `roster ${r.roster_id} · ${who}${sleeperTeam ? ` "${sleeperTeam}"` : ''} · ${record}`;

      if (!teamId) {
        log(`${label} → no franchise in ${leagues[i + 1].season}`, 'warn');
        continue;
      }
      next.set(r.roster_id, teamId);
      if (!r.owner_id) {
        log(`${label} → ${teamName.get(teamId)} (no owner listed)`, 'warn');
        continue;
      }
      const existing = saved.get(r.owner_id);
      const nameMatches = sleeperTeam != null && norm(sleeperTeam) === norm(teamName.get(teamId));
      if (existing != null && existing !== teamId) {
        log(`${label} → kept saved "${teamName.get(existing)}" (roster continuity says "${teamName.get(teamId)}") — review`, 'warn');
        continue;
      }
      if (existing == null) rows.push({ league_id: league.league_id, sleeper_user_id: r.owner_id, team_id: teamId });
      log(`${label} → ${teamName.get(teamId)}${nameMatches ? ' (team name matches)' : ''}`, 'success');
    }

    if (rows.length) {
      const { error } = await supabase.from('team_owners').upsert(rows, { onConflict: 'league_id,sleeper_user_id' });
      if (error) throw new Error(`Failed to save ${league.season} mappings: ${error.message}`);
    }
    log(`${league.season}: saved ${rows.length} new mappings`, 'success');
    chain.clear();
    for (const [k, v] of next) chain.set(k, v);
  }
  log('Done. Re-run Sync All Seasons so each season uses its mapping.', 'success');
}

// ─── Roster → DB team ID lookup ─────────────────────────────────────────────

export async function buildRosterToTeamMap(
  leagueId: string,
): Promise<Map<number, number>> {
  const [rosterOwnerMap, dbResult, leagueOwners] = await Promise.all([
    buildRosterOwnerMap(leagueId),
    supabase.from('teams').select('id, owner_id'),
    loadLeagueOwners(leagueId),
  ]);

  if (dbResult.error) throw dbResult.error;
  const dbTeams = dbResult.data ?? [];
  const validIds = new Set(dbTeams.map((t) => t.id));

  // If this season has been mapped, use ONLY its mapping so a team that
  // changed hands isn't attributed to a previous owner. Seasons that were
  // never mapped fall back to the legacy single-owner mapping.
  const strict = leagueOwners.size > 0;
  const legacy = loadPersistedMappings();

  const map = new Map<number, number>();
  for (const [rosterId, sleeperUserId] of rosterOwnerMap) {
    let teamId = leagueOwners.get(sleeperUserId);
    if (!strict) {
      const fallbackId = legacy[sleeperUserId];
      teamId =
        (validIds.has(fallbackId) ? fallbackId : undefined) ??
        dbTeams.find((t) => t.owner_id === sleeperUserId)?.id;
    }
    if (teamId && validIds.has(teamId)) map.set(rosterId, teamId);
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

  // `settings.leg` (the league's own "currently active leg") lags real-world
  // completion by up to a day after the last game of a week ends — Sleeper
  // doesn't roll it to the next leg until waivers process, typically
  // overnight Tue/Wed. Gating on `week < leg` therefore withholds an
  // already-final week's scores for that entire lag window. `last_scored_leg`
  // is Sleeper's own dedicated "this leg is fully scored" signal and is the
  // more reliable primary gate; `leg` is kept only as a fallback for the
  // preseason case where `last_scored_leg` is still 0. Once the season is
  // marked complete, both fields may freeze below the final week number, so
  // fall back to syncing everything in that case instead of permanently
  // stranding the last week.
  const currentLeg = league.settings.last_scored_leg || league.settings.leg || 0;
  const seasonComplete = league.status === 'complete';

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

      // Sleeper returns a literal 0 (not null) for points in weeks that
      // haven't been played yet, so `points` alone can't distinguish "really
      // scored 0" from "hasn't happened". Gate on `week <= currentLeg` (see
      // above) — `currentLeg` is `last_scored_leg`, which names the last
      // week that IS fully scored, so the comparison is inclusive. Skipping
      // the row entirely (rather than writing a 0) lets matchup_scores_view's
      // join return a true null for unplayed games, which every "is this
      // game in the future" check across the app relies on — the `scores`
      // table itself is NOT NULL, so 0 can't mean "unknown".
      const weekIsScored = seasonComplete ? week <= totalWeeks : week <= currentLeg;
      const scoreRows = matchups
        .map((m) => {
          const teamId = rosterMap.get(m.roster_id);
          if (!teamId || !weekIsScored) return null;
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
        const idA = rosterMap.get(pair[0].roster_id);
        const idB = rosterMap.get(pair[1].roster_id);
        if (!idA || !idB) continue;
        // Always store with lower team_id as home — canonical ordering prevents
        // duplicate rows when Sleeper returns the pair in different order across syncs.
        const [homeId, awayId] = idA < idB ? [idA, idB] : [idB, idA];
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
        // The `schedules` table enforces uniqueness per team per week via two
        // separate constraints — (season_id, week_number, home_team_id) and
        // (season_id, week_number, away_team_id) — not a single combined key.
        // Postgres can't resolve ON CONFLICT against two constraints at once,
        // so upsert falls back to a plain insert and collides with whatever's
        // already there on a re-sync. Delete-then-insert avoids that entirely
        // and matches the "existing data is replaced" behavior this page
        // already advertises.
        const { error: delErr } = await supabase
          .from('schedules')
          .delete()
          .eq('season_id', seasonId)
          .eq('week_number', week);
        if (delErr) throw new Error(`schedules delete failed (week ${week}): ${delErr.message}`);

        const { error: sche } = await supabase
          .from('schedules')
          .insert(scheduleRows);
        if (sche) throw new Error(`schedules insert failed (week ${week}): ${sche.message}`);
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

  // Build user_id → roster_id reverse-lookup.
  // Sleeper's draft_order is keyed by user_id (18-digit snowflake), NOT roster_id.
  // We need this to convert draft_order keys → small integer roster_ids (1-N).
  const rosterOwnerRaw = await buildRosterOwnerMap(league.league_id); // roster_id → user_id
  const userIdToRosterId = new Map<string, number>();
  for (const [rosterId, userId] of rosterOwnerRaw) {
    userIdToRosterId.set(userId, rosterId);
  }

  const drafts = await fetchLeagueDrafts(league.league_id);

  if (!drafts || drafts.length === 0) {
    log(`No drafts found for ${year}`, 'warn');
    return;
  }

  // Log all drafts so we can diagnose status/type mismatches
  log(`Drafts found for ${year} (${drafts.length} total):`);
  for (const d of drafts) {
    log(`  id=${d.draft_id} type=${d.type} status=${d.status} rounds=${d.settings?.rounds ?? '?'} teams=${d.settings?.teams ?? '?'}`);
  }

  // Include any draft that has been started or completed — dynasty leagues often
  // create a separate draft object per round; round 2 may have status 'drafting'
  // or another non-'complete' value even after all picks are in.
  const mainDrafts = drafts.filter((d) => d.status !== 'pre_draft');
  if (mainDrafts.length === 0) {
    log(`No non-pre_draft drafts for ${year}`, 'warn');
    return;
  }

  // Upsert handles re-runs safely — no pre-delete needed

  let totalPicks = 0;
  for (let di = 0; di < mainDrafts.length; di++) {
    const draft = mainDrafts[di];
    try {
      // Fetch full draft details to get draft_order (league endpoint sometimes omits it).
      // draft_order maps roster_id (string) → draft_slot (number).
      // We invert it to slot → roster_id so we can store original_roster_id per pick.
      let slotToRosterId = new Map<number, number>();
      try {
        const fullDraft = await fetchDraft(draft.draft_id);
        if (fullDraft.draft_order) {
          for (const [keyStr, slot] of Object.entries(fullDraft.draft_order)) {
            const parsedKey = Number(keyStr);
            let rosterId: number | undefined;
            if (parsedKey > 9999) {
              // draft_order is keyed by Sleeper user_id (18-digit snowflake) — convert to roster_id
              rosterId = userIdToRosterId.get(keyStr);
            } else {
              // draft_order is keyed by roster_id directly (small int 1-N)
              rosterId = parsedKey;
            }
            if (rosterId !== undefined) {
              slotToRosterId.set(slot, rosterId);
            }
          }
          log(`Draft ${draft.draft_id}: loaded draft_order (${slotToRosterId.size} slots → roster_ids)`);
        } else {
          log(`Draft ${draft.draft_id}: draft_order is null, draft_slot will equal pick position`, 'warn');
        }
      } catch {
        log(`Draft ${draft.draft_id}: could not fetch draft details, falling back`, 'warn');
      }

      const picks = await fetchDraftPicks(draft.draft_id);
      log(`Draft ${draft.draft_id}: ${picks.length} picks from Sleeper`);

      const rows = picks
        .map((p) => {
          const teamId = rosterMap.get(p.roster_id);
          if (!teamId) return null;
          const firstName = p.metadata?.first_name ?? '';
          const lastName = p.metadata?.last_name ?? '';
          const playerName = [firstName, lastName].filter(Boolean).join(' ') || `Player ${p.player_id}`;
          // draft_slot stores the ORIGINAL OWNER'S Sleeper roster_id (from draft_order inversion).
          // This equals SleeperTradedPick.roster_id, enabling correct traded-pick resolution.
          // Falls back to raw p.draft_slot if draft_order unavailable.
          const originalRosterId = slotToRosterId.get(p.draft_slot) ?? p.draft_slot;
          return {
            season_id: seasonId,
            round: p.round,
            pick_number: p.pick_no,
            team_id: teamId,
            player_name: playerName,
            draft_slot: originalRosterId,
          };
        })
        .filter(Boolean) as {
        season_id: number;
        round: number;
        pick_number: number;
        team_id: number;
        player_name: string;
        draft_slot: number;
      }[];

      if (rows.length) {
        log(`Draft ${draft.draft_id}: upserting ${rows.length} rows (rounds ${[...new Set(rows.map(r => r.round))].join(',')})`);
        const { error: upsertErr, count } = await supabase
          .from('draft_picks')
          .upsert(rows, { onConflict: 'season_id,round,pick_number', count: 'exact' });
        if (upsertErr) {
          log(`Draft ${draft.draft_id}: upsert error — ${upsertErr.message} (code ${upsertErr.code})`, 'error');
        } else {
          totalPicks += rows.length;
          log(`Draft ${draft.draft_id}: upserted ${rows.length} rows (db count=${count ?? '?'})`, 'success');
        }
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

  // ── Season boundary rule ────────────────────────────────────────────────
  // Historically, any trade up to and including this season's rookie draft
  // belonged to the season that had just finished — only trades made after
  // the draft counted for this new season. This is a whole-day rule, not a
  // to-the-minute one: a trade made later the same calendar day as the draft
  // (before or after the last pick) still counts as "during the draft".
  // Compare calendar dates (UTC), using each draft's last pick as its actual
  // end time (falls back to start_time for a draft still in progress).
  const previousSeasonId = seasonId > 1 ? await findSeasonId(year - 1) : null;
  const seasonDrafts = await fetchLeagueDrafts(league.league_id);
  const draftEndTimes = (seasonDrafts ?? [])
    .map((d) => d.last_picked ?? d.start_time)
    .filter((t): t is number => t != null);
  const draftCutoffMs = draftEndTimes.length > 0 ? Math.max(...draftEndTimes) : null;
  const draftCutoffDate = draftCutoffMs != null ? new Date(draftCutoffMs).toISOString().split('T')[0] : null;
  if (draftCutoffDate != null) {
    log(`Season ${year} draft cutoff: ${draftCutoffDate}`);
  } else if (previousSeasonId != null) {
    log(`Season ${year} draft not yet scheduled — trades will sync to season ${year - 1} until it is`, 'warn');
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

  // Helper: resolve the (R.SS) slot for a traded pick from draft_picks table.
  // Uses draft_slot (= SleeperDraftPick.draft_slot = original roster_id) which never
  // changes when a pick is traded, unlike team_id which reflects the final owner.
  const resolvePickSlot = async (
    pickSeason: string,
    round: number,
    sleeperRosterId: number,  // SleeperTradedPick.roster_id (original owner, never changes)
  ): Promise<string | null> => {
    const sid = await getSeasonIdCached(Number(pickSeason));
    if (sid === null) return null;
    const { data } = await supabase
      .from('draft_picks')
      .select('pick_number')
      .eq('season_id', sid)
      .eq('round', round)
      .eq('draft_slot', sleeperRosterId)
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

        // Trades on/before this season's draft belong to the season that
        // just finished; a not-yet-scheduled draft means every trade so far
        // is still "before the draft". Compared by calendar date (not exact
        // timestamp) — a trade made later the same day as the draft still
        // counts as "during the draft".
        const isBeforeOrAtDraft = draftCutoffDate == null ? true : tradeDate <= draftCutoffDate;
        const effectiveSeasonId = isBeforeOrAtDraft && previousSeasonId != null ? previousSeasonId : seasonId;

        const { data: tradeRow, error: tradeErr } = await supabase
          .from('trades')
          .insert({ season_id: effectiveSeasonId, team1_id: team1Id, team2_id: team2Id, trade_date: tradeDate })
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
          if (pick.roster_id) {
            // Pass pick.roster_id (Sleeper's original owner roster ID) directly — this matches
            // draft_slot stored in draft_picks, which is set from SleeperDraftPick.draft_slot
            // and never changes as picks are traded.
            const slot = await resolvePickSlot(pick.season, pick.round, pick.roster_id);
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
