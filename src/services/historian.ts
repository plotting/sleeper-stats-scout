import { supabase } from "@/integrations/supabase/client";
import type { SeasonStats } from "@/pages/Recaps";

/** Serializes computed league history into a compact text block for the
 *  historian's system context — small enough to stay cheap per question,
 *  specific enough that the model doesn't have to guess at anything. */
export function buildHistorianContext(allStats: SeasonStats[], careerLines: string[]): string {
  const seasonLines = allStats.map((s) => {
    const parts = [`Season ${s.seasonNumber} (${s.year}):`];
    if (s.champion) parts.push(`champion ${s.champion}${s.runnerUp ? `, runner-up ${s.runnerUp}` : ""}.`);
    if (s.bestRegularRecord) {
      const r = s.bestRegularRecord;
      parts.push(`Best regular-season record: ${r.team} (${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}).`);
    }
    if (s.highestPpg) parts.push(`Highest PPG: ${s.highestPpg.team} (${s.highestPpg.ppg.toFixed(1)}).`);
    if (s.highestSingleGame) {
      parts.push(`Highest single game: ${s.highestSingleGame.team}, ${s.highestSingleGame.score.toFixed(1)} pts in week ${s.highestSingleGame.week}.`);
    }
    if (s.biggestUpset) {
      parts.push(`Biggest upset: ${s.biggestUpset.winner} over ${s.biggestUpset.loser} (${s.biggestUpset.delta.toFixed(1)}-pt underdog) in week ${s.biggestUpset.week}.`);
    }
    return parts.join(" ");
  });

  return [
    "ALL-TIME CAREER RECORDS (regular season, best win% first):",
    ...careerLines,
    "",
    "SEASON-BY-SEASON HISTORY:",
    ...seasonLines,
  ].join("\n");
}

/** Calls the `ask-historian` Supabase Edge Function. Throws if the function
 *  isn't deployed (404) or the call otherwise fails — callers should catch
 *  and show a friendly "not configured yet" state rather than a raw error. */
export async function askHistorian(question: string, context: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("ask-historian", {
    body: { question, context },
  });
  if (error) throw error;
  if (!data?.answer) throw new Error("The historian didn't have an answer for that.");
  return data.answer as string;
}
