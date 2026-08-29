
import React, { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type { Team } from "@/types/database";
import { cn } from "@/lib/utils";

interface MatchupProps {
  homeTeam?: string;
  homeTeamId?: number;
  homeSeed?: number;
  homeScore?: number | null;
  awayTeam?: string;
  awayTeamId?: number;
  awaySeed?: number;
  awayScore?: number | null;
  matchupId?: number;
  isConsolation?: boolean;
  editMode?: boolean;
  onTeamSelect?: (matchupId: number, isHome: boolean, teamId: number) => void;
  onScoreUpdate?: (matchupId: number, isHome: boolean, score: number) => void;
  teams?: Team[];
}

const Matchup: React.FC<MatchupProps> = ({
  homeTeam = "",
  homeTeamId,
  homeSeed,
  homeScore,
  awayTeam = "",
  awayTeamId,
  awaySeed,
  awayScore,
  matchupId = 0,
  isConsolation = false,
  editMode = false,
  onTeamSelect,
  onScoreUpdate,
  teams = [],
}) => {
  const [tempHomeScore, setTempHomeScore] = useState(homeScore?.toString() || "");
  const [tempAwayScore, setTempAwayScore] = useState(awayScore?.toString() || "");

  const handleHomeScoreChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTempHomeScore(e.target.value);
    const score = parseFloat(e.target.value);
    if (!isNaN(score) && onScoreUpdate) {
      onScoreUpdate(matchupId, true, score);
    }
  };

  const handleAwayScoreChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTempAwayScore(e.target.value);
    const score = parseFloat(e.target.value);
    if (!isNaN(score) && onScoreUpdate) {
      onScoreUpdate(matchupId, false, score);
    }
  };

  const handleHomeTeamSelect = (value: string) => {
    if (onTeamSelect) {
      onTeamSelect(matchupId, true, parseInt(value));
    }
  };

  const handleAwayTeamSelect = (value: string) => {
    if (onTeamSelect) {
      onTeamSelect(matchupId, false, parseInt(value));
    }
  };

  return (
    <div 
      className={cn(
        "border rounded-lg p-3 shadow-sm", 
        isConsolation 
          ? "border-yellow-500 bg-yellow-50/80 dark:bg-yellow-900/30 dark:border-yellow-600" 
          : "border-primary/20 bg-card"
      )}
    >
      <div className="flex justify-between items-center mb-2 gap-2">
        {editMode ? (
          <div className="flex-1">
            <Select value={homeTeamId?.toString() || ""} onValueChange={handleHomeTeamSelect}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select Team" />
              </SelectTrigger>
              <SelectContent>
                {teams.map((team) => (
                  <SelectItem key={`home-${team.id}`} value={team.id.toString()}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className={cn("font-medium text-sm truncate", isConsolation ? "text-yellow-900 dark:text-yellow-200" : "")}>
            {homeSeed !== undefined && (
              <span className="text-muted-foreground font-normal mr-1">({homeSeed})</span>
            )}
            {homeTeam || "TBD"}
          </div>
        )}
        
        {editMode ? (
          <Input
            type="number"
            className="w-16 h-8 text-sm"
            value={tempHomeScore}
            onChange={handleHomeScoreChange}
            placeholder="Score"
          />
        ) : (
          <div className={cn("text-sm font-semibold", isConsolation ? "text-yellow-900 dark:text-yellow-200" : "")}>
            {homeScore !== null ? homeScore.toFixed(2) : "-"}
          </div>
        )}
      </div>
      
      <div className="flex justify-between items-center gap-2">
        {editMode ? (
          <div className="flex-1">
            <Select value={awayTeamId?.toString() || ""} onValueChange={handleAwayTeamSelect}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select Team" />
              </SelectTrigger>
              <SelectContent>
                {teams.map((team) => (
                  <SelectItem key={`away-${team.id}`} value={team.id.toString()}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className={cn("font-medium text-sm truncate", isConsolation ? "text-yellow-900 dark:text-yellow-200" : "")}>
            {awaySeed !== undefined && (
              <span className="text-muted-foreground font-normal mr-1">({awaySeed})</span>
            )}
            {awayTeam || "TBD"}
          </div>
        )}
        
        {editMode ? (
          <Input
            type="number"
            className="w-16 h-8 text-sm"
            value={tempAwayScore}
            onChange={handleAwayScoreChange}
            placeholder="Score"
          />
        ) : (
          <div className={cn("text-sm font-semibold", isConsolation ? "text-yellow-900 dark:text-yellow-200" : "")}>
            {awayScore !== null ? awayScore.toFixed(2) : "-"}
          </div>
        )}
      </div>
    </div>
  );
};

export default Matchup;
