
import React, { useState } from "react";
import type { MatchupScoresView, Team } from "@/types/database";
import WeekLabels from "./WeekLabels";
import Week15Matchups from "./five-team/Week15Matchups";
import Week16Matchups from "./five-team/Week16Matchups";
import {
  getWildcardGames,
  getSeedOneSemifinal,
  getChampionship,
  getWeekFifteenConsolation,
  getWeekSixteenConsolation,
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
  teamSeeds = new Map()
}) => {
  // State to track matchup counter across components
  const [matchupCounter, setMatchupCounter] = useState(0);
  
  // Partition using seed-based logic so is_consolation flag in DB isn't required.
  // Any matchup where at least one team has a top-5 seed is a playoff game;
  // matchups where both teams have seed > 5 are consolation.
  const playoffTeamIds = new Set(
    [...teamSeeds.entries()].filter(([, s]) => s <= 5).map(([id]) => id),
  );
  const isPlayoffGame = (m: MatchupScoresView) =>
    (m.is_playoff || m.is_consolation) &&
    (playoffTeamIds.size === 0 ||
      (m.home_team_id != null && playoffTeamIds.has(m.home_team_id)) ||
      (m.away_team_id != null && playoffTeamIds.has(m.away_team_id)));
  const isConsolationGame = (m: MatchupScoresView) =>
    (m.is_playoff || m.is_consolation) && !isPlayoffGame(m);

  const playoffMatchups = matchups.filter(isPlayoffGame);
  const consolationMatchups = matchups.filter(isConsolationGame);

  const wildcardGames = getWildcardGames(playoffMatchups, teamSeeds);
  const seedOneSemifinal = getSeedOneSemifinal(playoffMatchups, teamSeeds);
  const championship = getChampionship(playoffMatchups);

  const weekFifteenConsolation = getWeekFifteenConsolation(consolationMatchups);
  const weekSixteenConsolation = getWeekSixteenConsolation(consolationMatchups);

  return (
    <div className="overflow-auto">
      <div className="flex flex-col min-w-[800px]">
        <WeekLabels weeks={[15, 16]} />
        
        <div className="grid grid-cols-2 gap-8">
          {/* Week 15 Column */}
          <Week15Matchups
            wildcardGames={wildcardGames}
            seedOneSemifinal={seedOneSemifinal}
            weekFifteenConsolation={weekFifteenConsolation}
            editMode={editMode}
            onTeamSelect={onTeamSelect}
            onScoreUpdate={onScoreUpdate}
            teams={teams}
            teamSeeds={teamSeeds}
            matchupCounter={matchupCounter}
            onMatchupCounterUpdate={(counter) => setMatchupCounter(counter)}
          />
          
          {/* Week 16 Column */}
          <Week16Matchups
            championship={championship}
            consolationMatchups={weekSixteenConsolation}
            weekFifteenConsolation={weekFifteenConsolation}
            editMode={editMode}
            onTeamSelect={onTeamSelect}
            onScoreUpdate={onScoreUpdate}
            teams={teams}
            teamSeeds={teamSeeds}
            matchupCounter={matchupCounter}
            onMatchupCounterUpdate={(counter) => setMatchupCounter(counter)}
          />
        </div>
      </div>
    </div>
  );
};

export default FiveTeamPlayoffs;
