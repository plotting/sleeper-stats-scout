// The consolidation premium: in real trades, the side with fewer pieces (holding the better asset) is accepted at a plain-sum
// value below the many-piece side. It only applies when the extra pieces are much lesser than that asset: two starters for
// one star is a fair swap, and tacking a throw-in or a pick onto a side must never flip a premium on.

/** Best piece on the many side as a share of the best piece on the other side: at or below this the full premium applies… */
export const FULL_BELOW = 0.5;
/** …and at or above this none does (the pieces are comparable assets), with a straight ramp between. */
export const NONE_ABOVE = 0.85;

/** 0 = no premium (comparable pieces), 1 = the full measured premium (all pieces much lesser than the best asset). */
export function premiumWeight(bestMany: number, bestFew: number): number {
  if (bestFew <= 0 || bestMany <= 0) return 0;
  const r = bestMany / bestFew;
  return Math.min(1, Math.max(0, (NONE_ABOVE - r) / (NONE_ABOVE - FULL_BELOW)));
}

/** The multiplier for the fewer-piece side: the measured premium `m` raised to how lesser the many side's pieces are. */
export function premiumMultiplier(m: number, bestMany: number, bestFew: number): number {
  return Math.pow(m, premiumWeight(bestMany, bestFew));
}
