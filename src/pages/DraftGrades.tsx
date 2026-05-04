
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

interface RookieADP {
  rank: number;
  name: string;
  team: string;
  position: string;
  adp: number;
  year: number;
  synced_at: string;
}

interface HistoricalPick {
  overall_pick: number;
  round: number;
  pick_number: number;
  five_yr_vorp: number;
  position: string;
  draft_year: number;
  player_name: string;
}

type Position = "ALL" | "QB" | "RB" | "WR" | "TE";
type PageTab  = "grades" | "value" | "curve" | "teams";
type ViewMode = "picks" | "byteam" | "adp";

// ── Style helpers ─────────────────────────────────────────────────────────────

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
  K:  "text-slate-400 bg-slate-400/10 border-slate-400/30",
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

// ── Numeric helpers ───────────────────────────────────────────────────────────

function formatVorp(v: number): string {
  return v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1);
}

function vorpColor(v: number) {
  return v >= 75  ? "text-emerald-400"
       : v >= 0   ? "text-sky-400"
       : v >= -150 ? "text-amber-400"
       : "text-red-400";
}

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
  return v >= 30  ? "text-emerald-400"
       : v >= -10 ? "text-sky-400"
       : v >= -75 ? "text-amber-400"
       : "text-red-400";
}

function formatPickVal(v: number): string {
  return v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1);
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
  for (const [thresh, g] of NUM_GRADE) if (n >= thresh) return g;
  return "F";
}

// ── Year-by-year VORP breakdown (inside player cell) ─────────────────────────

function VorpBreakdown({
  playerName, draftYear, fiveYrVorp,
}: { playerName: string; draftYear: number; fiveYrVorp: number }) {
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
            ) : seasons.map((s) => (
              <tr key={s.year} className="border-b border-white/[0.04]">
                <td className="py-1 pr-6 text-slate-400 font-mono">{s.year}</td>
                <td className="py-1 pr-6 text-right text-slate-300 font-mono">{Number(s.total_points).toFixed(1)}</td>
                <td className="py-1 pr-6 text-right text-slate-400 font-mono">{s.position}{s.season_rank}</td>
                <td className={cn("py-1 text-right font-mono font-semibold", Number(s.vorp) >= 0 ? "text-emerald-400" : "text-red-400")}>
                  {formatVorp(Number(s.vorp))}
                </td>
              </tr>
            ))}
            {seasons.length > 0 && (
              <tr>
                <td colSpan={3} className="pt-1.5 text-slate-400 font-semibold">Total</td>
                <td className={cn("pt-1.5 text-right font-mono font-bold", fiveYrVorp >= 0 ? "text-emerald-400" : "text-red-400")}>
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

const DRAFT_YEARS     = [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013];
const ADP_YEARS       = [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013];
const GRADABLE_POS    = ["QB", "RB", "WR", "TE"];

const PAGE_TABS: { key: PageTab; label: string }[] = [
  { key: "grades", label: "VORP Grades" },
  { key: "value",  label: "Pick Value" },
  { key: "curve",  label: "Slot Curve" },
  { key: "teams",  label: "Teams" },
];

// ── Main component ────────────────────────────────────────────────────────────

const DraftGrades = () => {
  const [year, setYear]               = useState(2023);
  const [adpYear, setAdpYear]         = useState(2025);
  const [pageTab, setPageTab]         = useState<PageTab>("grades");
  const [viewMode, setViewMode]       = useState<ViewMode>("picks");
  const [adpSearch, setAdpSearch]     = useState("");
  const [adpPosFilter, setAdpPosFilter] = useState<Position>("ALL");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [expandedSlot, setExpandedSlot] = useState<number | null>(null);

  const rowKey       = (p: DraftGradeRow) => `${p.round}-${p.pick_number}`;
  const toggleExpand = (key: string)      => setExpandedKey((prev) => (prev === key ? null : key));
  const isExpanded   = (p: DraftGradeRow) => expandedKey === rowKey(p);

  // ── Queries ────────────────────────────────────────────────────────────────

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

  // Historical picks (2013–2021) — builds expected VORP curve + Slot Curve tab
  const { data: historicalPicks = [] } = useQuery({
    queryKey: ["draft-grades-historical"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rookie_draft_grades" as never)
        .select("overall_pick, round, pick_number, five_yr_vorp, position, draft_year, player_name")
        .lte("draft_year", 2021)
        .in("position", GRADABLE_POS);
      if (error) throw error;
      return data as HistoricalPick[];
    },
  });

  // Rookie ADP for the ADP sub-tab
  const { data: adpRookies = [], isLoading: adpLoading } = useQuery({
    queryKey: ["rookie-adp", adpYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rookie_adp")
        .select("rank, name, team, position, adp, year, synced_at")
        .eq("year", adpYear)
        .order("adp");
      if (error) throw error;
      return data as RookieADP[];
    },
    enabled: viewMode === "adp",
  });

  // ── Derived data ───────────────────────────────────────────────────────────

  // Smoothed expected VORP curve (±1 slot) used for Pick Value calculations
  const expectedVorpCurve = useMemo(() => {
    if (historicalPicks.length === 0) return new Map<number, number>();
    const slotMap = new Map<number, number[]>();
    for (const p of historicalPicks) {
      if (!slotMap.has(p.overall_pick)) slotMap.set(p.overall_pick, []);
      slotMap.get(p.overall_pick)!.push(Number(p.five_yr_vorp));
    }
    const result = new Map<number, number>();
    for (const slot of slotMap.keys()) {
      const values: number[] = [];
      for (let s = slot - 1; s <= slot + 1; s++) {
        const v = slotMap.get(s);
        if (v) values.push(...v);
      }
      result.set(slot, values.reduce((a, b) => a + b, 0) / values.length);
    }
    return result;
  }, [historicalPicks]);

  // Raw per-slot data for the Slot Curve tab (no smoothing — shows actual players)
  const slotCurveData = useMemo(() => {
    if (historicalPicks.length === 0) return [];
    const slotMap = new Map<number, {
      overall_pick: number; round: number; pick_number: number;
      players: { player_name: string; draft_year: number; five_yr_vorp: number; position: string }[];
    }>();
    for (const p of historicalPicks) {
      const slot = p.overall_pick;
      if (!slotMap.has(slot)) {
        slotMap.set(slot, { overall_pick: slot, round: p.round, pick_number: p.pick_number, players: [] });
      }
      slotMap.get(slot)!.players.push({
        player_name: p.player_name,
        draft_year: p.draft_year,
        five_yr_vorp: Number(p.five_yr_vorp),
        position: p.position,
      });
    }
    return [...slotMap.values()]
      .map((slot) => {
        const sorted = [...slot.players].sort((a, b) => b.five_yr_vorp - a.five_yr_vorp);
        const avg = slot.players.reduce((s, p) => s + p.five_yr_vorp, 0) / slot.players.length;
        return { ...slot, players: sorted, avg_vorp: avg, count: slot.players.length };
      })
      .sort((a, b) => a.overall_pick - b.overall_pick);
  }, [historicalPicks]);

  function getExpectedVorp(slot: number): number | null {
    if (expectedVorpCurve.has(slot)) return expectedVorpCurve.get(slot)!;
    for (let d = 1; d <= 3; d++) {
      if (expectedVorpCurve.has(slot - d)) return expectedVorpCurve.get(slot - d)!;
      if (expectedVorpCurve.has(slot + d)) return expectedVorpCurve.get(slot + d)!;
    }
    return null;
  }

  function getPickValue(pick: DraftGradeRow): number | null {
    const expected = getExpectedVorp(pick.overall_pick);
    return expected === null ? null : Number(pick.five_yr_vorp) - expected;
  }

  const gradablePicks = useMemo(
    () => picks.filter((p) => p.position && GRADABLE_POS.includes(p.position)),
    [picks]
  );

  const picksByValue = useMemo(
    () => [...gradablePicks].sort((a, b) => (getPickValue(b) ?? -9999) - (getPickValue(a) ?? -9999)),
    [gradablePicks, expectedVorpCurve] // eslint-disable-line
  );

  const vorpTeamSummaries = useMemo(() => {
    const map = new Map<number, { team_name: string; picks: DraftGradeRow[] }>();
    for (const p of gradablePicks) {
      if (!map.has(p.team_id)) map.set(p.team_id, { team_name: p.team_name, picks: [] });
      map.get(p.team_id)!.picks.push(p);
    }
    return [...map.values()]
      .map(({ team_name, picks: tp }) => {
        const totalVorp  = tp.reduce((s, p) => s + Number(p.five_yr_vorp), 0);
        const avgGradeNum = tp.length ? tp.reduce((s, p) => s + (GRADE_NUM[p.vorp_grade] ?? 0), 0) / tp.length : 0;
        return { team_name, picks: tp, pick_count: tp.length, total_vorp: totalVorp, avg_grade: numToLetterGrade(avgGradeNum) };
      })
      .sort((a, b) => b.total_vorp - a.total_vorp);
  }, [gradablePicks]);

  const teamSummaries = useMemo(() => {
    const map = new Map<number, { team_name: string; picks: DraftGradeRow[] }>();
    for (const p of gradablePicks) {
      if (!map.has(p.team_id)) map.set(p.team_id, { team_name: p.team_name, picks: [] });
      map.get(p.team_id)!.picks.push(p);
    }
    return [...map.values()]
      .map(({ team_name, picks: tp }) => {
        const totalVorp   = tp.reduce((s, p) => s + Number(p.five_yr_vorp), 0);
        const avgGradeNum = tp.length ? tp.reduce((s, p) => s + (GRADE_NUM[p.vorp_grade] ?? 0), 0) / tp.length : 0;
        const pvs         = tp.map(getPickValue).filter((v): v is number => v !== null);
        const avgPickVal  = pvs.length ? pvs.reduce((s, v) => s + v, 0) / pvs.length : 0;
        const avgPickNum  = tp.length ? tp.reduce((s, p) => s + p.overall_pick, 0) / tp.length : 0;
        return {
          team_name,
          picks: [...tp].sort((a, b) => a.overall_pick - b.overall_pick),
          pick_count: tp.length,
          total_vorp: totalVorp,
          vorp_grade: numToLetterGrade(avgGradeNum),
          avg_pick_num: avgPickNum,
          avg_pick_value: avgPickVal,
          pick_value_grade: teamPickValueGrade(avgPickVal),
          has_curve_data: pvs.length > 0,
        };
      })
      .sort((a, b) => b.avg_pick_value - a.avg_pick_value);
  }, [gradablePicks, expectedVorpCurve]); // eslint-disable-line

  const adpFiltered = useMemo(() => {
    return adpRookies
      .filter((p) => adpPosFilter === "ALL" || p.position === adpPosFilter)
      .filter((p) => !adpSearch || p.name.toLowerCase().includes(adpSearch.toLowerCase()) || (p.team ?? "").toLowerCase().includes(adpSearch.toLowerCase()));
  }, [adpRookies, adpPosFilter, adpSearch]);

  const adpPosCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of adpRookies) m[p.position] = (m[p.position] ?? 0) + 1;
    return m;
  }, [adpRookies]);

  const curveReady = expectedVorpCurve.size > 0;

  const handleYearChange = (v: string) => { setYear(parseInt(v)); setExpandedKey(null); };
  const handlePageTab    = (tab: PageTab) => { setPageTab(tab); setExpandedKey(null); };

  const dataNote = year > 2023
    ? "⚠️ Career data incomplete — VORP will update as seasons play out"
    : year > 2021
    ? "⚠️ 5-year window may be incomplete — Pick Value uses 2013–2021 baseline"
    : null;

  // ── Render helpers ─────────────────────────────────────────────────────────

  // Shared player-name cell with expand button (used in Grades by-pick and by-team)
  const PlayerCell = ({ pick }: { pick: DraftGradeRow }) => {
    const expanded = isExpanded(pick);
    return (
      <div>
        <button
          onClick={() => toggleExpand(rowKey(pick))}
          className="flex items-center gap-1.5 w-full text-left py-2 cursor-pointer hover:text-sky-300 transition-colors"
        >
          {expanded
            ? <ChevronDown className="h-3 w-3 text-slate-500 shrink-0" />
            : <ChevronRight className="h-3 w-3 text-slate-600 shrink-0" />}
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
    );
  };

  // ── Layout ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Draft Grades</h1>
          <p className="text-muted-foreground">
            5-year VORP grades, pick efficiency &amp; rookie ADP
            {picks.length > 0 && pageTab !== "curve" && (
              <span className="ml-1">· {gradablePicks.length} graded picks</span>
            )}
          </p>
          {dataNote && pageTab !== "curve" && (
            <p className="text-amber-400/80 text-xs mt-1">{dataNote}</p>
          )}
        </div>
        {/* Year selector — hidden when on Curve tab (year-agnostic) or ADP sub-tab (has own) */}
        {pageTab !== "curve" && !(pageTab === "grades" && viewMode === "adp") && (
          <Select value={String(year)} onValueChange={handleYearChange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DRAFT_YEARS.map((y) => (
                <SelectItem key={y} value={String(y)}>{y} Draft</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </header>

      {/* ── Page tabs ──────────────────────────────────────────────────────── */}
      <div className="flex gap-1 rounded-lg border border-white/10 p-1 w-fit">
        {PAGE_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => handlePageTab(key)}
            className={cn(
              "px-4 py-1.5 text-sm rounded-md transition-colors",
              pageTab === key ? "bg-white/10 text-white font-medium" : "text-slate-400 hover:text-white",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          GRADES TAB  (By Pick | By Team | ADP)
      ═══════════════════════════════════════════════════════════════════════ */}
      {pageTab === "grades" && (
        <div className="space-y-4">

          {/* Sub-tab toggle */}
          <div className="flex gap-1 rounded-lg border border-white/10 p-1 w-fit">
            {([
              { key: "picks",  label: "By Pick"  },
              { key: "byteam", label: "By Team"  },
              { key: "adp",    label: "ADP"      },
            ] as { key: ViewMode; label: string }[]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => { setViewMode(key); setExpandedKey(null); }}
                className={cn(
                  "px-3 py-1 text-xs rounded-md transition-colors",
                  viewMode === key ? "bg-white/10 text-white font-medium" : "text-slate-400 hover:text-white",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {isLoading && viewMode !== "adp" ? (
            <div className="py-20 text-center text-slate-500 text-sm animate-pulse">Loading {year} draft grades…</div>
          ) : picks.length === 0 && viewMode !== "adp" ? (
            <div className="py-20 text-center text-slate-400 text-sm">No draft data for {year}.</div>
          ) : viewMode === "picks" ? (
            /* ── By Pick ── */
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
                      const noData = !pick.position || !GRADABLE_POS.includes(pick.position);
                      return (
                        <TableRow
                          key={rowKey(pick)}
                          className={cn(i % 2 === 0 ? "" : "bg-white/[0.015]", noData ? "opacity-40" : "hover:bg-white/[0.04]", isExpanded(pick) && "bg-white/[0.05]")}
                        >
                          <TableCell className="text-center font-mono text-slate-400 text-sm align-top pt-4">
                            {pick.round}.{String(pick.pick_number).padStart(2, "0")}
                          </TableCell>
                          <TableCell className="text-sm text-slate-300 whitespace-nowrap align-top pt-4">{pick.team_name}</TableCell>
                          <TableCell className="font-medium text-white text-sm">
                            {noData
                              ? <span className="flex items-center gap-1.5 py-2">{pick.player_name}</span>
                              : <PlayerCell pick={pick} />}
                          </TableCell>
                          <TableCell className="align-top pt-4"><PosBadge pos={pick.position} /></TableCell>
                          <TableCell className="text-right font-mono text-sm text-slate-400 align-top pt-4">{Number(pick.adp).toFixed(1)}</TableCell>
                          <TableCell className={cn("text-right font-mono text-sm font-semibold align-top pt-4", noData ? "text-slate-600" : vorpColor(Number(pick.five_yr_vorp)))}>
                            {noData ? "—" : formatVorp(Number(pick.five_yr_vorp))}
                          </TableCell>
                          <TableCell className="text-center text-sm text-slate-500 align-top pt-4">{noData ? "—" : pick.seasons_with_data}</TableCell>
                          <TableCell className="text-center align-top pt-4">
                            {noData ? <span className="text-slate-600 text-xs">N/A</span> : <GradeBadge grade={pick.vorp_grade} />}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

          ) : viewMode === "byteam" ? (
            /* ── By Team ── */
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
                          <TableCell className={cn("text-right font-mono text-sm font-semibold", vorpColor(team.total_vorp))}>{formatVorp(team.total_vorp)}</TableCell>
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
                        {[...team.picks].sort((a, b) => a.overall_pick - b.overall_pick).map((pick, i) => (
                          <TableRow key={rowKey(pick)} className={cn(i % 2 === 0 ? "" : "bg-white/[0.015]", isExpanded(pick) && "bg-white/[0.05]", "hover:bg-white/[0.04]")}>
                            <TableCell className="text-center font-mono text-slate-400 text-xs align-top pt-4">
                              {pick.round}.{String(pick.pick_number).padStart(2, "0")}
                            </TableCell>
                            <TableCell className="font-medium text-white text-sm"><PlayerCell pick={pick} /></TableCell>
                            <TableCell className="align-top pt-4"><PosBadge pos={pick.position} /></TableCell>
                            <TableCell className={cn("text-right font-mono text-sm font-semibold align-top pt-4", vorpColor(Number(pick.five_yr_vorp)))}>{formatVorp(Number(pick.five_yr_vorp))}</TableCell>
                            <TableCell className="text-center align-top pt-4"><GradeBadge grade={pick.vorp_grade} /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              ))}
            </div>

          ) : (
            /* ── ADP sub-tab (Rookies content) ── */
            <Card className="border-white/10">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center gap-3 justify-between">
                  <CardTitle className="text-base">{adpYear} Rookie ADP</CardTitle>
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* ADP year selector */}
                    <Select value={String(adpYear)} onValueChange={(v) => setAdpYear(parseInt(v))}>
                      <SelectTrigger className="w-[130px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ADP_YEARS.map((y) => (
                          <SelectItem key={y} value={String(y)}>{y} Rookies</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {/* Search */}
                    <input
                      type="text"
                      placeholder="Search player or team…"
                      value={adpSearch}
                      onChange={(e) => setAdpSearch(e.target.value)}
                      className="bg-white/5 border border-white/10 rounded-md px-3 py-1.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-white/30 w-44"
                    />
                    {/* Position filter */}
                    <div className="flex gap-1 rounded-lg border border-white/10 p-1">
                      {(["ALL", "QB", "RB", "WR", "TE"] as Position[]).map((p) => (
                        <button
                          key={p}
                          onClick={() => setAdpPosFilter(p)}
                          className={cn("px-2.5 py-1 text-xs rounded-md transition-colors", adpPosFilter === p ? "bg-white/10 text-white font-medium" : "text-slate-400 hover:text-white")}
                        >
                          {p}
                          {p !== "ALL" && adpPosCounts[p] ? <span className="ml-1 opacity-50">{adpPosCounts[p]}</span> : null}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {adpRookies[0]?.synced_at && (
                  <p className="text-xs text-slate-600 mt-1">
                    synced {new Date(adpRookies[0].synced_at).toLocaleDateString()}
                    {adpRookies.length > 0 && <span className="ml-2">· {adpRookies.length} players</span>}
                  </p>
                )}
              </CardHeader>
              <CardContent className="pt-0">
                {adpLoading ? (
                  <div className="py-12 text-center text-slate-500 text-sm animate-pulse">Loading {adpYear} rookie ADP…</div>
                ) : adpRookies.length === 0 ? (
                  <div className="py-12 text-center space-y-2">
                    <p className="text-slate-400 text-sm">No data for {adpYear} yet.</p>
                    <p className="text-slate-600 text-xs">Use the "Sync Rookies" button in Admin to pull from FantasyPros.</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12 text-right">#</TableHead>
                        <TableHead>Player</TableHead>
                        <TableHead>Pos</TableHead>
                        <TableHead>NFL Team</TableHead>
                        <TableHead className="text-right">ADP</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {adpFiltered.map((player, i) => (
                        <TableRow key={player.name} className={i % 2 === 0 ? "" : "bg-white/[0.015]"}>
                          <TableCell className="text-right font-mono text-slate-500 text-sm">{player.rank}</TableCell>
                          <TableCell className="font-medium text-white text-sm">{player.name}</TableCell>
                          <TableCell><PosBadge pos={player.position} /></TableCell>
                          <TableCell className="font-mono text-sm text-slate-400">{player.team || <span className="text-slate-600">FA</span>}</TableCell>
                          <TableCell className="text-right font-mono text-sm font-semibold text-white">{player.adp.toFixed(1)}</TableCell>
                        </TableRow>
                      ))}
                      {adpFiltered.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-8 text-slate-500">No players match your filter</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}

          {/* VORP legend at bottom of Grades tab */}
          {viewMode !== "adp" && !isLoading && picks.length > 0 && (
            <Card className="border-white/10">
              <CardContent className="pt-4 pb-4 space-y-3">
                <div className="text-xs text-slate-400 space-y-1">
                  <p className="font-medium text-slate-300">How VORP is calculated</p>
                  <p className="text-slate-500 leading-relaxed">
                    <span className="font-mono text-slate-400">VORP = player's pts − (replacement PPG × player's games played)</span>
                    {" "}· Injuries don't tank grades since we compare against what the replacement would score in the same number of games.
                    Summed over 5 seasons from draft year. Replacement levels: QB10 · RB30 · WR30 · TE10
                  </p>
                </div>
                <div className="border-t border-white/10 pt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  <span className="font-medium text-slate-400">Grade scale:</span>
                  {[["A+","≥400"],["A","≥250"],["A-","≥150"],["B+","≥75"],["B","≥25"],["B-","≥0"],["C","≥−50"],["D","≥−150"],["F","<−150"]].map(([g, r]) => (
                    <span key={g} className="flex items-center gap-1"><GradeBadge grade={g} /><span>{r}</span></span>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          PICK VALUE TAB
      ═══════════════════════════════════════════════════════════════════════ */}
      {pageTab === "value" && (
        <>
          {isLoading ? (
            <div className="py-20 text-center text-slate-500 text-sm animate-pulse">Loading {year} draft grades…</div>
          ) : picks.length === 0 ? (
            <div className="py-20 text-center text-slate-400 text-sm">No draft data for {year}.</div>
          ) : (
            <div className="space-y-4">
              <Card className="border-white/10">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{year} — Pick Value vs. Slot Expectation</CardTitle>
                  <p className="text-xs text-slate-500 mt-1">
                    <span className="font-mono text-slate-400">Pick Value = Actual 5yr VORP − Expected VORP for that slot</span>
                    {" "}· Expected = avg of all players taken at that pick historically (2013–2021)
                    {" "}· Positive = outperformed · Negative = underperformed
                  </p>
                </CardHeader>
                <CardContent className="pt-0">
                  {!curveReady ? (
                    <p className="py-8 text-center text-slate-500 text-sm animate-pulse">Building expected VORP curve…</p>
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
                          const pv  = getPickValue(pick);
                          const exp = getExpectedVorp(pick.overall_pick);
                          return (
                            <TableRow key={rowKey(pick)} className={i % 2 === 0 ? "" : "bg-white/[0.015]"}>
                              <TableCell className="text-center font-mono text-slate-400 text-xs">
                                {pick.round}.{String(pick.pick_number).padStart(2, "0")}
                              </TableCell>
                              <TableCell className="text-sm text-slate-300 whitespace-nowrap">{pick.team_name}</TableCell>
                              <TableCell className="font-medium text-white text-sm">{pick.player_name}</TableCell>
                              <TableCell><PosBadge pos={pick.position} /></TableCell>
                              <TableCell className={cn("text-right font-mono text-sm font-semibold", vorpColor(Number(pick.five_yr_vorp)))}>{formatVorp(Number(pick.five_yr_vorp))}</TableCell>
                              <TableCell className="text-right font-mono text-sm text-slate-500">{exp !== null ? formatVorp(exp) : "—"}</TableCell>
                              <TableCell className={cn("text-right font-mono text-sm font-semibold", pv !== null ? pickValueColor(pv) : "text-slate-600")}>
                                {pv !== null ? formatPickVal(pv) : "—"}
                              </TableCell>
                              <TableCell className="text-center">
                                {pv !== null ? <GradeBadge grade={pickValueGrade(pv)} /> : <span className="text-slate-600 text-xs">N/A</span>}
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
                      For each slot (e.g. 1.01), we average the 5-year VORP of every player ever taken
                      there from 2013–2021. That becomes the slot's expected VORP. Pick Value is how far
                      above or below that baseline the actual player landed. See the <strong className="text-slate-400">Slot Curve</strong> tab
                      to inspect the historical players behind each slot's expected VORP.
                    </p>
                  </div>
                  <div className="border-t border-white/10 pt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span className="font-medium text-slate-400">Grade scale:</span>
                    {[["A+","≥+150"],["A","≥+75"],["A-","≥+30"],["B+","≥+10"],["B","≈0"],["B-","≥−30"],["C","≥−75"],["D","≥−150"],["F","<−150"]].map(([g, r]) => (
                      <span key={g} className="flex items-center gap-1"><GradeBadge grade={g} /><span>{r}</span></span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          SLOT CURVE TAB
          Historical VORP baseline per pick slot — click any row to see
          which players were taken at that slot and what they scored.
      ═══════════════════════════════════════════════════════════════════════ */}
      {pageTab === "curve" && (
        <div className="space-y-4">
          <Card className="border-white/10">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Historical Expected VORP by Draft Slot</CardTitle>
              <p className="text-xs text-slate-500 mt-1">
                2013–2021 baseline · Click any slot to see every player taken there and their 5-year VORP
              </p>
            </CardHeader>
            <CardContent className="pt-0">
              {slotCurveData.length === 0 ? (
                <p className="py-8 text-center text-slate-500 text-sm animate-pulse">Loading historical data…</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14 text-center">Slot</TableHead>
                      <TableHead className="text-right w-20">Players</TableHead>
                      <TableHead className="text-right w-32">Avg VORP</TableHead>
                      <TableHead className="text-right w-24">Best</TableHead>
                      <TableHead className="text-right w-24">Worst</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {slotCurveData.map((slot) => {
                      const isOpen = expandedSlot === slot.overall_pick;
                      const best   = slot.players[0]?.five_yr_vorp ?? 0;
                      const worst  = slot.players[slot.players.length - 1]?.five_yr_vorp ?? 0;
                      return (
                        <>
                          <TableRow
                            key={slot.overall_pick}
                            className={cn("hover:bg-white/[0.04] cursor-pointer", isOpen && "bg-white/[0.05]")}
                            onClick={() => setExpandedSlot(isOpen ? null : slot.overall_pick)}
                          >
                            <TableCell className="text-center font-mono text-slate-300 font-semibold">
                              <span className="flex items-center justify-center gap-1">
                                {isOpen
                                  ? <ChevronDown className="h-3 w-3 text-slate-500" />
                                  : <ChevronRight className="h-3 w-3 text-slate-600" />}
                                {slot.round}.{String(slot.pick_number).padStart(2, "0")}
                              </span>
                            </TableCell>
                            <TableCell className="text-right text-sm text-slate-400">{slot.count}</TableCell>
                            <TableCell className={cn("text-right font-mono text-sm font-semibold", vorpColor(slot.avg_vorp))}>
                              {formatVorp(slot.avg_vorp)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-emerald-400">{formatVorp(best)}</TableCell>
                            <TableCell className="text-right font-mono text-xs text-red-400">{formatVorp(worst)}</TableCell>
                          </TableRow>

                          {isOpen && (
                            <TableRow key={`${slot.overall_pick}-detail`} className="bg-white/[0.03]">
                              <TableCell colSpan={5} className="py-2 px-4">
                                <div className="text-xs mb-1 text-slate-500 font-medium uppercase tracking-wider">
                                  Players taken at {slot.round}.{String(slot.pick_number).padStart(2, "0")}
                                </div>
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b border-white/10">
                                      <th className="text-left pb-1 pr-6 font-medium text-slate-500">Player</th>
                                      <th className="text-left pb-1 pr-6 font-medium text-slate-500">Year</th>
                                      <th className="text-left pb-1 pr-4 font-medium text-slate-500">Pos</th>
                                      <th className="text-right pb-1 font-medium text-slate-500">5yr VORP</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {slot.players.map((p) => (
                                      <tr key={`${p.player_name}-${p.draft_year}`} className="border-b border-white/[0.04]">
                                        <td className="py-1 pr-6 text-white font-medium">{p.player_name}</td>
                                        <td className="py-1 pr-6 text-slate-400 font-mono">{p.draft_year}</td>
                                        <td className="py-1 pr-4">
                                          <PosBadge pos={p.position} />
                                        </td>
                                        <td className={cn("py-1 text-right font-mono font-semibold", vorpColor(p.five_yr_vorp))}>
                                          {formatVorp(p.five_yr_vorp)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          TEAMS TAB
      ═══════════════════════════════════════════════════════════════════════ */}
      {pageTab === "teams" && (
        <>
          {isLoading ? (
            <div className="py-20 text-center text-slate-500 text-sm animate-pulse">Loading {year} draft grades…</div>
          ) : picks.length === 0 ? (
            <div className="py-20 text-center text-slate-400 text-sm">No draft data for {year}.</div>
          ) : (
            <div className="space-y-4">
              <Card className="border-white/10">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{year} Team Report Card</CardTitle>
                  <p className="text-xs text-slate-500 mt-1">
                    Ranked by Pick Value efficiency — VORP grade shows raw performance,
                    Pick Eff. shows who outperformed their actual draft slots.
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
                            <TableCell className="text-right font-mono text-sm text-slate-400">{team.avg_pick_num.toFixed(1)}</TableCell>
                            <TableCell className={cn("text-right font-mono text-sm font-semibold", vorpColor(team.total_vorp))}>{formatVorp(team.total_vorp)}</TableCell>
                            <TableCell className="text-center"><GradeBadge grade={team.vorp_grade} /></TableCell>
                            <TableCell className={cn("text-right font-mono text-sm font-semibold", team.has_curve_data ? pickValueColor(team.avg_pick_value) : "text-slate-600")}>
                              {team.has_curve_data ? formatPickVal(team.avg_pick_value) : "—"}
                            </TableCell>
                            <TableCell className="text-center">
                              {team.has_curve_data ? <GradeBadge grade={team.pick_value_grade} /> : <span className="text-slate-600 text-xs">N/A</span>}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              {teamSummaries.map((team) => (
                <Card key={team.team_name} className="border-white/10">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <CardTitle className="text-sm font-semibold text-white">{team.team_name}</CardTitle>
                      <div className="flex items-center gap-3 text-xs flex-wrap">
                        <span className="text-slate-500">Avg slot:</span>
                        <span className="text-slate-300 font-mono">{team.avg_pick_num.toFixed(1)}</span>
                        <span className="text-slate-500">VORP:</span>
                        <span className={cn("font-mono font-semibold", vorpColor(team.total_vorp))}>{formatVorp(team.total_vorp)}</span>
                        <GradeBadge grade={team.vorp_grade} />
                        {team.has_curve_data && (
                          <>
                            <span className="text-slate-500">Pick val:</span>
                            <span className={cn("font-mono font-semibold", pickValueColor(team.avg_pick_value))}>{formatPickVal(team.avg_pick_value)}</span>
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
                          const pv  = getPickValue(pick);
                          const exp = getExpectedVorp(pick.overall_pick);
                          return (
                            <TableRow key={rowKey(pick)} className={i % 2 === 0 ? "" : "bg-white/[0.015]"}>
                              <TableCell className="text-center font-mono text-slate-400 text-xs">
                                {pick.round}.{String(pick.pick_number).padStart(2, "0")}
                              </TableCell>
                              <TableCell className="font-medium text-white text-sm">{pick.player_name}</TableCell>
                              <TableCell><PosBadge pos={pick.position} /></TableCell>
                              <TableCell className={cn("text-right font-mono text-sm font-semibold", vorpColor(Number(pick.five_yr_vorp)))}>{formatVorp(Number(pick.five_yr_vorp))}</TableCell>
                              <TableCell className="text-right font-mono text-sm text-slate-500">{exp !== null ? formatVorp(exp) : "—"}</TableCell>
                              <TableCell className={cn("text-right font-mono text-sm font-semibold", pv !== null ? pickValueColor(pv) : "text-slate-600")}>
                                {pv !== null ? formatPickVal(pv) : "—"}
                              </TableCell>
                              <TableCell className="text-center">
                                {pv !== null ? <GradeBadge grade={pickValueGrade(pv)} /> : <span className="text-slate-600 text-xs">—</span>}
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
    </div>
  );
};

export default DraftGrades;
