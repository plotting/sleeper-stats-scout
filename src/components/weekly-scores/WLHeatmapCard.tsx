
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { MatchupScoresView } from "@/types/database";

interface HeatRow {
  teamId: number;
  teamName: string;
  weeks: (1 | 0 | 0.5 | null)[];
  wins: number;
  losses: number;
  ties: number;
}

function computeHeatmap(matchups: MatchupScoresView[]): { rows: HeatRow[]; maxWeek: number } {
  const regular = matchups.filter((m) => !m.is_playoff && !m.is_consolation);
  const maxWeek = Math.max(0, ...regular.map((m) => m.week_number ?? 0));
  if (maxWeek === 0) return { rows: [], maxWeek: 0 };

  const teamMap = new Map<number, { name: string; weeks: (1 | 0 | 0.5 | null)[] }>();

  const ensure = (id: number, name: string) => {
    if (!teamMap.has(id)) teamMap.set(id, { name, weeks: Array(maxWeek).fill(null) });
    return teamMap.get(id)!;
  };

  for (const m of regular) {
    if (!m.home_team_id || !m.away_team_id || m.home_score == null || m.away_score == null) continue;
    const wk = (m.week_number ?? 1) - 1;
    const home = ensure(m.home_team_id, m.home_team_name!);
    const away = ensure(m.away_team_id, m.away_team_name!);

    if (m.home_score > m.away_score) { home.weeks[wk] = 1; away.weeks[wk] = 0; }
    else if (m.away_score > m.home_score) { home.weeks[wk] = 0; away.weeks[wk] = 1; }
    else { home.weeks[wk] = 0.5; away.weeks[wk] = 0.5; }
  }

  const rows: HeatRow[] = [...teamMap.entries()].map(([id, { name, weeks }]) => {
    const wins = weeks.filter((v) => v === 1).length;
    const losses = weeks.filter((v) => v === 0).length;
    const ties = weeks.filter((v) => v === 0.5).length;
    return { teamId: id, teamName: name, weeks, wins, losses, ties };
  });

  return { rows: rows.sort((a, b) => b.wins - a.wins || a.losses - b.losses), maxWeek };
}

const WLHeatmapCard = ({ matchups }: { matchups: MatchupScoresView[] | undefined }) => {
  const { rows, maxWeek } = useMemo(() => computeHeatmap(matchups ?? []), [matchups]);

  if (!matchups || rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>W-L Heatmap</CardTitle>
        <CardDescription>Week-by-week results — regular season</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 text-xs text-slate-400 mb-3">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-emerald-500/70" />Win
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-red-500/70" />Loss
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-amber-500/70" />Tie
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-left text-xs text-slate-500 pr-4 pb-2 font-normal">Team</th>
                {Array.from({ length: maxWeek }, (_, i) => (
                  <th key={i} className="text-center text-xs text-slate-500 w-8 pb-2 font-normal">
                    {i + 1}
                  </th>
                ))}
                <th className="text-right text-xs text-slate-500 pl-4 pb-2 font-normal">W-L</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.teamId}>
                  <td className="pr-4 py-0.5">
                    <Link
                      to={`/team/${r.teamId}`}
                      className="text-sm text-primary hover:underline whitespace-nowrap"
                    >
                      {r.teamName}
                    </Link>
                  </td>
                  {r.weeks.map((v, i) => (
                    <td key={i} className="px-0.5 py-0.5">
                      <div
                        className={cn(
                          "w-7 h-7 rounded-sm flex items-center justify-center text-xs font-bold mx-auto",
                          v === 1
                            ? "bg-emerald-500/25 text-emerald-400 border border-emerald-500/30"
                            : v === 0
                            ? "bg-red-500/20 text-red-400 border border-red-500/25"
                            : v === 0.5
                            ? "bg-amber-500/20 text-amber-400 border border-amber-500/25"
                            : "bg-white/3 border border-white/5 text-transparent",
                        )}
                      >
                        {v === 1 ? "W" : v === 0 ? "L" : v === 0.5 ? "T" : "·"}
                      </div>
                    </td>
                  ))}
                  <td className="pl-4 text-right font-mono text-sm whitespace-nowrap">
                    <span className="text-emerald-400">{r.wins}</span>
                    <span className="text-slate-500">-</span>
                    <span className="text-red-400">{r.losses}</span>
                    {r.ties > 0 && (
                      <>
                        <span className="text-slate-500">-</span>
                        <span className="text-amber-400">{r.ties}</span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
};

export default WLHeatmapCard;
