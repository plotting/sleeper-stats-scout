/**
 * Shared value-estimation helpers for Dynasty Digest and GM Scouting Report.
 * Deliberately simpler than Trades.tsx's precise date-windowed, retrade-aware
 * VORP engine (no prorating, no re-traded-pick detection) — these two pages
 * want quick "who came out ahead" signal for narrative purposes, not an
 * audit-grade trade ledger.
 */

export const GRADABLE_POS = ["QB", "RB", "WR", "TE"];

/** Strip internal markers before parsing/displaying a trade_items description. */
export function displayDesc(raw: string): string {
  return raw
    .replace(/\s*\[fut:\d+\]/g, "")
    .replace(/\s*\(via [^)]+\)/g, "")
    .trim();
}

/** Parse a resolved pick description "2024 (1.02)" -> { year, round, pick, overall }. */
export function parseResolvedPick(description: string): { year: number; round: number; pick: number; overall: number } | null {
  const clean = displayDesc(description);
  const m = clean.match(/^(\d{4}) \((\d+)\.(\d+)\)/);
  if (!m) return null;
  const year = Number(m[1]), round = Number(m[2]), pick = Number(m[3]);
  return { year, round, pick, overall: (round - 1) * 20 + pick };
}

export interface HistoricalPick {
  overall_pick: number;
  five_yr_vorp: number;
  draft_year: number;
  position: string | null;
}

/** Smoothed (±1 slot) expected 5yr VORP by overall draft slot, built from
 *  2014–2021 classes only (the only years with a complete 5-season window). */
export function buildExpectedVorpCurve(historicalPicks: HistoricalPick[]): Map<number, number> {
  const slotMap = new Map<number, number[]>();
  for (const p of historicalPicks) {
    if (p.draft_year < 2014 || p.draft_year > 2021) continue;
    if (!slotMap.has(p.overall_pick)) slotMap.set(p.overall_pick, []);
    slotMap.get(p.overall_pick)!.push(Number(p.five_yr_vorp));
  }
  const result = new Map<number, number>();
  for (const slot of slotMap.keys()) {
    const values: number[] = [];
    for (let s = slot - 1; s <= slot + 1; s++) {
      const v = slotMap.get(s);
      if (v) values.push(...v);
    }
    result.set(slot, values.reduce((a, b) => a + b, 0) / values.length);
  }
  return result;
}

export function getExpectedVorp(curve: Map<number, number>, slot: number): number | null {
  if (curve.has(slot)) return curve.get(slot)!;
  for (let d = 1; d <= 3; d++) {
    if (curve.has(slot - d)) return curve.get(slot - d)!;
    if (curve.has(slot + d)) return curve.get(slot + d)!;
  }
  return null;
}

/** Pick value = actual 5yr VORP minus what that draft slot normally produces.
 *  Positive = steal, negative = reach. */
export function getPickValue(curve: Map<number, number>, pick: { overall_pick: number; five_yr_vorp: number }): number | null {
  const expected = getExpectedVorp(curve, pick.overall_pick);
  return expected === null ? null : Number(pick.five_yr_vorp) - expected;
}

export interface PlayerVorpRow {
  player_name: string;
  position: string;
  year: number;
  vorp: number;
}

/** Most-recent known position per player (lowercased name key). */
export function buildPlayerPositionMap(rows: PlayerVorpRow[]): Map<string, string> {
  const byName = new Map<string, { year: number; position: string }>();
  for (const r of rows) {
    const key = r.player_name.toLowerCase();
    const existing = byName.get(key);
    if (!existing || r.year > existing.year) byName.set(key, { year: r.year, position: r.position });
  }
  return new Map([...byName.entries()].map(([k, v]) => [k, v.position]));
}

/** Lifetime (career-to-date) summed VORP per player, lowercased name key. */
export function buildPlayerLifetimeVorpMap(rows: PlayerVorpRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    m.set(r.player_name.toLowerCase(), (m.get(r.player_name.toLowerCase()) ?? 0) + Number(r.vorp));
  }
  return m;
}

function ordinalGrade(v: number): string {
  if (v >= 100) return "A+";
  if (v >= 50) return "A";
  if (v >= 20) return "B+";
  if (v >= 0) return "B";
  if (v >= -20) return "C";
  if (v >= -50) return "D";
  return "F";
}
export { ordinalGrade as valueGrade };
