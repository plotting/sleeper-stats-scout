
import React, { useEffect } from "react";
import { MatchupScoresView, Team } from "@/types/database";
import Matchup from "./Matchup";

interface FinalPlacementGamesProps {
  thirdPlaceGame?: MatchupScoresView;
  seventhPlaceGame?: MatchupScoresView;
  ninthPlaceGame?: MatchupScoresView;
  teamSeeds: Map<number, number>;
  matchupCounter: number;
  onMatchupCounterUpdate: (value: number) => void;
  editMode?: boolean;
  onTeamSelect?: (matchupId: number, isHome: boolean, teamId: number) => void;
  onScoreUpdate?: (matchupId: number, isHome: boolean, score: number) => void;
  teams?: Team[];
  ninthPlaceTitle: string;
}

const FinalPlacementGames: React.FC<FinalPlacementGamesProps> = ({
  thirdPlaceGame,
  seventhPlaceGame,
  ninthPlaceGame,
  teamSeeds,
  matchupCounter,
  onMatchupCounterUpdate,
  editMode = false,
  onTeamSelect,
  onScoreUpdate,
  teams = [],
  ninthPlaceTitle
}) => {
  // Count how many games we'll show
  let gamesToShow = 0;
  if (thirdPlaceGame) gamesToShow++;
  if (seventhPlaceGame) gamesToShow++;
  if (ninthPlaceGame) gamesToShow++;
  
  // Format team name (seed is rendered separately via homeSeed/awaySeed props)
  const formatTeamWithSeed = (teamId: number | null, teamName: string | null) => {
    if (!teamId || !teamName) return "";
    return teamName;
  };

  // Update parent counter using a stable dependency array
  useEffect(() => {
    if (gamesToShow > 0) {
      onMatchupCounterUpdate(matchupCounter + gamesToShow);
    }
  }, [
    !!thirdPlaceGame, 
    !!seventhPlaceGame, 
    !!ninthPlaceGame, 
    matchupCounter, 
    onMatchupCounterUpdate
  ]);

  // Use a pre-calculated array of matchup IDs instead of incrementing a variable during render
  const matchupIds = React.useMemo(() => {
    let nextId = matchupCounter;
    const ids = [];
    if (thirdPlaceGame) ids.push(nextId++);
    if (seventhPlaceGame) ids.push(nextId++);
    if (ninthPlaceGame) ids.push(nextId++);
    return ids;
  }, [matchupCounter, thirdPlaceGame, seventhPlaceGame, ninthPlaceGame]);

  return (
    <div className="space-y-12">
      <h3 className="text-lg font-semibold mb-6 text-center">Final Placement Games</h3>
      {thirdPlaceGame && (
        <div className="mx-auto w-[240px]">
          <div className="text-sm text-center font-medium mb-2">
            3rd Place Game
          </div>
          <Matchup
            matchupId={matchupIds[0]}
            homeTeam={formatTeamWithSeed(thirdPlaceGame.home_team_id, thirdPlaceGame.home_team_name)}
            homeTeamId={thirdPlaceGame.home_team_id}
            homeSeed={thirdPlaceGame.home_team_id ? teamSeeds.get(thirdPlaceGame.home_team_id) : undefined}
            homeScore={thirdPlaceGame.home_score}
            awayTeam={formatTeamWithSeed(thirdPlaceGame.away_team_id, thirdPlaceGame.away_team_name)}
            awayTeamId={thirdPlaceGame.away_team_id}
            awaySeed={thirdPlaceGame.away_team_id ? teamSeeds.get(thirdPlaceGame.away_team_id) : undefined}
            awayScore={thirdPlaceGame.away_score}
            editMode={editMode}
            onTeamSelect={onTeamSelect}
            onScoreUpdate={onScoreUpdate}
            teams={teams}
          />
        </div>
      )}
      
      {seventhPlaceGame && (
        <div className="mx-auto w-[240px]">
          <div className="text-sm text-center font-medium mb-2">
            7th Place Game
          </div>
          <Matchup
            matchupId={matchupIds[thirdPlaceGame ? 1 : 0]}
            homeTeam={formatTeamWithSeed(seventhPlaceGame.home_team_id, seventhPlaceGame.home_team_name)}
            homeTeamId={seventhPlaceGame.home_team_id}
            homeSeed={seventhPlaceGame.home_team_id ? teamSeeds.get(seventhPlaceGame.home_team_id) : undefined}
            homeScore={seventhPlaceGame.home_score}
            awayTeam={formatTeamWithSeed(seventhPlaceGame.away_team_id, seventhPlaceGame.away_team_name)}
            awayTeamId={seventhPlaceGame.away_team_id}
            awaySeed={seventhPlaceGame.away_team_id ? teamSeeds.get(seventhPlaceGame.away_team_id) : undefined}
            awayScore={seventhPlaceGame.away_score}
            isConsolation
            editMode={editMode}
            onTeamSelect={onTeamSelect}
            onScoreUpdate={onScoreUpdate}
            teams={teams}
          />
        </div>
      )}
      
      {ninthPlaceGame && (
        <div className="mx-auto w-[240px]">
          <div className="text-sm text-center font-medium mb-2">
            {ninthPlaceTitle}
          </div>
          <Matchup
            matchupId={matchupIds[thirdPlaceGame && seventhPlaceGame ? 2 : (thirdPlaceGame || seventhPlaceGame ? 1 : 0)]}
            homeTeam={formatTeamWithSeed(ninthPlaceGame.home_team_id, ninthPlaceGame.home_team_name)}
            homeTeamId={ninthPlaceGame.home_team_id}
            homeSeed={ninthPlaceGame.home_team_id ? teamSeeds.get(ninthPlaceGame.home_team_id) : undefined}
            homeScore={ninthPlaceGame.home_score}
            awayTeam={formatTeamWithSeed(ninthPlaceGame.away_team_id, ninthPlaceGame.away_team_name)}
            awayTeamId={ninthPlaceGame.away_team_id}
            awaySeed={ninthPlaceGame.away_team_id ? teamSeeds.get(ninthPlaceGame.away_team_id) : undefined}
            awayScore={ninthPlaceGame.away_score}
            isConsolation
            editMode={editMode}
            onTeamSelect={onTeamSelect}
            onScoreUpdate={onScoreUpdate}
            teams={teams}
          />
        </div>
      )}
    </div>
  );
};

export default FinalPlacementGames;
