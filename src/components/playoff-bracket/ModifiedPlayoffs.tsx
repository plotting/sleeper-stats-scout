
import React, { useState } from "react";
import { MatchupScoresView } from "@/types/database";
import WeekLabels from "./WeekLabels";

import type { Team } from "@/types/database";
import PlayoffSemifinals from "./PlayoffSemifinals";
import ConsolationBracket from "./ConsolationBracket";
import ChampionshipGame from "./ChampionshipGame";
import PlacementGames from "./PlacementGames";
import BracketSection from "./BracketSection";
import { getPlayoffWeeks } from "./utils/playoffWeeks";
import { 
  filterPlayoffMatchups, 
  getSemiFinals, 
  sortSemiFinalsBySeeds, 
  getChampionship, 
  getConsolationMatchups 
} from "./utils/matchupFilters";

interface ModifiedPlayoffsProps {
  matchups: MatchupScoresView[];
  editMode?: boolean;
  onTeamSelect?: (matchupId: number, isHome: boolean, teamId: number) => void;
  onScoreUpdate?: (matchupId: number, isHome: boolean, score: number) => void;
  teams?: Team[];
  teamSeeds?: Map<number, number>;
  seasonNumber?: number;
}

const ModifiedPlayoffs: React.FC<ModifiedPlayoffsProps> = ({ 
  matchups,
  editMode = false,
  onTeamSelect,
  onScoreUpdate,
  teams = [],
  teamSeeds = new Map(),
  seasonNumber = 8
}) => {
  const [matchupCounter, setMatchupCounter] = useState(0);

  // Get playoff week numbers based on season
  const { playoffStartWeek, champWeek, finalWeek } = getPlayoffWeeks(seasonNumber);

  // Seasons 8-10: 4-team bracket (seeds 1-4)
  const bracketTeamIds: Set<number> = teamSeeds.size > 0
    ? new Set(
        [...teamSeeds.entries()]
          .filter(([, seed]) => seed <= 4)
          .map(([id]) => id)
      )
    : new Set();

  // Filter and sort matchups using bracket team IDs
  const playoffMatchups = filterPlayoffMatchups(matchups, bracketTeamIds);
  const semiFinals = getSemiFinals(playoffMatchups, playoffStartWeek);
  const sortedSemiFinals = sortSemiFinalsBySeeds(semiFinals, teamSeeds);

  // Semi-final winners to correctly identify championship
  const semiFinalWinners = new Set<number>(
    semiFinals
      .filter(m => m.home_score != null && m.away_score != null)
      .map(m => m.home_score! >= m.away_score! ? m.home_team_id! : m.away_team_id!)
      .filter(Boolean)
  );

  const championship = getChampionship(playoffMatchups, champWeek, semiFinalWinners);

  // Get consolation matchups for each round using bracket team IDs
  const weekOneConsolation = getConsolationMatchups(matchups, playoffStartWeek, bracketTeamIds);
  const weekTwoConsolation = getConsolationMatchups(matchups, champWeek, bracketTeamIds);
  const weekThreeConsolation = getConsolationMatchups(matchups, finalWeek, bracketTeamIds);

  // Derive winners/losers from week 15 consolation results
  const round1Winners: number[] = [];
  const round1Losers: number[] = [];
  for (const m of weekOneConsolation) {
    if (m.home_score == null || m.away_score == null) continue;
    const [wid, lid] = m.home_score >= m.away_score
      ? [m.home_team_id!, m.away_team_id!]
      : [m.away_team_id!, m.home_team_id!];
    if (wid) round1Winners.push(wid);
    if (lid) round1Losers.push(lid);
  }

  // 5th place game in week 16 = game between two round1Winners
  const fifthPlaceGameEarly = weekTwoConsolation.find(
    m => round1Winners.includes(m.home_team_id || 0) && round1Winners.includes(m.away_team_id || 0)
  );

  // Round2 tracks only the toilet bowl track games (exclude 5th place game)
  // so seventhPlaceGame and ninthPlaceGame are identified from the right pool.
  const round2Winners: number[] = [];
  const round2Losers: number[] = [];
  for (const m of weekTwoConsolation) {
    if (m === fifthPlaceGameEarly) continue;
    if (m.home_score == null || m.away_score == null) continue;
    const [wid, lid] = m.home_score >= m.away_score
      ? [m.home_team_id!, m.away_team_id!]
      : [m.away_team_id!, m.home_team_id!];
    if (wid) round2Winners.push(wid);
    if (lid) round2Losers.push(lid);
  }

  // 3rd-place game = champWeek bracket game between semi-final losers
  const semiFinalLosers = new Set<number>(
    semiFinals
      .filter(m => m.home_score != null && m.away_score != null)
      .map(m => m.home_score! >= m.away_score! ? m.away_team_id! : m.home_team_id!)
      .filter(Boolean)
  );

  const thirdPlaceGame = playoffMatchups.find(
    m =>
      m.week_number === champWeek &&
      m !== championship &&
      semiFinalLosers.has(m.home_team_id!) &&
      semiFinalLosers.has(m.away_team_id!)
  );

  // Find consolation matchups for specific placements
  const isLoserAdvancesFormat = seasonNumber >= 8 && seasonNumber <= 10;

  let fifthPlaceGame = fifthPlaceGameEarly;
  let seventhPlaceGame: typeof weekThreeConsolation[number] | undefined;
  let ninthPlaceGame: typeof weekThreeConsolation[number] | undefined;

  if (isLoserAdvancesFormat) {
    if (weekThreeConsolation.length > 0) {
      // 7th place game = week 17 game between the toilet-track week 16 winners
      seventhPlaceGame = weekThreeConsolation.find(
        m => round2Winners.includes(m.home_team_id || 0) && round2Winners.includes(m.away_team_id || 0)
      );
      // 9th/10th place (toilet bowl) = week 17 game between toilet-track week 16 losers
      ninthPlaceGame = weekThreeConsolation.find(
        m => round2Losers.includes(m.home_team_id || 0) && round2Losers.includes(m.away_team_id || 0)
      );
    }
  } else {
    // Standard (non-loser-advances) logic — all placement games in week 16
    fifthPlaceGame = weekTwoConsolation.find(
      m => round1Winners.includes(m.home_team_id || 0) && round1Winners.includes(m.away_team_id || 0)
    );
    ninthPlaceGame = weekTwoConsolation.find(
      m => round1Losers.includes(m.home_team_id || 0) && round1Losers.includes(m.away_team_id || 0)
    );
    seventhPlaceGame = weekTwoConsolation.find(
      m => m !== fifthPlaceGame && m !== ninthPlaceGame && m !== thirdPlaceGame && m !== championship
    );
  }

  // For seasons 8-10, we update titles to reflect the "loser advances" format
  const ninthPlaceTitle = isLoserAdvancesFormat ? "9th Place Game (Toilet Bowl)" : "9th Place Game";
  const consolationTitle = isLoserAdvancesFormat ? "Consolation Bracket (Loser Advances)" : "Consolation Bracket";

  return (
    <div className="overflow-auto">
      <div className="flex flex-col min-w-[800px]">
        {/* Top bracket header: only the 2 bracket weeks (15 & 16) */}
        <WeekLabels weeks={[playoffStartWeek, champWeek]} />

        {/* Main playoff bracket — 2 columns: Semifinals | Championship + 3rd Place */}
        <div className="grid grid-cols-2 gap-8">
          {/* Left Column - Semifinals */}
          <div className="space-y-6">
            <PlayoffSemifinals
              semiFinals={sortedSemiFinals}
              teamSeeds={teamSeeds}
              matchupCounter={matchupCounter}
              onMatchupCounterUpdate={setMatchupCounter}
              editMode={editMode}
              onTeamSelect={onTeamSelect}
              onScoreUpdate={onScoreUpdate}
              teams={teams}
            />
          </div>

          {/* Right Column - Championship and 3rd Place Game */}
          <div>
            <ChampionshipGame
              championship={championship}
              teamSeeds={teamSeeds}
              matchupCounter={matchupCounter}
              onMatchupCounterUpdate={setMatchupCounter}
              editMode={editMode}
              onTeamSelect={onTeamSelect}
              onScoreUpdate={onScoreUpdate}
              teams={teams}
            />

            {thirdPlaceGame && (
              <PlacementGames
                thirdPlaceGame={thirdPlaceGame}
                teamSeeds={teamSeeds}
                matchupCounter={matchupCounter}
                onMatchupCounterUpdate={setMatchupCounter}
                editMode={editMode}
                onTeamSelect={onTeamSelect}
                onScoreUpdate={onScoreUpdate}
                teams={teams}
                thirdPlaceTitle="3rd Place Game"
                showOnlyFifthPlace={false}
              />
            )}
          </div>
        </div>
        
        {/* Full width divider for consolation bracket */}
        <div className="w-full my-8">
          <div className="flex items-center justify-center">
            <div className="h-px bg-border flex-grow"></div>
            <span className="px-4 text-sm text-muted-foreground font-medium">{consolationTitle}</span>
            <div className="h-px bg-border flex-grow"></div>
          </div>
        </div>
        
        {/* Consolation bracket in a different grid layout */}
        <div className="grid grid-cols-3 gap-8">
          {/* Week 15/16 Consolation Games (First Round) */}
          <div>
            <h4 className="text-center text-sm font-medium mb-4">Week {playoffStartWeek}</h4>
            <BracketSection
              title=""
              subtitle={isLoserAdvancesFormat ? "Toilet Bowl Round 1: Loser advances" : "Winners advance to 5th place game"}
              matchups={weekOneConsolation.map((matchup, idx) => ({
                matchupId: matchupCounter + idx,
                homeTeam: matchup.home_team_name,
                homeTeamId: matchup.home_team_id,
                homeSeed: matchup.home_team_id ? teamSeeds.get(matchup.home_team_id) : undefined,
                homeScore: matchup.home_score,
                awayTeam: matchup.away_team_name,
                awayTeamId: matchup.away_team_id,
                awaySeed: matchup.away_team_id ? teamSeeds.get(matchup.away_team_id) : undefined,
                awayScore: matchup.away_score,
                isConsolation: true
              }))}
              editMode={editMode}
              onTeamSelect={onTeamSelect}
              onScoreUpdate={onScoreUpdate}
              teams={teams}
            />
          </div>
          
          {/* Week 16/17 Consolation Games */}
          <div>
            <h4 className="text-center text-sm font-medium mb-4">Week {champWeek}</h4>
            {isLoserAdvancesFormat && fifthPlaceGame && (
              <BracketSection
                title="5th Place Game"
                matchups={[{
                  matchupId: matchupCounter + weekOneConsolation.length,
                  homeTeam: fifthPlaceGame.home_team_name,
                  homeTeamId: fifthPlaceGame.home_team_id,
                  homeSeed: fifthPlaceGame.home_team_id ? teamSeeds.get(fifthPlaceGame.home_team_id) : undefined,
                  homeScore: fifthPlaceGame.home_score,
                  awayTeam: fifthPlaceGame.away_team_name,
                  awayTeamId: fifthPlaceGame.away_team_id,
                  awaySeed: fifthPlaceGame.away_team_id ? teamSeeds.get(fifthPlaceGame.away_team_id) : undefined,
                  awayScore: fifthPlaceGame.away_score,
                  isConsolation: true
                }]}
                editMode={editMode}
                onTeamSelect={onTeamSelect}
                onScoreUpdate={onScoreUpdate}
                teams={teams}
              />
            )}
            {/* Toilet bowl semi-finals in week 16 (games not part of the 5th place track) */}
            {isLoserAdvancesFormat && weekTwoConsolation.filter(m => m !== fifthPlaceGame).length > 0 && (
              <BracketSection
                title=""
                subtitle="Toilet Bowl Round 2: Loser advances"
                className="mt-8"
                matchups={weekTwoConsolation
                  .filter(m => m !== fifthPlaceGame)
                  .map((matchup, idx) => ({
                    matchupId: matchupCounter + weekOneConsolation.length + 1 + idx,
                    homeTeam: matchup.home_team_name,
                    homeTeamId: matchup.home_team_id,
                    homeSeed: matchup.home_team_id ? teamSeeds.get(matchup.home_team_id) : undefined,
                    homeScore: matchup.home_score,
                    awayTeam: matchup.away_team_name,
                    awayTeamId: matchup.away_team_id,
                    awaySeed: matchup.away_team_id ? teamSeeds.get(matchup.away_team_id) : undefined,
                    awayScore: matchup.away_score,
                    isConsolation: true
                  }))}
                editMode={editMode}
                onTeamSelect={onTeamSelect}
                onScoreUpdate={onScoreUpdate}
                teams={teams}
              />
            )}
            
            {/* For standard format, show all consolation games */}
            {!isLoserAdvancesFormat && (
              <PlacementGames
                fifthPlaceGame={fifthPlaceGame}
                seventhPlaceGame={seventhPlaceGame}
                ninthPlaceGame={ninthPlaceGame}
                teamSeeds={teamSeeds}
                matchupCounter={matchupCounter + weekOneConsolation.length}
                onMatchupCounterUpdate={setMatchupCounter}
                editMode={editMode}
                onTeamSelect={onTeamSelect}
                onScoreUpdate={onScoreUpdate}
                teams={teams}
                ninthPlaceTitle={ninthPlaceTitle}
              />
            )}
          </div>
          
          {/* Week 17 Final Consolation Games (only for seasons 8-10) */}
          {isLoserAdvancesFormat && weekThreeConsolation.length > 0 && (
            <div>
              <h4 className="text-center text-sm font-medium mb-4">Week {finalWeek}</h4>
              <PlacementGames
                seventhPlaceGame={seventhPlaceGame}
                ninthPlaceGame={ninthPlaceGame}
                teamSeeds={teamSeeds}
                matchupCounter={matchupCounter + weekOneConsolation.length + (fifthPlaceGame ? 1 : 0)}
                onMatchupCounterUpdate={setMatchupCounter}
                editMode={editMode}
                onTeamSelect={onTeamSelect}
                onScoreUpdate={onScoreUpdate}
                teams={teams}
                ninthPlaceTitle="9th/10th Place (Toilet Bowl)"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ModifiedPlayoffs;
