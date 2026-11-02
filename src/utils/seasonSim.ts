// What-if season simulator: plays out the remaining schedule many times (optionally with some games locked to a result)
// and reports where the standings land. Same win/points-for tiebreak as playoffSimCore.

import type { SimFutureGame, SimTeamInput } from './playoffSimCore';

export type GameLock = 'home' | 'away';

export const gameKey = (g: { week: number; homeId: number; awayId: number }) => `${g.week}-${g.homeId}-${g.awayId}`;

export interface SeasonSimRequest {
  teams: SimTeamInput[];
  games: SimFutureGame[];
  locks?: Map<string, GameLock>;
  numSims: number;
  bracketSize: number;
  rng?: () => number;
}

export interface TeamOutlook {
  teamId: number;
  avgWins: number;
  /** 10th / 90th percentile of final wins (ties count half) */
  winsLow: number;
  winsHigh: number;
  /** most common final win total */
  winsMode: number;
  avgPf: number;
  avgRank: number;
  seedPct: number[];
  playoffPct: number;
}

function normalSampler(rng: () => number) {
  let spare: number | null = null;
  return (mean: number, std: number) => {
    if (spare !== null) { const v = spare; spare = null; return mean + std * v; }
    let u = 0, v = 0, s = 0;
    do { u = rng() * 2 - 1; v = rng() * 2 - 1; s = u * u + v * v; } while (s === 0 || s >= 1);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * mul;
    return mean + std * (u * mul);
  };
}

/** Locked games count for the chosen side (and each team's projected points); the rest are sampled. */
function prepare(req: Pick<SeasonSimRequest, 'teams' | 'games' | 'locks'>) {
  const idx = new Map(req.teams.map((t, i) => [t.teamId, i]));
  const baseWins = req.teams.map((t) => t.wins + t.ties * 0.5);
  const basePf = req.teams.map((t) => t.pf);
  const open: Array<{ h: number; a: number; g: SimFutureGame }> = [];
  for (const g of req.games) {
    const h = idx.get(g.homeId), a = idx.get(g.awayId);
    if (h == null || a == null) continue;
    const lock = req.locks?.get(gameKey(g));
    if (lock) {
      baseWins[lock === 'home' ? h : a] += 1;
      basePf[h] += g.homeMean; basePf[a] += g.awayMean;
    } else open.push({ h, a, g });
  }
  return { baseWins, basePf, open, n: req.teams.length };
}

function rankOrder(n: number, wins: ArrayLike<number>, pf: ArrayLike<number>): number[] {
  return Array.from({ length: n }, (_, i) => i).sort((x, y) => wins[y] - wins[x] || pf[y] - pf[x]);
}

export function simulateSeason(req: SeasonSimRequest): TeamOutlook[] {
  const { numSims, bracketSize } = req;
  const { baseWins, basePf, open, n } = prepare(req);
  const sample = normalSampler(req.rng ?? Math.random);
  const maxHalf = Math.ceil((Math.max(...baseWins, 0) + open.length) * 2) + 1;
  const dist = Array.from({ length: n }, () => new Float64Array(maxHalf + 1));
  const seeds = Array.from({ length: n }, () => new Float64Array(n));
  const winSum = new Float64Array(n), pfSum = new Float64Array(n), rankSum = new Float64Array(n);
  const w = new Float64Array(n), pf = new Float64Array(n);

  for (let s = 0; s < numSims; s++) {
    w.set(baseWins); pf.set(basePf);
    for (const { h, a, g } of open) {
      const hs = sample(g.homeMean, g.homeStd), as = sample(g.awayMean, g.awayStd);
      pf[h] += hs; pf[a] += as;
      if (hs > as) w[h] += 1; else if (as > hs) w[a] += 1; else { w[h] += 0.5; w[a] += 0.5; }
    }
    const order = rankOrder(n, w, pf);
    for (let r = 0; r < n; r++) { seeds[order[r]][r]++; rankSum[order[r]] += r + 1; }
    for (let i = 0; i < n; i++) { winSum[i] += w[i]; pfSum[i] += pf[i]; dist[i][Math.round(w[i] * 2)]++; }
  }

  return req.teams.map((t, i) => {
    const quantile = (q: number) => {
      let acc = 0;
      for (let k = 0; k < dist[i].length; k++) { acc += dist[i][k]; if (acc / numSims >= q) return k / 2; }
      return (dist[i].length - 1) / 2;
    };
    let mode = 0;
    for (let k = 1; k < dist[i].length; k++) if (dist[i][k] > dist[i][mode]) mode = k;
    const seedPct = Array.from(seeds[i], (c) => c / numSims);
    return {
      teamId: t.teamId, avgWins: winSum[i] / numSims, winsLow: quantile(0.1), winsHigh: quantile(0.9), winsMode: mode / 2,
      avgPf: pfSum[i] / numSims, avgRank: rankSum[i] / numSims, seedPct, playoffPct: seedPct.slice(0, bracketSize).reduce((x, y) => x + y, 0),
    };
  });
}

export interface PlayedGame { key: string; week: number; homeId: number; awayId: number; homeScore: number; awayScore: number; locked: boolean }
export interface SampleStanding { teamId: number; wins: number; losses: number; ties: number; pf: number }

/** One random way the rest of the season could go: every game's score and the resulting final standings. */
export function sampleSeason(req: Omit<SeasonSimRequest, 'numSims' | 'bracketSize'>): { games: PlayedGame[]; standings: SampleStanding[] } {
  const sample = normalSampler(req.rng ?? Math.random);
  const rec = req.teams.map((t) => ({ teamId: t.teamId, wins: t.wins, losses: t.losses, ties: t.ties, pf: t.pf }));
  const idx = new Map(req.teams.map((t, i) => [t.teamId, i]));
  const games: PlayedGame[] = [];
  const credit = (h: number, a: number, hs: number, as: number) => {
    rec[h].pf += hs; rec[a].pf += as;
    if (hs > as) { rec[h].wins++; rec[a].losses++; } else if (as > hs) { rec[a].wins++; rec[h].losses++; } else { rec[h].ties++; rec[a].ties++; }
  };
  for (const g of req.games) {
    const h = idx.get(g.homeId), a = idx.get(g.awayId);
    if (h == null || a == null) continue;
    const key = gameKey(g);
    const lock = req.locks?.get(key);
    let hs = sample(g.homeMean, g.homeStd), as = sample(g.awayMean, g.awayStd);
    if (lock === 'home' && hs <= as) [hs, as] = [as, hs];
    if (lock === 'away' && as <= hs) [hs, as] = [as, hs];
    credit(h, a, hs, as);
    games.push({ key, week: g.week, homeId: g.homeId, awayId: g.awayId, homeScore: hs, awayScore: as, locked: !!lock });
  }
  const standings = rec.sort((x, y) => (y.wins + y.ties * 0.5) - (x.wins + x.ties * 0.5) || y.pf - x.pf);
  return { games, standings };
}
