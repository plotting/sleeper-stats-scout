import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  GRADABLE_POS, displayDesc, parseResolvedPick, buildExpectedVorpCurve, getPickValue,
  buildPlayerPositionMap, buildPlayerLifetimeVorpMap, type HistoricalPick, type PlayerVorpRow,
} from "@/utils/dynastyValue";
import { UserSearch, ArrowLeftRight, TrendingUp, TrendingDown } from "lucide-react";

function fmt(n: number, d = 1): string {
  return n > 0 ? `+${n.toFixed(d)}` : n.toFixed(d);
}

interface TradeItemRow {
  trade_id: number;
  item_type: string;
  item_description: string;
  from_team_id: number | null;
  to_team_id: number | null;
}
interface DraftGradeRow {
  overall_pick: number;
  team_id: number;
  team_name: string;
  player_name: string;
  position: string | null;
  five_yr_vorp: number;
  draft_year: number;
}

interface TeamProfile {
  teamId: number;
  teamName: string;
  tradeCount: number;
  topPartner: { name: string; count: number } | null;
  netTradeVorp: number;
  draftPickCount: number;
  positionCounts: Record<string, number>;
  topDraftPosition: string | null;
  blindSpot: string | null;
  avgPickValue: number;
  acquiredPositionCounts: Record<string, number>;
  topAcquiredPosition: string | null;
}

function tradeStyleLine(profile: TeamProfile): string {
  const { netTradeVorp, tradeCount } = profile;
  const activity = tradeCount >= 20 ? "a wheeler-dealer" : tradeCount >= 8 ? "a regular in the trade market" : tradeCount > 0 ? "rarely at the table" : "never once traded";
  if (tradeCount === 0) return `${profile.teamName} has ${activity} — every roster spot has been earned the hard way.`;
  const outcome =
    netTradeVorp >= 100 ? "a shrewd operator who consistently comes out ahead"
    : netTradeVorp >= 20 ? "a solid value trader, more often winning deals than losing them"
    : netTradeVorp >= -20 ? "roughly break-even across their trade history"
    : netTradeVorp >= -100 ? "given away more than they've gotten back"
    : "a certified value donor — the rest of the league loves trading with them";
  let line = `${profile.teamName} is ${activity} (${profile.tradeCount} trade${profile.tradeCount === 1 ? "" : "s"}) and has been ${outcome}`;
  if (profile.topPartner) line += `, most often dealing with ${profile.topPartner.name} (${profile.topPartner.count} trades)`;
  return line + ".";
}

function draftStyleLine(profile: TeamProfile): string {
  if (profile.draftPickCount === 0) return `${profile.teamName} hasn't made a rookie pick yet.`;
  const valueLine =
    profile.avgPickValue >= 30 ? "consistently finds value on draft day"
    : profile.avgPickValue >= -10 ? "drafts about as well as the room average"
    : "has a track record of reaching";
  let line = `On draft day, ${profile.teamName} ${valueLine}`;
  if (profile.topDraftPosition) line += `, with a clear preference for ${profile.topDraftPosition}s`;
  if (profile.blindSpot) line += `. Blind spot: they've barely touched ${profile.blindSpot} in the rookie draft`;
  return line + ".";
}

function acquireLine(profile: TeamProfile): string {
  if (!profile.topAcquiredPosition) return "";
  return `When they do trade for players, ${profile.topAcquiredPosition}s are the position they chase hardest.`;
}

const GMScouting = () => {
  const { data: teams } = useQuery({
    queryKey: ["scouting-teams"],
    queryFn: async () => {
      const { data, error } = await supabase.from("teams").select("id, name").order("id");
      if (error) throw error;
      return data as Array<{ id: number; name: string }>;
    },
  });
  const teamNameById = useMemo(() => new Map((teams ?? []).map((t) => [t.id, t.name])), [teams]);

  const { data: trades } = useQuery({
    queryKey: ["scouting-trades"],
    queryFn: async () => {
      const { data, error } = await supabase.from("trades").select("id");
      if (error) throw error;
      return data as Array<{ id: number }>;
    },
  });

  const { data: tradeItems } = useQuery({
    queryKey: ["scouting-trade-items"],
    queryFn: async () => {
      const { data, error } = await supabase.from("trade_items").select("trade_id, item_type, item_description, from_team_id, to_team_id");
      if (error) throw error;
      return data as TradeItemRow[];
    },
  });

  const { data: draftGrades } = useQuery({
    queryKey: ["scouting-draft-grades"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rookie_draft_grades" as never)
        .select("overall_pick, team_id, team_name, player_name, position, five_yr_vorp, draft_year")
        .in("position", GRADABLE_POS);
      if (error) throw error;
      return data as unknown as DraftGradeRow[];
    },
  });

  const tradePlayerNames = useMemo(
    () => [...new Set((tradeItems ?? []).filter((i) => i.item_type === "player").map((i) => i.item_description))],
    [tradeItems],
  );
  const { data: playerVorpRows } = useQuery({
    queryKey: ["scouting-player-vorp", tradePlayerNames.length],
    queryFn: async () => {
      // Chunk to stay well under URL length limits for large .in() lists.
      const CHUNK = 100;
      const chunks: string[][] = [];
      for (let i = 0; i < tradePlayerNames.length; i += CHUNK) chunks.push(tradePlayerNames.slice(i, i + CHUNK));
      const results = await Promise.all(chunks.map(async (names) => {
        const { data, error } = await supabase.from("player_vorp" as never).select("player_name, position, year, vorp").in("player_name", names);
        if (error) throw error;
        return data as unknown as PlayerVorpRow[];
      }));
      return results.flat();
    },
    enabled: tradePlayerNames.length > 0,
  });

  const resolvedPickYears = useMemo(() => {
    const years = new Set<number>();
    for (const item of tradeItems ?? []) {
      if (item.item_type !== "pick") continue;
      const resolved = parseResolvedPick(item.item_description);
      if (resolved) years.add(resolved.year);
    }
    return [...years];
  }, [tradeItems]);
  const { data: tradePickGrades } = useQuery({
    queryKey: ["scouting-trade-pick-grades", resolvedPickYears],
    queryFn: async () => {
      const { data, error } = await supabase.from("rookie_draft_grades" as never).select("draft_year, overall_pick, five_yr_vorp").in("draft_year", resolvedPickYears);
      if (error) throw error;
      return data as unknown as Array<{ draft_year: number; overall_pick: number; five_yr_vorp: number }>;
    },
    enabled: resolvedPickYears.length > 0,
  });

  const expectedVorpCurve = useMemo(() => buildExpectedVorpCurve((draftGrades ?? []) as HistoricalPick[]), [draftGrades]);
  const positionByPlayer = useMemo(() => buildPlayerPositionMap(playerVorpRows ?? []), [playerVorpRows]);
  const lifetimeVorpByPlayer = useMemo(() => buildPlayerLifetimeVorpMap(playerVorpRows ?? []), [playerVorpRows]);
  const pickValueByKey = useMemo(() => new Map((tradePickGrades ?? []).map((p) => [`${p.draft_year}:${p.overall_pick}`, Number(p.five_yr_vorp)])), [tradePickGrades]);

  const profiles = useMemo<TeamProfile[]>(() => {
    if (!teams) return [];

    function itemValue(item: TradeItemRow): number {
      if (item.item_type === "player") return lifetimeVorpByPlayer.get(item.item_description.toLowerCase()) ?? 0;
      const resolved = parseResolvedPick(item.item_description);
      if (!resolved) return 0;
      return pickValueByKey.get(`${resolved.year}:${resolved.overall}`) ?? 0;
    }
    function itemPosition(item: TradeItemRow): string | null {
      if (item.item_type !== "player") return null;
      return positionByPlayer.get(item.item_description.toLowerCase()) ?? null;
    }

    const itemsByTrade = new Map<number, TradeItemRow[]>();
    for (const item of tradeItems ?? []) {
      if (!itemsByTrade.has(item.trade_id)) itemsByTrade.set(item.trade_id, []);
      itemsByTrade.get(item.trade_id)!.push(item);
    }

    const tradeCountByTeam = new Map<number, Set<number>>();
    const partnerCountByTeam = new Map<number, Map<number, number>>();
    const netVorpByTeam = new Map<number, number>();
    const acquiredPosByTeam = new Map<number, Record<string, number>>();

    for (const [tradeId, items] of itemsByTrade) {
      const teamIds = new Set<number>();
      for (const item of items) {
        if (item.from_team_id != null) teamIds.add(item.from_team_id);
        if (item.to_team_id != null) teamIds.add(item.to_team_id);
      }
      for (const teamId of teamIds) {
        if (!tradeCountByTeam.has(teamId)) tradeCountByTeam.set(teamId, new Set());
        tradeCountByTeam.get(teamId)!.add(tradeId);
        for (const other of teamIds) {
          if (other === teamId) continue;
          if (!partnerCountByTeam.has(teamId)) partnerCountByTeam.set(teamId, new Map());
          const pm = partnerCountByTeam.get(teamId)!;
          pm.set(other, (pm.get(other) ?? 0) + 1);
        }
      }
      for (const item of items) {
        const val = itemValue(item);
        if (item.to_team_id != null) {
          netVorpByTeam.set(item.to_team_id, (netVorpByTeam.get(item.to_team_id) ?? 0) + val);
          const pos = itemPosition(item);
          if (pos) {
            if (!acquiredPosByTeam.has(item.to_team_id)) acquiredPosByTeam.set(item.to_team_id, {});
            const rec = acquiredPosByTeam.get(item.to_team_id)!;
            rec[pos] = (rec[pos] ?? 0) + 1;
          }
        }
        if (item.from_team_id != null) {
          netVorpByTeam.set(item.from_team_id, (netVorpByTeam.get(item.from_team_id) ?? 0) - val);
        }
      }
    }

    const picksByTeam = new Map<number, DraftGradeRow[]>();
    for (const p of draftGrades ?? []) {
      if (!picksByTeam.has(p.team_id)) picksByTeam.set(p.team_id, []);
      picksByTeam.get(p.team_id)!.push(p);
    }

    return teams.map((t) => {
      const partners = partnerCountByTeam.get(t.id);
      let topPartner: TeamProfile["topPartner"] = null;
      if (partners) {
        for (const [partnerId, count] of partners) {
          if (!topPartner || count > topPartner.count) topPartner = { name: teamNameById.get(partnerId) ?? "Unknown", count };
        }
      }

      const picks = picksByTeam.get(t.id) ?? [];
      const positionCounts: Record<string, number> = {};
      for (const p of picks) if (p.position) positionCounts[p.position] = (positionCounts[p.position] ?? 0) + 1;
      let topDraftPosition: string | null = null;
      for (const pos of GRADABLE_POS) {
        if (!topDraftPosition || (positionCounts[pos] ?? 0) > (positionCounts[topDraftPosition] ?? 0)) topDraftPosition = pos;
      }
      if (topDraftPosition && (positionCounts[topDraftPosition] ?? 0) === 0) topDraftPosition = null;
      let blindSpot: string | null = null;
      let minCount = Infinity;
      for (const pos of GRADABLE_POS) {
        const c = positionCounts[pos] ?? 0;
        if (c < minCount) { minCount = c; blindSpot = pos; }
      }
      if (picks.length < 4) blindSpot = null; // not enough picks to call it a real pattern
      const pvs = picks.map((p) => getPickValue(expectedVorpCurve, p)).filter((v): v is number => v !== null);
      const avgPickValue = pvs.length ? pvs.reduce((s, v) => s + v, 0) / pvs.length : 0;

      const acquired = acquiredPosByTeam.get(t.id) ?? {};
      let topAcquiredPosition: string | null = null;
      for (const [pos, count] of Object.entries(acquired)) {
        if (!topAcquiredPosition || count > acquired[topAcquiredPosition]) topAcquiredPosition = pos;
      }

      return {
        teamId: t.id,
        teamName: t.name,
        tradeCount: tradeCountByTeam.get(t.id)?.size ?? 0,
        topPartner,
        netTradeVorp: netVorpByTeam.get(t.id) ?? 0,
        draftPickCount: picks.length,
        positionCounts,
        topDraftPosition,
        blindSpot,
        avgPickValue,
        acquiredPositionCounts: acquired,
        topAcquiredPosition,
      };
    }).sort((a, b) => b.netTradeVorp - a.netTradeVorp);
  }, [teams, tradeItems, draftGrades, expectedVorpCurve, positionByPlayer, lifetimeVorpByPlayer, pickValueByKey, teamNameById]);

  const isLoading = !teams || !tradeItems || !draftGrades;

  return (
    <div className="min-h-screen space-y-6">
      <header>
        <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3">
          <UserSearch className="h-8 w-8 text-violet-400" />
          GM Scouting Report
        </h1>
        <p className="text-slate-400">Every owner profiled from this league's own trade and draft history — tendencies, blind spots, and who's winning the market.</p>
      </header>

      {isLoading ? (
        <p className="text-slate-500 text-sm animate-pulse py-12 text-center">Scouting the league…</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {profiles.map((p) => (
            <Card key={p.teamId} className="border-white/10 bg-[#1a1a2e] overflow-hidden">
              <div className="px-5 pt-5 pb-3 border-b border-white/10 flex items-center justify-between gap-2">
                <h2 className="text-xl font-bold text-white">{p.teamName}</h2>
                <span className={cn(
                  "text-xs font-mono font-semibold px-2 py-0.5 rounded border",
                  p.netTradeVorp >= 20 ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/25"
                  : p.netTradeVorp >= -20 ? "text-sky-400 bg-sky-400/10 border-sky-400/25"
                  : "text-red-400 bg-red-400/10 border-red-400/25",
                )}>
                  {fmt(p.netTradeVorp)} net VORP
                </span>
              </div>
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-start gap-2.5">
                  <ArrowLeftRight className="h-4 w-4 text-sky-400 mt-0.5 shrink-0" />
                  <p className="text-sm text-slate-300 leading-relaxed">{tradeStyleLine(p)}</p>
                </div>
                <div className="flex items-start gap-2.5">
                  {p.avgPickValue >= 0 ? (
                    <TrendingUp className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                  )}
                  <p className="text-sm text-slate-300 leading-relaxed">{draftStyleLine(p)}</p>
                </div>
                {p.topAcquiredPosition && (
                  <p className="text-xs text-slate-500 pl-7">{acquireLine(p)}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default GMScouting;
