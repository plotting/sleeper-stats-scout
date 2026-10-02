/**
 * Monte Carlo playoff simulation core. Run by the scheduled job (scripts/sim-playoff-odds.ts), which saves the
 * results; the site only displays them.
 *
 * Methodology: each remaining game is simulated by sampling a score for each team from a normal distribution
 * (that team's projected mean/std for the week — roster- and injury-aware, see playerProjections.ts and
 * computeSimTeams). Higher score wins. After every remaining week, final standings (wins, then points-for)
 * determine the simulated seeding. Repeated `numSims` times.
 */

export interface SimTeamInput {
  teamId: number;
  wins: number;
  losses: number;
  ties: number;
  pf: number;
}

export interface SimFutureGame {
  homeId: number;
  awayId: number;
  week: number;
  /** Projected mean/std for this specific game — lets the sim reflect
   *  per-week factors (byes, streamed free agents, forecast horizon)
   *  rather than a single flat projection reused for every future week. */
  homeMean: number;
  homeStd: number;
  awayMean: number;
  awayStd: number;
}

export interface SimRequest {
  teams: SimTeamInput[];
  futureGames: SimFutureGame[];
  numSims: number;
  bracketSize: number;
}

export interface SimResult {
  teamId: number;
  avgProjectedWins: number;
  avgRank: number;
  playoffPct: number;
  /** seedPct[i] = probability of finishing in place i+1 (0-indexed) */
  seedPct: number[];
}

// Single-game win% is computed analytically elsewhere (exact for the
// difference of two independent normals) — no need to derive it from the
// full-season simulation here.

// Box-Muller, cached second value per call pair for speed.
let spare: number | null = null;
function sampleNormal(mean: number, std: number): number {
  if (spare !== null) {
    const v = spare;
    spare = null;
    return mean + std * v;
  }
  let u = 0, v = 0, s = 0;
  do {
    u = Math.random() * 2 - 1;
    v = Math.random() * 2 - 1;
    s = u * u + v * v;
  } while (s === 0 || s >= 1);
  const mul = Math.sqrt((-2 * Math.log(s)) / s);
  spare = v * mul;
  return mean + std * (u * mul);
}

export function runSim(req: SimRequest): SimResult[] {
  const { teams, futureGames, numSims, bracketSize } = req;
  const n = teams.length;
  if (n === 0) return [];

  const idxOf = new Map<number, number>(teams.map((t, i) => [t.teamId, i]));
  const baseWins = new Float64Array(n);
  const basePf = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    baseWins[i] = teams[i].wins + teams[i].ties * 0.5;
    basePf[i] = teams[i].pf;
  }

  const games = futureGames
    .map((g) => ({
      h: idxOf.get(g.homeId), a: idxOf.get(g.awayId), week: g.week,
      homeMean: g.homeMean, homeStd: g.homeStd, awayMean: g.awayMean, awayStd: g.awayStd,
    }))
    .filter((g): g is { h: number; a: number; week: number; homeMean: number; homeStd: number; awayMean: number; awayStd: number } =>
      g.h != null && g.a != null);

  const winAccum = new Float64Array(n);
  const rankAccum = new Float64Array(n);
  const playoffCount = new Float64Array(n);
  const seedCount: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n));

  const simWins = new Float64Array(n);
  const simPf = new Float64Array(n);
  const order = new Int32Array(n);

  if (games.length === 0) {
    const sorted = teams
      .map((t, i) => ({ i, wins: baseWins[i], pf: basePf[i] }))
      .sort((a, b) => b.wins - a.wins || b.pf - a.pf);
    return teams.map((t, i) => {
      const rank = sorted.findIndex((s) => s.i === i);
      const seedPct = new Array(n).fill(0);
      seedPct[rank] = 1;
      return {
        teamId: t.teamId,
        avgProjectedWins: baseWins[i],
        avgRank: rank + 1,
        playoffPct: rank < bracketSize ? 1 : 0,
        seedPct,
      };
    });
  }

  for (let sim = 0; sim < numSims; sim++) {
    simWins.set(baseWins);
    simPf.set(basePf);

    for (let gi = 0; gi < games.length; gi++) {
      const g = games[gi];
      const hs = sampleNormal(g.homeMean, g.homeStd);
      const as = sampleNormal(g.awayMean, g.awayStd);
      simPf[g.h] += hs;
      simPf[g.a] += as;
      if (hs > as) { simWins[g.h] += 1; }
      else if (as > hs) { simWins[g.a] += 1; }
      else { simWins[g.h] += 0.5; simWins[g.a] += 0.5; }
    }

    for (let i = 0; i < n; i++) order[i] = i;
    // Simple insertion sort — n is small (league size), and typed-array
    // sorting this way avoids per-sim closure/array allocation overhead.
    for (let i = 1; i < n; i++) {
      const cur = order[i];
      let j = i - 1;
      while (j >= 0 && (simWins[order[j]] < simWins[cur] ||
        (simWins[order[j]] === simWins[cur] && simPf[order[j]] < simPf[cur]))) {
        order[j + 1] = order[j];
        j--;
      }
      order[j + 1] = cur;
    }

    for (let rank = 0; rank < n; rank++) {
      const ti = order[rank];
      rankAccum[ti] += rank + 1;
      seedCount[ti][rank]++;
      if (rank < bracketSize) playoffCount[ti]++;
    }
    for (let i = 0; i < n; i++) winAccum[i] += simWins[i];
  }

  return teams.map((t, i) => ({
    teamId: t.teamId,
    avgProjectedWins: winAccum[i] / numSims,
    avgRank: rankAccum[i] / numSims,
    playoffPct: playoffCount[i] / numSims,
    seedPct: Array.from(seedCount[i], (c) => c / numSims),
  }));
}
