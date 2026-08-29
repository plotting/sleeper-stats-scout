
import React, { useEffect } from "react";
import { MatchupScoresView, Team } from "@/types/database";
import Matchup from "./Matchup";

interface ToiletBowlRoundProps {
  toiletRoundMatchups: MatchupScoresView[];
  teamSeeds: Map<number, number>;
  matchupCounter: number;
  onMatchupCounterUpdate: (value: number) => void;
  editMode?: boolean;
  onTeamSelect?: (matchupId: number, isHome: boolean, teamId: number) => void;
  onScoreUpdate?: (matchupId: number, isHome: boolean, score: number) => void;
  teams?: Team[];
  title: string;
}

const ToiletBowlRound: React.FC<ToiletBowlRoundProps> = ({
  toiletRoundMatchups,
  teamSeeds,
  matchupCounter,
  onMatchupCounterUpdate,
  editMode = false,
  onTeamSelect,
  onScoreUpdate,
  teams = [],
  title
}) => {
  // Update parent counter when finished rendering
  useEffect(() => {
    if (toiletRoundMatchups.length > 0) {
      const newCounter = matchupCounter + toiletRoundMatchups.length;
      onMatchupCounterUpdate(newCounter);
    }
  }, [toiletRoundMatchups.length, matchupCounter, onMatchupCounterUpdate]);

  if (!toiletRoundMatchups || toiletRoundMatchups.length === 0) {
    return null;
  }

  return (
    <div className="space-y-12">
      {toiletRoundMatchups.map((matchup, index) => {
        // Determine title based on matchup
        const matchTitle = matchup.home_score !== null && matchup.away_score !== null && 
            (matchup.home_score > matchup.away_score ? matchup.home_team_id : matchup.away_team_id) ?
            "7th Place Game" :
            "9th Place Game (Toilet Bowl)";

        return (
          <div key={`toilet-round-${index}`} className="mx-auto w-[240px]">
            <div className="text-sm text-center text-muted-foreground mb-2">
              {matchTitle}
            </div>
            <Matchup
              matchupId={matchupCounter + index}
              homeTeam={matchup.home_team_id ? matchup.home_team_name : ""}
              homeTeamId={matchup.home_team_id}
              homeSeed={matchup.home_team_id ? teamSeeds.get(matchup.home_team_id) : undefined}
              homeScore={matchup.home_score}
              awayTeam={matchup.away_team_id ? matchup.away_team_name : ""}
              awayTeamId={matchup.away_team_id}
              awaySeed={matchup.away_team_id ? teamSeeds.get(matchup.away_team_id) : undefined}
              awayScore={matchup.away_score}
              isConsolation
              editMode={editMode}
              onTeamSelect={onTeamSelect}
              onScoreUpdate={onScoreUpdate}
              teams={teams}
            />
          </div>
        )
      })}
    </div>
  );
};

export default ToiletBowlRound;
