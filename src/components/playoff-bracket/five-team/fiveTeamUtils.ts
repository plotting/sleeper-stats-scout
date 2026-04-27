
import { MatchupScoresView } from "@/types/database";

/**
 * Filter playoff matchups (non-consolation)
 */
export const getPlayoffMatchups = (matchups: MatchupScoresView[]): MatchupScoresView[] => {
  return matchups.filter(
    (matchup) => matchup.is_playoff && !matchup.is_consolation
  );
};

/**
 * Get wildcard matchups (week 15) - excludes the 1-seed's game
 */
export const getWildcardGames = (
  playoffMatchups: MatchupScoresView[],
  teamSeeds: Map<number, number>,
): MatchupScoresView[] => {
  const seedOneId = [...teamSeeds.entries()].find(([, s]) => s === 1)?.[0];
  return playoffMatchups.filter(
    (m) =>
      m.week_number === 15 &&
      m.home_team_id !== seedOneId &&
      m.away_team_id !== seedOneId,
  );
};

/**
 * Get semifinal matchup with the 1 seed (week 15)
 */
export const getSeedOneSemifinal = (
  playoffMatchups: MatchupScoresView[],
  teamSeeds: Map<number, number>,
): MatchupScoresView | undefined => {
  const seedOneId = [...teamSeeds.entries()].find(([, s]) => s === 1)?.[0];
  return playoffMatchups.find(
    (m) =>
      m.week_number === 15 &&
      (m.home_team_id === seedOneId || m.away_team_id === seedOneId),
  );
};

/**
 * Get championship matchup (week 16)
 */
export const getChampionship = (playoffMatchups: MatchupScoresView[]): MatchupScoresView | undefined => {
  return playoffMatchups.find(
    (matchup) => matchup.week_number === 16
  );
};

/**
 * Get consolation matchups
 */
export const getConsolationMatchups = (matchups: MatchupScoresView[]): MatchupScoresView[] => {
  return matchups.filter(
    (matchup) => matchup.is_consolation
  );
};

/**
 * Get week 15 consolation matchups
 */
export const getWeekFifteenConsolation = (consolationMatchups: MatchupScoresView[]): MatchupScoresView[] => {
  return consolationMatchups.filter(
    (matchup) => matchup.week_number === 15
  );
};

/**
 * Get week 16 consolation matchups (3rd place and other games)
 */
export const getWeekSixteenConsolation = (consolationMatchups: MatchupScoresView[]): MatchupScoresView[] => {
  return consolationMatchups.filter(
    (matchup) => matchup.week_number === 16
  );
};

/**
 * Get winners from week 15 consolation matchups (loser advances format)
 */
export const getWeekFifteenConsolationWinners = (
  weekFifteenConsolation: MatchupScoresView[]
): number[] => {
  return weekFifteenConsolation
    .filter(m => m.home_score !== null && m.away_score !== null)
    .map(m => {
      // In "loser advances" format, we want the winners (who don't advance)
      return m.home_score! > m.away_score! ? m.home_team_id : m.away_team_id;
    })
    .filter((id): id is number => id !== null && id !== undefined);
};

/**
 * Get losers from week 15 consolation matchups (loser advances format)
 */
export const getWeekFifteenConsolationLosers = (
  weekFifteenConsolation: MatchupScoresView[]
): number[] => {
  return weekFifteenConsolation
    .filter(m => m.home_score !== null && m.away_score !== null)
    .map(m => {
      // In "loser advances" format, we want the losers (who advance)
      return m.home_score! > m.away_score! ? m.away_team_id : m.home_team_id;
    })
    .filter((id): id is number => id !== null && id !== undefined);
};

/**
 * Identify specific placement games in week 16
 */
export const identifyPlacementGames = (
  weekSixteenConsolation: MatchupScoresView[],
  weekFifteenLosers: number[]
): { 
  seventhPlaceGame?: MatchupScoresView,
  ninthPlaceGame?: MatchupScoresView,
  fifthPlaceGame?: MatchupScoresView,
} => {
  // 5th place game: Brian vs Marshall
  const fifthPlaceGame = weekSixteenConsolation.find(
    matchup => 
      (matchup.home_team_name?.includes("Brian") && matchup.away_team_name?.includes("Marshall")) ||
      (matchup.away_team_name?.includes("Brian") && matchup.home_team_name?.includes("Marshall"))
  );
  
  // 7th place game: Nate vs Aron
  const seventhPlaceGame = weekSixteenConsolation.find(
    matchup => 
      (matchup.home_team_name?.includes("Nate") && matchup.away_team_name?.includes("Aron")) ||
      (matchup.away_team_name?.includes("Nate") && matchup.home_team_name?.includes("Aron"))
  );
  
  // 9th place game/toilet bowl: Thom vs Melissa
  const ninthPlaceGame = weekSixteenConsolation.find(
    matchup => 
      (matchup.home_team_name?.includes("Thom") && matchup.away_team_name?.includes("Melissa")) ||
      (matchup.away_team_name?.includes("Thom") && matchup.home_team_name?.includes("Melissa"))
  );

  return { fifthPlaceGame, seventhPlaceGame, ninthPlaceGame };
};
