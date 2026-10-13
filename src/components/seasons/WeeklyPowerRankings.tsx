import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPlayoffStartWeek } from "@/utils/playoffRegistry";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface Props {
  seasonId: number;
}

interface MatchupRow {
  home_team_id: number | null;
  away_team_id: number | null;
  home_score: number | null;
  away_score: number | null;
  home_team_name: string | null;
  away_team_name: string | null;
  week_number: number | null;
}

// Composite weights: 65% all-play win%, 35% cumulative PPG
const AP_WEIGHT = 0.65;
const PPG_WEIGHT = 0.35;

type RankMode = "composite" | "allplay" | "cumulative" | "rolling3";

const PALETTE = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#84cc16",
  "#ec4899",
  "#6366f1",
];


const RankedDot = (props: {
  cx?: number;
  cy?: number;
  payload?: Record<string, unknown>;
  dataKey?: string;
  stroke?: string;
}) => {
  const { cx, cy, payload, dataKey, stroke } = props;
  if (cx == null || cy == null || !dataKey || !payload) return null;
  const rankVal = payload[dataKey];
  if (rankVal == null || typeof rankVal !== "number") return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={10} fill={stroke ?? "#3b82f6"} />
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={9}
        fontWeight="bold"
        fill="#fff"
      >
        {rankVal}
      </text>
    </g>
  );
};

interface TooltipPayloadEntry {
  dataKey: string;
  value: number;
  stroke: string;
  payload: Record<string, unknown>;
}

const CustomTooltip = ({
  active,
  payload,
  label,
  teamNames,
  teamColors,
  mode,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
  teamNames: Record<string, string>;
  teamColors: Record<string, string>;
  mode: RankMode;
}) => {
  if (!active || !payload?.length) return null;

  const point = payload[0]?.payload as Record<string, unknown>;
  const sorted = [...payload]
    .filter((p) => p.value != null)
    .sort((a, b) => a.value - b.value);

  return (
    <div className="rounded-lg border border-white/10 bg-[#0f172a]/90 px-3 py-2 text-xs shadow-lg min-w-[200px]">
      <p className="text-slate-400 mb-2 font-semibold">{label}</p>
      {sorted.map((entry) => {
        const teamKey = entry.dataKey;
        const ppg = point[`${teamKey}_ppg`] as number | undefined;
        const ap = point[`${teamKey}_ap`] as string | undefined;
        return (
          <div key={teamKey} className="flex items-center gap-2 mb-1">
            <span
              className="inline-block w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: teamColors[teamKey] ?? "#94a3b8" }}
            />
            <span className="text-slate-300 flex-1">{teamNames[teamKey] ?? teamKey}</span>
            <div className="flex gap-2 font-mono text-slate-400 text-[10px]">
              {ap != null && (
                <span className={mode === "allplay" || mode === "composite" ? "text-slate-200" : ""}>
                  {ap} AP
                </span>
              )}
              {ppg != null && (
                <span className={mode === "cumulative" || mode === "rolling3" || mode === "composite" ? "text-slate-200" : ""}>
                  {ppg.toFixed(1)} pts
                </span>
              )}
              <span className="text-slate-500">#{entry.value}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const WeeklyPowerRankings = ({ seasonId }: Props) => {
  const [mode, setMode] = useState<RankMode>("composite");

  const { data: rows, isLoading } = useQuery({
    queryKey: ["weekly-power-rankings", seasonId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matchup_scores_view")
        .select(
          "home_team_id, away_team_id, home_score, away_score, home_team_name, away_team_name, week_number"
        )
        .eq("season_id", seasonId);
      if (error) throw error;
      return data as MatchupRow[];
    },
    enabled: seasonId > 0,
  });

  const { chartData, teamKeys, teamNameMap, teamColorMap, numTeams } = useMemo(() => {
    if (!rows || rows.length === 0) {
      return { chartData: [], teamKeys: [], teamNameMap: {}, teamColorMap: {}, numTeams: 0 };
    }

    const regularRows = rows.filter(
      (r) =>
        r.week_number != null &&
        r.week_number >= 1 &&
        r.week_number < getPlayoffStartWeek(seasonId)
    );

    const nameById: Record<number, string> = {};
    for (const r of regularRows) {
      if (r.home_team_id != null && r.home_team_name)
        nameById[r.home_team_id] = r.home_team_name;
      if (r.away_team_id != null && r.away_team_name)
        nameById[r.away_team_id] = r.away_team_name;
    }

    const allTeamIds = Object.keys(nameById)
      .map(Number)
      .sort((a, b) => a - b); // site-wide team order (team id)

    const n = allTeamIds.length;
    if (n === 0) {
      return { chartData: [], teamKeys: [], teamNameMap: {}, teamColorMap: {}, numTeams: 0 };
    }

    const colorByTeamId: Record<number, string> = {};
    allTeamIds.forEach((id, idx) => {
      colorByTeamId[id] = PALETTE[idx % PALETTE.length];
    });

    // Cumulative trackers
    const totalPF: Record<number, number> = {};
    const gamesPlayed: Record<number, number> = {};
    const weeklyScores: Record<number, number[]> = {};
    const apWins: Record<number, number> = {};    // all-play wins
    const apLosses: Record<number, number> = {};  // all-play losses
    const apTies: Record<number, number> = {};

    allTeamIds.forEach((id) => {
      totalPF[id] = 0;
      gamesPlayed[id] = 0;
      weeklyScores[id] = [];
      apWins[id] = 0;
      apLosses[id] = 0;
      apTies[id] = 0;
    });

    const maxWeek = Math.max(0, ...regularRows.map((r) => r.week_number ?? 0));
    const weekPoints: Array<Record<string, unknown>> = [];

    for (let w = 1; w <= maxWeek; w++) {
      const weekRows = regularRows.filter((r) => r.week_number === w);

      // Collect all team scores this week
      const weekScoreMap: Record<number, number> = {};
      for (const r of weekRows) {
        if (r.home_team_id != null && r.home_score != null)
          weekScoreMap[r.home_team_id] = r.home_score;
        if (r.away_team_id != null && r.away_score != null)
          weekScoreMap[r.away_team_id] = r.away_score;
      }

      // Update cumulative PPG stats
      for (const [idStr, score] of Object.entries(weekScoreMap)) {
        const id = Number(idStr);
        totalPF[id] = (totalPF[id] ?? 0) + score;
        gamesPlayed[id] = (gamesPlayed[id] ?? 0) + 1;
        if (!weeklyScores[id]) weeklyScores[id] = [];
        weeklyScores[id].push(score);
      }

      // Update all-play record: each team vs every other team that week
      const scoringTeams = Object.keys(weekScoreMap).map(Number);
      for (const id of scoringTeams) {
        const myScore = weekScoreMap[id];
        for (const oppId of scoringTeams) {
          if (oppId === id) continue;
          const oppScore = weekScoreMap[oppId];
          if (myScore > oppScore) apWins[id]++;
          else if (myScore < oppScore) apLosses[id]++;
          else apTies[id]++;
        }
      }

      // Build per-team stats snapshot for this week
      const activeIds = allTeamIds.filter((id) => gamesPlayed[id] > 0);

      type TeamSnapshot = {
        id: number;
        cumPPG: number;
        rolling3PPG: number;
        apPct: number;
      };

      const snapshots: TeamSnapshot[] = activeIds.map((id) => {
        const scores = weeklyScores[id] ?? [];
        const last3 = scores.slice(-3);
        const rolling = last3.length > 0 ? last3.reduce((a, b) => a + b, 0) / last3.length : 0;
        const cumPPG = totalPF[id] / gamesPlayed[id];
        const apGames = apWins[id] + apLosses[id] + apTies[id];
        const apPct = apGames > 0 ? (apWins[id] + apTies[id] * 0.5) / apGames : 0;
        return { id, cumPPG, rolling3PPG: rolling, apPct };
      });

      // Normalize both metrics to [0, 1] across this week's active teams so
      // they can be blended on equal footing. Teams tied on all-play will be
      // correctly separated by PPG (higher PPG → higher composite score).
      const maxAP  = Math.max(...snapshots.map((s) => s.apPct),  0.001);
      const minAP  = Math.min(...snapshots.map((s) => s.apPct),  0);
      const maxPPG = Math.max(...snapshots.map((s) => s.cumPPG), 1);
      const minPPG = Math.min(...snapshots.map((s) => s.cumPPG), 0);
      const apRange  = maxAP  - minAP  || 1;
      const ppgRange = maxPPG - minPPG || 1;

      const compositeScore = (s: TeamSnapshot) =>
        AP_WEIGHT  * ((s.apPct  - minAP)  / apRange) +
        PPG_WEIGHT * ((s.cumPPG - minPPG) / ppgRange);

      // Final sort by selected mode (higher score = better rank)
      const ranked = [...snapshots].sort((a, b) => {
        if (mode === "composite") return compositeScore(b) - compositeScore(a);
        if (mode === "allplay")   return b.apPct       - a.apPct   || b.cumPPG - a.cumPPG;
        if (mode === "rolling3")  return b.rolling3PPG - a.rolling3PPG || b.cumPPG - a.cumPPG;
        return b.cumPPG - a.cumPPG;
      });

      const point: Record<string, unknown> = { week: `W${w}` };
      ranked.forEach((snap, idx) => {
        const key = `t${snap.id}`;
        point[key] = idx + 1;
        // Always store both metrics for the tooltip
        point[`${key}_ppg`] = mode === "rolling3" ? snap.rolling3PPG : snap.cumPPG;
        const apG = apWins[snap.id] + apLosses[snap.id] + apTies[snap.id];
        point[`${key}_ap`] = apG > 0
          ? `${apWins[snap.id]}-${apLosses[snap.id]}${apTies[snap.id] > 0 ? `-${apTies[snap.id]}` : ""}`
          : "—";
      });

      weekPoints.push(point);
    }

    const teamKeys = allTeamIds.map((id) => `t${id}`);
    const teamNameMap: Record<string, string> = {};
    const teamColorMap: Record<string, string> = {};
    allTeamIds.forEach((id) => {
      teamNameMap[`t${id}`] = nameById[id];
      teamColorMap[`t${id}`] = colorByTeamId[id];
    });

    return { chartData: weekPoints, teamKeys, teamNameMap, teamColorMap, numTeams: n };
  }, [rows, mode]);

  // Season-to-date all-play and schedule table that sits under the chart, ordered like the chart's latest ranking.
  const tableRows = useMemo(() => {
    if (!rows || chartData.length === 0) return [];
    const regular = rows.filter((r) => r.week_number != null && r.week_number >= 1 && r.week_number < getPlayoffStartWeek(seasonId) && r.home_team_id != null && r.away_team_id != null && r.home_score != null && r.away_score != null);
    type Acc = { id: number; name: string; w: number; l: number; t: number; pf: number; g: number; apW: number; apL: number; apT: number; opps: number[] };
    const acc = new Map<number, Acc>();
    const get = (id: number, name: string | null) => acc.get(id) ?? (acc.set(id, { id, name: name ?? `Team ${id}`, w: 0, l: 0, t: 0, pf: 0, g: 0, apW: 0, apL: 0, apT: 0, opps: [] }), acc.get(id)!);
    const byWeek = new Map<number, Array<{ id: number; score: number }>>();
    for (const r of regular) {
      const h = get(r.home_team_id!, r.home_team_name), a = get(r.away_team_id!, r.away_team_name);
      h.pf += r.home_score!; a.pf += r.away_score!; h.g++; a.g++;
      if (r.home_score! > r.away_score!) { h.w++; a.l++; } else if (r.home_score! < r.away_score!) { a.w++; h.l++; } else { h.t++; a.t++; }
      h.opps.push(r.away_team_id!); a.opps.push(r.home_team_id!);
      const wk = byWeek.get(r.week_number!) ?? byWeek.set(r.week_number!, []).get(r.week_number!)!;
      wk.push({ id: h.id, score: r.home_score! }, { id: a.id, score: r.away_score! });
    }
    for (const scores of byWeek.values()) {
      for (const me of scores) for (const o of scores) {
        if (o.id === me.id) continue;
        const t = acc.get(me.id)!;
        if (me.score > o.score) t.apW++; else if (me.score < o.score) t.apL++; else t.apT++;
      }
    }
    const ppg = (t: Acc) => (t.g > 0 ? t.pf / t.g : 0);
    const out = [...acc.values()].map((t) => {
      const apG = t.apW + t.apL + t.apT;
      const apPct = apG > 0 ? (t.apW + t.apT * 0.5) / apG : 0;
      // opponents' combined season record, one entry per game played (same idea as the Strength of Schedule tab)
      let oW = 0, oL = 0, oT = 0;
      for (const id of t.opps) { const o = acc.get(id)!; oW += o.w; oL += o.l; oT += o.t; }
      const oG = oW + oL + oT;
      return { ...t, ppg: ppg(t), apPct, oW, oL, oT, oPct: oG > 0 ? (oW + oT * 0.5) / oG : 0, power: (chartData[chartData.length - 1]?.[`t${t.id}`] as number | undefined) ?? 99 };
    });
    return out.sort((x, y) => x.power - y.power);
  }, [rows, chartData, seasonId]);

  if (isLoading) {
    return (
      <Card className="border-white/10">
        <CardContent className="p-6 text-center text-slate-500 animate-pulse">
          Loading power rankings…
        </CardContent>
      </Card>
    );
  }

  if (chartData.length === 0) {
    return (
      <Card className="border-white/10">
        <CardContent className="p-6 text-center text-muted-foreground">
          No matchup data available for this season.
        </CardContent>
      </Card>
    );
  }

  const modes: { key: RankMode; label: string }[] = [
    { key: "composite", label: "Power Index" },
    { key: "allplay", label: "All-Play Only" },
    { key: "cumulative", label: "PPG Only" },
    { key: "rolling3", label: "Rolling 3-Wk" },
  ];

  return (
    <Card className="border-white/10">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="text-base font-semibold text-slate-200">
              Weekly Power Rankings
            </CardTitle>
            <p className="text-xs text-slate-500 mt-0.5">
              {mode === "composite"
                ? `65% all-play win% · 35% cumulative PPG`
                : mode === "allplay"
                ? "All-play win% — how you'd do vs every team each week"
                : mode === "cumulative"
                ? "Average points scored per game"
                : "Average points over the last 3 weeks"}
            </p>
          </div>
          <div className="flex items-center rounded-md border border-white/10 overflow-hidden text-xs">
            {modes.map((m, i) => (
              <button
                key={m.key}
                className={`px-3 py-1.5 transition-colors ${i > 0 ? "border-l border-white/10" : ""} ${
                  mode === m.key
                    ? "bg-white/10 text-slate-100"
                    : "text-slate-400 hover:text-slate-200"
                }`}
                onClick={() => setMode(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="space-y-4">
          <ResponsiveContainer width="100%" height={440}>
            <LineChart
              data={chartData}
              margin={{ top: 16, right: 80, left: 0, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="week"
                tick={{ fill: "#64748b", fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              />
              <YAxis
                reversed
                domain={[1, numTeams]}
                ticks={Array.from({ length: numTeams }, (_, i) => i + 1)}
                tick={{ fill: "#64748b", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={28}
                label={{
                  value: "Rank",
                  angle: -90,
                  position: "insideLeft",
                  offset: 8,
                  fill: "#475569",
                  fontSize: 11,
                }}
              />
              <Tooltip
                content={
                  <CustomTooltip
                    teamNames={teamNameMap}
                    teamColors={teamColorMap}
                    mode={mode}
                  />
                }
              />
              {teamKeys.map((key) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={teamColorMap[key]}
                  strokeWidth={2}
                  dot={<RankedDot />}
                  activeDot={false}
                  isAnimationActive={false}
                  label={
                    chartData.length > 0 &&
                    chartData[chartData.length - 1][key] != null
                      ? {
                          position: "right",
                          value: teamNameMap[key],
                          fill: teamColorMap[key],
                          fontSize: 10,
                          fontWeight: 500,
                        }
                      : false
                  }
                />
              ))}
            </LineChart>
          </ResponsiveContainer>

          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
            {teamKeys.map((key) => (
              <div key={key} className="flex items-center gap-1.5 text-xs text-slate-400">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: teamColorMap[key] }}
                />
                {teamNameMap[key]}
              </div>
            ))}
          </div>

          {tableRows.length > 0 && (
            <div className="pt-4 border-t border-white/10">
              <p className="text-sm font-semibold text-slate-200">All-play &amp; schedule</p>
              <p className="text-xs text-slate-500 mb-2">
                Season to date, in the chart's current order. All-play is each team's record against every team's score each week. Opponents is the combined record of the
                teams faced, one entry per game (a higher win % is a tougher schedule).
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">#</TableHead>
                      <TableHead>Team</TableHead>
                      <TableHead className="text-right">Record</TableHead>
                      <TableHead className="text-right">PPG</TableHead>
                      <TableHead className="text-right">All-play</TableHead>
                      <TableHead className="text-right">AP win%</TableHead>
                      <TableHead className="text-right">Opponents' record</TableHead>
                      <TableHead className="text-right">Opp win %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tableRows.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="text-slate-500">{t.power}</TableCell>
                        <TableCell className="font-medium">{t.name}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{t.w}-{t.l}{t.t > 0 ? `-${t.t}` : ""}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{t.ppg.toFixed(1)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{t.apW}-{t.apL}{t.apT > 0 ? `-${t.apT}` : ""}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{(t.apPct * 100).toFixed(1)}%</TableCell>
                        <TableCell className="text-right font-mono text-sm">{t.oW}-{t.oL}{t.oT > 0 ? `-${t.oT}` : ""}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-slate-300">{(t.oPct * 100).toFixed(1)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default WeeklyPowerRankings;
