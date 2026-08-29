
import { MatchupScoresView } from "@/types/database";

const assignGame = (
  game: MatchupScoresView | undefined,
  placements: Map<number, number>,
  winnerPlace: number,
  loserPlace: number
) => {
  if (!game || game.home_score == null || game.away_score == null) return;
  const [wid, lid] =
    game.home_score >= game.away_score
      ? [game.home_team_id!, game.away_team_id!]
      : [game.away_team_id!, game.home_team_id!];
  if (wid) placements.set(wid, winnerPlace);
  if (lid) placements.set(lid, loserPlace);
};

/**
 * Calculate team final placements based on playoff results.
 *
 * @param playoffMatchups  All playoff-week matchups for the season (is_playoff=true).
 * @param bracketTeamIds   Optional set of team IDs that competed in the real playoff bracket
 *                         (top ceil(N/2) teams by regular-season record).  When provided,
 *                         bracket games are identified by both participants being in this set;
 *                         all other playoff-week games are treated as consolation games.
 *                         Without this param the function falls back to is_playoff/is_consolation
 *                         flags, which are unreliable in the DB.
 */
export const getTeamFinalPlacements = (
  playoffMatchups: MatchupScoresView[],
  bracketTeamIds?: Set<number>,
  teamSeeds?: Map<number, number>,
  seasonNumber?: number
): Map<number, number> => {
  if (!playoffMatchups || playoffMatchups.length === 0) return new Map();

  const teamPlacements = new Map<number, number>();

  const isBracket = (m: MatchupScoresView): boolean => {
    if (bracketTeamIds && bracketTeamIds.size > 0) {
      return (
        bracketTeamIds.has(m.home_team_id!) &&
        bracketTeamIds.has(m.away_team_id!)
      );
    }
    // Fallback: DB flags (unreliable — is_consolation is always false)
    return m.is_playoff === true && !m.is_consolation;
  };

  // ── Dynamic week detection ────────────────────────────────────────────────
  // Derive champWeek/semisWeek from actual game data rather than hardcoding.
  // This correctly handles seasons with 2-round (weeks 15-16) or 3-round
  // (weeks 15-16-17) brackets, and consolation brackets that may end earlier
  // than the main bracket (e.g. Season 13 consolation ends in week 16 while
  // the main bracket championship is in week 17).

  // True consolation games require BOTH teams outside the bracket. A game
  // between a bracket team (on a bye week) and a consolation team is a
  // dead/bye game, not a real consolation matchup — including it would let a
  // bracket team get mistakenly credited with a consolation placement.
  const isConsolationGame = (m: MatchupScoresView): boolean => {
    if (bracketTeamIds && bracketTeamIds.size > 0) {
      return !bracketTeamIds.has(m.home_team_id!) && !bracketTeamIds.has(m.away_team_id!);
    }
    return m.is_consolation === true;
  };

  const bracketGames    = playoffMatchups.filter(m => isBracket(m));
  const consolGames     = playoffMatchups.filter(m => isConsolationGame(m));

  const bracketWeeks = [...new Set(
    bracketGames.map(m => m.week_number!).filter((w): w is number => w != null)
  )].sort((a, b) => a - b);

  const consolWeeks = [...new Set(
    consolGames.map(m => m.week_number!).filter((w): w is number => w != null)
  )].sort((a, b) => a - b);

  // Championship week = last week with bracket games
  const champWeek     = bracketWeeks.length > 0 ? bracketWeeks[bracketWeeks.length - 1] : 17;
  // Semis week = second-to-last bracket week (or one before champ as fallback)
  const semisWeek     = bracketWeeks.length >= 2 ? bracketWeeks[bracketWeeks.length - 2] : champWeek - 1;

  // Consolation "championship" week = last week with consolation games
  const consolChampWeek = consolWeeks.length > 0 ? consolWeeks[consolWeeks.length - 1] : champWeek;
  // Consolation "semis" week = second-to-last consolation week
  const consolSemisWeek = consolWeeks.length >= 2 ? consolWeeks[consolWeeks.length - 2] : consolChampWeek - 1;

  const bracketSemisGames  = bracketGames.filter(m => m.week_number === semisWeek);
  const bracketFinalsGames = bracketGames.filter(m => m.week_number === champWeek);
  const consolSemisGames   = consolGames.filter(m => m.week_number === consolSemisWeek);
  const consolFinalsGames  = consolGames.filter(m => m.week_number === consolChampWeek);

  // ── Real bracket ──────────────────────────────────────────────────────────
  const bracketSemiWinners = new Set<number>();
  const bracketSemiLosers  = new Set<number>();
  for (const m of bracketSemisGames) {
    if (m.home_score == null || m.away_score == null) continue;
    const [wid, lid] =
      m.home_score >= m.away_score
        ? [m.home_team_id!, m.away_team_id!]
        : [m.away_team_id!, m.home_team_id!];
    if (wid) bracketSemiWinners.add(wid);
    if (lid) bracketSemiLosers.add(lid);
  }

  // Championship = finals game where both teams won their semi
  const championship =
    bracketFinalsGames.find(m =>
      bracketSemiWinners.has(m.home_team_id!) && bracketSemiWinners.has(m.away_team_id!)
    ) ?? bracketFinalsGames[0]; // fallback: first bracket final

  // 3rd-place game = finals game where both teams lost their semi
  const thirdPlace = bracketFinalsGames.find(m =>
    m !== championship && (
      bracketSemiLosers.has(m.home_team_id!) && bracketSemiLosers.has(m.away_team_id!)
    )
  );

  assignGame(championship, teamPlacements, 1, 2);
  assignGame(thirdPlace,   teamPlacements, 3, 4);

  // ── Consolation bracket ───────────────────────────────────────────────────
  const consolSemiWinners = new Set<number>();
  const consolSemiLosers  = new Set<number>();
  for (const m of consolSemisGames) {
    if (m.home_score == null || m.away_score == null) continue;
    const [wid, lid] =
      m.home_score >= m.away_score
        ? [m.home_team_id!, m.away_team_id!]
        : [m.away_team_id!, m.home_team_id!];
    if (wid) consolSemiWinners.add(wid);
    if (lid) consolSemiLosers.add(lid);
  }

  // 5th-place game: both teams won their consolation semi
  const fifthPlace = consolFinalsGames.find(
    m =>
      consolSemiWinners.has(m.home_team_id!) &&
      consolSemiWinners.has(m.away_team_id!)
  );

  // Toilet Bowl (9th-place game): both teams lost their consolation semi
  const ninthPlace = consolFinalsGames.find(
    m =>
      consolSemiLosers.has(m.home_team_id!) &&
      consolSemiLosers.has(m.away_team_id!)
  );

  // 7th-place game (and 11th for bigger leagues): whatever's left
  const otherConsolation = consolFinalsGames.filter(
    m => m !== fifthPlace && m !== ninthPlace
  );

  // Consolation positions start immediately after the bracket.
  // e.g. 4-bracket → consolation starts at 5th; 5-bracket → 6th; 6-bracket → 7th.
  const consolStart = bracketTeamIds && bracketTeamIds.size > 0
    ? bracketTeamIds.size + 1
    : 5;

  // Assign consolation finals positions sequentially so that:
  //   fifthPlace (consolation winners bracket) gets the best spots,
  //   then any middle games, then ninthPlace (consolation losers bracket) gets the worst.
  // Teams eliminated before the finals (play-in losers, round-1 consol losers) fill
  // the remaining gaps through the mop-up pass below.
  let consolPos = consolStart;
  if (fifthPlace) {
    assignGame(fifthPlace, teamPlacements, consolPos, consolPos + 1);
    consolPos += 2;
  }
  for (const g of otherConsolation) {
    assignGame(g, teamPlacements, consolPos, consolPos + 1);
    consolPos += 2;
  }
  if (ninthPlace) {
    assignGame(ninthPlace, teamPlacements, consolPos, consolPos + 1);
  }

  // ── Mop-up: assign placements to teams eliminated before finals ──────────
  // Covers play-in losers (bracket) and first-round consolation losers who
  // never appear in the final week's games.  Ordered by seed (lower = better).
  const allParticipants = new Set<number>();
  for (const m of playoffMatchups) {
    if (m.home_team_id) allParticipants.add(m.home_team_id);
    if (m.away_team_id) allParticipants.add(m.away_team_id);
  }

  const unplaced = [...allParticipants].filter(id => !teamPlacements.has(id));
  if (unplaced.length > 0) {
    // Sort by seed ascending (lower seed = better finish); fall back to team ID for stability
    unplaced.sort((a, b) => {
      const sa = teamSeeds?.get(a) ?? 999;
      const sb = teamSeeds?.get(b) ?? 999;
      return sa !== sb ? sa - sb : a - b;
    });

    // Find all consecutive empty placement slots (after the last assigned place)
    const usedPlaces = new Set(teamPlacements.values());
    let nextPlace = 1;
    for (const tid of unplaced) {
      while (usedPlaces.has(nextPlace)) nextPlace++;
      teamPlacements.set(tid, nextPlace);
      usedPlaces.add(nextPlace);
      nextPlace++;
    }
  }

  return teamPlacements;
};
