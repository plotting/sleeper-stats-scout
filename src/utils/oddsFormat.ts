/** Playoff odds (0-1) as a percent. Long shots keep four decimals so a team that is unlikely but alive doesn't read as 0.0%;
 *  zero simulated runs shows as "<0.0001%" (the sim's floor), not 0, since that isn't proof of elimination. */
export function fmtOdds(p: number): string {
  const pct = p * 100;
  if (pct >= 1) return `${pct.toFixed(2)}%`;
  if (pct < 0.00005) return '<0.0001%';
  return `${pct.toFixed(4)}%`;
}
