import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { MatchupScoresView } from "@/types/database";
import {
  losersPlaceOffset,
  ordinal,
  roundLabel,
  roundWeeks,
  type PlayoffConfig,
  type PlayoffMatch,
} from "@/utils/playoffBracket";

interface Props {
  config: PlayoffConfig;
  matchups: MatchupScoresView[];
  teamNames: Map<number, string>;
  teamSeeds: Map<number, number>;
  seasonId: number;
}

type Scores = Map<number, number>;

/** Score for a team over the weeks of a round (two-week rounds sum both weeks). */
function matchScores(match: PlayoffMatch, weeks: number[], matchups: MatchupScoresView[]): Scores | null {
  if (match.t1 == null || match.t2 == null) return null;
  const totals: Scores = new Map([[match.t1, 0], [match.t2, 0]]);
  let found = false;
  for (const m of matchups) {
    if (m.week_number == null || !weeks.includes(m.week_number)) continue;
    const a = m.home_team_id, b = m.away_team_id;
    if (a == null || b == null || m.home_score == null || m.away_score == null) continue;
    const pair = (a === match.t1 && b === match.t2) || (a === match.t2 && b === match.t1);
    if (!pair) continue;
    found = true;
    totals.set(a, (totals.get(a) ?? 0) + m.home_score);
    totals.set(b, (totals.get(b) ?? 0) + m.away_score);
  }
  return found ? totals : null;
}

function slotLabel(from: { w?: number; l?: number } | undefined): string {
  if (from?.w != null) return `Winner of game ${from.w}`;
  if (from?.l != null) return `Loser of game ${from.l}`;
  return "TBD";
}

function MatchCard({
  match, weeks, scores, teamNames, teamSeeds, seasonId, placeOffset,
}: {
  match: PlayoffMatch; weeks: number[]; scores: Scores | null;
  teamNames: Map<number, string>; teamSeeds: Map<number, number>; seasonId: number;
  placeOffset: number;
}) {
  const rows: Array<{ id: number | null; from?: { w?: number; l?: number }; roster?: number }> = [
    { id: match.t1, from: match.t1_from, roster: match.t1_roster },
    { id: match.t2, from: match.t2_from, roster: match.t2_roster },
  ];
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1 text-[10px] uppercase tracking-wide text-slate-500 border-b border-white/5">
        <span>{match.p != null ? `${ordinal(match.p + placeOffset)} place game` : `Game ${match.m}`}</span>
        <span>Wk {weeks.join("–")}</span>
      </div>
      {rows.map((row, i) => {
        const won = match.w != null && row.id === match.w;
        const lost = match.l != null && row.id === match.l;
        return (
          <div
            key={i}
            className={cn(
              "flex items-center justify-between gap-3 px-3 py-2 text-sm",
              i === 0 && "border-b border-white/5",
              won && "bg-emerald-500/10",
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              {row.id != null && teamSeeds.has(row.id) && (
                <span className="text-[10px] font-mono text-slate-500 w-4 text-right">{teamSeeds.get(row.id)}</span>
              )}
              {row.id != null ? (
                <Link
                  to={`/team/${row.id}?season=${seasonId}`}
                  className={cn("truncate hover:underline", won ? "font-semibold text-white" : lost ? "text-slate-500" : "text-slate-200")}
                >
                  {teamNames.get(row.id) ?? `Team ${row.id}`}
                </Link>
              ) : (
                <span
                  className={cn("truncate italic", row.roster != null ? "text-amber-400/80" : "text-slate-500")}
                  title={row.roster != null ? "This Sleeper roster isn't mapped to a team for this season — fix it in Admin → Team Mapping and re-sync scores." : undefined}
                >
                  {row.roster != null ? `Unmapped team (roster ${row.roster})` : slotLabel(row.from)}
                </span>
              )}
            </div>
            <span className={cn("font-mono text-xs", won ? "text-emerald-300 font-semibold" : "text-slate-500")}>
              {row.id != null && scores ? (scores.get(row.id) ?? 0).toFixed(1) : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function BracketColumns({
  title, matches, config, matchups, teamNames, teamSeeds, seasonId, placeOffset, plainRounds,
}: Props & { title: string; matches: PlayoffMatch[]; placeOffset: number; plainRounds?: boolean }) {
  if (matches.length === 0) return null;
  const rounds = [...new Set(matches.map((m) => m.r))].sort((a, b) => a - b);
  const total = Math.max(...rounds);
  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold text-center">{title}</h3>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {rounds.map((r) => {
          const weeks = roundWeeks(config, r, total);
          return (
            <div key={r} className="min-w-[220px] flex-1 space-y-3">
              <div className="text-center">
                <p className="text-sm font-semibold">{plainRounds ? `Round ${r}` : roundLabel(r, total)}</p>
                <p className="text-xs text-slate-500">Week {weeks.join("–")}</p>
              </div>
              {matches
                .filter((m) => m.r === r)
                .sort((a, b) => (b.p == null ? 1 : 0) - (a.p == null ? 1 : 0) || a.m - b.m)
                .map((m) => (
                  <MatchCard
                    key={m.m}
                    match={m}
                    weeks={weeks}
                    scores={matchScores(m, weeks, matchups)}
                    teamNames={teamNames}
                    teamSeeds={teamSeeds}
                    seasonId={seasonId}
                    placeOffset={placeOffset}
                  />
                ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Renders whatever bracket Sleeper published for the season — any size or format. */
const BracketView = (props: Props) => (
  <div className="space-y-8">
    <BracketColumns {...props} title="Playoff Bracket" matches={props.config.winners} placeOffset={0} />
    <BracketColumns
      {...props}
      title="Consolation Bracket"
      matches={props.config.losers}
      placeOffset={losersPlaceOffset(props.config.winners, props.config.losers)}
      plainRounds
    />
  </div>
);

export default BracketView;
