// TypeScript twin of the player_vorp view (migration 20260930000021): replacement level from
// player availability. Used by the trade-value fit so it can read the plain player_seasons table
// instead of the (slow) view. scripts/vorp.test.ts pins the numbers; keep both in sync.

export interface SeasonRow { player_name: string; position: string; year: number; total_points: number; games_played: number }
export interface VorpRow { player_name: string; position: string; year: number; vorp: number; season_games: number }

const TEAMS = 10;
const FLEX_SLOTS = 3;
const POSITIONS: Array<{ position: string; base: number; flex: boolean }> = [
  { position: 'QB', base: 1, flex: false },
  { position: 'RB', base: 2, flex: true },
  { position: 'WR', base: 2, flex: true },
  { position: 'TE', base: 1, flex: true },
  { position: 'DST', base: 1, flex: false },
];

export function computeVorp(rows: SeasonRow[]): VorpRow[] {
  const byYear = new Map<number, SeasonRow[]>();
  for (const r of rows) {
    if (r.games_played > 0 && POSITIONS.some((p) => p.position === r.position)) {
      (byYear.get(r.year) ?? byYear.set(r.year, []).get(r.year)!).push(r);
    }
  }
  const out: VorpRow[] = [];
  for (const [year, list] of byYear) {
    const games = Math.min(year >= 2021 ? 17 : 16, Math.max(...list.map((r) => r.games_played)));
    const ranked = new Map<string, SeasonRow[]>();
    for (const p of POSITIONS) {
      ranked.set(p.position, list.filter((r) => r.position === p.position).sort((a, b) => b.total_points - a.total_points));
    }
    // Flex goes to the best RB/WR/TE left after the base starters.
    const pool = POSITIONS.filter((p) => p.flex).flatMap((p) =>
      ranked.get(p.position)!.slice(p.base * TEAMS).map((r) => ({ position: p.position, pts: r.total_points })))
      .sort((a, b) => b.pts - a.pts).slice(0, FLEX_SLOTS * TEAMS);
    for (const p of POSITIONS) {
      const players = ranked.get(p.position)!;
      if (players.length === 0) continue;
      const slots = p.base * TEAMS + pool.filter((x) => x.position === p.position).length;
      const top = players.slice(0, Math.ceil(slots * 1.5));
      const avg = top.reduce((s, r) => s + Math.min(r.games_played, games), 0) / top.length;
      const want = Math.ceil((slots * games) / Math.max(avg, 1)) + 1; // players needed, then the next one
      const repl = players[Math.max(0, Math.min(want, players.length) - 1)];
      const replPpg = repl.total_points / Math.max(repl.games_played, 1);
      for (const r of players) {
        out.push({ player_name: r.player_name, position: p.position, year, vorp: Math.max(0, Math.round((r.total_points - replPpg * games) * 10) / 10), season_games: games });
      }
    }
  }
  return out;
}
