
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface DraftGradeRow {
  pick_id: number;
  draft_year: number;
  pick_number: number;
  round: number;
  overall_pick: number;
  team_id: number;
  team_name: string;
  player_name: string;
  position: string | null;
  adp: number;
  five_yr_vorp: number;
  seasons_with_data: number;
  vorp_grade: string;
}

const GRADE_STYLE: Record<string, string> = {
  "A+": "text-emerald-300 bg-emerald-400/15 border-emerald-400/30",
  "A":  "text-emerald-400 bg-emerald-400/10 border-emerald-400/25",
  "A-": "text-emerald-500 bg-emerald-500/10 border-emerald-500/25",
  "B+": "text-sky-300 bg-sky-400/15 border-sky-400/30",
  "B":  "text-sky-400 bg-sky-400/10 border-sky-400/25",
  "B-": "text-sky-500 bg-sky-500/10 border-sky-500/25",
  "C":  "text-amber-400 bg-amber-400/10 border-amber-400/25",
  "D":  "text-orange-400 bg-orange-400/10 border-orange-400/25",
  "F":  "text-red-400 bg-red-400/10 border-red-400/25",
};

const POS_COLORS: Record<string, string> = {
  QB: "text-amber-400 bg-amber-400/10 border-amber-400/30",
  RB: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
  WR: "text-sky-400 bg-sky-400/10 border-sky-400/30",
  TE: "text-violet-400 bg-violet-400/10 border-violet-400/30",
};

function GradeBadge({ grade }: { grade: string }) {
  return (
    <span className={cn(
      "inline-block px-2 py-0.5 rounded text-xs font-bold border min-w-[32px] text-center",
      GRADE_STYLE[grade] ?? "text-slate-400 bg-slate-400/10 border-slate-400/30",
    )}>
      {grade}
    </span>
  );
}

function PosBadge({ pos }: { pos: string | null }) {
  if (!pos) return <span className="text-slate-600 text-xs">—</span>;
  return (
    <span className={cn(
      "inline-block px-1.5 py-0.5 rounded text-[10px] font-bold border",
      POS_COLORS[pos] ?? "text-slate-400 bg-slate-400/10 border-slate-400/30",
    )}>
      {pos}
    </span>
  );
}

function formatVorp(v: number): string {
  if (v > 0) return `+${v.toFixed(1)}`;
  return v.toFixed(1);
}

// Weighted team grade: average of per-pick grades with letter → numeric conversion
const GRADE_NUM: Record<string, number> = {
  "A+": 12, "A": 11, "A-": 10,
  "B+": 9,  "B": 8,  "B-": 7,
  "C": 5,   "D": 3,  "F": 0,
};
const NUM_GRADE = [
  [11.5, "A+"], [10.5, "A"], [9.5, "A-"],
  [8.5, "B+"],  [7.5, "B"],  [6, "B-"],
  [4, "C"],     [1.5, "D"],
] as [number, string][];

function numToLetterGrade(n: number): string {
  for (const [thresh, g] of NUM_GRADE) {
    if (n >= thresh) return g;
  }
  return "F";
}

type ViewMode = "picks" | "teams";

const DRAFT_YEARS = [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013];

const DraftGrades = () => {
  const [year, setYear] = useState(2023);
  const [view, setView] = useState<ViewMode>("picks");

  const { data: picks = [], isLoading } = useQuery({
    queryKey: ["draft-grades", year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rookie_draft_grades" as never)
        .select("*")
        .eq("draft_year", year)
        .order("overall_pick");
      if (error) throw error;
      return data as DraftGradeRow[];
    },
  });

  // Filter to only skill-position picks with VORP data for grading purposes
  const gradablePicks = useMemo(
    () => picks.filter(p => p.position && ["QB","RB","WR","TE"].includes(p.position)),
    [picks]
  );

  // Team summaries
  const teamSummaries = useMemo(() => {
    const map = new Map<number, { team_name: string; picks: DraftGradeRow[] }>();
    for (const p of gradablePicks) {
      if (!map.has(p.team_id)) map.set(p.team_id, { team_name: p.team_name, picks: [] });
      map.get(p.team_id)!.picks.push(p);
    }
    return [...map.values()]
      .map(({ team_name, picks: tPicks }) => {
        const totalVorp = tPicks.reduce((s, p) => s + Number(p.five_yr_vorp), 0);
        const avgGradeNum = tPicks.length
          ? tPicks.reduce((s, p) => s + (GRADE_NUM[p.vorp_grade] ?? 0), 0) / tPicks.length
          : 0;
        return {
          team_name,
          picks: tPicks,
          pick_count: tPicks.length,
          total_vorp: totalVorp,
          avg_grade: numToLetterGrade(avgGradeNum),
        };
      })
      .sort((a, b) => b.total_vorp - a.total_vorp);
  }, [gradablePicks]);

  const dataNote = year > 2023
    ? "⚠️ Career data incomplete — VORP will update as seasons play out"
    : year > 2018
    ? "⚠️ 5-year window may be incomplete for some picks"
    : null;

  return (
    <div className="min-h-screen space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Draft Grades</h1>
          <p className="text-muted-foreground">
            5-year VORP grades for every rookie draft pick
            {picks.length > 0 && <span className="ml-1">· {gradablePicks.length} graded picks</span>}
          </p>
          {dataNote && (
            <p className="text-amber-400/80 text-xs mt-1">{dataNote}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex gap-1 rounded-lg border border-white/10 p-1">
            {(["picks", "teams"] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "px-3 py-1 text-xs rounded-md transition-colors capitalize",
                  view === v
                    ? "bg-white/10 text-white font-medium"
                    : "text-slate-400 hover:text-white",
                )}
              >
                {v === "picks" ? "By Pick" : "By Team"}
              </button>
            ))}
          </div>
          <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v))}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DRAFT_YEARS.map((y) => (
                <SelectItem key={y} value={String(y)}>{y} Draft</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      {isLoading ? (
        <div className="py-20 text-center text-slate-500 text-sm animate-pulse">
          Loading {year} draft grades…
        </div>
      ) : picks.length === 0 ? (
        <div className="py-20 text-center text-slate-400 text-sm">
          No draft data for {year}.
        </div>
      ) : view === "picks" ? (
        <Card className="border-white/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{year} Draft Picks — 5-Year VORP</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16 text-center">Pick</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Player</TableHead>
                  <TableHead className="w-14">Pos</TableHead>
                  <TableHead className="text-right w-16">ADP</TableHead>
                  <TableHead className="text-right w-24">5yr VORP</TableHead>
                  <TableHead className="w-16 text-center">Seasons</TableHead>
                  <TableHead className="w-16 text-center">Grade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {picks.map((pick, i) => {
                  const noData = !pick.position || !["QB","RB","WR","TE"].includes(pick.position);
                  return (
                    <TableRow
                      key={pick.pick_id}
                      className={cn(
                        i % 2 === 0 ? "" : "bg-white/[0.015]",
                        noData && "opacity-40",
                      )}
                    >
                      <TableCell className="text-center font-mono text-slate-400 text-sm">
                        {pick.round}.{String(pick.pick_number).padStart(2, "0")}
                      </TableCell>
                      <TableCell className="text-sm text-slate-300 whitespace-nowrap">
                        {pick.team_name}
                      </TableCell>
                      <TableCell className="font-medium text-white text-sm">
                        {pick.player_name}
                      </TableCell>
                      <TableCell>
                        <PosBadge pos={pick.position} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-slate-400">
                        {Number(pick.adp).toFixed(1)}
                      </TableCell>
                      <TableCell className={cn(
                        "text-right font-mono text-sm font-semibold",
                        noData ? "text-slate-600"
                          : Number(pick.five_yr_vorp) >= 75 ? "text-emerald-400"
                          : Number(pick.five_yr_vorp) >= 0  ? "text-sky-400"
                          : Number(pick.five_yr_vorp) >= -150 ? "text-amber-400"
                          : "text-red-400",
                      )}>
                        {noData ? "—" : formatVorp(Number(pick.five_yr_vorp))}
                      </TableCell>
                      <TableCell className="text-center text-sm text-slate-500">
                        {noData ? "—" : pick.seasons_with_data}
                      </TableCell>
                      <TableCell className="text-center">
                        {noData ? <span className="text-slate-600 text-xs">N/A</span>
                          : <GradeBadge grade={pick.vorp_grade} />}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        /* By Team view */
        <div className="space-y-4">
          {/* Team rankings summary card */}
          <Card className="border-white/10">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{year} Team Draft Rankings</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8 text-center">#</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead className="text-right w-20">Picks</TableHead>
                    <TableHead className="text-right w-28">Total VORP</TableHead>
                    <TableHead className="w-20 text-center">Grade</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teamSummaries.map((team, i) => (
                    <TableRow key={team.team_name} className={i % 2 === 0 ? "" : "bg-white/[0.015]"}>
                      <TableCell className="text-center text-slate-500 text-sm font-mono">
                        {i + 1}
                      </TableCell>
                      <TableCell className="font-semibold text-white">{team.team_name}</TableCell>
                      <TableCell className="text-right text-sm text-slate-400">{team.pick_count}</TableCell>
                      <TableCell className={cn(
                        "text-right font-mono text-sm font-semibold",
                        team.total_vorp >= 200 ? "text-emerald-400"
                          : team.total_vorp >= 0   ? "text-sky-400"
                          : team.total_vorp >= -100 ? "text-amber-400"
                          : "text-red-400",
                      )}>
                        {formatVorp(team.total_vorp)}
                      </TableCell>
                      <TableCell className="text-center">
                        <GradeBadge grade={team.avg_grade} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Per-team pick breakdowns */}
          {teamSummaries.map((team) => (
            <Card key={team.team_name} className="border-white/10">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold text-white">{team.team_name}</CardTitle>
                  <div className="flex items-center gap-3">
                    <span className={cn(
                      "text-sm font-mono font-semibold",
                      team.total_vorp >= 0 ? "text-emerald-400" : "text-red-400"
                    )}>
                      {formatVorp(team.total_vorp)} VORP
                    </span>
                    <GradeBadge grade={team.avg_grade} />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14 text-center">Pick</TableHead>
                      <TableHead>Player</TableHead>
                      <TableHead className="w-14">Pos</TableHead>
                      <TableHead className="text-right w-20">5yr VORP</TableHead>
                      <TableHead className="w-14 text-center">Grade</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {team.picks.sort((a, b) => a.overall_pick - b.overall_pick).map((pick, i) => (
                      <TableRow key={pick.pick_id} className={i % 2 === 0 ? "" : "bg-white/[0.015]"}>
                        <TableCell className="text-center font-mono text-slate-400 text-xs">
                          {pick.round}.{String(pick.pick_number).padStart(2, "0")}
                        </TableCell>
                        <TableCell className="font-medium text-white text-sm">{pick.player_name}</TableCell>
                        <TableCell><PosBadge pos={pick.position} /></TableCell>
                        <TableCell className={cn(
                          "text-right font-mono text-sm font-semibold",
                          Number(pick.five_yr_vorp) >= 75 ? "text-emerald-400"
                            : Number(pick.five_yr_vorp) >= 0 ? "text-sky-400"
                            : Number(pick.five_yr_vorp) >= -150 ? "text-amber-400"
                            : "text-red-400",
                        )}>
                          {formatVorp(Number(pick.five_yr_vorp))}
                        </TableCell>
                        <TableCell className="text-center">
                          <GradeBadge grade={pick.vorp_grade} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Grade legend */}
      <Card className="border-white/10">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span className="font-medium text-slate-400">VORP Grade Scale:</span>
            {[
              ["A+", "≥400"], ["A", "≥250"], ["A-", "≥150"],
              ["B+", "≥75"], ["B", "≥25"], ["B-", "≥0"],
              ["C", "≥−50"], ["D", "≥−150"], ["F", "<−150"],
            ].map(([g, r]) => (
              <span key={g} className="flex items-center gap-1">
                <GradeBadge grade={g} />
                <span>{r}</span>
              </span>
            ))}
            <span className="ml-2 border-l border-white/10 pl-2">5-year cumulative fantasy VORP vs. positional replacement (QB12, RB25, WR30, TE12)</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default DraftGrades;
