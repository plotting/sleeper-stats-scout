export const getSeasonYear = (season: string | number): number => {
  const startYear = 2013;
  return startYear + (Number(season) - 1);
};

export const getSeasonLabel = (season: string | number): string => {
  return `Season ${season} (${getSeasonYear(season)})`;
};

export const getAllSeasons = () => {
  return Array.from({ length: 14 }, (_, i) => ({
    value: (i + 1).toString(),
    label: getSeasonLabel(i + 1),
  }));
};