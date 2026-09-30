// League-agnostic playoff bracket model.
//
// Sleeper publishes each season's exact bracket (`/league/:id/winners_bracket`
// and `/losers_bracket`): every match with its round, the two rosters (or
// where they come from: winner/loser of an earlier match), the result, and a
// placement number for placement games (p=1 championship, p=3 third-place
// game, ...). Byes are simply rosters that first appear in round 2. We store
// that structure per season (team ids, not roster ids) so nothing in the app
// needs to know a league's format.

export interface SleeperBracketMatch {
  r: number;
  m: number;
  t1: number | null;
  t2: number | null;
  t1_from?: { w?: number; l?: number };
  t2_from?: { w?: number; l?: number };
  w: number | null;
  l: number | null;
  p?: number;
}

/** A bracket match with roster ids translated to DB team ids. */
export interface PlayoffMatch {
  r: number;
  m: number;
  t1: number | null;
  t2: number | null;
  t1_from?: { w?: number; l?: number };
  t2_from?: { w?: number; l?: number };
  w: number | null;
  l: number | null;
  p?: number;
  /** Sleeper roster id, kept only when that roster has no mapped team. */
  t1_roster?: number;
  t2_roster?: number;
}

export interface PlayoffConfig {
  season_id: number;
  playoff_week_start: number;
  playoff_teams: number;
  /** Sleeper playoff_round_type: 0 one week per round, 1 two-week championship, 2 two weeks per round */
  round_type: number;
  winners: PlayoffMatch[];
  losers: PlayoffMatch[];
}

export function normalizeBracket(
  raw: SleeperBracketMatch[] | null | undefined,
  rosterToTeam: Map<number, number>,
): PlayoffMatch[] {
  const team = (r: number | null | undefined) => (r == null ? null : rosterToTeam.get(r) ?? null);
  return (raw ?? []).map((x) => ({
    r: x.r,
    m: x.m,
    t1: team(x.t1),
    t2: team(x.t2),
    ...(x.t1 != null && team(x.t1) == null ? { t1_roster: x.t1 } : {}),
    ...(x.t2 != null && team(x.t2) == null ? { t2_roster: x.t2 } : {}),
    ...(x.t1_from ? { t1_from: x.t1_from } : {}),
    ...(x.t2_from ? { t2_from: x.t2_from } : {}),
    w: team(x.w),
    l: team(x.l),
    ...(x.p != null ? { p: x.p } : {}),
  }));
}

export function bracketTeams(matches: PlayoffMatch[]): Set<number> {
  const ids = new Set<number>();
  for (const m of matches) {
    if (m.t1 != null) ids.add(m.t1);
    if (m.t2 != null) ids.add(m.t2);
  }
  return ids;
}

/** Teams that skipped round 1: they're in the bracket but not in any round-1 match. */
export function bracketByes(winners: PlayoffMatch[]): Set<number> {
  if (winners.length === 0) return new Set();
  const firstRound = Math.min(...winners.map((m) => m.r));
  const playedFirst = bracketTeams(winners.filter((m) => m.r === firstRound));
  const all = bracketTeams(winners);
  return new Set([...all].filter((t) => !playedFirst.has(t)));
}

/**
 * Final finish (1 = champion) for every team decided by a placement game.
 * Winners-bracket `p` values are overall places. Losers-bracket (consolation)
 * `p` values may be relative to that bracket (p=1 → first place *among the
 * consolation teams*) or already overall; if the smallest p is within the
 * winners-bracket team count we treat them as relative and offset them.
 */
/** Amount to add to a losers-bracket `p` to get the overall place (0 when already absolute). */
export function losersPlaceOffset(winners: PlayoffMatch[], losers: PlayoffMatch[]): number {
  const winnersTeamCount = bracketTeams(winners).size;
  const loserPs = losers.filter((m) => m.p != null).map((m) => m.p as number);
  const relative = loserPs.length > 0 && Math.min(...loserPs) <= winnersTeamCount;
  return relative ? winnersTeamCount : 0;
}

export function computePlacements(winners: PlayoffMatch[], losers: PlayoffMatch[]): Map<number, number> {
  const places = new Map<number, number>();
  const apply = (matches: PlayoffMatch[], offset: number) => {
    for (const m of matches) {
      if (m.p == null || m.w == null || m.l == null) continue;
      places.set(m.w, offset + m.p);
      places.set(m.l, offset + m.p + 1);
    }
  };
  apply(winners, 0);
  apply(losers, losersPlaceOffset(winners, losers));
  return places;
}

/** NFL weeks a round is played over (scores are summed across them). */
export function roundWeeks(config: Pick<PlayoffConfig, 'playoff_week_start' | 'round_type'>, round: number, totalRounds: number): number[] {
  const start = config.playoff_week_start;
  if (config.round_type === 2) return [start + 2 * (round - 1), start + 2 * (round - 1) + 1];
  if (config.round_type === 1 && round === totalRounds) return [start + round - 1, start + round];
  return [start + round - 1];
}

export function roundLabel(round: number, totalRounds: number): string {
  if (round === totalRounds) return 'Championship';
  if (round === totalRounds - 1) return 'Semifinals';
  if (round === totalRounds - 2) return 'Quarterfinals';
  return `Round ${round}`;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
