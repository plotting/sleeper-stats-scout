/** Letter grade from a z-score (how many standard deviations above/below the league average). */
export function zGrade(z: number): string {
  if (z >= 1.4) return "A+";
  if (z >= 1.0) return "A";
  if (z >= 0.6) return "A-";
  if (z >= 0.25) return "B+";
  if (z >= -0.25) return "B";
  if (z >= -0.6) return "B-";
  if (z >= -1.0) return "C";
  if (z >= -1.4) return "D";
  return "F";
}

/** Grades relative to the other entries: the spread of the group decides the letters, so
 *  a small league doesn't pile everyone into the same C or D. */
export function relativeGrades(values: number[]): string[] {
  if (values.length === 0) return [];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  return values.map((v) => (sd > 0 ? zGrade((v - mean) / sd) : "B"));
}

export const GRADE_STYLE: Record<string, string> = {
  "A+": "text-emerald-300 bg-emerald-400/15 border-emerald-400/30",
  "A":  "text-emerald-400 bg-emerald-400/10 border-emerald-400/25",
  "A-": "text-emerald-500 bg-emerald-500/10 border-emerald-500/25",
  "B+": "text-sky-300 bg-sky-400/15 border-sky-400/30",
  "B":  "text-sky-400 bg-sky-400/10 border-sky-400/25",
  "B-": "text-sky-500 bg-sky-500/10 border-sky-500/25",
  "C":  "text-amber-400 bg-amber-400/10 border-amber-400/25",
  "D":  "text-orange-400 bg-orange-400/10 border-orange-400/25",
  "F":  "text-red-400 bg-red-400/10 border-red-400/25",
};
