
import { MatchupScoresView } from "@/types/database";

/**
 * Filter playoff matchups.
 * When bracketTeamIds is provided, only returns games where BOTH teams are in the bracket.
 * Falls back to is_playoff flag if no bracketTeamIds given.
 */
export const filterPlayoffMatchups = (
  matchups: MatchupScoresView[],
  bracketTeamIds?: Set<number>
): MatchupScoresView[] => {
  if (bracketTeamIds && bracketTeamIds.size > 0) {
    return matchups.filter(
      m => bracketTeamIds.has(m.home_team_id!) && bracketTeamIds.has(m.away_team_id!)
    );
  }
  return matchups.filter(m => m.is_playoff && !m.is_consolation);
};

/**
 * Filter semifinal matchups by week
 */
export const getSemiFinals = (
  playoffMatchups: MatchupScoresView[],
  playoffStartWeek: number
): MatchupScoresView[] => {
  return playoffMatchups.filter(m => m.week_number === playoffStartWeek);
};

/**
 * Sort semifinal matchups by seed (top seed first)
 */
export const sortSemiFinalsBySeeds = (
  semiFinals: MatchupScoresView[],
  teamSeeds: Map<number, number>
): MatchupScoresView[] => {
  return [...semiFinals].sort((a, b) => {
    const aBest = Math.min(teamSeeds.get(a.home_team_id || 0) ?? 999, teamSeeds.get(a.away_team_id || 0) ?? 999);
    const bBest = Math.min(teamSeeds.get(b.home_team_id || 0) ?? 999, teamSeeds.get(b.away_team_id || 0) ?? 999);
    return aBest - bBest;
  });
};

/**
 * Get championship matchup.
 * When semiFinalWinners is provided, finds the game between those two teams.
 * Falls back to first is_playoff game in champWeek.
 */
export const getChampionship = (
  playoffMatchups: MatchupScoresView[],
  champWeek: number,
  semiFinalWinners?: Set<number>
): MatchupScoresView | undefined => {
  const weekGames = playoffMatchups.filter(m => m.week_number === champWeek);
  if (semiFinalWinners && semiFinalWinners.size >= 2) {
    return weekGames.find(
      m => semiFinalWinners.has(m.home_team_id!) && semiFinalWinners.has(m.away_team_id!)
    );
  }
  return weekGames.find(m => !m.is_consolation) ?? weekGames[0];
};

/**
 * Get consolation matchups for a specific week.
 * When bracketTeamIds is provided, returns games where at least one team is NOT in the bracket.
 * Falls back to is_consolation flag.
 */
export const getConsolationMatchups = (
  matchups: MatchupScoresView[],
  week: number,
  bracketTeamIds?: Set<number>
): MatchupScoresView[] => {
  const weekGames = matchups.filter(m => m.week_number === week);
  if (bracketTeamIds && bracketTeamIds.size > 0) {
    // Require BOTH teams to be outside the bracket (not just one)
    return weekGames.filter(
      m => !bracketTeamIds.has(m.home_team_id!) && !bracketTeamIds.has(m.away_team_id!)
    );
  }
  return weekGames.filter(m => m.is_consolation);
};
