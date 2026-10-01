// The league began in FIRST_SEASON_YEAR; there is no earlier data.
// Bump CURRENT_SEASON_YEAR each new season — everything else derives from these.
export const FIRST_SEASON_YEAR = 2013;
export const CURRENT_SEASON_YEAR = 2026;
export const CURRENT_SEASON_NUMBER = CURRENT_SEASON_YEAR - FIRST_SEASON_YEAR + 1;
export const SEASON_COUNT = CURRENT_SEASON_NUMBER;
// The first season's draft was the startup draft (veterans, not rookies), so
// rookie draft grades begin the following year.
export const FIRST_ROOKIE_DRAFT_YEAR = FIRST_SEASON_YEAR + 1;

export const getSeasonYear = (season: string | number): number => {
  return FIRST_SEASON_YEAR + (Number(season) - 1);
};

export const getSeasonLabel = (season: string | number): string => {
  return `Season ${season} (${getSeasonYear(season)})`;
};

export const getAllSeasons = () => {
  return Array.from({ length: SEASON_COUNT }, (_, i) => ({
    value: (i + 1).toString(),
    label: getSeasonLabel(i + 1),
  }));
};
