
import { MatchupScoresView } from "@/types/database";

/**
 * Filter to games where both teams are in the playoff bracket (seed ≤ 5).
 * Falls back to is_playoff flag when no seeds provided.
 */
export const getPlayoffMatchups = (
  matchups: MatchupScoresView[],
  playoffTeamIds?: Set<number>
): MatchupScoresView[] => {
  if (playoffTeamIds && playoffTeamIds.size > 0) {
    return matchups.filter(
      m => playoffTeamIds.has(m.home_team_id!) && playoffTeamIds.has(m.away_team_id!)
    );
  }
  return matchups.filter(m => m.is_playoff && !m.is_consolation);
};

/**
 * Get wildcard matchups (week 15) — excludes any game the 1-seed is in.
 */
export const getWildcardGames = (
  playoffMatchups: MatchupScoresView[],
  teamSeeds: Map<number, number>,
): MatchupScoresView[] => {
  const seedOneId = [...teamSeeds.entries()].find(([, s]) => s === 1)?.[0];
  return playoffMatchups.filter(
    m =>
      m.week_number === 15 &&
      m.home_team_id !== seedOneId &&
      m.away_team_id !== seedOneId,
  );
};

/**
 * Get the 1-seed's week-15 game (may be vs a consolation opponent as a filler).
 */
export const getSeedOneSemifinal = (
  playoffMatchups: MatchupScoresView[],
  teamSeeds: Map<number, number>,
): MatchupScoresView | undefined => {
  const seedOneId = [...teamSeeds.entries()].find(([, s]) => s === 1)?.[0];
  return playoffMatchups.find(
    m =>
      m.week_number === 15 &&
      (m.home_team_id === seedOneId || m.away_team_id === seedOneId),
  );
};

/**
 * Get championship matchup (week 16).
 * When there are multiple week-16 playoff games (e.g. championship + 3rd place),
 * identifies the championship as the game between two week-15 bracket winners.
 */
export const getChampionship = (
  playoffMatchups: MatchupScoresView[]
): MatchupScoresView | undefined => {
  const week16Games = playoffMatchups.filter(m => m.week_number === 16);
  if (week16Games.length <= 1) return week16Games[0];

  // Multiple games — find the one between two week-15 winners
  const week15Winners = new Set<number>(
    playoffMatchups
      .filter(m => m.week_number === 15 && m.home_score != null && m.away_score != null)
      .map(m => m.home_score! >= m.away_score! ? m.home_team_id! : m.away_team_id!)
      .filter((id): id is number => id != null)
  );

  return (
    week16Games.find(
      m => week15Winners.has(m.home_team_id!) && week15Winners.has(m.away_team_id!)
    ) ?? week16Games[0]
  );
};

/**
 * Get consolation matchups (games where neither team is a bracket seed).
 */
export const getConsolationMatchups = (matchups: MatchupScoresView[]): MatchupScoresView[] => {
  return matchups.filter(m => m.is_consolation);
};

/**
 * Get week-15 consolation matchups.
 * Input is already pre-filtered to consolation games; just filter by week.
 */
export const getWeekFifteenConsolation = (consolationMatchups: MatchupScoresView[]): MatchupScoresView[] => {
  return consolationMatchups.filter(m => m.week_number === 15);
};

/**
 * Get week-16 consolation matchups.
 */
export const getWeekSixteenConsolation = (consolationMatchups: MatchupScoresView[]): MatchupScoresView[] => {
  return consolationMatchups.filter(m => m.week_number === 16);
};

/**
 * Get winners from a list of consolation matchups.
 */
export const getConsolationWinners = (matchups: MatchupScoresView[]): number[] =>
  matchups
    .filter(m => m.home_score != null && m.away_score != null)
    .map(m => (m.home_score! >= m.away_score! ? m.home_team_id : m.away_team_id))
    .filter((id): id is number => id != null);

/**
 * Get losers from a list of consolation matchups.
 */
export const getConsolationLosers = (matchups: MatchupScoresView[]): number[] =>
  matchups
    .filter(m => m.home_score != null && m.away_score != null)
    .map(m => (m.home_score! >= m.away_score! ? m.away_team_id : m.home_team_id))
    .filter((id): id is number => id != null);

// Legacy aliases used by Week16Matchups
export const getWeekFifteenConsolationWinners = getConsolationWinners;
export const getWeekFifteenConsolationLosers  = getConsolationLosers;

/**
 * Identify 5th / 7th / 9th place games from week-16 consolation matchups.
 * Uses week-15 consolation winners/losers rather than hardcoded team names.
 */
export const identifyPlacementGames = (
  weekSixteenConsolation: MatchupScoresView[],
  weekFifteenLosers: number[],   // kept for back-compat; not used for logic
  weekFifteenWinners?: number[],
): {
  fifthPlaceGame?: MatchupScoresView;
  seventhPlaceGame?: MatchupScoresView;
  ninthPlaceGame?: MatchupScoresView;
} => {
  const winners = new Set(weekFifteenWinners ?? []);
  const losers  = new Set(weekFifteenLosers);

  // 5th place: both teams won their week-15 consolation game
  const fifthPlaceGame = weekSixteenConsolation.find(
    m => winners.size > 0 && winners.has(m.home_team_id!) && winners.has(m.away_team_id!)
  );

  // 9th place (toilet bowl): both teams lost their week-15 consolation game
  const ninthPlaceGame = weekSixteenConsolation.find(
    m => losers.size > 0 && losers.has(m.home_team_id!) && losers.has(m.away_team_id!)
  );

  // 7th place: the remaining game
  const seventhPlaceGame = weekSixteenConsolation.find(
    m => m !== fifthPlaceGame && m !== ninthPlaceGame
  );

  return { fifthPlaceGame, seventhPlaceGame, ninthPlaceGame };
};
