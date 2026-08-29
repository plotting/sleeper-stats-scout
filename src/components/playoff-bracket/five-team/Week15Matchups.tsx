
import React from "react";
import { MatchupScoresView } from "@/types/database";
import BracketSection from "../BracketSection";
import type { Team } from "@/types/database";
import { Separator } from "@/components/ui/separator";

interface Week15MatchupsProps {
  wildcardGames: MatchupScoresView[];
  seedOneSemifinal?: MatchupScoresView;
  weekFifteenConsolation: MatchupScoresView[];
  editMode?: boolean;
  onTeamSelect?: (matchupId: number, isHome: boolean, teamId: number) => void;
  onScoreUpdate?: (matchupId: number, isHome: boolean, score: number) => void;
  teams?: Team[];
  teamSeeds: Map<number, number>;
  matchupCounter: number;
  onMatchupCounterUpdate: (newCounter: number) => void;
}

const Week15Matchups: React.FC<Week15MatchupsProps> = ({
  wildcardGames,
  seedOneSemifinal,
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

  // Create matchup objects for wildcard games
  const wildcardMatchups = wildcardGames.map(matchup => {
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
      awayScore: matchup.away_score
    };
  });

  // Create matchup for seed one semifinal
  const seedOneMatchup = seedOneSemifinal ? [{
    matchupId: localCounter++,
    homeTeam: getTeamWithSeed(seedOneSemifinal.home_team_name, seedOneSemifinal.home_team_id),
    homeTeamId: seedOneSemifinal.home_team_id,
    homeSeed: teamSeeds.get(seedOneSemifinal.home_team_id),
    homeScore: seedOneSemifinal.home_score,
    awayTeam: getTeamWithSeed(seedOneSemifinal.away_team_name, seedOneSemifinal.away_team_id),
    awayTeamId: seedOneSemifinal.away_team_id,
    awaySeed: teamSeeds.get(seedOneSemifinal.away_team_id),
    awayScore: seedOneSemifinal.away_score
  }] : [];

  // Create matchup objects for consolation games
  const consolationMatchups = weekFifteenConsolation.map(matchup => {
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

  // Update parent's counter
  React.useEffect(() => {
    onMatchupCounterUpdate(localCounter);
  }, [localCounter, onMatchupCounterUpdate]);

  return (
    <div className="space-y-6">
      <div className="space-y-12">
        <BracketSection
          title="Wildcard Games"
          matchups={wildcardMatchups}
          editMode={editMode}
          onTeamSelect={onTeamSelect}
          onScoreUpdate={onScoreUpdate}
          teams={teams}
        />

        {seedOneMatchup.length > 0 && (
          <BracketSection
            title="1 Seed Semifinal"
            matchups={seedOneMatchup}
            editMode={editMode}
            onTeamSelect={onTeamSelect}
            onScoreUpdate={onScoreUpdate}
            teams={teams}
          />
        )}
      </div>

      {/* Full width divider with text */}
      <div className="w-full mt-12 mb-6">
        <div className="flex items-center justify-center">
          <div className="h-px bg-border flex-grow"></div>
          <span className="px-4 text-sm text-muted-foreground font-medium">Consolation Bracket (Loser Advances)</span>
          <div className="h-px bg-border flex-grow"></div>
        </div>
      </div>
      
      <BracketSection
        title="Consolation Round"
        subtitle="Losers advance to next round"
        matchups={consolationMatchups}
        editMode={editMode}
        onTeamSelect={onTeamSelect}
        onScoreUpdate={onScoreUpdate}
        teams={teams}
      />
    </div>
  );
};

export default Week15Matchups;
