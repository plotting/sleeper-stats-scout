export interface WinPctResult {
  wins: number;
  ties: number;
  total: number;
  pct: number;
}

/**
 * % of games in `pool` that `score` would have beaten (ties worth half
 * credit). Pass `excludeSelf` when `score` is itself a member of `pool` (an
 * actual historical game) so it doesn't count as its own tie.
 */
export function computeWinPct(score: number, pool: number[], excludeSelf = false): WinPctResult {
  let wins = 0, ties = 0;
  let total = pool.length;
  let selfExcluded = false;
  for (const v of pool) {
    if (excludeSelf && !selfExcluded && v === score) {
      selfExcluded = true;
      total--;
      continue;
    }
    if (score > v) wins++;
    else if (score === v) ties++;
  }
  return { wins, ties, total, pct: total > 0 ? ((wins + ties * 0.5) / total) * 100 : 0 };
}
