// Turns Sleeper's rosters, users and traded picks into teams with the players and draft picks each one owns.

export interface LeaguePick { season: number; round: number; originalRosterId: number; slot: number | null; tier: 'early' | 'mid' | 'late' | null }
export interface LeagueTeam { rosterId: number; ownerId: string | null; name: string; players: string[]; picks: LeaguePick[] }

interface RosterIn { roster_id: number; owner_id: string | null; players: string[] | null; settings: { wins: number; losses: number; ties: number; fpts: number; fpts_decimal?: number } }
interface UserIn { user_id: string; display_name: string; metadata?: { team_name?: string } }
interface TradedPickIn { season: string; round: number; roster_id: number; owner_id: number }

/** Seasons whose rookie picks can still be traded: after the draft (June on) this year's class is gone. */
export function pickSeasons(now: Date): number[] {
  const first = now.getUTCFullYear() + (now.getUTCMonth() >= 5 ? 1 : 0);
  return [first, first + 1, first + 2];
}

export const slotTier = (slot: number): 'early' | 'mid' | 'late' => (slot <= 3 ? 'early' : slot <= 6 ? 'mid' : 'late');

/** Projected draft slot per roster from the standings: the weakest team picks first. */
export function projectedSlots(rosters: RosterIn[]): Map<number, number> {
  const strength = (r: RosterIn) => {
    const g = r.settings.wins + r.settings.losses + r.settings.ties;
    return [g > 0 ? (r.settings.wins + 0.5 * r.settings.ties) / g : 0.5, r.settings.fpts + (r.settings.fpts_decimal ?? 0) / 100];
  };
  const ordered = [...rosters].sort((a, b) => { const x = strength(a), y = strength(b); return x[0] - y[0] || x[1] - y[1] || a.roster_id - b.roster_id; });
  return new Map(ordered.map((r, i) => [r.roster_id, i + 1]));
}

export function buildTeams(opts: { rosters: RosterIn[]; users: UserIn[]; tradedPicks: TradedPickIn[]; rounds: number; now: Date }): LeagueTeam[] {
  const { rosters, users, tradedPicks, rounds, now } = opts;
  const slots = projectedSlots(rosters);
  const owner = new Map<string, number>(); // `${season}-${round}-${originalRoster}` -> current owner roster
  for (const t of tradedPicks) owner.set(`${t.season}-${t.round}-${t.roster_id}`, t.owner_id);
  const teams = new Map<number, LeagueTeam>();
  for (const r of rosters) {
    const u = users.find((x) => x.user_id === r.owner_id);
    teams.set(r.roster_id, { rosterId: r.roster_id, ownerId: r.owner_id, name: u?.metadata?.team_name || u?.display_name || `Team ${r.roster_id}`, players: r.players ?? [], picks: [] });
  }
  for (const season of pickSeasons(now)) {
    for (let round = 1; round <= rounds; round++) {
      for (const r of rosters) {
        const current = owner.get(`${season}-${round}-${r.roster_id}`) ?? r.roster_id;
        // slots are only meaningful for the next draft; later classes depend on how the teams do
        const slot = season === pickSeasons(now)[0] ? slots.get(r.roster_id) ?? null : null;
        teams.get(current)?.picks.push({ season, round, originalRosterId: r.roster_id, slot, tier: slot ? slotTier(slot) : null });
      }
    }
  }
  return [...teams.values()].sort((a, b) => a.rosterId - b.rosterId);
}
