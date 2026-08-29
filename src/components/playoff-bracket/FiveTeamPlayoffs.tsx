
import React, { useState } from "react";
import type { MatchupScoresView, Team } from "@/types/database";
import WeekLabels from "./WeekLabels";
import Week15Matchups from "./five-team/Week15Matchups";
import Week16Matchups from "./five-team/Week16Matchups";
import BracketSection from "./BracketSection";
import {
  getWildcardGames,
  getSeedOneSemifinal,
  getChampionship,
  getWeekFifteenConsolation,
  getWeekSixteenConsolation,
  getConsolationWinners,
  getConsolationLosers,
} from "./five-team/fiveTeamUtils";

interface FiveTeamPlayoffsProps {
  matchups: MatchupScoresView[];
  editMode?: boolean;
  onTeamSelect?: (matchupId: number, isHome: boolean, teamId: number) => void;
  onScoreUpdate?: (matchupId: number, isHome: boolean, score: number) => void;
  teams?: Team[];
  teamSeeds?: Map<number, number>;
}

const FiveTeamPlayoffs: React.FC<FiveTeamPlayoffsProps> = ({
  matchups,
  editMode = false,
  onTeamSelect,
  onScoreUpdate,
  teams = [],
  teamSeeds = new Map(),
}) => {
  // useState always called unconditionally
  const [matchupCounter, setMatchupCounter] = useState(0);

  // Seeds 1-5 are playoff bracket; rest are consolation
  const playoffTeamIds = new Set(
    [...teamSeeds.entries()].filter(([, s]) => s <= 5).map(([id]) => id),
  );

  const isBracket = (m: MatchupScoresView) =>
    playoffTeamIds.size > 0
      ? playoffTeamIds.has(m.home_team_id!) && playoffTeamIds.has(m.away_team_id!)
      : m.is_playoff === true && !m.is_consolation;

  const allPlayoffWeek = matchups.filter(m => m.is_playoff === true || m.is_consolation === true);
  const playoffMatchups    = allPlayoffWeek.filter(m => isBracket(m));
  const consolationMatchups = allPlayoffWeek.filter(m => !isBracket(m));

  // Detect 3-round format from ALL playoff weeks, not just bracket weeks.
  // Our seed-based isBracket filter can misclassify play-in games when Sleeper's
  // seeding differs from our win% ranking, causing bracketWeeks to miss week 1.
  const allPlayoffWeeks = [...new Set(
    allPlayoffWeek.map(m => m.week_number!).filter(Boolean)
  )].sort((a, b) => a - b);

  const isThreeRound = allPlayoffWeeks.length >= 3;

  // ── 2-round data (computed unconditionally for the non-3-round path) ──────
  const wildcardGames2      = getWildcardGames(playoffMatchups, teamSeeds);
  const seedOneSemifinal2   = getSeedOneSemifinal(playoffMatchups, teamSeeds);
  const championship2       = getChampionship(playoffMatchups);
  const weekFifteenConsol   = getWeekFifteenConsolation(consolationMatchups);
  const weekSixteenConsol   = getWeekSixteenConsolation(consolationMatchups);

  const commonProps = { editMode, onTeamSelect, onScoreUpdate, teams };

  // ── 3-round layout (Season 13+: play-in / semis / championship) ──────────
  if (isThreeRound) {
    const [week1, week2, week3] = allPlayoffWeeks;

    const allWeek1 = allPlayoffWeek.filter(m => m.week_number === week1);
    const allWeek2 = allPlayoffWeek.filter(m => m.week_number === week2);
    const allWeek3 = allPlayoffWeek.filter(m => m.week_number === week3);

    // ── Identify bracket games directly via seed-based playoffTeamIds ──────────
    // (isBracket/playoffTeamIds come from teamSeeds, computed from deduplicated
    // regular-season records — reliable now that seeding is correct.)
    const week1Bracket = allWeek1.filter(m => isBracket(m));
    const week2Bracket = allWeek2.filter(m => isBracket(m));
    const week3Bracket = allWeek3.filter(m => isBracket(m));

    // Championship = week-3 bracket game between the two week-2 semifinal winners.
    // 3rd place = week-3 bracket game between the two week-2 semifinal losers.
    const semiWinners = new Set<number>();
    const semiLosers  = new Set<number>();
    for (const m of week2Bracket) {
      if (m.home_score == null || m.away_score == null) continue;
      const [wid, lid] =
        m.home_score >= m.away_score
          ? [m.home_team_id!, m.away_team_id!]
          : [m.away_team_id!, m.home_team_id!];
      if (wid) semiWinners.add(wid);
      if (lid) semiLosers.add(lid);
    }

    const championship = week3Bracket.find(
      m => semiWinners.has(m.home_team_id!) && semiWinners.has(m.away_team_id!)
    ) ?? week3Bracket[0];
    const thirdPlace = week3Bracket.find(
      m => m !== championship
        && semiLosers.has(m.home_team_id!) && semiLosers.has(m.away_team_id!)
    );

    // Consolation: every non-bracket game in each week
    const allBracketTeams = new Set<number>();
    [...week1Bracket, ...week2Bracket, ...week3Bracket].forEach(m => {
      if (m.home_team_id) allBracketTeams.add(m.home_team_id);
      if (m.away_team_id) allBracketTeams.add(m.away_team_id);
    });

    // True consolation games require BOTH teams outside the bracket. A game
    // between a bracket team (on a bye) and a consolation team is a dead/bye
    // game, not a real consolation matchup — including it corrupts the
    // 5th/7th/9th place winner-tracing below (a bracket team could get
    // mistakenly credited with a consolation placement).
    const isConsolationGame = (m: MatchupScoresView) =>
      !playoffTeamIds.has(m.home_team_id!) && !playoffTeamIds.has(m.away_team_id!);
    const week1Consol = allWeek1.filter(isConsolationGame);
    const week2Consol = allWeek2.filter(isConsolationGame);
    const week3Consol = allWeek3.filter(isConsolationGame);

    // ── Consolation placement games ───────────────────────────────────────────
    // Consolation placement games in week 3 (or week 2 if consolation ends earlier)
    const consolFinalWeek = week3Consol.length > 0 ? week3Consol : week2Consol;
    const consolSemiWeek  = week3Consol.length > 0 ? week2Consol : week1Consol;

    const consolSemiWinners = new Set(getConsolationWinners(consolSemiWeek));
    const consolSemiLosers  = new Set(getConsolationLosers(consolSemiWeek));

    const fifthPlace   = consolFinalWeek.find(
      m => consolSemiWinners.size > 0
        && consolSemiWinners.has(m.home_team_id!)
        && consolSemiWinners.has(m.away_team_id!)
    );
    const ninthPlace   = consolFinalWeek.find(
      m => consolSemiLosers.size > 0
        && consolSemiLosers.has(m.home_team_id!)
        && consolSemiLosers.has(m.away_team_id!)
    );
    const seventhPlace = consolFinalWeek.find(m => m !== fifthPlace && m !== ninthPlace);

    // Build matchup objects for BracketSection — simple sequential IDs
    let ctr = 0;
    const mk = (m: MatchupScoresView, isConsolation = false) => ({
      matchupId: ctr++,
      homeTeam: m.home_team_name,
      homeTeamId: m.home_team_id,
      homeSeed: m.home_team_id ? teamSeeds.get(m.home_team_id) : undefined,
      homeScore: m.home_score,
      awayTeam: m.away_team_name,
      awayTeamId: m.away_team_id,
      awaySeed: m.away_team_id ? teamSeeds.get(m.away_team_id) : undefined,
      awayScore: m.away_score,
      ...(isConsolation && { isConsolation: true }),
    });

    // Consolation labels: offset by bracket size so positions are correct overall.
    // e.g. 5-bracket → consolation starts at 6th, so "5th Place Game" → "6th Place Game".
    const consolStart = allBracketTeams.size > 0 ? allBracketTeams.size + 1 : 6;
    const ordinal = (n: number) => {
      if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
      return `${n}${['th','st','nd','rd','th','th','th','th','th','th'][n % 10] ?? 'th'}`;
    };
    const fifthLabel   = `${ordinal(consolStart)} Place Game`;
    const seventhLabel = `${ordinal(consolStart + 2)} Place Game`;
    // ninthPlace game position depends on whether a seventh-place game exists
    const ninthLabel   = `${ordinal(consolStart + 2 + (seventhPlace ? 2 : 0))} Place Game`;

    // Pre-build matchup arrays so the counter increments deterministically
    const wildcardMatchups    = week1Bracket.map(m => mk(m));
    const week2Matchups       = week2Bracket.map(m => mk(m));
    const champMatchup        = championship ? [mk(championship)] : [];
    const thirdMatchup        = thirdPlace   ? [mk(thirdPlace)]   : [];
    const consol1Matchups     = week1Consol.map(m => mk(m, true));
    const consol2Matchups     = week2Consol.map(m => mk(m, true));
    const fifthMatchup        = fifthPlace   ? [mk(fifthPlace,   true)] : [];
    const seventhMatchup      = seventhPlace ? [mk(seventhPlace, true)] : [];
    const ninthMatchup        = ninthPlace   ? [mk(ninthPlace,   true)] : [];

    // Whether consolation finals land in week 3 or week 2
    const consolFinalsInWeek3 = week3Consol.length > 0;
    // The week number shown as header for the consolation finals column
    const consolFinalWeekNum = consolFinalsInWeek3 ? week3 : week2;
    // Consolation round-2 only exists as a distinct round when finals are in week 3
    const hasConsolRound2 = consolFinalsInWeek3 && consol2Matchups.length > 0;

    return (
      <div className="overflow-auto">
        <div className="flex flex-col min-w-[1100px]">
          <WeekLabels weeks={[week1, week2, week3]} />

          {/* ── Top section: main bracket only ── */}
          <div className="grid grid-cols-3 gap-8">
            {/* Column 1: Play-in */}
            <div className="space-y-6">
              <BracketSection
                title="Play-in Games"
                matchups={wildcardMatchups}
                {...commonProps}
              />
            </div>

            {/* Column 2: Semifinals */}
            <div className="space-y-6">
              <BracketSection
                title="Semifinals"
                matchups={week2Matchups}
                {...commonProps}
              />
            </div>

            {/* Column 3: Championship + 3rd place */}
            <div className="space-y-6">
              {champMatchup.length > 0 && (
                <BracketSection
                  title="Championship Game"
                  matchups={champMatchup}
                  {...commonProps}
                />
              )}
              {thirdMatchup.length > 0 && (
                <BracketSection
                  title="3rd Place Game"
                  matchups={thirdMatchup}
                  {...commonProps}
                />
              )}
            </div>
          </div>

          {/* ── Single full-width consolation divider ── */}
          {(consol1Matchups.length > 0 || consol2Matchups.length > 0 || fifthMatchup.length > 0 || ninthMatchup.length > 0) && (
            <div className="w-full my-8">
              <div className="flex items-center justify-center">
                <div className="h-px bg-border flex-grow"></div>
                <span className="px-4 text-sm text-muted-foreground font-medium">Consolation Bracket</span>
                <div className="h-px bg-border flex-grow"></div>
              </div>
            </div>
          )}

          {/* ── Bottom section: consolation bracket ── */}
          <div className="grid grid-cols-3 gap-8">
            {/* Consol column 1: Round 1 */}
            <div className="space-y-6">
              {consol1Matchups.length > 0 && (
                <BracketSection
                  title="Consolation Round 1"
                  matchups={consol1Matchups}
                  {...commonProps}
                />
              )}
            </div>

            {/* Consol column 2: Round 2 (intermediate) OR finals when consolation ends in week 2 */}
            <div className="space-y-6">
              {hasConsolRound2 && (
                <BracketSection
                  title="Consolation Round 2"
                  matchups={consol2Matchups}
                  {...commonProps}
                />
              )}
              {!consolFinalsInWeek3 && (
                <>
                  {fifthMatchup.length > 0 && (
                    <BracketSection title={fifthLabel} matchups={fifthMatchup} {...commonProps} />
                  )}
                  {seventhMatchup.length > 0 && (
                    <BracketSection title={seventhLabel} matchups={seventhMatchup} {...commonProps} />
                  )}
                  {ninthMatchup.length > 0 && (
                    <BracketSection title={ninthLabel} matchups={ninthMatchup} {...commonProps} />
                  )}
                </>
              )}
            </div>

            {/* Consol column 3: Finals when consolation extends to week 3 */}
            <div className="space-y-6">
              {consolFinalsInWeek3 && (
                <>
                  {fifthMatchup.length > 0 && (
                    <BracketSection title={fifthLabel} matchups={fifthMatchup} {...commonProps} />
                  )}
                  {seventhMatchup.length > 0 && (
                    <BracketSection title={seventhLabel} matchups={seventhMatchup} {...commonProps} />
                  )}
                  {ninthMatchup.length > 0 && (
                    <BracketSection title={ninthLabel} matchups={ninthMatchup} {...commonProps} />
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 2-round layout (fallback for any future 5-team 2-round season) ─────────
  return (
    <div className="overflow-auto">
      <div className="flex flex-col min-w-[800px]">
        <WeekLabels weeks={[15, 16]} />

        <div className="grid grid-cols-2 gap-8">
          <Week15Matchups
            wildcardGames={wildcardGames2}
            seedOneSemifinal={seedOneSemifinal2}
            weekFifteenConsolation={weekFifteenConsol}
            editMode={editMode}
            onTeamSelect={onTeamSelect}
            onScoreUpdate={onScoreUpdate}
            teams={teams}
            teamSeeds={teamSeeds}
            matchupCounter={matchupCounter}
            onMatchupCounterUpdate={setMatchupCounter}
          />
          <Week16Matchups
            championship={championship2}
            consolationMatchups={weekSixteenConsol}
            weekFifteenConsolation={weekFifteenConsol}
            editMode={editMode}
            onTeamSelect={onTeamSelect}
            onScoreUpdate={onScoreUpdate}
            teams={teams}
            teamSeeds={teamSeeds}
            matchupCounter={matchupCounter}
            onMatchupCounterUpdate={setMatchupCounter}
          />
        </div>
      </div>
    </div>
  );
};

export default FiveTeamPlayoffs;
