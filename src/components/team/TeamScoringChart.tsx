import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { MatchupScoresView } from "@/types/database";

interface Props {
  teamId: number;
  seasonId: number; // DB season primary key
}

interface ChartPoint {
  week: number;
  label: string;
  score: number | null;
  leagueAvg: number | null;
  result: "W" | "L" | "T" | null;
}

const DOT_COLOR = { W: "#34d399", L: "#f87171", T: "#fbbf24" };

// Custom dot that changes color by result
const ResultDot = (props: {
  cx?: number; cy?: number; payload?: ChartPoint; r?: number
}) => {
  const { cx, cy, payload, r = 4 } = props;
  if (cx == null || cy == null || payload?.score == null) return null;
  const fill = payload.result ? DOT_COLOR[payload.result] : "#94a3b8";
  return <circle cx={cx} cy={cy} r={r} fill={fill} stroke="none" />;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const d: ChartPoint = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-[#1a1a2e]/90 px-3 py-2 text-xs shadow-lg">
      <p className="text-slate-400 mb-1">Week {label}</p>
      <p className="font-mono font-semibold" style={{ color: d.result ? DOT_COLOR[d.result] : "#94a3b8" }}>
        {d.score?.toFixed(1) ?? "—"}{d.result ? ` (${d.result})` : ""}
      </p>
      {d.leagueAvg != null && (
        <p className="text-slate-500">League avg: {d.leagueAvg.toFixed(1)}</p>
      )}
    </div>
  );
};

const TeamScoringChart = ({ teamId, seasonId }: Props) => {
  const { data: matchups, isLoading } = useQuery({
    queryKey: ["team-scoring-chart", teamId, seasonId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matchup_scores_view")
        .select("*")
        .eq("season_id", seasonId)
        .order("week_number");
      if (error) throw error;
      return data as MatchupScoresView[];
    },
  });

  const chartData = useMemo((): ChartPoint[] => {
    if (!matchups) return [];

    const regular = matchups.filter((m) => !m.is_playoff && !m.is_consolation);
    const maxWeek = Math.max(0, ...regular.map((m) => m.week_number ?? 0));
    if (maxWeek === 0) return [];

    // Per-week league avg and team score
    const weeks: ChartPoint[] = [];
    for (let w = 1; w <= maxWeek; w++) {
      const weekGames = regular.filter((m) => m.week_number === w);
      const allScores: number[] = [];
      for (const m of weekGames) {
        if (m.home_score != null) allScores.push(m.home_score);
        if (m.away_score != null) allScores.push(m.away_score);
      }
      const leagueAvg = allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : null;

      // Find this team's game
      const myGame = weekGames.find(
        (m) => m.home_team_id === teamId || m.away_team_id === teamId,
      );
      let score: number | null = null;
      let result: "W" | "L" | "T" | null = null;
      if (myGame) {
        const isHome = myGame.home_team_id === teamId;
        score = isHome ? myGame.home_score : myGame.away_score;
        const oppScore = isHome ? myGame.away_score : myGame.home_score;
        if (score != null && oppScore != null) {
          result = score > oppScore ? "W" : score < oppScore ? "L" : "T";
        }
      }

      weeks.push({ week: w, label: String(w), score, leagueAvg, result });
    }
    return weeks;
  }, [matchups, teamId]);

  if (isLoading) return <p className="text-slate-500 text-sm animate-pulse">Loading chart…</p>;
  if (chartData.length === 0) return null;

  const scores = chartData.map((d) => d.score).filter((s): s is number => s != null);
  const minScore = Math.max(0, Math.min(...scores) - 10);
  const maxScore = Math.max(...scores) + 10;

  return (
    <Card className="border-white/10">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-slate-300">
          Weekly Scoring — Regular Season
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 pb-4">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey="week"
              tick={{ fill: "#64748b", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              label={{ value: "Week", position: "insideBottom", offset: -2, fill: "#475569", fontSize: 11 }}
            />
            <YAxis
              domain={[minScore, maxScore]}
              tick={{ fill: "#64748b", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={40}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 8, color: "#64748b" }}
              formatter={(value) => <span style={{ color: "#94a3b8" }}>{value}</span>}
            />
            {/* League average reference */}
            <Line
              type="monotone"
              dataKey="leagueAvg"
              name="League Avg"
              stroke="rgba(148,163,184,0.35)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              activeDot={false}
            />
            {/* Team score line */}
            <Line
              type="monotone"
              dataKey="score"
              name="Score"
              stroke="#60a5fa"
              strokeWidth={2}
              dot={<ResultDot />}
              activeDot={{ r: 6, fill: "#60a5fa", stroke: "rgba(96,165,250,0.3)", strokeWidth: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
        <div className="flex gap-4 justify-center mt-1 text-xs text-slate-500">
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400" />Win</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-red-400" />Loss</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400" />Tie</span>
        </div>
      </CardContent>
    </Card>
  );
};

export default TeamScoringChart;
