
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

interface RookieADP {
  rank: number;
  name: string;
  team: string;
  position: string;
  adp: number;
  year: number;
  synced_at: string;
}

type Position = "ALL" | "QB" | "RB" | "WR" | "TE";

const POS_COLORS: Record<string, string> = {
  QB: "text-amber-400 bg-amber-400/10 border-amber-400/30",
  RB: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
  WR: "text-sky-400 bg-sky-400/10 border-sky-400/30",
  TE: "text-violet-400 bg-violet-400/10 border-violet-400/30",
  K:  "text-slate-400 bg-slate-400/10 border-slate-400/30",
  OL: "text-slate-400 bg-slate-400/10 border-slate-400/30",
};

function PosBadge({ pos }: { pos: string }) {
  return (
    <span className={cn(
      "inline-block px-1.5 py-0.5 rounded text-[10px] font-bold border",
      POS_COLORS[pos] ?? "text-slate-400 bg-slate-400/10 border-slate-400/30",
    )}>
      {pos}
    </span>
  );
}

// Years that FantasyPros has rookie ADP data for
const AVAILABLE_YEARS = [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013];

const Rookies = () => {
  const [posFilter, setPosFilter] = useState<Position>("ALL");
  const [search, setSearch] = useState("");
  const [year, setYear] = useState(2025);

  const { data: rookies = [], isLoading } = useQuery({
    queryKey: ["rookie-adp", year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rookie_adp")
        .select("rank, name, team, position, adp, year, synced_at")
        .eq("year", year)
        .order("adp");
      if (error) throw error;
      return data as RookieADP[];
    },
  });

  const syncedAt = rookies[0]?.synced_at
    ? new Date(rookies[0].synced_at).toLocaleDateString()
    : null;

  const filtered = useMemo(() => {
    return rookies
      .filter((p) => posFilter === "ALL" || p.position === posFilter)
      .filter((p) =>
        !search ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.team ?? "").toLowerCase().includes(search.toLowerCase()),
      );
  }, [rookies, posFilter, search]);

  const posCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of rookies) m[p.position] = (m[p.position] ?? 0) + 1;
    return m;
  }, [rookies]);

  return (
    <div className="min-h-screen space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">{year} Rookie ADP</h1>
          <p className="text-muted-foreground">
            Dynasty rookie ADP — FantasyPros consensus
            {rookies.length > 0 && <span className="ml-1">· {rookies.length} players</span>}
            {syncedAt && <span className="ml-2 text-slate-600 text-xs">· synced {syncedAt}</span>}
          </p>
        </div>
        <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v))}>
          <SelectTrigger className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AVAILABLE_YEARS.map((y) => (
              <SelectItem key={y} value={String(y)}>{y} Rookies</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      <Card className="border-white/10">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <CardTitle className="text-base">Rankings</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Search */}
              <input
                type="text"
                placeholder="Search player or team…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-md px-3 py-1.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-white/30 w-44"
              />
              {/* Position filter */}
              <div className="flex gap-1 rounded-lg border border-white/10 p-1">
                {(["ALL", "QB", "RB", "WR", "TE"] as Position[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPosFilter(p)}
                    className={cn(
                      "px-2.5 py-1 text-xs rounded-md transition-colors",
                      posFilter === p
                        ? "bg-white/10 text-white font-medium"
                        : "text-slate-400 hover:text-white",
                    )}
                  >
                    {p}
                    {p !== "ALL" && posCounts[p] ? (
                      <span className="ml-1 opacity-50">{posCounts[p]}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {isLoading ? (
            <div className="py-12 text-center text-slate-500 text-sm animate-pulse">
              Loading {year} rookie ADP…
            </div>
          ) : rookies.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <p className="text-slate-400 text-sm">No data for {year} yet.</p>
              <p className="text-slate-600 text-xs">
                Use the "Sync Rookies" button in the Admin page to pull this year from FantasyPros.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-right">#</TableHead>
                  <TableHead>Player</TableHead>
                  <TableHead>Pos</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead className="text-right">ADP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((player, i) => (
                  <TableRow key={player.name} className={i % 2 === 0 ? "" : "bg-white/[0.015]"}>
                    <TableCell className="text-right font-mono text-slate-500 text-sm">
                      {player.rank}
                    </TableCell>
                    <TableCell className="font-medium text-white text-sm">
                      {player.name}
                    </TableCell>
                    <TableCell>
                      <PosBadge pos={player.position} />
                    </TableCell>
                    <TableCell className="font-mono text-sm text-slate-400">
                      {player.team || <span className="text-slate-600">FA</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold text-white">
                      {player.adp.toFixed(1)}
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-slate-500">
                      No players match your filter
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Rookies;
