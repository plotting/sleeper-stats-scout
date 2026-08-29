
/**
 * Utility functions for determining playoff weeks based on season
 */

/**
 * Get playoff week numbers based on season
 */
export const getPlayoffWeeks = (seasonNumber: number) => {
  // Determine playoff weeks based on season
  // For seasons 11-12, playoffs start in week 15 (not 16)
  const playoffStartWeek = (seasonNumber >= 11 && seasonNumber <= 12) ? 15 : 
                           seasonNumber >= 13 ? 16 : 15;
  const champWeek = (seasonNumber >= 11 && seasonNumber <= 12) ? 17 : 
                    seasonNumber >= 13 ? 17 : 16;
  const finalWeek = champWeek + 1; // Final week is typically one week after championship
  
  // Build the unique list of weeks to show in the bracket header
  const displayWeeksSet = new Set([playoffStartWeek, playoffStartWeek + 1, champWeek, finalWeek]);
  // Only include finalWeek when it's actually used (seasons 8-10 have week-17 consolation finals)
  const useFinalWeek = seasonNumber >= 8 && seasonNumber <= 10;
  const displayWeeks = useFinalWeek
    ? [playoffStartWeek, champWeek, finalWeek]
    : [...new Set([playoffStartWeek, playoffStartWeek + 1, champWeek])];

  return {
    playoffStartWeek,
    champWeek,
    finalWeek,
    displayWeeks,
    // Loser-advances consolation format was only used in seasons 8-10
    isLoserAdvancesFormat: seasonNumber >= 8 && seasonNumber <= 10
  };
};
