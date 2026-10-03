import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bookmark, Check, Copy, Link2, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import AdminGate from "@/components/admin/AdminGate";
import { AssetLine, AssetSearch } from "@/components/market/assetUi";
import { VerdictMeter, TradeReport } from "@/components/market/TradeReport";
import { ValueOverTime } from "@/components/market/ValueOverTime";
import { PriceCheck } from "@/components/market/PriceCheck";
import { DurabilityCard } from "@/components/market/Durability";
import { OutcomeRangeCard } from "@/components/market/OutcomeRange";
import { LineupImpact, type TeamSide } from "@/components/market/LineupImpact";
import { useLeagueTeams } from "@/hooks/useLeagueTeams";
import { teamAssets } from "@/utils/leaguePricing";
import { bestLineup, lineupScore, positionTotals, type RosterPlayer } from "@/utils/rosterLineup";
import { SellHighBuyLow } from "@/components/market/SellHighBuyLow";
import { LeagueTrades } from "@/components/market/LeagueTrades";
import { TradeFinder } from "@/components/market/TradeFinder";
import { ValuesExplainer } from "@/components/market/ValuesExplainer";
import { loadDirectory, loadValues, loadValuesAgo, useEntries } from "@/components/market/assetData";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { assess, decodeShare, effectiveValue, encodeShare, normalizeTop, suggestToEven, valueChanges, type AgeCurve, type CalcAsset, type Depth, type Outcome } from "@/utils/marketCalc";

interface TradeIdea {
  id: number; name: string; format: "1qb" | "sf";
  receive: string[]; send: string[]; receiveLabels: string[]; sendLabels: string[];
  league: { you: number; partner: number } | null;
}

// Hidden, admin-only page: prices a trade with the values fitted from completed market trades
// (market_values). Players only appear once they've been in enough trades to get a value.


function Side({ title, assets, total, onRemove, children }: { title: string; assets: CalcAsset[]; total: number; onRemove: (key: string) => void; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-bold tracking-widest text-slate-400 uppercase">{title}</h2>
        <span className="font-mono text-lg font-bold text-emerald-400">{Math.round(total).toLocaleString()}</span>
      </div>
      {children}
      <div className="space-y-1.5 min-h-[3rem]">
        {assets.map((a) => (
          <div key={a.key} className="rounded-lg border border-white/10 px-3 py-2">
            <AssetLine asset={a} right={<button type="button" data-no-capture onClick={() => onRemove(a.key)} aria-label={`Remove ${a.label}`} className="text-slate-500 hover:text-white"><X className="h-4 w-4" /></button>} />
          </div>
        ))}
      </div>
    </div>
  );
}

const Calculator = () => {
  // A shared link carries the trade and settings in the query string; the assets are filled in once values load.
  const shared = useRef(typeof window !== "undefined" ? decodeShare(window.location.search) : null);
  const pendingAssets = useRef<{ receive: string[]; send: string[]; league?: boolean } | null>(shared.current && (shared.current.receive.length || shared.current.send.length) ? { receive: shared.current.receive, send: shared.current.send } : null);
  const [format, setFormat] = useState<"1qb" | "sf">(shared.current?.format === "sf" ? "sf" : "1qb");
  const [receive, setReceive] = useState<CalcAsset[]>([]);
  const [send, setSend] = useState<CalcAsset[]>([]);
  const [vorpPct, setVorpPct] = useState<number>(() => {
    if (shared.current?.vorp !== undefined && shared.current.vorp >= 0 && shared.current.vorp <= 100) return shared.current.vorp;
    try { const v = Number(localStorage.getItem("calc-vorp-weight")); return Number.isFinite(v) && v >= 0 && v <= 100 && localStorage.getItem("calc-vorp-weight") !== null ? v : 50; } catch { return 50; }
  });
  const [pickPct, setPickPct] = useState<number>(() => {
    if (shared.current?.pick !== undefined && shared.current.pick >= 50 && shared.current.pick <= 250) return shared.current.pick;
    try { const raw = localStorage.getItem("calc-pick-scale"); const v = Number(raw); return raw !== null && Number.isFinite(v) && v >= 50 && v <= 250 ? v : 100; } catch { return 100; }
  });
  const setPick = (n: number) => { setPickPct(n); try { localStorage.setItem("calc-pick-scale", String(n)); } catch { /* optional */ } };
  const setVorp = (n: number) => { setVorpPct(n); try { localStorage.setItem("calc-vorp-weight", String(n)); } catch { /* optional */ } };
  // League mode: pick your team and a leaguemate; each side can only offer what that team actually owns.
  const [leagueMode, setLeagueModeState] = useState<boolean>(() => { try { return localStorage.getItem("calc-league-mode") === "1"; } catch { return false; } });
  const [youId, setYouIdState] = useState<number | null>(() => { try { const v = Number(localStorage.getItem("calc-you")); return v > 0 ? v : null; } catch { return null; } });
  const [partnerId, setPartnerId] = useState<number | null>(null);
  const remember = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* optional */ } };
  const { data: league, isLoading: leagueLoading, error: leagueError } = useLeagueTeams(leagueMode);
  const { data: raw, isLoading, error } = useQuery({ queryKey: ["calc-values", format], queryFn: () => loadValues(format) });
  // The crawler collects trades from leagues that match ours (1QB), so Superflex only appears once it has values
  const { data: hasSf } = useQuery({
    queryKey: ["calc-has-sf"],
    queryFn: async () => { const { count } = await supabase.from("market_values" as never).select("asset_key", { count: "exact", head: true }).eq("format", "sf"); return (count ?? 0) > 0; },
    staleTime: 60 * 60 * 1000,
  });
  // Player values blended between the market (fit to trades) and the VORP + age baseline.
  const values = useMemo(() => {
    if (!raw) return undefined;
    const out = new Map<string, { value: number; n_trades: number }>();
    const w = vorpPct / 100;
    for (const [key, v] of raw) {
      if (key.startsWith("v:") || key.startsWith("vp:")) continue;
      const baseline = key.startsWith("p:") ? raw.get(`v:${key.slice(2)}`)?.value : undefined;
      let priced = effectiveValue({ key, value: v.value, nTrades: v.n_trades, baseline }, w);
      if (key.startsWith("pk:")) {
        // Picks: scale the market value by how a typical pick of that round actually turned out (outcome
        // value vs what this class trades for), then split by slot tier (early / mid / late in the round).
        const round = key.split(":")[2];
        const vpAny = raw.get(`vp:${round}:any`)?.value;
        const m0 = raw.get(`pk:0:${round}`)?.value;
        if (vpAny && m0) priced *= Math.pow(vpAny / m0, w);
        for (const tier of ["early", "mid", "late"]) {
          const vpT = raw.get(`vp:${round}:${tier}`)?.value;
          if (vpAny && vpT) out.set(`${key}:${tier}`, { value: priced * (vpT / vpAny) * (pickPct / 100), n_trades: v.n_trades });
        }
        priced *= pickPct / 100;
      }
      out.set(key, { value: priced, n_trades: v.n_trades });
    }
    for (const [key, v] of raw) if (key.startsWith("v:") && !out.has(`p:${key.slice(2)}`)) out.set(`p:${key.slice(2)}`, { value: v.value, n_trades: 0 });
    // Blending with the VORP baseline pulls the top toward the middle, so re-scale: the most valuable
    // player (10+ trades) is always 10,000, whatever the slider says (same rule as the fit).
    normalizeTop(out);
    return out;
  }, [raw, vorpPct, pickPct]);
  const reprice = (a: CalcAsset): CalcAsset => ({ ...a, value: values?.get(a.meta?.priceKey ?? a.key)?.value ?? a.value });

  const { data: directory } = useQuery({ queryKey: ["calc-directory"], queryFn: loadDirectory, staleTime: 60 * 60 * 1000 });
  // 7-day change in the market value (before the sliders), shown next to each player
  const { data: weekAgo } = useQuery({ queryKey: ["calc-values-ago", format, 7], queryFn: () => loadValuesAgo(format, 7), staleTime: 60 * 60 * 1000 });
  const changes = useMemo(() => (raw && weekAgo ? valueChanges(new Map([...raw].map(([k, v]) => [k, v.value])), weekAgo.values) : undefined), [raw, weekAgo]);
  const entries = useEntries(values, directory, changes);
  const teams = leagueMode ? league?.teams : undefined;
  const youTeam = teams?.find((t) => t.rosterId === (youId ?? teams[0]?.rosterId));
  const partnerTeam = teams?.find((t) => t.rosterId === partnerId && t.rosterId !== youTeam?.rosterId);
  const teamNames = useMemo(() => new Map((teams ?? []).map((t) => [t.rosterId, t.name])), [teams]);
  const inLeague = !!(leagueMode && youTeam && partnerTeam && values);
  // What each side can offer: in league mode only what that team owns
  const youOffer = useMemo(() => (inLeague && values && youTeam ? teamAssets(youTeam, entries, values, teamNames, new Date()) : entries), [inLeague, values, youTeam, entries, teamNames]);
  const partnerOffer = useMemo(() => (inLeague && values && partnerTeam ? teamAssets(partnerTeam, entries, values, teamNames, new Date()) : entries), [inLeague, values, partnerTeam, entries, teamNames]);
  // Everyone else's tradable assets, for the trade finder
  const leagueReady = !!(leagueMode && youTeam && values);
  const youAssets = useMemo(() => (leagueReady && values && youTeam ? teamAssets(youTeam, entries, values, teamNames, new Date()) : []), [leagueReady, values, youTeam, entries, teamNames]);
  const otherTeams = useMemo(
    () => (leagueReady && values && teams && youTeam
      ? teams.filter((t) => t.rosterId !== youTeam.rosterId).map((t) => ({ rosterId: t.rosterId, name: t.name, assets: teamAssets(t, entries, values, teamNames, new Date()) }))
      : []),
    [leagueReady, values, teams, youTeam, entries, teamNames],
  );
  // Saved ideas (this browser only): a trade's asset keys plus, in league mode, the two teams
  const [ideas, setIdeas] = useState<TradeIdea[]>(() => { try { return JSON.parse(localStorage.getItem("calc-trade-ideas") ?? "[]") as TradeIdea[]; } catch { return []; } });
  const [pendingTick, setPendingTick] = useState(0);
  useEffect(() => {
    const pending = pendingAssets.current;
    if (!pending || entries.length === 0) return;
    if (pending.league && !leagueReady) return; // team picks only exist once the rosters have loaded
    const byKey = new Map(entries.map((a) => [a.key, a]));
    if (pending.league) for (const a of [...youAssets, ...otherTeams.flatMap((t) => t.assets)]) byKey.set(a.key, a);
    const pick = (keys: string[]) => keys.flatMap((k) => byKey.get(k) ?? []);
    setReceive(pick(pending.receive));
    setSend(pick(pending.send));
    pendingAssets.current = null;
  }, [entries, leagueReady, youAssets, otherTeams, pendingTick]);
  // Value-by-age curves per position (fitted alongside the values)
  const curves = useMemo(() => {
    const out = new Map<string, AgeCurve>();
    if (!raw) return out;
    for (const pos of ["QB", "RB", "WR", "TE"]) {
      const b1 = raw.get(`cfg:age:${pos}:b1`)?.value, b2 = raw.get(`cfg:age:${pos}:b2`)?.value;
      if (b1 !== undefined && b2 !== undefined) out.set(pos, { b1, b2 });
    }
    return out;
  }, [raw]);
  // Next-season value change distributions per position and age group (fitted with the values)
  const vol = useMemo(() => {
    const out = new Map<string, Outcome>();
    if (!raw) return out;
    for (const pos of ["QB", "RB", "WR", "TE"]) {
      for (const bucket of ["young", "prime", "vet"]) {
        const g = (stat: string) => raw.get(`cfg:vol:${pos}:${bucket}:${stat}`);
        const p10 = g("p10"), p50 = g("p50"), p90 = g("p90"), up = g("up"), down = g("down");
        if (p10 && p50 && p90 && up && down) out.set(`${pos}:${bucket}`, { p10: p10.value, p50: p50.value, p90: p90.value, up: up.value, down: down.value, n: p50.n_trades });
      }
    }
    return out;
  }, [raw]);
  const taken = useMemo(() => new Set([...receive, ...send].map((a) => a.key)), [receive, send]);
  const fitDepth = values?.get("cfg:rho_players")?.value ?? 1;
  const rhoPlayers = fitDepth;
  const rhoPicks = values?.get("cfg:rho_picks")?.value ?? 1;
  // Consolidation premium by shape, measured from real trades (stored as cfg:shape:<many>-<few>)
  const premium = useMemo(() => {
    const out = new Map<string, number>();
    for (const [key, v] of values ?? []) if (key.startsWith("cfg:shape:")) out.set(key.slice(10), v.value);
    return out;
  }, [values]);
  const depth: Depth = useMemo(() => ({ players: rhoPlayers, picks: rhoPicks, premium }), [rhoPlayers, rhoPicks, premium]);
  const receiveP = receive.map(reprice);
  const sendP = send.map(reprice);
  const result = assess(receiveP, sendP, depth);
  const hasAssets = receive.length + send.length > 0;
  const names = useMemo(
    () => (hasAssets && result.tier !== "even" ? suggestToEven(result.gap, entries, taken, result.gap > 0 ? sendP : receiveP, depth, 3, 4, { other: result.gap > 0 ? receiveP : sendP, sideIsRecv: result.gap <= 0 }) : []),
    [entries, taken, result.gap, result.tier, hasAssets, receiveP, sendP, depth],
  );

  const persistIdeas = (next: TradeIdea[]) => { setIdeas(next); try { localStorage.setItem("calc-trade-ideas", JSON.stringify(next)); } catch { /* optional */ } };
  const saveIdea = () => {
    const name = window.prompt("Name this trade idea", `Idea ${ideas.length + 1}`);
    if (name === null) return;
    persistIdeas([{
      id: Date.now(), name: name.trim() || `Idea ${ideas.length + 1}`, format,
      receive: receive.map((a) => a.key), send: send.map((a) => a.key),
      receiveLabels: receive.map((a) => a.label), sendLabels: send.map((a) => a.label),
      league: inLeague && youTeam && partnerTeam ? { you: youTeam.rosterId, partner: partnerTeam.rosterId } : null,
    }, ...ideas]);
    flash("Idea saved");
  };
  const openIdea = (idea: TradeIdea) => {
    setFormat(idea.format);
    setReceive([]); setSend([]);
    if (idea.league) {
      setLeagueModeState(true); remember("calc-league-mode", "1");
      setYouIdState(idea.league.you); remember("calc-you", String(idea.league.you));
      setPartnerId(idea.league.partner);
    } else { setLeagueModeState(false); remember("calc-league-mode", null); }
    pendingAssets.current = { receive: idea.receive, send: idea.send, league: !!idea.league };
    setPendingTick((n) => n + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const captureRef = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const flash = (msg: string) => { setNotice(msg); setTimeout(() => setNotice(null), 2200); };
  const shareUrl = () => `${window.location.origin}${window.location.pathname}?${encodeShare({ receive: receive.map((a) => a.key), send: send.map((a) => a.key), format, vorp: vorpPct, pick: pickPct })}`;
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(shareUrl()); flash("Link copied"); } catch { window.prompt("Copy this link", shareUrl()); }
  };
  const copyImage = async () => {
    if (!captureRef.current) return;
    try {
      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(captureRef.current, {
        pixelRatio: 2, cacheBust: true, backgroundColor: "#0b0d14",
        filter: (n) => !(n instanceof HTMLElement && n.dataset.noCapture !== undefined),
        imagePlaceholder: "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==", // photos that can't be fetched become blank
      });
      if (!blob) throw new Error("no image");
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        flash("Image copied");
      } catch {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = "trade.png"; a.click();
        flash("Image saved");
      }
    } catch { flash("Couldn't make the image"); }
  };
  const clearAll = () => { setReceive([]); setSend([]); };
  const setLeagueMode = (on: boolean) => { setLeagueModeState(on); remember("calc-league-mode", on ? "1" : null); clearAll(); };
  const pickYou = (id: number) => { setYouIdState(id); remember("calc-you", String(id)); setPartnerId(null); clearAll(); };
  const pickPartner = (id: number | null) => { setPartnerId(id); clearAll(); };
  // Lineup impact: every team's best lineup now (for position ranks) and the two teams before / after the trade
  const slots = league?.slots ?? [];
  const toRoster = (ids: string[]): RosterPlayer[] => ids.flatMap((id) => {
    const info = directory?.get(id);
    return info && ["QB", "RB", "WR", "TE"].includes(info.position ?? "") ? [{ id, position: info.position!, name: info.name, score: raw?.get(`cr:${id}`)?.value ?? 0 }] : [];
  });
  const leagueTotals = useMemo(
    () => new Map((teams ?? []).map((t) => [t.rosterId, positionTotals(bestLineup(toRoster(t.players), slots))])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [teams, directory, raw, slots],
  );
  const lineupSides = useMemo((): { you: TeamSide; partner: TeamSide } | null => {
    if (!inLeague || !youTeam || !partnerTeam) return null;
    const ids = (assets: CalcAsset[]) => assets.flatMap((a) => (a.meta?.playerId ? [a.meta.playerId] : []));
    const send = new Set(ids(sendP)), recv = new Set(ids(receiveP));
    const side = (t: typeof youTeam, out: Set<string>, into: Set<string>): TeamSide => ({
      rosterId: t.rosterId, name: t.name, before: toRoster(t.players), after: toRoster([...t.players.filter((p) => !out.has(p)), ...into]),
    });
    return { you: side(youTeam, send, recv), partner: side(partnerTeam, recv, send) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inLeague, youTeam, partnerTeam, sendP, receiveP, directory, raw]);
  // Lineup change for both teams if `recv` came to you and `give` went to the partner (used by the trade finder)
  const lineupDelta = useCallback((partnerRosterId: number, recv: CalcAsset[], give: CalcAsset[]) => {
    const partner = teams?.find((t) => t.rosterId === partnerRosterId);
    if (!youTeam || !partner) return null;
    const ids = (assets: CalcAsset[]) => new Set(assets.flatMap((a) => (a.meta?.playerId ? [a.meta.playerId] : [])));
    const into = ids(recv), out = ids(give);
    const gain = (t: typeof youTeam, leaving: Set<string>, arriving: Set<string>) => {
      const before = lineupScore(bestLineup(toRoster(t.players), slots));
      const after = lineupScore(bestLineup(toRoster([...t.players.filter((p) => !leaving.has(p)), ...arriving]), slots));
      return after - before;
    };
    return { you: gain(youTeam, out, into), them: gain(partner, into, out) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams, youTeam, slots, directory, raw]);
  const players = useMemo(() => [...receiveP, ...sendP].filter((a) => a.meta?.playerId), [receiveP, sendP]);
  const durabilityPlayers = useMemo(
    () => [...receiveP.filter((a) => a.meta?.playerId).map((a) => ({ ...a, side: "get" as const })), ...sendP.filter((a) => a.meta?.playerId).map((a) => ({ ...a, side: "give" as const }))],
    [receiveP, sendP],
  );
  const add = (set: typeof setReceive) => (a: CalcAsset) => set((xs) => (xs.some((x) => x.key === a.key) ? xs : [...xs, a]));
  const remove = (set: typeof setReceive) => (key: string) => set((xs) => xs.filter((x) => x.key !== key));
  const empty = receive.length + send.length === 0;
  // If you're ahead, ask them for more; if you're behind, you add to what you send… from your side's view.
  const suggestSide = result.gap > 0 ? "you could add to what you send" : "you could ask for";

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header className="text-center space-y-2">
        <h1 className="text-3xl font-bold">Trade Calculator</h1>
        <p className="text-slate-400 text-sm">Values fitted from completed trades in similar public leagues (admin only).</p>
        <div className="inline-flex gap-0.5 rounded-lg border border-white/10 p-0.5">
          {(["1qb", "sf"] as const).filter((f) => f === format || f === "1qb" || hasSf).map((f) => (
            <button key={f} type="button" onClick={() => setFormat(f)}
              className={cn("px-3 py-1 text-xs rounded-md", format === f ? "bg-white/10 text-white font-medium" : "text-slate-400 hover:text-white")}>
              {f === "1qb" ? "1QB" : "Superflex"}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-center gap-3 text-xs text-slate-400">
          <span>Market</span>
          <input type="range" min={0} max={100} step={5} value={vorpPct} onChange={(e) => setVorp(Number(e.target.value))} className="w-40" aria-label="VORP weight" />
          <span>VORP</span>
          <span className="font-mono text-slate-200 w-10 text-left">{vorpPct}%</span>
        </div>
        <div className="flex items-center justify-center gap-3 text-xs text-slate-400">
          <span>Pick value</span>
          <input type="range" min={50} max={250} step={5} value={pickPct} onChange={(e) => setPick(Number(e.target.value))} className="w-40" aria-label="Pick value multiplier" />
          <span className="font-mono text-slate-200 w-12 text-left">×{(pickPct / 100).toFixed(2)}</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-slate-400 pt-1">
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={leagueMode} onChange={(e) => setLeagueMode(e.target.checked)} /> League mode (use real rosters)
          </label>
          {leagueMode && teams && youTeam && (
            <>
              <label className="inline-flex items-center gap-1.5">You
                <select value={youTeam.rosterId} onChange={(e) => pickYou(Number(e.target.value))} className="bg-transparent border border-white/10 rounded-md px-2 py-1 text-slate-200">
                  {teams.map((t) => <option key={t.rosterId} value={t.rosterId} className="bg-slate-900">{t.name}</option>)}
                </select>
              </label>
              <label className="inline-flex items-center gap-1.5">Trading with
                <select value={partnerTeam?.rosterId ?? ""} onChange={(e) => pickPartner(e.target.value ? Number(e.target.value) : null)} className="bg-transparent border border-white/10 rounded-md px-2 py-1 text-slate-200">
                  <option value="" className="bg-slate-900">Choose a leaguemate…</option>
                  {teams.filter((t) => t.rosterId !== youTeam.rosterId).map((t) => <option key={t.rosterId} value={t.rosterId} className="bg-slate-900">{t.name}</option>)}
                </select>
              </label>
            </>
          )}
          {leagueMode && leagueLoading && <span className="animate-pulse">Loading rosters…</span>}
          {leagueMode && leagueError && <span className="text-red-400">Couldn't load rosters from Sleeper</span>}
        </div>
        {leagueMode && teams && !partnerTeam && <p className="text-[11px] text-amber-300/80">Choose a leaguemate to start a roster-locked trade; each side can only offer what that team owns.</p>}
        <p className="text-[10px] text-slate-600">build {__BUILD_ID__}</p>
        <p className="text-[11px] text-slate-500">Player values blend what trades pay with what recent VORP + age imply; picks are priced by how rookie picks of that round and slot actually turned out, times the pick multiplier.</p>
      </header>

      {isLoading && <p className="text-center text-slate-500 text-sm animate-pulse">Loading values…</p>}
      {error && <p className="text-center text-red-400 text-sm">Couldn't load values: {error instanceof Error ? error.message : String(error)}. Run the value-fit migration and sign in as admin.</p>}
      {values && values.size === 0 && <p className="text-center text-slate-500 text-sm">No fitted values for this format yet — they appear after the crawler's fit step runs.</p>}

      {values && values.size > 0 && (
        <>
          {leagueReady && youTeam && (
            <TradeFinder
              you={{ rosterId: youTeam.rosterId, name: youTeam.name, assets: youAssets }} others={otherTeams} depth={depth} lineupDelta={lineupDelta}
              onUse={(partner, recv, give) => { setPartnerId(partner); setReceive(recv); setSend(give); window.scrollTo({ top: 0, behavior: "smooth" }); }}
            />
          )}

          {leagueReady && youTeam && <SellHighBuyLow you={{ rosterId: youTeam.rosterId, name: youTeam.name, assets: youAssets }} others={otherTeams} />}

          <div ref={captureRef} className="space-y-4 rounded-2xl" hidden={leagueMode && !!teams && !partnerTeam}>
            <Card className="border-white/10 p-5 grid md:grid-cols-2 gap-8">
              <Side title="You receive" assets={receiveP} total={result.recv} onRemove={remove(setReceive)}>
                <AssetSearch entries={partnerOffer} taken={taken} onAdd={add(setReceive)} placeholder={inLeague ? `Search ${partnerTeam?.name ?? "their"} roster & picks…` : undefined} />
              </Side>
              <Side title="You send" assets={sendP} total={result.sent} onRemove={remove(setSend)}>
                <AssetSearch entries={youOffer} taken={taken} onAdd={add(setSend)} placeholder={inLeague ? `Search ${youTeam?.name ?? "your"} roster & picks…` : undefined} />
              </Side>
            </Card>
            {!empty && (
              <Card className="border-white/10 p-5">
                <VerdictMeter recv={result.recv} sent={result.sent} />
                <p className="text-center text-xs text-slate-500 mt-1">{result.diffPct.toFixed(1)}% gap</p>
                {result.premium && (
                  <p className="text-center text-[11px] text-slate-600 mt-1">
                    Consolidation premium ×{result.premium.m.toFixed(2)} applied to {result.premium.side === "recv" ? "what you receive" : "what you send"} (the extra pieces on the other side are much lesser than that asset)
                  </p>
                )}
              </Card>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="outline" onClick={copyLink} disabled={empty || leagueMode} title={leagueMode ? "Share links aren't available in league mode" : undefined}><Link2 className="h-4 w-4 mr-1.5" />Share link</Button>
            <Button variant="outline" onClick={saveIdea} disabled={empty}><Bookmark className="h-4 w-4 mr-1.5" />Save idea</Button>
            <Button variant="outline" onClick={copyImage} disabled={empty}><Copy className="h-4 w-4 mr-1.5" />Copy image</Button>
            <Button variant="ghost" onClick={clearAll} disabled={empty} className="text-slate-400">Clear</Button>
            {notice && <span className="inline-flex items-center gap-1 text-xs text-emerald-400"><Check className="h-3.5 w-3.5" />{notice}</span>}
          </div>

          {!empty && result.tier !== "even" && names.length > 0 && (
            <Card className="border-white/10 p-4 space-y-2">
              <p className="text-xs text-slate-400">To even it out, {suggestSide}:</p>
              <div className="flex flex-wrap gap-2">
                {names.map((a) => (
                  <button key={a.key} type="button" onClick={() => (result.gap > 0 ? add(setSend) : add(setReceive))(a)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1 text-xs hover:bg-white/5">
                    <Plus className="h-3 w-3" /> {a.label} <span className="font-mono text-slate-500">{Math.round(a.value).toLocaleString()}</span>
                  </button>
                ))}
              </div>
            </Card>
          )}

          {!empty && (
            <>
              <TradeReport receive={receiveP} send={sendP} depth={depth} subtitle={`10-team ${format === "sf" ? "Superflex" : "1QB"} · values from completed trades, ${vorpPct}% VORP`} />
              {lineupSides && <LineupImpact you={lineupSides.you} partner={lineupSides.partner} slots={slots} league={leagueTotals} />}
              <ValueOverTime receive={receiveP} send={sendP} depth={depth} curves={curves} />
              <OutcomeRangeCard players={durabilityPlayers} entries={entries} vol={vol} />
              <DurabilityCard players={durabilityPlayers} />
              <PriceCheck players={players} directory={directory} trade={{ get: receiveP, give: sendP }} />
            </>
          )}
          {ideas.length > 0 && (
            <Card className="border-white/10 p-5 space-y-2">
              <p className="text-sm font-semibold">Saved trade ideas <span className="text-[11px] font-normal text-slate-500">(this browser only)</span></p>
              {ideas.map((idea) => (
                <div key={idea.id} className="rounded-lg border border-white/10 px-3 py-2 flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1 text-xs space-y-0.5">
                    <p className="font-semibold text-slate-200">{idea.name}{idea.league && <span className="ml-2 text-[10px] font-normal text-slate-500">league mode</span>}</p>
                    <p className="text-slate-400">Receive: {idea.receiveLabels.join(", ") || "—"}</p>
                    <p className="text-slate-400">Send: {idea.sendLabels.join(", ") || "—"}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => openIdea(idea)}>Open</Button>
                  <button type="button" aria-label={`Delete ${idea.name}`} onClick={() => persistIdeas(ideas.filter((x) => x.id !== idea.id))} className="text-slate-500 hover:text-white"><X className="h-4 w-4" /></button>
                </div>
              ))}
            </Card>
          )}
          <LeagueTrades entries={entries} depth={depth} onOpen={(recv, give) => { setReceive(recv); setSend(give); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
          <ValuesExplainer />
        </>
      )}
    </div>
  );
};

const TradeCalculator = () => (
  <AdminGate>
    <Calculator />
  </AdminGate>
);

export default TradeCalculator;
