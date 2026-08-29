import React from "react";
import { MatchupScoresView } from "@/types/database";
import BracketSection from "../BracketSection";
import type { Team } from "@/types/database";
import {
  getWeekFifteenConsolationLosers,
  getWeekFifteenConsolationWinners,
  identifyPlacementGames,
} from "./fiveTeamUtils";

interface Week16MatchupsProps {
  championship?: MatchupScoresView;
  consolationMatchups: MatchupScoresView[];
  weekFifteenConsolation: MatchupScoresView[];
  editMode?: boolean;
  onTeamSelect?: (matchupId: number, isHome: boolean, teamId: number) => void;
  onScoreUpdate?: (matchupId: number, isHome: boolean, score: number) => void;
  teams?: Team[];
  teamSeeds: Map<number, number>;
  matchupCounter: number;
  onMatchupCounterUpdate: (newCounter: number) => void;
}

const Week16Matchups: React.FC<Week16MatchupsProps> = ({
  championship,
  consolationMatchups,
  weekFifteenConsolation,
  editMode = false,
  onTeamSelect,
  onScoreUpdate,
  teams = [],
  teamSeeds,
  matchupCounter,
  onMatchupCounterUpdate
}) => {
  // Counter to track matchup IDs
  let localCounter = matchupCounter;
  
  // Format team names with seeds
  const getTeamWithSeed = (teamName?: string, teamId?: number) => {
    if (!teamName || !teamId) return teamName || "";
    const seed = teamSeeds.get(teamId);
    return seed ? `(${seed}) ${teamName}` : teamName;
  };

  // Winners and losers from week-15 consolation games
  const weekFifteenWinners = getWeekFifteenConsolationWinners(weekFifteenConsolation);
  const weekFifteenLosers  = getWeekFifteenConsolationLosers(weekFifteenConsolation);

  // Identify placement games using winner/loser logic (no hardcoded names)
  const { fifthPlaceGame, seventhPlaceGame, ninthPlaceGame } = identifyPlacementGames(
    consolationMatchups,
    weekFifteenLosers,
    weekFifteenWinners,
  );

  // Create matchup for championship game
  const championshipMatchup = championship ? [{
    matchupId: localCounter++,
    homeTeam: getTeamWithSeed(championship.home_team_name, championship.home_team_id),
    homeTeamId: championship.home_team_id,
    homeSeed: teamSeeds.get(championship.home_team_id),
    homeScore: championship.home_score,
    awayTeam: getTeamWithSeed(championship.away_team_name, championship.away_team_id),
    awayTeamId: championship.away_team_id,
    awaySeed: teamSeeds.get(championship.away_team_id),
    awayScore: championship.away_score
  }] : [];

  // Filter out the placement games from consolation matchups
  const otherConsolationGames = consolationMatchups.filter(
    game => game !== fifthPlaceGame && game !== seventhPlaceGame && game !== ninthPlaceGame
  );

  // Create matchups for other consolation games
  const otherConsolationMatchups = otherConsolationGames.map(matchup => {
    const id = localCounter++;
    return {
      matchupId: id,
      homeTeam: getTeamWithSeed(matchup.home_team_name, matchup.home_team_id),
      homeTeamId: matchup.home_team_id,
      homeSeed: teamSeeds.get(matchup.home_team_id),
      homeScore: matchup.home_score,
      awayTeam: getTeamWithSeed(matchup.away_team_name, matchup.away_team_id),
      awayTeamId: matchup.away_team_id,
      awaySeed: teamSeeds.get(matchup.away_team_id),
      awayScore: matchup.away_score,
      isConsolation: true
    };
  });
  
  // Create matchups for placement games
  const placementMatchups = [];
  
  // 5th Place Game - Brian vs Marshall
  if (fifthPlaceGame) {
    placementMatchups.push({
      matchupId: localCounter++,
      title: "5th Place Game",
      homeTeam: getTeamWithSeed(fifthPlaceGame.home_team_name, fifthPlaceGame.home_team_id),
      homeTeamId: fifthPlaceGame.home_team_id,
      homeSeed: teamSeeds.get(fifthPlaceGame.home_team_id),
      homeScore: fifthPlaceGame.home_score,
      awayTeam: getTeamWithSeed(fifthPlaceGame.away_team_name, fifthPlaceGame.away_team_id),
      awayTeamId: fifthPlaceGame.away_team_id,
      awaySeed: teamSeeds.get(fifthPlaceGame.away_team_id),
      awayScore: fifthPlaceGame.away_score,
      isConsolation: true
    });
  }
  
  // 7th Place Game - Nate vs Aron
  if (seventhPlaceGame) {
    placementMatchups.push({
      matchupId: localCounter++,
      title: "7th Place Game",
      homeTeam: getTeamWithSeed(seventhPlaceGame.home_team_name, seventhPlaceGame.home_team_id),
      homeTeamId: seventhPlaceGame.home_team_id,
      homeSeed: teamSeeds.get(seventhPlaceGame.home_team_id),
      homeScore: seventhPlaceGame.home_score,
      awayTeam: getTeamWithSeed(seventhPlaceGame.away_team_name, seventhPlaceGame.away_team_id),
      awayTeamId: seventhPlaceGame.away_team_id,
      awaySeed: teamSeeds.get(seventhPlaceGame.away_team_id),
      awayScore: seventhPlaceGame.away_score,
      isConsolation: true
    });
  }
  
  // 9th Place Game (Toilet Bowl) - Thom vs Melissa
  if (ninthPlaceGame) {
    placementMatchups.push({
      matchupId: localCounter++,
      title: "9th Place Game (Toilet Bowl)",
      homeTeam: getTeamWithSeed(ninthPlaceGame.home_team_name, ninthPlaceGame.home_team_id),
      homeTeamId: ninthPlaceGame.home_team_id,
      homeSeed: teamSeeds.get(ninthPlaceGame.home_team_id),
      homeScore: ninthPlaceGame.home_score,
      awayTeam: getTeamWithSeed(ninthPlaceGame.away_team_name, ninthPlaceGame.away_team_id),
      awayTeamId: ninthPlaceGame.away_team_id,
      awaySeed: teamSeeds.get(ninthPlaceGame.away_team_id),
      awayScore: ninthPlaceGame.away_score,
      isConsolation: true
    });
  }

  // Update parent's counter
  React.useEffect(() => {
    onMatchupCounterUpdate(localCounter);
  }, [localCounter, onMatchupCounterUpdate]);

  return (
    <div className="space-y-6">
      <div className="space-y-12">
        <BracketSection
          title="Championship Game"
          matchups={championshipMatchup}
          editMode={editMode}
          onTeamSelect={onTeamSelect}
          onScoreUpdate={onScoreUpdate}
          teams={teams}
        />
      </div>

      {/* Full width divider with text */}
      <div className="w-full mt-12 mb-6">
        <div className="flex items-center justify-center">
          <div className="h-px bg-border flex-grow"></div>
          <span className="px-4 text-sm text-muted-foreground font-medium">Consolation Bracket</span>
          <div className="h-px bg-border flex-grow"></div>
        </div>
      </div>
      
      {/* Place games section */}
      {placementMatchups.length > 0 && placementMatchups.map((matchup, index) => (
        <BracketSection
          key={`placement-${index}`}
          title={matchup.title || "Placement Game"}
          matchups={[matchup]}
          editMode={editMode}
          onTeamSelect={onTeamSelect}
          onScoreUpdate={onScoreUpdate}
          teams={teams}
          className="mb-10"
        />
      ))}
      
      {/* Other consolation matchups */}
      {otherConsolationMatchups.length > 0 && (
        <BracketSection
          title="Consolation Matchups"
          matchups={otherConsolationMatchups}
          editMode={editMode}
          onTeamSelect={onTeamSelect}
          onScoreUpdate={onScoreUpdate}
          teams={teams}
          className="mb-10"
        />
      )}
    </div>
  );
};

export default Week16Matchups;
