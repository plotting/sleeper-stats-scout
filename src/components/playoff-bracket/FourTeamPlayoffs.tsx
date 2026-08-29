
import React from "react";
import { MatchupScoresView } from "@/types/database";
import WeekLabels from "./WeekLabels";
import BracketSection from "./BracketSection";
import type { Team } from "@/types/database";

interface FourTeamPlayoffsProps {
  matchups: MatchupScoresView[];
  editMode?: boolean;
  onTeamSelect?: (matchupId: number, isHome: boolean, teamId: number) => void;
  onScoreUpdate?: (matchupId: number, isHome: boolean, score: number) => void;
  teams?: Team[];
  teamSeeds?: Map<number, number>;
}

const FourTeamPlayoffs: React.FC<FourTeamPlayoffsProps> = ({
  matchups,
  editMode = false,
  onTeamSelect,
  onScoreUpdate,
  teams = [],
  teamSeeds = new Map(),
}) => {
  // ── Determine which teams are in the real 4-team bracket ─────────────────
  // Use seeds 1-4 from teamSeeds.  If seeds aren't available yet, fall back to
  // treating all is_playoff games as bracket games (old behaviour).
  const bracketTeamIds: Set<number> = teamSeeds.size > 0
    ? new Set(
        [...teamSeeds.entries()]
          .filter(([, seed]) => seed <= 4)
          .map(([id]) => id)
      )
    : new Set();

  const isBracketGame = (m: MatchupScoresView): boolean =>
    bracketTeamIds.size > 0
      ? bracketTeamIds.has(m.home_team_id!) && bracketTeamIds.has(m.away_team_id!)
      : (m.is_playoff === true && !m.is_consolation);

  // ── Split week-15 games ───────────────────────────────────────────────────
  const allWeek15 = matchups.filter(m => m.week_number === 15);
  const bracketSemis       = allWeek15.filter(m => isBracketGame(m));
  const consolationWeek15  = allWeek15.filter(m => !isBracketGame(m));

  // ── Identify bracket semi winners / losers ────────────────────────────────
  const bracketSemiWinners = new Set<number>();
  const bracketSemiLosers  = new Set<number>();
  for (const m of bracketSemis) {
    if (m.home_score == null || m.away_score == null) continue;
    const [wid, lid] =
      m.home_score >= m.away_score
        ? [m.home_team_id!, m.away_team_id!]
        : [m.away_team_id!, m.home_team_id!];
    if (wid) bracketSemiWinners.add(wid);
    if (lid) bracketSemiLosers.add(lid);
  }

  // ── Split week-16 games ───────────────────────────────────────────────────
  const allWeek16 = matchups.filter(m => m.week_number === 16);

  // Championship = week-16 game where BOTH teams won their semi
  const championship = allWeek16.find(
    m =>
      bracketSemiWinners.has(m.home_team_id!) &&
      bracketSemiWinners.has(m.away_team_id!)
  );

  // 3rd-place game = week-16 game where BOTH teams lost their semi
  const thirdPlaceGame = allWeek16.find(
    m =>
      bracketSemiLosers.has(m.home_team_id!) &&
      bracketSemiLosers.has(m.away_team_id!)
  );

  // Consolation week 16 = everything else
  const consolationWeek16 = allWeek16.filter(
    m => m !== championship && m !== thirdPlaceGame
  );

  // ── Consolation ordering: identify 5th / 7th / 9th place games ───────────
  const consolationSemiWinners = new Set<number>();
  const consolationSemiLosers  = new Set<number>();
  for (const m of consolationWeek15) {
    if (m.home_score == null || m.away_score == null) continue;
    const [wid, lid] =
      m.home_score >= m.away_score
        ? [m.home_team_id!, m.away_team_id!]
        : [m.away_team_id!, m.home_team_id!];
    if (wid) consolationSemiWinners.add(wid);
    if (lid) consolationSemiLosers.add(lid);
  }

  const fifthPlaceGame = consolationWeek16.find(
    m =>
      consolationSemiWinners.has(m.home_team_id!) &&
      consolationSemiWinners.has(m.away_team_id!)
  );
  const ninthPlaceGame = consolationWeek16.find(
    m =>
      consolationSemiLosers.has(m.home_team_id!) &&
      consolationSemiLosers.has(m.away_team_id!)
  );
  const seventhPlaceGame = consolationWeek16.find(
    m => m !== fifthPlaceGame && m !== ninthPlaceGame
  );

  // ── Build data arrays for BracketSection ─────────────────────────────────
  let idCounter = 0;
  const toData = (m: MatchupScoresView, isConsolation = false) => ({
    matchupId: idCounter++,
    homeTeam:    m.home_team_name,
    homeTeamId:  m.home_team_id,
    homeSeed:    teamSeeds.get(m.home_team_id ?? 0),
    homeScore:   m.home_score,
    awayTeam:    m.away_team_name,
    awayTeamId:  m.away_team_id,
    awaySeed:    teamSeeds.get(m.away_team_id ?? 0),
    awayScore:   m.away_score,
    isConsolation,
  });

  // Sort bracket semis: higher seed (lower number) on top
  const sortedSemis = [...bracketSemis].sort((a, b) => {
    const aBest = Math.min(
      teamSeeds.get(a.home_team_id ?? 0) ?? 999,
      teamSeeds.get(a.away_team_id ?? 0) ?? 999
    );
    const bBest = Math.min(
      teamSeeds.get(b.home_team_id ?? 0) ?? 999,
      teamSeeds.get(b.away_team_id ?? 0) ?? 999
    );
    return aBest - bBest;
  });

  const semiFinalsData       = sortedSemis.map(m => toData(m, false));
  const consolationSemiData  = consolationWeek15.map(m => toData(m, true));
  const championshipData     = championship    ? [toData(championship, false)]    : [];
  const thirdPlaceData       = thirdPlaceGame  ? [toData(thirdPlaceGame, false)]  : [];

  const placementGames = [
    fifthPlaceGame   ? { title: "5th Place Game",              data: [toData(fifthPlaceGame,   true)] } : null,
    seventhPlaceGame ? { title: "7th Place Game",              data: [toData(seventhPlaceGame, true)] } : null,
    ninthPlaceGame   ? { title: "9th Place Game (Toilet Bowl)", data: [toData(ninthPlaceGame,   true)] } : null,
  ].filter((g): g is { title: string; data: ReturnType<typeof toData>[] } => g !== null);

  const hasConsolation = consolationSemiData.length > 0 || placementGames.length > 0;

  return (
    <div className="overflow-auto">
      <div className="flex flex-col min-w-[800px]">
        <WeekLabels weeks={[15, 16]} />

        <div className="grid grid-cols-2 gap-8">
          {/* Left — Semifinals */}
          <div className="space-y-12">
            <BracketSection
              title="Semifinals"
              matchups={semiFinalsData}
              editMode={editMode}
              onTeamSelect={onTeamSelect}
              onScoreUpdate={onScoreUpdate}
              teams={teams}
            />
          </div>

          {/* Right — Championship + 3rd Place */}
          <div className="space-y-12">
            <BracketSection
              title="Championship"
              matchups={championshipData}
              editMode={editMode}
              onTeamSelect={onTeamSelect}
              onScoreUpdate={onScoreUpdate}
              teams={teams}
            />
            {thirdPlaceData.length > 0 && (
              <BracketSection
                title="3rd Place Game"
                matchups={thirdPlaceData}
                editMode={editMode}
                onTeamSelect={onTeamSelect}
                onScoreUpdate={onScoreUpdate}
                teams={teams}
              />
            )}
          </div>
        </div>

        {/* Consolation divider */}
        {hasConsolation && (
          <div className="w-full mt-10 mb-6">
            <div className="flex items-center justify-center">
              <div className="h-px bg-border flex-grow" />
              <span className="px-4 text-sm text-muted-foreground font-medium">
                Consolation Bracket
              </span>
              <div className="h-px bg-border flex-grow" />
            </div>
          </div>
        )}

        {hasConsolation && (
          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-12">
              {consolationSemiData.length > 0 && (
                <BracketSection
                  title="Consolation Matchups"
                  matchups={consolationSemiData}
                  editMode={editMode}
                  onTeamSelect={onTeamSelect}
                  onScoreUpdate={onScoreUpdate}
                  teams={teams}
                />
              )}
            </div>
            <div className="space-y-12">
              {placementGames.map((game, index) => (
                <BracketSection
                  key={`placement-${index}`}
                  title={game.title}
                  matchups={game.data}
                  editMode={editMode}
                  onTeamSelect={onTeamSelect}
                  onScoreUpdate={onScoreUpdate}
                  teams={teams}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FourTeamPlayoffs;
