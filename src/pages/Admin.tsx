import { useState, useCallback, Component, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="max-w-2xl mx-auto mt-8 p-6 rounded-xl border border-red-500/30 bg-red-500/10">
          <h2 className="text-red-400 font-bold mb-2">Render error — copy this and report it:</h2>
          <pre className="text-xs text-red-300 whitespace-pre-wrap break-all">{String(this.state.error)}</pre>
          <button onClick={() => this.setState({ error: null })} className="mt-4 text-xs text-slate-400 underline">
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  fetchLeague,
  fetchAllLeagues,
  LEAGUE_ID,
  type SleeperLeague,
} from '@/services/sleeperApi';
import {
  buildTeamMappings,
  saveTeamMappings,
  syncScoresAndSchedules,
  syncDraftPicks,
  syncTrades,
  syncAll,
  repairTradeDescriptions,
  repairPickDescriptions,
  clearAndResyncTrades,
  type TeamMapping,
} from '@/services/sleeperSync';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  RefreshCw,
  Users,
  Calendar,
  FileText,
  ArrowLeftRight,
  CheckCircle,
  XCircle,
  AlertCircle,
  Zap,
  Trophy,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Log entry ─────────────────────────────────────────────────────────────

interface LogEntry {
  msg: string;
  level: 'info' | 'success' | 'warn' | 'error';
  ts: number;
}

function useLog() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const log = useCallback((msg: string, level: LogEntry['level'] = 'info') => {
    setEntries((prev) => [...prev, { msg, level, ts: Date.now() }]);
  }, []);
  const clear = useCallback(() => setEntries([]), []);
  return { entries, log, clear };
}

// ─── Status badge ───────────────────────────────────────────────────────────

function LeagueBadge({ status }: { status: SleeperLeague['status'] }) {
  const map: Record<string, { label: string; className: string }> = {
    complete: { label: 'Complete', className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
    in_season: { label: 'Active', className: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
    pre_draft: { label: 'Pre-Draft', className: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
    drafting: { label: 'Drafting', className: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  };
  const { label, className } = map[status] ?? { label: status, className: '' };
  return <Badge variant="outline" className={cn('text-xs', className)}>{label}</Badge>;
}

// ─── Log panel ──────────────────────────────────────────────────────────────

function LogPanel({ entries, onClear }: { entries: LogEntry[]; onClear: () => void }) {
  const colorMap = {
    info: 'text-slate-300',
    success: 'text-emerald-400',
    warn: 'text-amber-400',
    error: 'text-red-400',
  };
  const iconMap = {
    info: '›',
    success: '✓',
    warn: '⚠',
    error: '✗',
  };
  if (entries.length === 0) return null;
  return (
    <div className="mt-4 rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-xs max-h-56 overflow-y-auto">
      <div className="flex justify-between items-center mb-2">
        <span className="text-slate-500">Sync log</span>
        <button onClick={onClear} className="text-slate-500 hover:text-slate-300 text-xs">clear</button>
      </div>
      {entries.map((e, i) => (
        <div key={i} className={cn('leading-5', colorMap[e.level])}>
          <span className="mr-1">{iconMap[e.level]}</span>{e.msg}
        </div>
      ))}
    </div>
  );
}

// ─── Section wrapper ─────────────────────────────────────────────────────────

function SyncCard({
  icon: Icon,
  title,
  description,
  children,
  accent = 'blue',
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
  accent?: 'blue' | 'emerald' | 'purple' | 'amber';
}) {
  const accents = {
    blue: 'from-blue-500/10',
    emerald: 'from-emerald-500/10',
    purple: 'from-purple-500/10',
    amber: 'from-amber-500/10',
  };
  const iconColors = {
    blue: 'text-blue-400',
    emerald: 'text-emerald-400',
    purple: 'text-purple-400',
    amber: 'text-amber-400',
  };
  return (
    <Card className={cn('bg-gradient-to-br to-transparent border-white/10', accents[accent])}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className={cn('h-4 w-4', iconColors[accent])} />
          {title}
        </CardTitle>
        <CardDescription className="text-slate-400 text-sm">{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

const Admin = () => {
  const { entries, log, clear } = useLog();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>('');
  const [mappings, setMappings] = useState<TeamMapping[] | null>(null);
  const [mappingEdits, setMappingEdits] = useState<Record<string, number | null>>({});

  // ── Fetch current league info ──
  const { data: currentLeague, isLoading: leagueLoading, error: leagueError, refetch: refetchLeague } = useQuery({
    queryKey: ['sleeper-league', LEAGUE_ID],
    queryFn: () => fetchLeague(LEAGUE_ID),
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  // ── Fetch full league history ──
  const { data: allLeagues, isLoading: historyLoading, error: historyError, refetch: refetchHistory } = useQuery({
    queryKey: ['sleeper-all-leagues', LEAGUE_ID],
    queryFn: () => fetchAllLeagues(LEAGUE_ID),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  // ── Fetch DB teams (for mapping dropdowns) ──
  const { data: dbTeams } = useQuery({
    queryKey: ['teams'],
    queryFn: async () => {
      const { data, error } = await supabase.from('teams').select('id, name').order('id');
      if (error) throw error;
      return data;
    },
  });

  const selectedLeague = allLeagues?.find((l) => l.league_id === selectedLeagueId) ?? currentLeague;

  // ── Run helper ──
  async function run(fn: () => Promise<void>) {
    setRunning(true);
    setProgress(0);
    clear();
    try {
      await fn();
      // Bust the cache so all pages show fresh data immediately
      await queryClient.invalidateQueries();
    } catch (err) {
      log(`Error: ${String(err)}`, 'error');
    } finally {
      setRunning(false);
      setProgress(100);
    }
  }

  // ── Team mapping ──
  async function handleLoadMappings() {
    await run(async () => {
      const leagueId = selectedLeague?.league_id ?? LEAGUE_ID;
      log(`Fetching users for league ${leagueId}…`);
      const result = await buildTeamMappings(leagueId, log);
      log(`Got ${result.length} Sleeper users from API`);
      setMappings(result);
      const edits: Record<string, number | null> = {};
      for (const m of result) edits[m.sleeperUserId] = m.dbTeamId;
      setMappingEdits(edits);
      log(`Loaded ${result.length} Sleeper users`, 'success');
    });
  }

  // Which dbTeamIds are selected more than once (duplicate detection)
  const duplicateTeamIds = Object.values(mappingEdits).reduce<Set<number>>((dupes, id) => {
    if (id == null) return dupes;
    const count = Object.values(mappingEdits).filter((x) => x === id).length;
    if (count > 1) dupes.add(id);
    return dupes;
  }, new Set());

  async function handleSaveMappings() {
    if (!mappings) return;
    if (duplicateTeamIds.size > 0) {
      log('Cannot save — two or more Sleeper users are mapped to the same team. Fix the duplicates highlighted in red first.', 'error');
      return;
    }
    await run(async () => {
      const updated: TeamMapping[] = mappings.map((m) => ({
        ...m,
        dbTeamId: mappingEdits[m.sleeperUserId] ?? null,
        dbTeamName: dbTeams?.find((t) => t.id === mappingEdits[m.sleeperUserId])?.name ?? null,
      }));
      await saveTeamMappings(updated, log);
      // Refresh mappings so isNew flags update after save
      const refreshed = await buildTeamMappings(selectedLeague?.league_id ?? LEAGUE_ID);
      setMappings(refreshed);
    });
  }

  // ── Sync actions ──
  async function handleSyncScores() {
    if (!selectedLeague) return;
    await run(async () => {
      await syncScoresAndSchedules(selectedLeague, log, setProgress);
    });
  }

  async function handleSyncDrafts() {
    if (!selectedLeague) return;
    await run(async () => {
      await syncDraftPicks(selectedLeague, log, setProgress);
    });
  }

  async function handleSyncTrades() {
    if (!selectedLeague) return;
    await run(async () => {
      await syncTrades(selectedLeague, log, setProgress);
    });
  }

  async function handleRepairTradeDescriptions() {
    await run(async () => {
      await repairTradeDescriptions(log);
    });
  }

  async function handleRepairPickDescriptions() {
    await run(async () => {
      await repairPickDescriptions(log);
    });
  }

  async function handleClearAndResyncTrades() {
    if (!selectedLeague) return;
    await run(async () => {
      await clearAndResyncTrades(selectedLeague, log, setProgress);
    });
  }

  async function handleSyncAll() {
    if (!selectedLeague) return;
    await run(async () => {
      await syncAll(selectedLeague, log, (_label, p) => setProgress(p));
    });
  }

  async function handleSyncAllSeasons() {
    if (!allLeagues) return;
    await run(async () => {
      for (let i = 0; i < allLeagues.length; i++) {
        const league = allLeagues[i];
        await syncAll(league, log, (_label, p) =>
          setProgress(((i + p / 100) / allLeagues.length) * 100),
        );
      }
    });
  }

  return (
    <ErrorBoundary>
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Zap className="h-6 w-6 text-blue-400" />
            Data Sync
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Pull live data from the Sleeper API into Supabase
          </p>
        </div>
        {running && (
          <div className="flex items-center gap-2 text-sm text-blue-400">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Syncing…
          </div>
        )}
      </div>

      {running && <Progress value={progress} className="h-1" />}

      {/* League overview */}
      <SyncCard icon={Trophy} title="League Info" description="Current Sleeper league status" accent="blue">
        {leagueLoading ? (
          <p className="text-slate-400 text-sm animate-pulse">Connecting to Sleeper API…</p>
        ) : leagueError ? (
          <div className="flex items-center gap-3">
            <p className="text-red-400 text-sm">Failed to reach Sleeper API — check your connection.</p>
            <Button size="sm" variant="outline" onClick={() => refetchLeague()} className="border-red-500/30 text-red-400 hover:bg-red-500/10">
              Retry
            </Button>
          </div>
        ) : currentLeague ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'League', value: currentLeague.name },
              { label: 'Season', value: currentLeague.season },
              { label: 'Teams', value: currentLeague.total_rosters },
              { label: 'Status', value: <LeagueBadge status={currentLeague.status} /> },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg bg-white/5 p-3">
                <p className="text-xs text-slate-500 mb-1">{label}</p>
                <p className="text-sm font-medium">{value}</p>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[180px]">
            <Select
              value={selectedLeagueId || selectedLeague?.league_id || ''}
              onValueChange={setSelectedLeagueId}
              disabled={historyLoading || !!historyError}
            >
              <SelectTrigger className="bg-white/5 border-white/10 text-sm">
                <SelectValue placeholder={
                  historyLoading ? 'Loading season history…' :
                  historyError ? 'Failed to load seasons — retry below' :
                  !allLeagues?.length ? 'No seasons found' :
                  'Select a season to sync'
                } />
              </SelectTrigger>
              <SelectContent>
                {allLeagues?.map((l) => (
                  <SelectItem key={l.league_id} value={l.league_id}>
                    {l.season} — {l.name}{l.status === 'in_season' ? ' (active)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {historyError && (
              <button onClick={() => refetchHistory()} className="mt-1 text-xs text-red-400 hover:text-red-300 underline">
                Retry loading season history
              </button>
            )}
          </div>
          <Button
            onClick={handleSyncAllSeasons}
            disabled={running || !allLeagues}
            variant="outline"
            size="sm"
            className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
          >
            <Zap className="h-3 w-3 mr-1" />
            Sync All Seasons
          </Button>
        </div>
      </SyncCard>

      {/* Team mapping */}
      <SyncCard
        icon={Users}
        title="Team Mapping"
        description="Link Sleeper users to your league teams. Required before syncing scores or trades."
        accent="purple"
      >
        <Button
          onClick={handleLoadMappings}
          disabled={running}
          size="sm"
          variant="outline"
          className="border-purple-500/30 text-purple-400 hover:bg-purple-500/10 mb-4"
        >
          <RefreshCw className={cn('h-3 w-3 mr-1', running && 'animate-spin')} />
          Load Mappings
        </Button>

        {mappings && (
          <>
            <div className="space-y-2 mb-4">
              {mappings.map((m) => {
                const currentDbId = mappingEdits[m.sleeperUserId];
                const isMapped = currentDbId != null;
                const isDuplicate = currentDbId != null && duplicateTeamIds.has(currentDbId);
                return (
                  <div
                    key={m.sleeperUserId}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 transition-colors',
                      isDuplicate
                        ? 'bg-red-500/10 border border-red-500/30'
                        : 'bg-white/5',
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{m.sleeperDisplayName}</p>
                        {m.isNew && (
                          <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            NEW
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">@{m.sleeperUsername}</p>
                    </div>
                    <div className="w-44">
                      <Select
                        value={currentDbId != null ? String(currentDbId) : '__none__'}
                        onValueChange={(val) =>
                          setMappingEdits((prev) => ({
                            ...prev,
                            [m.sleeperUserId]: val === '__none__' ? null : Number(val),
                          }))
                        }
                      >
                        <SelectTrigger className={cn('text-xs h-8', isDuplicate ? 'border-red-500/50 bg-red-500/5' : 'bg-white/5 border-white/10')}>
                          <SelectValue placeholder="Select team…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— unset —</SelectItem>
                          {dbTeams?.map((t) => (
                            <SelectItem key={t.id} value={String(t.id)}>
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {isDuplicate && (
                        <p className="text-[10px] text-red-400 mt-0.5">Already assigned to another user</p>
                      )}
                    </div>
                    {isDuplicate ? (
                      <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                    ) : isMapped ? (
                      <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={handleSaveMappings}
                disabled={running || duplicateTeamIds.size > 0}
                size="sm"
                className="bg-purple-600 hover:bg-purple-700 disabled:opacity-40"
              >
                Save Mappings
              </Button>
              {duplicateTeamIds.size > 0 && (
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <XCircle className="h-3 w-3" />
                  Fix {duplicateTeamIds.size} duplicate{duplicateTeamIds.size > 1 ? 's' : ''} before saving
                </p>
              )}
            </div>
          </>
        )}

        <LogPanel entries={entries} onClear={clear} />
      </SyncCard>

      {/* Scores & Schedules */}
      <SyncCard
        icon={Calendar}
        title="Scores & Schedules"
        description="Sync weekly matchup scores and pairings. Existing data for the selected season is replaced."
        accent="emerald"
      >
        <div className="flex gap-2 flex-wrap">
          <Button
            onClick={handleSyncScores}
            disabled={running || !selectedLeague}
            size="sm"
            className="bg-emerald-700 hover:bg-emerald-600"
          >
            <RefreshCw className={cn('h-3 w-3 mr-1', running && 'animate-spin')} />
            Sync {selectedLeague?.season ?? '…'}
          </Button>
        </div>
        <LogPanel entries={entries} onClear={clear} />
      </SyncCard>

      {/* Draft picks */}
      <SyncCard
        icon={FileText}
        title="Draft Picks"
        description="Sync completed draft picks. Player names come from Sleeper pick metadata."
        accent="amber"
      >
        <Button
          onClick={handleSyncDrafts}
          disabled={running || !selectedLeague}
          size="sm"
          variant="outline"
          className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
        >
          <RefreshCw className={cn('h-3 w-3 mr-1', running && 'animate-spin')} />
          Sync Drafts for {selectedLeague?.season ?? '…'}
        </Button>
        <LogPanel entries={entries} onClear={clear} />
      </SyncCard>

      {/* Trades */}
      <SyncCard
        icon={ArrowLeftRight}
        title="Trades"
        description="Sync completed trades and the players/picks exchanged. Already-synced transactions are skipped."
        accent="blue"
      >
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={handleSyncTrades}
            disabled={running || !selectedLeague}
            size="sm"
            variant="outline"
            className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
          >
            <RefreshCw className={cn('h-3 w-3 mr-1', running && 'animate-spin')} />
            Sync Trades for {selectedLeague?.season ?? '…'}
          </Button>
          <Button
            onClick={handleRepairTradeDescriptions}
            disabled={running}
            size="sm"
            variant="outline"
            className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
            title="Updates any 'Player XXXX' entries in trade history with real player names"
          >
            <RefreshCw className={cn('h-3 w-3 mr-1', running && 'animate-spin')} />
            Fix Player Names in Trades
          </Button>
          <Button
            onClick={handleRepairPickDescriptions}
            disabled={running}
            size="sm"
            variant="outline"
            className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
            title="Upgrades 'YYYY Round N Pick' to (R.SS) format using draft history"
          >
            <RefreshCw className={cn('h-3 w-3 mr-1', running && 'animate-spin')} />
            Fix Pick Descriptions
          </Button>
          <Button
            onClick={handleClearAndResyncTrades}
            disabled={running || !selectedLeague}
            size="sm"
            variant="outline"
            className="border-red-500/30 text-red-400 hover:bg-red-500/10"
            title="Deletes all trades for this season and re-syncs from Sleeper — picks will get (R.SS) format"
          >
            <RefreshCw className={cn('h-3 w-3 mr-1', running && 'animate-spin')} />
            Clear & Re-sync Trades ({selectedLeague?.season ?? '…'})
          </Button>
        </div>
        <LogPanel entries={entries} onClear={clear} />
      </SyncCard>

      {/* Sync everything for selected season */}
      <Card className="border-white/10 bg-gradient-to-r from-blue-500/5 to-emerald-500/5">
        <CardContent className="pt-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-sm">Sync Everything</p>
              <p className="text-xs text-slate-400">
                Scores, schedules, drafts, and trades for {selectedLeague?.season ?? 'the selected season'} in one shot.
              </p>
            </div>
            <Button
              onClick={handleSyncAll}
              disabled={running || !selectedLeague}
              className="bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-500 hover:to-emerald-500 shrink-0"
            >
              <Zap className="h-4 w-4 mr-1" />
              Sync All
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Global log */}
      <LogPanel entries={entries} onClear={clear} />
    </div>
    </ErrorBoundary>
  );
};

export default Admin;
