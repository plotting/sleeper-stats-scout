
import { useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { MatchupScoresView } from "@/types/database";
import { ScoringRecordsSection } from "@/components/records/ScoringRecordsSection";
import { MiscRecordsSection } from "@/components/records/MiscRecordsSection";
import { CareerRecordsSection } from "@/components/records/CareerRecordsSection";
import { StreaksSection } from "@/components/records/StreaksSection";
import { AllTimeScheduleRecords } from "@/components/records/AllTimeScheduleRecords";
import { TopPerformancesSection } from "@/components/records/TopPerformancesSection";
import { TradeRecordsSection } from "@/components/records/TradeRecordsSection";

const Records = () => {
  const { data: matchups, isLoading: matchupsLoading } = useQuery({
    queryKey: ['matchups-records'],
    queryFn: async () => {
      const PAGE = 1000;
      let rows: MatchupScoresView[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from('matchup_scores_view')
          .select('*')
          .order('season_id')
          .order('week_number')
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        rows = rows.concat(data as MatchupScoresView[]);
        if (data.length < PAGE) break;
        from += PAGE;
      }
      // Deduplicate: old syncs stored the same game twice (home/away swapped).
      // Without this, every scoring record and career stat double-counts.
      const seen = new Set<string>();
      return rows.filter(m => {
        const ids = [m.home_team_id ?? 0, m.away_team_id ?? 0].sort((a, b) => a - b);
        const key = `${m.season_id}-${m.week_number}-${ids[0]}-${ids[1]}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
  });

  const { data: seasons } = useQuery({
    queryKey: ['seasons-list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('seasons').select('id, year, season_number');
      if (error) throw error;
      return data;
    },
  });

  const yearMap = useMemo(() => {
    const m = new Map<number, number>();
    if (!seasons) return m;
    for (const s of seasons) m.set(s.id, s.year ?? s.season_number);
    return m;
  }, [seasons]);

  const calculateCareerStats = () => {
    if (!matchups) return [];

    const stats = new Map<string, {
      team: string;
      regularSeason: { wins: number; losses: number; ties: number; };
      playoffs: { wins: number; losses: number; ties: number; };
      consolation: { wins: number; losses: number; ties: number; };
      hypothetical: { wins: number; losses: number; ties: number; };
      scoring: {
        hundredPlus: number;
        highestScore: number;
        lowestScore: number;
        timesHighest: number;
        timesLowest: number;
        vsHighest: number;
        vsLowest: number;
      };
      regularSeasonPointTotal: number;
      regularSeasonGames: number;
    }>();

    matchups.forEach(match => {
      if (!match.home_score || !match.away_score) return;

      const processTeam = (
        team: string,
        score: number,
        otherScore: number,
        isPlayoff: boolean,
        isConsolation: boolean,
        weekScores: { team: string; score: number; }[]
      ) => {
        if (!stats.has(team)) {
          stats.set(team, {
            team,
            regularSeason: { wins: 0, losses: 0, ties: 0 },
            playoffs: { wins: 0, losses: 0, ties: 0 },
            consolation: { wins: 0, losses: 0, ties: 0 },
            hypothetical: { wins: 0, losses: 0, ties: 0 },
            scoring: {
              hundredPlus: 0,
              highestScore: 0,
              lowestScore: Infinity,
              timesHighest: 0,
              timesLowest: 0,
              vsHighest: 0,
              vsLowest: 0,
            },
            regularSeasonPointTotal: 0,
            regularSeasonGames: 0,
          });
        }

        const stat = stats.get(team)!;
        
        // Determine which record to update based on match type
        let target;
        if (isConsolation) {
          target = stat.consolation;
        } else if (isPlayoff) {
          target = stat.playoffs;
        } else {
          target = stat.regularSeason;
        }
        
        // Update wins/losses/ties
        if (score > otherScore) target.wins++;
        else if (score < otherScore) target.losses++;
        else target.ties++;

        // Regular-season points total, for career PPG
        if (!isConsolation && !isPlayoff) {
          stat.regularSeasonPointTotal += score;
          stat.regularSeasonGames++;
        }

        // Update scoring stats
        if (score >= 100) stat.scoring.hundredPlus++;
        stat.scoring.highestScore = Math.max(stat.scoring.highestScore, score);
        stat.scoring.lowestScore = Math.min(stat.scoring.lowestScore, score);

        const weekHigh = Math.max(...weekScores.map(s => s.score));
        const weekLow = Math.min(...weekScores.map(s => s.score));
        
        if (score === weekHigh) stat.scoring.timesHighest++;
        if (score === weekLow) stat.scoring.timesLowest++;
        if (otherScore === weekHigh) stat.scoring.vsHighest++;
        if (otherScore === weekLow) stat.scoring.vsLowest++;

        // Calculate hypothetical record
        weekScores.forEach(ws => {
          if (ws.team !== team) {
            if (score > ws.score) stat.hypothetical.wins++;
            else if (score < ws.score) stat.hypothetical.losses++;
            else stat.hypothetical.ties++;
          }
        });
      };

      // Get all scores for the week
      const weekScores = matchups
        .filter(m => 
          m.season_id === match.season_id && 
          m.week_number === match.week_number &&
          m.home_score !== null &&
          m.away_score !== null
        )
        .flatMap(m => [
          { team: m.home_team_name!, score: m.home_score! },
          { team: m.away_team_name!, score: m.away_score! }
        ]);

      // Process home team
      processTeam(
        match.home_team_name!,
        match.home_score,
        match.away_score,
        match.is_playoff || false,
        match.is_consolation || false,
        weekScores
      );
      
      // Process away team
      processTeam(
        match.away_team_name!,
        match.away_score,
        match.home_score,
        match.is_playoff || false,
        match.is_consolation || false,
        weekScores
      );
    });

    return Array.from(stats.values()).map(stat => ({
      ...stat,
      regularSeason: {
        ...stat.regularSeason,
        percentage: calculatePercentage(stat.regularSeason)
      },
      playoffs: {
        ...stat.playoffs,
        percentage: calculatePercentage(stat.playoffs)
      },
      consolation: {
        ...stat.consolation,
        percentage: calculatePercentage(stat.consolation)
      },
      hypothetical: {
        ...stat.hypothetical,
        percentage: calculatePercentage(stat.hypothetical)
      },
      careerPpg: stat.regularSeasonGames > 0 ? stat.regularSeasonPointTotal / stat.regularSeasonGames : 0,
    }));
  };

  const calculatePercentage = (record: { wins: number; losses: number; ties: number; }) => {
    const total = record.wins + record.losses + record.ties;
    if (total === 0) return 0;
    return ((record.wins + record.ties * 0.5) / total) * 100;
  };

  const calculateScoringRecords = () => {
    if (!matchups) return {
      regularSeasonHigh: [],
      regularSeasonLow: [],
      playoffHigh: [],
      playoffLow: [],
      largestMargins: [],
      highestCombined: []
    };

    const regularGames = matchups.filter(m => !m.is_playoff && m.home_score !== null && m.away_score !== null);
    const playoffGames = matchups.filter(m => m.is_playoff && m.home_score !== null && m.away_score !== null);

    const getAllScores = (games: typeof matchups) => {
      const scores: Array<{
        score: number,
        team: string,
        season: number,
        week: number,
        opponent: string,
        gameScore: string
      }> = [];

      games.forEach(game => {
        scores.push({
          score: game.home_score!,
          team: game.home_team_name!,
          opponent: game.away_team_name!,
          season: game.season_id,
          week: game.week_number!,
          gameScore: `${game.home_score!.toFixed(1)}-${game.away_score!.toFixed(1)}`
        });
        scores.push({
          score: game.away_score!,
          team: game.away_team_name!,
          opponent: game.home_team_name!,
          season: game.season_id,
          week: game.week_number!,
          gameScore: `${game.away_score!.toFixed(1)}-${game.home_score!.toFixed(1)}`
        });
      });

      return scores;
    };

    const margins = matchups
      .filter(m => m.home_score !== null && m.away_score !== null)
      .map(m => ({
        margin: Math.abs(m.home_score - m.away_score),
        winner: m.home_score > m.away_score ? m.home_team_name : m.away_team_name,
        loser: m.home_score > m.away_score ? m.away_team_name : m.home_team_name,
        season: m.season_id,
        week: m.week_number,
        score: `${Math.max(m.home_score, m.away_score).toFixed(1)}-${Math.min(m.home_score, m.away_score).toFixed(1)}`,
        isPlayoff: m.is_playoff
      }))
      .sort((a, b) => b.margin - a.margin);

    const combined = matchups
      .filter(m => m.home_score !== null && m.away_score !== null)
      .map(m => ({
        total: m.home_score + m.away_score,
        teams: `${m.home_team_name} vs ${m.away_team_name}`,
        season: m.season_id,
        week: m.week_number,
        score: `${m.home_score.toFixed(1)}-${m.away_score.toFixed(1)}`,
        isPlayoff: m.is_playoff
      }))
      .sort((a, b) => b.total - a.total);

    const regularScores = getAllScores(regularGames);
    const playoffScores = getAllScores(playoffGames);

    return {
      regularSeasonHigh: regularScores.sort((a, b) => b.score - a.score).slice(0, 10),
      regularSeasonLow: regularScores.sort((a, b) => a.score - b.score).slice(0, 10),
      playoffHigh: playoffScores.sort((a, b) => b.score - a.score).slice(0, 10),
      playoffLow: playoffScores.sort((a, b) => a.score - b.score).slice(0, 10),
      largestMargins: margins.slice(0, 10),
      highestCombined: combined.slice(0, 10)
    };
  };

  // Single-season PPG (regular season only, min 5 games so a partial/in-progress
  // season like the current one can't sneak onto the list with a tiny sample).
  const calculateSeasonPpgRecords = () => {
    if (!matchups) return { highestSeasonPpg: [], lowestSeasonPpg: [] };

    const bySeasonTeam = new Map<string, { team: string; season: number; total: number; games: number }>();
    for (const m of matchups) {
      if (m.is_playoff || m.is_consolation) continue;
      const addTeam = (team: string | null, score: number | null) => {
        if (!team || score == null) return;
        const key = `${m.season_id}-${team}`;
        if (!bySeasonTeam.has(key)) bySeasonTeam.set(key, { team, season: m.season_id, total: 0, games: 0 });
        const rec = bySeasonTeam.get(key)!;
        rec.total += score;
        rec.games++;
      };
      addTeam(m.home_team_name, m.home_score);
      addTeam(m.away_team_name, m.away_score);
    }

    const seasonPpgs = [...bySeasonTeam.values()]
      .filter((r) => r.games >= 5)
      .map((r) => ({ team: r.team, season: r.season, games: r.games, ppg: r.total / r.games }));

    return {
      highestSeasonPpg: [...seasonPpgs].sort((a, b) => b.ppg - a.ppg).slice(0, 10),
      lowestSeasonPpg: [...seasonPpgs].sort((a, b) => a.ppg - b.ppg).slice(0, 10),
    };
  };

  const calculateHypotheticalRecords = () => {
    if (!matchups) return { best: [], worst: [] };

    const seasonTeamRecords = new Map<string, {
      team: string,
      season: string,
      wins: number,
      ties: number,
      games: number
    }>();

    const seasonWeeks = new Map<string, MatchupScoresView[]>();
    matchups.forEach(matchup => {
      if (!matchup.home_score || !matchup.away_score || matchup.is_playoff) return;
      
      const key = `${matchup.season_id}-${matchup.week_number}`;
      if (!seasonWeeks.has(key)) {
        seasonWeeks.set(key, []);
      }
      seasonWeeks.get(key)!.push(matchup);
    });

    seasonWeeks.forEach((weekMatchups, weekKey) => {
      const [season] = weekKey.split('-');
      
      const weekScores = weekMatchups.flatMap(m => [
        { team: m.home_team_name!, score: m.home_score! },
        { team: m.away_team_name!, score: m.away_score! }
      ]);

      weekScores.forEach(teamScore => {
        const wins = weekScores.filter(s => 
          s.team !== teamScore.team && teamScore.score > s.score
        ).length;
        const ties = weekScores.filter(s => 
          s.team !== teamScore.team && teamScore.score === s.score
        ).length;

        const key = `${season}-${teamScore.team}`;
        if (!seasonTeamRecords.has(key)) {
          seasonTeamRecords.set(key, {
            team: teamScore.team,
            season,
            wins: 0,
            ties: 0,
            games: 0
          });
        }

        const record = seasonTeamRecords.get(key)!;
        record.wins += wins;
        record.ties += ties;
        record.games += weekScores.length - 1;
      });
    });

    const records = Array.from(seasonTeamRecords.values())
      .map(record => ({
        team: record.team,
        season: record.season,
        record: `${record.wins}-${record.games - record.wins - record.ties}-${record.ties}`,
        percentage: ((record.wins + record.ties * 0.5) / record.games) * 100
      }))
      .sort((a, b) => b.percentage - a.percentage);

    return {
      best: records.slice(0, 10),
      worst: records.slice(-10).reverse()
    };
  };

  const careerStats = calculateCareerStats();
  const scoringRecords = calculateScoringRecords();
  const seasonPpgRecords = calculateSeasonPpgRecords();
  const hypotheticalRecords = calculateHypotheticalRecords();

  if (matchupsLoading) {
    return <div>Loading records...</div>;
  }

  return (
    <div className="min-h-screen">
      <header className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">League Records</h1>
        <p className="text-muted-foreground">Historical achievements and statistics</p>
      </header>

      <Tabs defaultValue="scoring" className="space-y-4">
        <TabsList>
          <TabsTrigger value="scoring">Scoring</TabsTrigger>
          <TabsTrigger value="history">Team History</TabsTrigger>
          <TabsTrigger value="schedule">Schedule &amp; Luck</TabsTrigger>
          <TabsTrigger value="trades">Trade Records</TabsTrigger>
        </TabsList>

        <TabsContent value="scoring" className="space-y-10">
          <section>
            <h2 className="text-lg font-semibold mb-4">Scoring Records</h2>
            <ScoringRecordsSection {...scoringRecords} {...seasonPpgRecords} />
          </section>
          <section>
            <h2 className="text-lg font-semibold mb-4">Top Performances</h2>
            {matchups && (
              <TopPerformancesSection allMatchups={matchups} yearMap={yearMap} />
            )}
          </section>
        </TabsContent>

        <TabsContent value="history" className="space-y-10">
          <section>
            <h2 className="text-lg font-semibold mb-4">Career Records</h2>
            <CareerRecordsSection careerStats={careerStats} />
          </section>
          <section>
            <h2 className="text-lg font-semibold mb-4">Streaks</h2>
            <StreaksSection matchups={matchups || []} />
          </section>
        </TabsContent>

        <TabsContent value="schedule" className="space-y-10">
          <section>
            <h2 className="text-lg font-semibold mb-4">Schedules</h2>
            <AllTimeScheduleRecords matchups={matchups || []} />
          </section>
          <section>
            <h2 className="text-lg font-semibold mb-4">Miscellaneous</h2>
            <MiscRecordsSection
              bestRecords={hypotheticalRecords.best}
              worstRecords={hypotheticalRecords.worst}
            />
          </section>
        </TabsContent>

        <TabsContent value="trades">
          <TradeRecordsSection />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Records;
