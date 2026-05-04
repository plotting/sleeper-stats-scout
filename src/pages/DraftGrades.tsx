
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
import { ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface VorpSeason {
  year: number;
  total_points: number;
  season_rank: number;
  position: string;
  vorp: number;
  games_played: number;
}

// ── Grade styles ──────────────────────────────────────────────────────────────

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

// ── VORP helpers ──────────────────────────────────────────────────────────────

function formatVorp(v: number): string {
  if (v > 0) return `+${v.toFixed(1)}`;
  return v.toFixed(1);
}

function vorpColor(v: number) {
  return v >= 75  ? "text-emerald-400"
       : v >= 0   ? "text-sky-400"
       : v >= -150 ? "text-amber-400"
       : "text-red-400";
}

// ── Pick Value helpers ────────────────────────────────────────────────────────
// Pick Value = actual 5yr VORP − expected VORP for that draft slot
// Expected VORP for slot N = average 5yr VORP of all historical players picked at slot N
// Positive = outperformed slot expectation · Negative = underperformed

function pickValueGrade(v: number): string {
  if (v >= 150) return "A+";
  if (v >= 75)  return "A";
  if (v >= 30)  return "A-";
  if (v >= 10)  return "B+";
  if (v >= -10) return "B";
  if (v >= -30) return "B-";
  if (v >= -75) return "C";
  if (v >= -150) return "D";
  return "F";
}

function pickValueColor(v: number): string {
  return v >= 30   ? "text-emerald-400"
       : v >= -10  ? "text-sky-400"
       : v >= -75  ? "text-amber-400"
       : "text-red-400";
}

function formatPickVal(v: number): string {
  if (v > 0) return `+${v.toFixed(1)}`;
  return v.toFixed(1);
}

function teamPickValueGrade(avg: number): string {
  if (avg >= 80)  return "A+";
  if (avg >= 40)  return "A";
  if (avg >= 15)  return "A-";
  if (avg >= 5)   return "B+";
  if (avg >= -5)  return "B";
  if (avg >= -15) return "B-";
  if (avg >= -40) return "C";
  if (avg >= -80) return "D";
  return "F";
}

// ── Weighted VORP grade ───────────────────────────────────────────────────────

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

// ── Year-by-year VORP breakdown ───────────────────────────────────────────────

function VorpBreakdown({
  playerName,
  draftYear,
  fiveYrVorp,
}: {
  playerName: string;
  draftYear: number;
  fiveYrVorp: number;
}) {
  const { data: seasons = [], isLoading } = useQuery({
    queryKey: ["player-vorp-detail", playerName, draftYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_vorp" as never)
        .select("year, total_points, season_rank, position, vorp, games_played")
        .eq("player_name", playerName)
        .gte("year", draftYear)
        .lt("year", draftYear + 5)
        .order("year");
      if (error) throw error;
      return data as VorpSeason[];
    },
  });

  return (
    <div className="mt-2 ml-4 mb-1">
      {isLoading ? (
        <p className="text-slate-500 text-xs animate-pulse py-1">Loading…</p>
      ) : (
        <table className="text-xs">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left pb-1 pr-6 font-medium text-slate-500 w-12">Year</th>
              <th className="text-right pb-1 pr-6 font-medium text-slate-500">Pts</th>
              <th className="text-right pb-1 pr-6 font-medium text-slate-500">Rank</th>
              <th className="text-right pb-1 font-medium text-slate-500">VORP</th>
            </tr>
          </thead>
          <tbody>
            {seasons.length === 0 ? (
              <tr><td colSpan={4} className="py-1 text-slate-600">No data yet</td></tr>
            ) : (
              seasons.map((s) => (
                <tr key={s.year} className="border-b border-white/[0.04]">
                  <td className="py-1 pr-6 text-slate-400 font-mono">{s.year}</td>
                  <td className="py-1 pr-6 text-right text-slate-300 font-mono">
                    {Number(s.total_points).toFixed(1)}
                  </td>
                  <td className="py-1 pr-6 text-right text-slate-400 font-mono">
                    {s.position}{s.season_rank}
                  </td>
                  <td className={cn(
                    "py-1 text-right font-mono font-semibold",
                    Number(s.vorp) >= 0 ? "text-emerald-400" : "text-red-400",
                  )}>
                    {formatVorp(Number(s.vorp))}
                  </td>
                </tr>
              ))
            )}
            {seasons.length > 0 && (
              <tr>
                <td colSpan={3} className="pt-1.5 text-slate-400 font-semibold">Total</td>
                <td className={cn(
                  "pt-1.5 text-right font-mono font-bold",
                  fiveYrVorp >= 0 ? "text-emerald-400" : "text-red-400",
                )}>
                  {formatVorp(fiveYrVorp)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

type PageTab = "grades" | "value" | "teams";
type ViewMode = "picks" | "byteam";

const DRAFT_YEARS = [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013];

const PAGE_TABS: { key: PageTab; label: string }[] = [
  { key: "grades", label: "VORP Grades" },
  { key: "value",  label: "Pick Value" },
  { key: "teams",  label: "Teams" },
];

// ── Main component ────────────────────────────────────────────────────────────

const DraftGrades = () => {
  const [year, setYear]               = useState(2023);
  const [pageTab, setPageTab]         = useState<PageTab>("grades");
  const [viewMode, setViewMode]       = useState<ViewMode>("picks");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const rowKey       = (p: DraftGradeRow) => `${p.round}-${p.pick_number}`;
  const toggleExpand = (key: string) => setExpandedKey((prev) => (prev === key ? null : key));
  const isExpanded   = (p: DraftGradeRow) => expandedKey === rowKey(p);

  // Current year's picks
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

  // Historical picks (all years ≤ 2021 for complete 5-yr windows)
  // Used to build the expected VORP curve per slot
  const { data: historicalPicks = [] } = useQuery({
    queryKey: ["draft-grades-historical"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rookie_draft_grades" as never)
        .select("overall_pick, five_yr_vorp, position, draft_year")
        .lte("draft_year", 2021)
        .in("position", ["QB", "RB", "WR", "TE"]);
      if (error) throw error;
      return data as { overall_pick: number; five_yr_vorp: number; position: string; draft_year: number }[];
    },
  });

  // Build expected VORP curve: for each overall_pick slot, average the 5yr VORP
  // of all players historically drafted at that slot (using ±1 slot smoothing)
  const expectedVorpCurve = useMemo(() => {
    if (historicalPicks.length === 0) return new Map<number, number>();
    const slotMap = new Map<number, number[]>();
    for (const p of historicalPicks) {
      const slot = p.overall_pick;
      if (!slotMap.has(slot)) slotMap.set(slot, []);
      slotMap.get(slot)!.push(Number(p.five_yr_vorp));
    }
    const result = new Map<number, number>();
    for (const slot of slotMap.keys()) {
      // Smooth: include neighbors ±1 to reduce single-outlier noise
      const values: number[] = [];
      for (let s = slot - 1; s <= slot + 1; s++) {
        const v = slotMap.get(s);
        if (v) values.push(...v);
      }
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      result.set(slot, avg);
    }
    return result;
  }, [historicalPicks]);

  function getExpectedVorp(slot: number): number | null {
    if (expectedVorpCurve.has(slot)) return expectedVorpCurve.get(slot)!;
    // Fallback: nearest slot within ±3
    for (let d = 1; d <= 3; d++) {
      if (expectedVorpCurve.has(slot - d)) return expectedVorpCurve.get(slot - d)!;
      if (expectedVorpCurve.has(slot + d)) return expectedVorpCurve.get(slot + d)!;
    }
    return null;
  }

  function getPickValue(pick: DraftGradeRow): number | null {
    const expected = getExpectedVorp(pick.overall_pick);
    if (expected === null) return null;
    return Number(pick.five_yr_vorp) - expected;
  }

  const handleYearChange = (v: string) => {
    setYear(parseInt(v));
    setExpandedKey(null);
  };

  const handlePageTab = (tab: PageTab) => {
    setPageTab(tab);
    setExpandedKey(null);
  };

  const gradablePicks = useMemo(
    () => picks.filter((p) => p.position && ["QB", "RB", "WR", "TE"].includes(p.position)),
    [picks]
  );

  // Picks sorted by pick value descending for Value tab
  const picksByValue = useMemo(
    () => [...gradablePicks].sort((a, b) => {
      const va = getPickValue(a) ?? -9999;
      const vb = getPickValue(b) ?? -9999;
      return vb - va;
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gradablePicks, expectedVorpCurve]
  );

  // VORP team summaries (Grades → By Team)
  const vorpTeamSummaries = useMemo(() => {
    const map = new Map<number, { team_name: string; picks: DraftGradeRow[] }>();
    for (const p of gradablePicks) {
      if (!map.has(p.team_id)) map.set(p.team_id, { team_name: p.team_name, picks: [] });
      map.get(p.team_id)!.picks.push(p);
    }
    return [...map.values()]
      .map(({ team_name, picks: tPicks }) => {
        const totalVorp   = tPicks.reduce((s, p) => s + Number(p.five_yr_vorp), 0);
        const avgGradeNum = tPicks.length
          ? tPicks.reduce((s, p) => s + (GRADE_NUM[p.vorp_grade] ?? 0), 0) / tPicks.length : 0;
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

  // Combined team summaries for Teams tab (VORP + pick value vs expectation)
  const teamSummaries = useMemo(() => {
    const map = new Map<number, { team_name: string; picks: DraftGradeRow[] }>();
    for (const p of gradablePicks) {
      if (!map.has(p.team_id)) map.set(p.team_id, { team_name: p.team_name, picks: [] });
      map.get(p.team_id)!.picks.push(p);
    }
    return [...map.values()]
      .map(({ team_name, picks: tPicks }) => {
        const totalVorp   = tPicks.reduce((s, p) => s + Number(p.five_yr_vorp), 0);
        const avgGradeNum = tPicks.length
          ? tPicks.reduce((s, p) => s + (GRADE_NUM[p.vorp_grade] ?? 0), 0) / tPicks.length : 0;

        const pickValues  = tPicks.map((p) => getPickValue(p)).filter((v): v is number => v !== null);
        const totalPickValue = pickValues.reduce((s, v) => s + v, 0);
        const avgPickValue   = pickValues.length ? totalPickValue / pickValues.length : 0;
        const avgPickNum     = tPicks.length
          ? tPicks.reduce((s, p) => s + p.overall_pick, 0) / tPicks.length : 0;

        return {
          team_name,
          picks: tPicks.sort((a, b) => a.overall_pick - b.overall_pick),
          pick_count: tPicks.length,
          total_vorp: totalVorp,
          vorp_grade: numToLetterGrade(avgGradeNum),
          avg_pick_num: avgPickNum,
          total_pick_value: totalPickValue,
          avg_pick_value: avgPickValue,
          pick_value_grade: teamPickValueGrade(avgPickValue),
          has_curve_data: pickValues.length > 0,
        };
      })
      .sort((a, b) => b.avg_pick_value - a.avg_pick_value);
  }, [gradablePicks, expectedVorpCurve]); // eslint-disable-line react-hooks/exhaustive-deps

  const curveReady = expectedVorpCurve.size > 0;

  const dataNote =
    year > 2023 ? "⚠️ Career data incomplete — VORP will update as seasons play out"
    : year > 2021 ? "⚠️ 5-year window may be incomplete — Pick Value comparison uses 2013–2021 baseline"
    : null;

  return (
    <div className="min-h-screen space-y-6">
      {/* ── Header ── */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Draft Grades</h1>
          <p className="text-muted-foreground">
            5-year VORP grades &amp; pick value vs. historical slot expectations
            {picks.length > 0 && (
              <span className="ml-1">· {gradablePicks.length} graded picks</span>
            )}
          </p>
          {dataNote && <p className="text-amber-400/80 text-xs mt-1">{dataNote}</p>}
        </div>
        <Select value={String(year)} onValueChange={handleYearChange}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DRAFT_YEARS.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y} Draft
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      {/* ── Page tabs ── */}
      <div className="flex gap-1 rounded-lg border border-white/10 p-1 w-fit">
        {PAGE_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => handlePageTab(key)}
            className={cn(
              "px-4 py-1.5 text-sm rounded-md transition-colors",
              pageTab === key
                ? "bg-white/10 text-white font-medium"
                : "text-slate-400 hover:text-white",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="py-20 text-center text-slate-500 text-sm animate-pulse">
          Loading {year} draft grades…
        </div>
      ) : picks.length === 0 ? (
        <div className="py-20 text-center text-slate-400 text-sm">
          No draft data for {year}.
        </div>
      ) : (
        <>
          {/* ═══════════════════════════════════════════════════════════════
              GRADES TAB
          ═══════════════════════════════════════════════════════════════ */}
          {pageTab === "grades" && (
            <div className="space-y-4">
              <div className="flex gap-1 rounded-lg border border-white/10 p-1 w-fit">
                {(["picks", "byteam"] as ViewMode[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => { setViewMode(v); setExpandedKey(null); }}
                    className={cn(
                      "px-3 py-1 text-xs rounded-md transition-colors",
                      viewMode === v ? "bg-white/10 text-white font-medium" : "text-slate-400 hover:text-white",
                    )}
                  >
                    {v === "picks" ? "By Pick" : "By Team"}
                  </button>
                ))}
              </div>

              {viewMode === "picks" ? (
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
                          const noData  = !pick.position || !["QB","RB","WR","TE"].includes(pick.position);
                          const expanded = isExpanded(pick);
                          return (
                            <TableRow
                              key={rowKey(pick)}
                              className={cn(
                                i % 2 === 0 ? "" : "bg-white/[0.015]",
                                noData ? "opacity-40" : "hover:bg-white/[0.04]",
                                expanded && "bg-white/[0.05]",
                              )}
                            >
                              <TableCell className="text-center font-mono text-slate-400 text-sm align-top pt-4">
                                {pick.round}.{String(pick.pick_number).padStart(2, "0")}
                              </TableCell>
                              <TableCell className="text-sm text-slate-300 whitespace-nowrap align-top pt-4">
                                {pick.team_name}
                              </TableCell>
                              <TableCell className="font-medium text-white text-sm">
                                {noData ? (
                                  <span className="flex items-center gap-1.5 py-2">{pick.player_name}</span>
                                ) : (
                                  <div>
                                    <button
                                      onClick={() => toggleExpand(rowKey(pick))}
                                      className="flex items-center gap-1.5 w-full text-left py-2 cursor-pointer hover:text-sky-300 transition-colors"
                                    >
                                      {expanded
                                        ? <ChevronDown className="h-3 w-3 text-slate-500 shrink-0" />
                                        : <ChevronRight className="h-3 w-3 text-slate-600 shrink-0" />
                                      }
                                      {pick.player_name}
                                    </button>
                                    {expanded && (
                                      <VorpBreakdown
                                        playerName={pick.player_name}
                                        draftYear={Number(pick.draft_year)}
                                        fiveYrVorp={Number(pick.five_yr_vorp)}
                                      />
                                    )}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="align-top pt-4"><PosBadge pos={pick.position} /></TableCell>
                              <TableCell className="text-right font-mono text-sm text-slate-400 align-top pt-4">
                                {Number(pick.adp).toFixed(1)}
                              </TableCell>
                              <TableCell className={cn(
                                "text-right font-mono text-sm font-semibold align-top pt-4",
                                noData ? "text-slate-600" : vorpColor(Number(pick.five_yr_vorp)),
                              )}>
                                {noData ? "—" : formatVorp(Number(pick.five_yr_vorp))}
                              </TableCell>
                              <TableCell className="text-center text-sm text-slate-500 align-top pt-4">
                                {noData ? "—" : pick.seasons_with_data}
                              </TableCell>
                              <TableCell className="text-center align-top pt-4">
                                {noData
                                  ? <span className="text-slate-600 text-xs">N/A</span>
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
                <div className="space-y-4">
                  <Card className="border-white/10">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">{year} Team VORP Rankings</CardTitle>
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
                          {vorpTeamSummaries.map((team, i) => (
                            <TableRow key={team.team_name} className={i % 2 === 0 ? "" : "bg-white/[0.015]"}>
                              <TableCell className="text-center text-slate-500 text-sm font-mono">{i + 1}</TableCell>
                              <TableCell className="font-semibold text-white">{team.team_name}</TableCell>
                              <TableCell className="text-right text-sm text-slate-400">{team.pick_count}</TableCell>
                              <TableCell className={cn("text-right font-mono text-sm font-semibold", vorpColor(team.total_vorp))}>
                                {formatVorp(team.total_vorp)}
                              </TableCell>
                              <TableCell className="text-center"><GradeBadge grade={team.avg_grade} /></TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>

                  {vorpTeamSummaries.map((team) => (
                    <Card key={team.team_name} className="border-white/10">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm font-semibold text-white">{team.team_name}</CardTitle>
                          <div className="flex items-center gap-3">
                            <span className={cn("text-sm font-mono font-semibold", team.total_vorp >= 0 ? "text-emerald-400" : "text-red-400")}>
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
                            {team.picks.sort((a, b) => a.overall_pick - b.overall_pick).map((pick, i) => {
                              const expanded = isExpanded(pick);
                              return (
                                <TableRow
                                  key={rowKey(pick)}
                                  className={cn(i % 2 === 0 ? "" : "bg-white/[0.015]", expanded && "bg-white/[0.05]", "hover:bg-white/[0.04]")}
                                >
                                  <TableCell className="text-center font-mono text-slate-400 text-xs align-top pt-4">
                                    {pick.round}.{String(pick.pick_number).padStart(2, "0")}
                                  </TableCell>
                                  <TableCell className="font-medium text-white text-sm">
                                    <div>
                                      <button
                                        onClick={() => toggleExpand(rowKey(pick))}
                                        className="flex items-center gap-1.5 w-full text-left py-2 cursor-pointer hover:text-sky-300 transition-colors"
                                      >
                                        {expanded
                                          ? <ChevronDown className="h-3 w-3 text-slate-500 shrink-0" />
                                          : <ChevronRight className="h-3 w-3 text-slate-600 shrink-0" />
                                        }
                                        {pick.player_name}
                                      </button>
                                      {expanded && (
                                        <VorpBreakdown
                                          playerName={pick.player_name}
                                          draftYear={Number(pick.draft_year)}
                                          fiveYrVorp={Number(pick.five_yr_vorp)}
                                        />
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell className="align-top pt-4"><PosBadge pos={pick.position} /></TableCell>
                                  <TableCell className={cn("text-right font-mono text-sm font-semibold align-top pt-4", vorpColor(Number(pick.five_yr_vorp)))}>
                                    {formatVorp(Number(pick.five_yr_vorp))}
                                  </TableCell>
                                  <TableCell className="text-center align-top pt-4"><GradeBadge grade={pick.vorp_grade} /></TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════
              PICK VALUE TAB
              Compares each player's actual 5yr VORP to the avg VORP of
              every player historically taken at that same draft slot.
          ═══════════════════════════════════════════════════════════════ */}
          {pageTab === "value" && (
            <div className="space-y-4">
              <Card className="border-white/10">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{year} — Pick Value vs. Slot Expectation</CardTitle>
                  <p className="text-xs text-slate-500 mt-1">
                    <span className="font-mono text-slate-400">Pick Value = Actual 5yr VORP − Expected VORP for that slot</span>
                    {" "}· Expected VORP = average of all players taken at that pick historically (2013–2021)
                    {" "}· Positive = outperformed the slot · Negative = underperformed
                  </p>
                </CardHeader>
                <CardContent className="pt-0">
                  {!curveReady ? (
                    <p className="py-8 text-center text-slate-500 text-sm animate-pulse">
                      Building expected VORP curve…
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-14 text-center">Pick</TableHead>
                          <TableHead>Team</TableHead>
                          <TableHead>Player</TableHead>
                          <TableHead className="w-14">Pos</TableHead>
                          <TableHead className="text-right w-24">Actual VORP</TableHead>
                          <TableHead className="text-right w-24">Expected</TableHead>
                          <TableHead className="text-right w-24">Pick Value</TableHead>
                          <TableHead className="w-16 text-center">Grade</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {picksByValue.map((pick, i) => {
                          const pv       = getPickValue(pick);
                          const expected = getExpectedVorp(pick.overall_pick);
                          return (
                            <TableRow key={rowKey(pick)} className={i % 2 === 0 ? "" : "bg-white/[0.015]"}>
                              <TableCell className="text-center font-mono text-slate-400 text-xs">
                                {pick.round}.{String(pick.pick_number).padStart(2, "0")}
                              </TableCell>
                              <TableCell className="text-sm text-slate-300 whitespace-nowrap">
                                {pick.team_name}
                              </TableCell>
                              <TableCell className="font-medium text-white text-sm">
                                {pick.player_name}
                              </TableCell>
                              <TableCell><PosBadge pos={pick.position} /></TableCell>
                              <TableCell className={cn("text-right font-mono text-sm font-semibold", vorpColor(Number(pick.five_yr_vorp)))}>
                                {formatVorp(Number(pick.five_yr_vorp))}
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm text-slate-500">
                                {expected !== null ? formatVorp(expected) : "—"}
                              </TableCell>
                              <TableCell className={cn(
                                "text-right font-mono text-sm font-semibold",
                                pv !== null ? pickValueColor(pv) : "text-slate-600",
                              )}>
                                {pv !== null ? formatPickVal(pv) : "—"}
                              </TableCell>
                              <TableCell className="text-center">
                                {pv !== null
                                  ? <GradeBadge grade={pickValueGrade(pv)} />
                                  : <span className="text-slate-600 text-xs">N/A</span>}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <Card className="border-white/10">
                <CardContent className="pt-4 pb-4 space-y-3">
                  <div className="text-xs text-slate-400 space-y-1">
                    <p className="font-medium text-slate-300">How Pick Value is calculated</p>
                    <p className="text-slate-500 leading-relaxed">
                      For each draft slot (e.g. pick 1.01), we average the 5-year VORP of every player
                      ever taken at that slot across all available years. That becomes the "expected" VORP
                      for the slot. A player picked at 1.01 who outperforms Bijan, Burrow, and every other
                      1.01 pick in history gets an A+. One who underperforms gets penalized accordingly.
                      This removes the luck of draft position — it only rewards outperforming the slot.
                    </p>
                  </div>
                  <div className="border-t border-white/10 pt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span className="font-medium text-slate-400">Grade scale (pick value):</span>
                    {[
                      ["A+","≥+150"],["A","≥+75"],["A-","≥+30"],
                      ["B+","≥+10"],["B","≈0"],["B-","≥−30"],
                      ["C","≥−75"],["D","≥−150"],["F","<−150"],
                    ].map(([g, r]) => (
                      <span key={g} className="flex items-center gap-1">
                        <GradeBadge grade={g} /><span>{r}</span>
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════
              TEAMS TAB
              Shows VORP grade + pick value efficiency per team.
              A team always picking 1.01 should have great VORP — the
              pick value column normalizes for draft slot.
          ═══════════════════════════════════════════════════════════════ */}
          {pageTab === "teams" && (
            <div className="space-y-4">
              <Card className="border-white/10">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{year} Team Report Card</CardTitle>
                  <p className="text-xs text-slate-500 mt-1">
                    Pick Value grade normalizes for draft slot — a team picking 1.01 every year
                    <em> should</em> get A VORP. Pick Value reveals who actually outperformed their spots.
                  </p>
                </CardHeader>
                <CardContent className="pt-0">
                  {!curveReady ? (
                    <p className="py-8 text-center text-slate-500 text-sm animate-pulse">Building curve…</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8 text-center">#</TableHead>
                          <TableHead>Team</TableHead>
                          <TableHead className="text-right w-16">Picks</TableHead>
                          <TableHead className="text-right w-20">Avg Slot</TableHead>
                          <TableHead className="text-right w-28">Total VORP</TableHead>
                          <TableHead className="w-20 text-center">VORP</TableHead>
                          <TableHead className="text-right w-28">Avg Pick Val</TableHead>
                          <TableHead className="w-24 text-center">Pick Eff.</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {teamSummaries.map((team, i) => (
                          <TableRow key={team.team_name} className={i % 2 === 0 ? "" : "bg-white/[0.015]"}>
                            <TableCell className="text-center text-slate-500 text-sm font-mono">{i + 1}</TableCell>
                            <TableCell className="font-semibold text-white">{team.team_name}</TableCell>
                            <TableCell className="text-right text-sm text-slate-400">{team.pick_count}</TableCell>
                            <TableCell className="text-right font-mono text-sm text-slate-400">
                              {team.avg_pick_num.toFixed(1)}
                            </TableCell>
                            <TableCell className={cn("text-right font-mono text-sm font-semibold", vorpColor(team.total_vorp))}>
                              {formatVorp(team.total_vorp)}
                            </TableCell>
                            <TableCell className="text-center"><GradeBadge grade={team.vorp_grade} /></TableCell>
                            <TableCell className={cn(
                              "text-right font-mono text-sm font-semibold",
                              team.has_curve_data ? pickValueColor(team.avg_pick_value) : "text-slate-600",
                            )}>
                              {team.has_curve_data ? formatPickVal(team.avg_pick_value) : "—"}
                            </TableCell>
                            <TableCell className="text-center">
                              {team.has_curve_data
                                ? <GradeBadge grade={team.pick_value_grade} />
                                : <span className="text-slate-600 text-xs">N/A</span>}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              {/* Per-team detail: each pick with both VORP and pick value */}
              {teamSummaries.map((team) => (
                <Card key={team.team_name} className="border-white/10">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <CardTitle className="text-sm font-semibold text-white">{team.team_name}</CardTitle>
                      <div className="flex items-center gap-3 text-xs flex-wrap">
                        <span className="text-slate-500">Avg slot:</span>
                        <span className="text-slate-300 font-mono">{team.avg_pick_num.toFixed(1)}</span>
                        <span className="text-slate-500">VORP:</span>
                        <span className={cn("font-mono font-semibold", vorpColor(team.total_vorp))}>
                          {formatVorp(team.total_vorp)}
                        </span>
                        <GradeBadge grade={team.vorp_grade} />
                        {team.has_curve_data && (
                          <>
                            <span className="text-slate-500">Pick val:</span>
                            <span className={cn("font-mono font-semibold", pickValueColor(team.avg_pick_value))}>
                              {formatPickVal(team.avg_pick_value)}
                            </span>
                            <GradeBadge grade={team.pick_value_grade} />
                          </>
                        )}
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
                          <TableHead className="text-right w-24">Actual VORP</TableHead>
                          <TableHead className="text-right w-24">Expected</TableHead>
                          <TableHead className="text-right w-24">Pick Value</TableHead>
                          <TableHead className="w-16 text-center">Grade</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {team.picks.map((pick, i) => {
                          const pv       = getPickValue(pick);
                          const expected = getExpectedVorp(pick.overall_pick);
                          return (
                            <TableRow key={rowKey(pick)} className={i % 2 === 0 ? "" : "bg-white/[0.015]"}>
                              <TableCell className="text-center font-mono text-slate-400 text-xs">
                                {pick.round}.{String(pick.pick_number).padStart(2, "0")}
                              </TableCell>
                              <TableCell className="font-medium text-white text-sm">{pick.player_name}</TableCell>
                              <TableCell><PosBadge pos={pick.position} /></TableCell>
                              <TableCell className={cn("text-right font-mono text-sm font-semibold", vorpColor(Number(pick.five_yr_vorp)))}>
                                {formatVorp(Number(pick.five_yr_vorp))}
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm text-slate-500">
                                {expected !== null ? formatVorp(expected) : "—"}
                              </TableCell>
                              <TableCell className={cn(
                                "text-right font-mono text-sm font-semibold",
                                pv !== null ? pickValueColor(pv) : "text-slate-600",
                              )}>
                                {pv !== null ? formatPickVal(pv) : "—"}
                              </TableCell>
                              <TableCell className="text-center">
                                {pv !== null
                                  ? <GradeBadge grade={pickValueGrade(pv)} />
                                  : <span className="text-slate-600 text-xs">—</span>}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── VORP legend (Grades tab only) ── */}
      {pageTab === "grades" && !isLoading && picks.length > 0 && (
        <Card className="border-white/10">
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="text-xs text-slate-400 space-y-1">
              <p className="font-medium text-slate-300">How VORP is calculated</p>
              <p className="text-slate-500 leading-relaxed">
                <span className="font-mono text-slate-400">VORP = player's pts − (replacement PPG × player's games played)</span>
                {" "}— injuries don't unfairly tank a grade since we compare against what the replacement
                player would have scored in the <em>same number of games</em>.
                Summed over the 5 seasons starting from draft year.
              </p>
              <p className="text-slate-500">Replacement levels: QB10 · RB30 · WR30 · TE10</p>
            </div>
            <div className="border-t border-white/10 pt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span className="font-medium text-slate-400">VORP grade scale:</span>
              {[
                ["A+","≥400"],["A","≥250"],["A-","≥150"],
                ["B+","≥75"],["B","≥25"],["B-","≥0"],
                ["C","≥−50"],["D","≥−150"],["F","<−150"],
              ].map(([g, r]) => (
                <span key={g} className="flex items-center gap-1">
                  <GradeBadge grade={g} /><span>{r}</span>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default DraftGrades;
