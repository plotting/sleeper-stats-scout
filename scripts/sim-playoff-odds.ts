// Computes the Simulated Odds snapshot(s) and saves them to playoff_sim_history, which is all the site shows.
// Run by .github/workflows/sim-playoff-odds.yml on Tuesday–Thursday after each week's scores settle; by hand:
//   SUPABASE_SERVICE_ROLE_KEY=... TSX_TSCONFIG_PATH=tsconfig.app.json npx tsx scripts/sim-playoff-odds.ts
//
// One methodology throughout: team-level baseline (history + this season) with every remaining week
// replaced by a roster-based projection (starters, injuries, byes, streamed free agents) from the rosters at that
// point. "Latest" uses today's rosters. BACKFILL=1 rebuilds earlier weeks from each week's recorded lineups
// (Sleeper keeps every roster's players/starters per matchup week), so a snapshot after week k uses the rosters
// as they stood for week k+1 — after the waivers and trades that followed week k.
// Env: FORCE=1 runs out of season; BACKFILL=1 also rebuilds every earlier week (WEEKS=0,1,2 limits which);
// NUM_SIMS (default 1,000,000).

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
} as Storage;

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set — snapshots are admin-write only.');
  process.exit(1);
}

const { supabase } = await import('../src/integrations/supabase/client');
const { fetchLeague, fetchLeagueRosters, fetchMatchups, LEAGUE_ID } = await import('../src/services/sleeperApi');
const { buildRosterToTeamMap } = await import('../src/services/sleeperSync');
const { computeTeamWeekProjections } = await import('../src/services/playerProjections');
const { savePlayoffSimSnapshot } = await import('../src/services/playoffSimHistory');
const { setPlayoffConfigs, getPlayoffBracketSize } = await import('../src/utils/playoffRegistry');
const { buildOddsInput, dedupeMatchups, playoffPctFromSeeds } = await import('../src/utils/playoffSimModel');
const { runSim } = await import('../src/utils/playoffSimCore');
type MatchupScoresView = import('../src/types/database').MatchupScoresView;
type TeamWeekProjection = import('../src/services/playerProjections').TeamWeekProjection;
type RosterInput = { teamId: number; players: string[]; starters: string[] };

const NUM_SIMS = Number(process.env.NUM_SIMS ?? 1_000_000);
const db = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

const league = await fetchLeague(LEAGUE_ID);
console.log(`League ${league.name} ${league.season}: status=${league.status}, last scored week ${league.settings.last_scored_leg}`);
if (league.status !== 'in_season' && process.env.FORCE !== '1') {
  console.log('League is not in season — nothing to compute. (Set FORCE=1 to run anyway.)');
  process.exit(0);
}

const { data: season, error: seasonErr } = await db.from('seasons').select('id').eq('year', Number(league.season)).single();
if (seasonErr || !season) throw new Error(`No season row for ${league.season}`);
const seasonId: number = season.id;

const { data: playoffRows } = await db.from('season_playoffs').select('*');
setPlayoffConfigs(playoffRows ?? []);
const bracketSizes = [...new Set([4, 5, 6, getPlayoffBracketSize(seasonId)])].sort((a, b) => a - b);

async function loadMatchups(filterSeason?: number): Promise<MatchupScoresView[]> {
  const rows: MatchupScoresView[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from('matchup_scores_view').select('*').order('season_id').order('week_number');
    if (filterSeason != null) q = q.eq('season_id', filterSeason);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw error;
    rows.push(...(data as MatchupScoresView[]));
    if (!data || data.length < 1000) break;
  }
  return dedupeMatchups(rows);
}
const allMatchups = await loadMatchups();
const matchups = allMatchups.filter((m) => m.season_id === seasonId);
const { data: seasonRows } = await db.from('seasons').select('id');
const sortedHistIds: number[] = (seasonRows as Array<{ id: number }>).map((s) => s.id).filter((id) => id !== seasonId).sort((a, b) => b - a);

const playedWeeks = [...new Set(
  matchups.filter((m) => !m.is_playoff && !m.is_consolation && m.home_score != null && m.away_score != null && m.week_number)
    .map((m) => m.week_number as number),
)].sort((a, b) => a - b);
const latest = playedWeeks[playedWeeks.length - 1] ?? 0;
console.log(`Played regular-season weeks: ${playedWeeks.join(', ') || 'none'} — latest ${latest}`);
if (latest === 0 && process.env.FORCE !== '1' && process.env.BACKFILL !== '1') {
  console.log('No weeks played yet — computing the preseason snapshot only.');
}

const rosterTeamMap = await buildRosterToTeamMap(LEAGUE_ID);
const toInputs = (rows: Array<{ roster_id: number; players?: string[] | null; starters?: string[] | null }>): RosterInput[] =>
  rows
    .map((r) => {
      const teamId = rosterTeamMap.get(r.roster_id);
      return teamId ? { teamId, players: r.players ?? [], starters: r.starters ?? [] } : null;
    })
    .filter((r): r is RosterInput => r != null);

async function rostersFor(asOf: number): Promise<{ inputs: RosterInput[]; label: string } | null> {
  if (asOf < latest) {
    const m = await fetchMatchups(LEAGUE_ID, asOf + 1);
    const inputs = toInputs(m ?? []);
    if (inputs.length > 0 && inputs.some((r) => r.players.length > 0)) return { inputs, label: `week ${asOf + 1} lineups` };
    return null;
  }
  return { inputs: toInputs(await fetchLeagueRosters(LEAGUE_ID)), label: 'current rosters' };
}

async function snapshot(asOf: number) {
  const rosters = await rostersFor(asOf);
  if (!rosters) {
    console.log(`Week ${asOf}: no roster history available — skipped (nothing saved, so nothing mixed in).`);
    return;
  }
  const bare = buildOddsInput(matchups, allMatchups, sortedHistIds, asOf, new Map());
  if (!bare) { console.log(`Week ${asOf}: no games remain — skipped.`); return; }

  const weeks = [...new Set(bare.futureGames.map((g) => g.week))].sort((a, b) => a - b);
  const projections = new Map<number, Map<number, TeamWeekProjection> | null>();
  for (const w of weeks) projections.set(w, await computeTeamWeekProjections(league.season, w, rosters.inputs, league.roster_positions));
  const covered = weeks.filter((w) => projections.get(w) != null);
  console.log(`Week ${asOf}: ${rosters.label}; roster projections for ${covered.length}/${weeks.length} remaining weeks (${covered.join(', ') || 'none'}).`);

  const input = buildOddsInput(matchups, allMatchups, sortedHistIds, asOf, projections)!;
  const results = runSim({ teams: input.simTeams, futureGames: input.futureGames, numSims: NUM_SIMS, bracketSize: bracketSizes[0] });

  // the "Proj PPG / ±" columns show the next game's mean/std for each team
  const nextWeek = weeks[0];
  const next = new Map<number, { mean: number; std: number }>();
  for (const g of input.futureGames) {
    if (g.week !== nextWeek) continue;
    next.set(g.homeId, { mean: g.homeMean, std: g.homeStd });
    next.set(g.awayId, { mean: g.awayMean, std: g.awayStd });
  }
  const byTeam = new Map(input.teams.map((t) => [t.teamId, t]));

  // What did the week's results alone do to the odds? Replay the previous week's position (results through asOf-1) with the SAME rosters
  // and projections, so the only difference from this snapshot is the games just played. The rest of the saved change since last week is
  // lineups, injuries and projection updates.
  let prevResults: Map<number, number[]> | null = null;
  if (asOf > 0) {
    const prevBare = buildOddsInput(matchups, allMatchups, sortedHistIds, asOf - 1, new Map());
    if (prevBare) {
      const prevProj = new Map(projections);
      for (const w of new Set(prevBare.futureGames.map((g) => g.week))) {
        if (!prevProj.has(w)) prevProj.set(w, await computeTeamWeekProjections(league.season, w, rosters.inputs, league.roster_positions));
      }
      const prevInput = buildOddsInput(matchups, allMatchups, sortedHistIds, asOf - 1, prevProj)!;
      const prevRun = runSim({ teams: prevInput.simTeams, futureGames: prevInput.futureGames, numSims: NUM_SIMS, bracketSize: bracketSizes[0] });
      prevResults = new Map(prevRun.map((r) => [r.teamId, r.seedPct]));
    }
  }

  // how each team's projection looks, so a jump in the odds can be traced to a lineup, a bye or an injury
  for (const t of input.teams) {
    const mine = input.futureGames.flatMap((g) => (g.homeId === t.teamId ? [{ m: g.homeMean, w: g.week }] : g.awayId === t.teamId ? [{ m: g.awayMean, w: g.week }] : []));
    const avg = mine.reduce((a, x) => a + x.m, 0) / Math.max(mine.length, 1);
    const nextP = projections.get(nextWeek)?.get(t.teamId);
    console.log(`  ${t.teamName.padEnd(10)} ${t.wins}-${t.losses}  next ${next.get(t.teamId)?.mean.toFixed(1)}  avg of ${mine.length} remaining ${avg.toFixed(1)}  (next week: ${nextP?.benchedByeCount ?? 0} bye slots benched, ${nextP?.streamedCount ?? 0} streamed)`);
  }

  for (const size of bracketSizes) {
    await savePlayoffSimSnapshot(seasonId, asOf, size, NUM_SIMS, results.map((r) => ({
      teamId: r.teamId,
      projPpg: next.get(r.teamId)?.mean ?? byTeam.get(r.teamId)?.projMean ?? 0,
      projStd: next.get(r.teamId)?.std ?? byTeam.get(r.teamId)?.projStd ?? 0,
      projWins: r.avgProjectedWins,
      projSeed: r.avgRank,
      playoffPct: playoffPctFromSeeds(r.seedPct, size),
      seedPct: r.seedPct,
      deltaResults: prevResults?.get(r.teamId) ? playoffPctFromSeeds(r.seedPct, size) - playoffPctFromSeeds(prevResults.get(r.teamId)!, size) : null,
    })));
  }
  const top = [...results].sort((a, b) => b.playoffPct - a.playoffPct).slice(0, 3)
    .map((r) => `${byTeam.get(r.teamId)?.teamName} ${(playoffPctFromSeeds(r.seedPct, getPlayoffBracketSize(seasonId)) * 100).toFixed(1)}%`);
  console.log(`  saved top-${bracketSizes.join('/')} odds. Leaders: ${top.join(', ')}`);
}

const only = process.env.WEEKS ? process.env.WEEKS.split(',').map((w) => Number(w.trim())).filter((w) => Number.isFinite(w)) : null;
const targets = process.env.BACKFILL === '1'
  ? [0, ...playedWeeks].filter((w) => !only || only.includes(w))
  : [latest];
for (const w of targets) await snapshot(w);
console.log('Done.');
