
import React from "react";
import { MatchupScoresView } from "@/types/database";
import WeekLabels from "./WeekLabels";
import type { Team } from "@/types/database";
import { getPlayoffWeeks } from "./utils/playoffWeeks";
import PlayoffWildcard from "./PlayoffWildcard";
import PlayoffSemifinals from "./PlayoffSemifinals";
import PlacementGames from "./PlacementGames";
import ConsolationBracket from "./ConsolationBracket";
import ChampionshipGame from "./ChampionshipGame";
import BracketSection from "./BracketSection";

interface SixTeamPlayoffsProps {
  matchups: MatchupScoresView[];
  editMode?: boolean;
  onTeamSelect?: (matchupId: number, isHome: boolean, teamId: number) => void;
  onScoreUpdate?: (matchupId: number, isHome: boolean, score: number) => void;
  teams?: Team[];
  teamSeeds?: Map<number, number>;
  seasonNumber?: number;
}

const SixTeamPlayoffs: React.FC<SixTeamPlayoffsProps> = ({
  matchups,
  editMode = false,
  onTeamSelect,
  onScoreUpdate,
  teams = [],
  teamSeeds = new Map(),
  seasonNumber = 11,
}) => {
  const { playoffStartWeek, champWeek, displayWeeks, isLoserAdvancesFormat } =
    getPlayoffWeeks(seasonNumber);

  // ── Seasons 11-12: 6-team bracket (seeds 1-6) ────────────────────────────
  const bracketSize = 6;
  const bracketTeamIds: Set<number> =
    teamSeeds.size > 0
      ? new Set(
          [...teamSeeds.entries()]
            .filter(([, seed]) => seed <= bracketSize)
            .map(([id]) => id)
        )
      : new Set();

  const isBracket = (m: MatchupScoresView) =>
    bracketTeamIds.size > 0
      ? bracketTeamIds.has(m.home_team_id!) && bracketTeamIds.has(m.away_team_id!)
      : m.is_playoff === true && !m.is_consolation;

  // NOTE: intentionally the loose "!isBracket" check (at least one team outside
  // the bracket), not the stricter "both teams outside" check. When our seed
  // computation disagrees with Sleeper's actual historical bracket (this can
  // happen on multi-way ties — see Season 12, where Aron was the real 6-seed
  // per Sleeper's bracket API but our win%/PF tiebreak ranks CJ 6th instead),
  // the strict check causes real games between two "consolation-looking" teams
  // to be silently dropped whenever one of them is wrongly seeded into the
  // bracket. The loose check risks a bracket team's bye-week game being
  // mislabeled as a placement game, but never loses a real game from display.
  const isConsolationGame = (m: MatchupScoresView) => !isBracket(m);

  // ── Wildcard (week playoffStartWeek) ─────────────────────────────────────
  const allWildcardWeek = matchups.filter(m => m.week_number === playoffStartWeek);
  const wildcardGames = allWildcardWeek.filter(m => isBracket(m));
  const consolationWeek1 = allWildcardWeek.filter(isConsolationGame);

  // Track which bracket seeds lost the wildcard — they drop to a lower bracket track.
  const wildcardLosers = new Set<number>();
  for (const m of wildcardGames) {
    if (m.home_score == null || m.away_score == null) continue;
    const loserId = m.home_score >= m.away_score ? m.away_team_id! : m.home_team_id!;
    if (loserId) wildcardLosers.add(loserId);
  }

  // Sort wildcard by seed
  const sortedWildcardGames = [...wildcardGames].sort((a, b) => {
    const aBest = Math.min(teamSeeds.get(a.home_team_id ?? 0) ?? 999, teamSeeds.get(a.away_team_id ?? 0) ?? 999);
    const bBest = Math.min(teamSeeds.get(b.home_team_id ?? 0) ?? 999, teamSeeds.get(b.away_team_id ?? 0) ?? 999);
    return aBest - bBest;
  });

  // ── Semis (week playoffStartWeek + 1) ─────────────────────────────────────
  const semisWeek = playoffStartWeek + 1;
  const allSemiWeek = matchups.filter(m => m.week_number === semisWeek);
  // True semis: bracket games that are NOT between two wildcard losers
  const semiFinals = allSemiWeek.filter(m =>
    isBracket(m) &&
    !(wildcardLosers.has(m.home_team_id!) && wildcardLosers.has(m.away_team_id!))
  );
  // Wildcard-loser bracket game (e.g. seeds 5v6 in week 16 for 5th/6th place track)
  const wildcardLosersBracketGame = allSemiWeek.find(m =>
    isBracket(m) &&
    wildcardLosers.has(m.home_team_id!) && wildcardLosers.has(m.away_team_id!)
  );
  const consolationWeek2 = allSemiWeek.filter(isConsolationGame);

  const sortedSemiFinals = [...semiFinals].sort((a, b) => {
    const aBest = Math.min(teamSeeds.get(a.home_team_id ?? 0) ?? 999, teamSeeds.get(a.away_team_id ?? 0) ?? 999);
    const bBest = Math.min(teamSeeds.get(b.home_team_id ?? 0) ?? 999, teamSeeds.get(b.away_team_id ?? 0) ?? 999);
    return aBest - bBest;
  });

  // Semi winners / losers
  const semiFinalWinners = new Set<number>();
  const semiFinalLosers = new Set<number>();
  for (const m of semiFinals) {
    if (m.home_score == null || m.away_score == null) continue;
    const [wid, lid] =
      m.home_score >= m.away_score
        ? [m.home_team_id!, m.away_team_id!]
        : [m.away_team_id!, m.home_team_id!];
    if (wid) semiFinalWinners.add(wid);
    if (lid) semiFinalLosers.add(lid);
  }

  // ── Finals (champWeek) ────────────────────────────────────────────────────
  const allChampWeek = matchups.filter(m => m.week_number === champWeek);
  const bracketChampWeek = allChampWeek.filter(m => isBracket(m));
  const consolationWeek3 = allChampWeek.filter(isConsolationGame);

  // Championship = champ-week bracket game between two semi-winners
  const championship = bracketChampWeek.find(
    m => semiFinalWinners.has(m.home_team_id!) && semiFinalWinners.has(m.away_team_id!)
  ) ?? bracketChampWeek[0];

  // 3rd place = champ-week bracket game between two semi-losers
  const thirdPlaceGame = bracketChampWeek.find(
    m =>
      m !== championship &&
      semiFinalLosers.has(m.home_team_id!) &&
      semiFinalLosers.has(m.away_team_id!)
  );

  // ── Consolation ordering — dynamic week detection ─────────────────────────
  // If consolation ends before champWeek (e.g. only 4 consolation teams in a
  // 6-bracket season), consolationWeek3 will be empty.  In that case the
  // "finals" are in consolationWeek2 and the "semis" are in consolationWeek1.
  const consolFinalsGames = consolationWeek3.length > 0 ? consolationWeek3 : consolationWeek2;
  const consolSemisGames  = consolationWeek3.length > 0 ? consolationWeek2 : consolationWeek1;
  const consolFinalWeekNum = consolationWeek3.length > 0 ? champWeek : semisWeek;

  const consolSemiWinners = new Set<number>();
  const consolSemiLosers  = new Set<number>();
  for (const m of consolSemisGames) {
    if (m.home_score == null || m.away_score == null) continue;
    const [wid, lid] =
      m.home_score >= m.away_score
        ? [m.home_team_id!, m.away_team_id!]
        : [m.away_team_id!, m.home_team_id!];
    if (wid) consolSemiWinners.add(wid);
    if (lid) consolSemiLosers.add(lid);
  }

  // 5th place: consolation finals game where BOTH teams won their consol semi
  const fifthPlaceGame = consolFinalsGames.find(
    m => consolSemiWinners.has(m.home_team_id!) && consolSemiWinners.has(m.away_team_id!)
  );
  // 9th place (toilet bowl): consolation finals game where BOTH teams lost their consol semi
  const ninthPlaceGame = consolFinalsGames.find(
    m => consolSemiLosers.has(m.home_team_id!) && consolSemiLosers.has(m.away_team_id!)
  );
  // 7th place: remaining consolation finals game (may be undefined if only 4 consol teams)
  const seventhPlaceGame = consolFinalsGames.find(
    m => m !== fifthPlaceGame && m !== ninthPlaceGame
  );

  // Sort consolation week 1 by seed
  const sortedConsolationWeek1 = [...consolationWeek1].sort((a, b) => {
    const aBest = Math.min(teamSeeds.get(a.home_team_id ?? 0) ?? 999, teamSeeds.get(a.away_team_id ?? 0) ?? 999);
    const bBest = Math.min(teamSeeds.get(b.home_team_id ?? 0) ?? 999, teamSeeds.get(b.away_team_id ?? 0) ?? 999);
    return aBest - bBest;
  });

  // In a 6-team bracket, consolation placements start at 7th.
  // The last consolation game is between teams placing (N-1)th and Nth where N = total teams.
  const totalTeams = teamSeeds.size > 0 ? teamSeeds.size : 10;
  const lastPlaceNum = totalTeams - 1;
  const ninthPlaceTitle = `${lastPlaceNum}th Place (Last Place)`;
  const consolationTitle = isLoserAdvancesFormat
    ? "Consolation Bracket (Loser Advances)"
    : "Consolation Bracket";
  const toiletBowlRoundTitle = isLoserAdvancesFormat
    ? "Toilet Bowl Round 1: Loser advances"
    : "Consolation Round 1";

  // ── Shared matchup counter ────────────────────────────────────────────────
  let matchupCounter = 0;
  const nextId = () => matchupCounter++;

  return (
    <div className="overflow-auto">
      <div className="flex flex-col min-w-[1000px]">
        <WeekLabels weeks={displayWeeks} />

        <div className="grid grid-cols-3 gap-8">
          {/* Left Column — Wildcard week */}
          <div className="space-y-12">
            <PlayoffWildcard
              wildcardGames={sortedWildcardGames}
              teamSeeds={teamSeeds}
              matchupCounter={matchupCounter}
              onMatchupCounterUpdate={() => {}}
              editMode={editMode}
              onTeamSelect={onTeamSelect}
              onScoreUpdate={onScoreUpdate}
              teams={teams}
            />
          </div>

          {/* Middle Column — Semis */}
          <div className="space-y-12">
            <PlayoffSemifinals
              semiFinals={sortedSemiFinals}
              teamSeeds={teamSeeds}
              matchupCounter={matchupCounter}
              onMatchupCounterUpdate={() => {}}
              editMode={editMode}
              onTeamSelect={onTeamSelect}
              onScoreUpdate={onScoreUpdate}
              teams={teams}
            />
            {wildcardLosersBracketGame && (
              <BracketSection
                title="5th Place"
                subtitle="Seeded bracket – lower half"
                matchups={[{
                  matchupId: matchupCounter + wildcardGames.length + sortedSemiFinals.length,
                  homeTeam: wildcardLosersBracketGame.home_team_name,
                  homeTeamId: wildcardLosersBracketGame.home_team_id,
                  homeSeed: wildcardLosersBracketGame.home_team_id ? teamSeeds.get(wildcardLosersBracketGame.home_team_id) : undefined,
                  homeScore: wildcardLosersBracketGame.home_score,
                  awayTeam: wildcardLosersBracketGame.away_team_name,
                  awayTeamId: wildcardLosersBracketGame.away_team_id,
                  awaySeed: wildcardLosersBracketGame.away_team_id ? teamSeeds.get(wildcardLosersBracketGame.away_team_id) : undefined,
                  awayScore: wildcardLosersBracketGame.away_score,
                  isConsolation: false
                }]}
                editMode={editMode}
                onTeamSelect={onTeamSelect}
                onScoreUpdate={onScoreUpdate}
                teams={teams}
              />
            )}
          </div>

          {/* Right Column — Championship + 3rd place */}
          <div className="space-y-12">
            {championship && (
              <ChampionshipGame
                championship={championship}
                teamSeeds={teamSeeds}
                matchupCounter={matchupCounter}
                onMatchupCounterUpdate={() => {}}
                editMode={editMode}
                onTeamSelect={onTeamSelect}
                onScoreUpdate={onScoreUpdate}
                teams={teams}
              />
            )}

            {thirdPlaceGame && (
              <PlacementGames
                thirdPlaceGame={thirdPlaceGame}
                teamSeeds={teamSeeds}
                matchupCounter={matchupCounter}
                onMatchupCounterUpdate={() => {}}
                editMode={editMode}
                onTeamSelect={onTeamSelect}
                onScoreUpdate={onScoreUpdate}
                teams={teams}
                thirdPlaceTitle="3rd Place Game"
              />
            )}
          </div>
        </div>

        {/* Full-width consolation divider */}
        <div className="w-full my-8">
          <div className="flex items-center justify-center">
            <div className="h-px bg-border flex-grow" />
            <span className="px-4 text-sm text-muted-foreground font-medium">
              {consolationTitle}
            </span>
            <div className="h-px bg-border flex-grow" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8">
          {/* Consolation Round 1 */}
          <div>
            <h4 className="text-center text-sm font-medium mb-4">
              Week {playoffStartWeek}
            </h4>
            <ConsolationBracket
              weekFifteenConsolation={sortedConsolationWeek1}
              teamSeeds={teamSeeds}
              matchupCounter={matchupCounter}
              onMatchupCounterUpdate={() => {}}
              editMode={editMode}
              onTeamSelect={onTeamSelect}
              onScoreUpdate={onScoreUpdate}
              teams={teams}
              title=""
              subtitle={toiletBowlRoundTitle}
            />
          </div>

          {/* Consolation Finals */}
          <div>
            <h4 className="text-center text-sm font-medium mb-4">
              Week {consolFinalWeekNum}
            </h4>
            {fifthPlaceGame && (
              <PlacementGames
                fifthPlaceGame={fifthPlaceGame}
                teamSeeds={teamSeeds}
                matchupCounter={matchupCounter}
                onMatchupCounterUpdate={() => {}}
                editMode={editMode}
                onTeamSelect={onTeamSelect}
                onScoreUpdate={onScoreUpdate}
                teams={teams}
                showOnlyFifthPlace={true}
                fifthPlaceTitle="7th Place Game"
              />
            )}

            {seventhPlaceGame && (
              <div className="mt-6">
                <PlacementGames
                  seventhPlaceGame={seventhPlaceGame}
                  teamSeeds={teamSeeds}
                  matchupCounter={matchupCounter}
                  onMatchupCounterUpdate={() => {}}
                  editMode={editMode}
                  onTeamSelect={onTeamSelect}
                  onScoreUpdate={onScoreUpdate}
                  teams={teams}
                  seventhPlaceTitle="9th Place Game"
                />
              </div>
            )}

            {ninthPlaceGame && (
              <div className="mt-6">
                <PlacementGames
                  ninthPlaceGame={ninthPlaceGame}
                  teamSeeds={teamSeeds}
                  matchupCounter={matchupCounter}
                  onMatchupCounterUpdate={() => {}}
                  editMode={editMode}
                  onTeamSelect={onTeamSelect}
                  onScoreUpdate={onScoreUpdate}
                  teams={teams}
                  ninthPlaceTitle={ninthPlaceTitle}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SixTeamPlayoffs;
