import { Fragment } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Menu,
  Trophy,
  BookOpen,
  ArrowLeftRight,
  ChevronDown,
  Zap,
  LineChart,
  Flame,
  GraduationCap,
  MoreHorizontal,
  Landmark,
  Store,
  Calculator,
  Lock,
} from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { type Team } from '@/types/database';
import { cn } from '@/lib/utils';
import { formatDistanceToNowStrict } from 'date-fns';
import { CURRENT_SEASON_NUMBER, CURRENT_SEASON_YEAR } from '@/utils/seasonUtils';

// Core pages, kept as flat top-level links.
const links = [
  { to: '/current-season', label: `S${CURRENT_SEASON_NUMBER} '${String(CURRENT_SEASON_YEAR).slice(2)}`, icon: Flame },
  { to: '/', label: 'Seasons', icon: Trophy },
  { to: '/draft', label: 'Draft', icon: BookOpen },
  { to: '/hall', label: 'The Hall', icon: Landmark },
];

// Trade Hub: everything about trades in one menu, placed where the Trades link used to be (after Draft).
// The market and calculator are behind the admin sign-in (the pages show the sign-in form when signed out).
const tradeHubLinks = [
  { to: '/trades', label: 'Trades', icon: ArrowLeftRight, locked: false },
  { to: '/trade-market', label: 'Market', icon: Store, locked: true },
  { to: '/trade-calculator', label: 'Calculator', icon: Calculator, locked: true },
];
const HUB_AFTER = '/draft';

// Everything else lives behind "More" so the primary bar stays short —
// splitting these out actually narrows the nav instead of just appending to it.
// Recaps and Rookies are intentionally absent: Recaps now lives as a sub-tab
// under the current-season page, and Rookies' functionality was absorbed into Draft Grades'
// ADP/Pick Value tabs — both dropped from the nav upstream on main.
// Weekly Scores, By Week, and H2H are also absent: all three now live as
// sub-tabs on the Seasons page. Dynasty Digest and GM Scouting are hidden
// for now (routes still exist, just not linked) while those pages are held
// back. Records is folded into The Hall as its "Records" tab.
const moreLinks = [
  { to: '/analytics', label: 'Analytics', icon: LineChart },
  { to: '/draft-grades', label: 'Grades', icon: GraduationCap },
];

const Navigation = () => {
  const isMobile = useIsMobile();
  const location = useLocation();

  const { data: teams, isLoading } = useQuery({
    queryKey: ['teams'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('id, name, owner_id, created_at, updated_at')
        .order('id');
      if (error) throw error;
      // Only list teams that have actually played a season (mapping mistakes
      // or unused teams would otherwise clutter the dropdown).
      const { data: played } = await supabase.from('team_records_view').select('team_id');
      const playedIds = new Set((played ?? []).map((r) => r.team_id));
      return (playedIds.size ? data.filter((t) => playedIds.has(t.id)) : data) as Team[];
    },
  });

  // Most recent trade sync as a proxy "last synced" signal — not exact for
  // every table, but trades sync on the same cadence as everything else and
  // is cheap to query.
  const { data: lastSyncedAt } = useQuery({
    queryKey: ['last-synced-at'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trades')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.created_at ?? null;
    },
    staleTime: 5 * 60 * 1000,
  });

  const isActive = (to: string) =>
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);

  const NavLink = ({ to, label, icon: Icon }: (typeof links)[0]) => (
    <Link
      to={to}
      className={cn(
        'flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md transition-all duration-150',
        isActive(to)
          ? 'text-white bg-white/10 font-medium'
          : 'text-slate-400 hover:text-white hover:bg-white/5',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </Link>
  );

  return (
    <nav className="sticky top-0 z-50 border-b border-white/8 bg-[#020617]/80 backdrop-blur-md">
      <div className="container mx-auto px-4 h-14 flex items-center justify-between">
        {/* Brand */}
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <div className="h-7 w-7 rounded-md bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center">
            <Trophy className="h-4 w-4 text-white" />
          </div>
          <span className="font-bold text-sm hidden sm:block gradient-text">
            Matzie's Dynasty
          </span>
        </Link>

        {isMobile ? (
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="text-slate-400 hover:text-white">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent className="bg-[#020617] border-white/10">
              <SheetHeader>
                <SheetTitle className="gradient-text text-left">Matzie's Dynasty</SheetTitle>
              </SheetHeader>
              <div className="flex flex-col gap-1 mt-6">
                {links.map((link) => (
                  <SheetClose asChild key={link.to}>
                    <Link
                      to={link.to}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2.5 rounded-md text-sm transition-colors',
                        isActive(link.to)
                          ? 'text-white bg-white/10 font-medium'
                          : 'text-slate-400 hover:text-white hover:bg-white/5',
                      )}
                    >
                      <link.icon className="h-4 w-4" />
                      {link.label}
                    </Link>
                  </SheetClose>
                ))}
                <p className="px-3 pt-3 text-xs text-slate-500 uppercase tracking-wider">Trade Hub</p>
                {tradeHubLinks.map((link) => (
                  <SheetClose asChild key={link.to}>
                    <Link
                      to={link.to}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2.5 rounded-md text-sm transition-colors',
                        isActive(link.to)
                          ? 'text-white bg-white/10 font-medium'
                          : 'text-slate-400 hover:text-white hover:bg-white/5',
                      )}
                    >
                      <link.icon className="h-4 w-4" />
                      {link.label}
                      {link.locked && <Lock className="h-3 w-3 ml-auto opacity-50" aria-label="Sign-in required" />}
                    </Link>
                  </SheetClose>
                ))}
                {moreLinks.map((link) => (
                  <SheetClose asChild key={link.to}>
                    <Link
                      to={link.to}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2.5 rounded-md text-sm transition-colors',
                        isActive(link.to)
                          ? 'text-white bg-white/10 font-medium'
                          : 'text-slate-400 hover:text-white hover:bg-white/5',
                      )}
                    >
                      <link.icon className="h-4 w-4" />
                      {link.label}
                    </Link>
                  </SheetClose>
                ))}

                <div className="border-t border-white/10 mt-3 pt-3">
                  <p className="px-3 text-xs text-slate-500 mb-2 uppercase tracking-wider">Teams</p>
                  {isLoading ? (
                    <p className="px-3 text-slate-500 text-sm">Loading…</p>
                  ) : (
                    teams?.map((team) => (
                      <SheetClose asChild key={team.id}>
                        <Link
                          to={`/team/${team.id}`}
                          className={cn(
                            'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
                            location.pathname === `/team/${team.id}`
                              ? 'text-white bg-white/10'
                              : 'text-slate-400 hover:text-white hover:bg-white/5',
                          )}
                        >
                          {team.name}
                        </Link>
                      </SheetClose>
                    ))
                  )}
                </div>

                <div className="border-t border-white/10 mt-3 pt-3">
                  <SheetClose asChild>
                    <Link
                      to="/admin"
                      className={cn(
                        'flex items-center gap-2 px-3 py-2.5 rounded-md text-sm transition-colors',
                        isActive('/admin')
                          ? 'text-blue-400 bg-blue-500/10'
                          : 'text-slate-500 hover:text-blue-400 hover:bg-blue-500/10',
                      )}
                    >
                      <Zap className="h-4 w-4" />
                      Data Sync
                      {lastSyncedAt && (
                        <span className="ml-auto text-[10px] text-slate-500 font-normal">
                          {formatDistanceToNowStrict(new Date(lastSyncedAt), { addSuffix: true })}
                        </span>
                      )}
                    </Link>
                  </SheetClose>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        ) : (
          <div className="flex items-center gap-1">
            {links.map((link) => (
              <Fragment key={link.to}>
                <NavLink {...link} />
                {link.to === HUB_AFTER && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className={cn(
                          'flex items-center gap-1 text-sm px-3 py-1.5 rounded-md transition-all duration-150',
                          tradeHubLinks.some((l) => isActive(l.to))
                            ? 'text-white bg-white/10 font-medium'
                            : 'text-slate-400 hover:text-white hover:bg-white/5',
                        )}
                      >
                        <ArrowLeftRight className="h-3.5 w-3.5" />
                        Trade Hub
                        <ChevronDown className="h-3 w-3 opacity-60" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="bg-[#0f172a] border-white/10 min-w-[170px]">
                      {tradeHubLinks.map((hub) => (
                        <DropdownMenuItem key={hub.to} asChild>
                          <Link
                            to={hub.to}
                            className={cn('flex w-full items-center gap-2 cursor-pointer', isActive(hub.to) && 'text-blue-400')}
                          >
                            <hub.icon className="h-3.5 w-3.5" />
                            {hub.label}
                            {hub.locked && <Lock className="h-3 w-3 ml-auto opacity-50" aria-label="Sign-in required" />}
                          </Link>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </Fragment>
            ))}

            {/* More dropdown — lower-traffic pages */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    'flex items-center gap-1 text-sm px-3 py-1.5 rounded-md transition-all duration-150',
                    moreLinks.some((l) => isActive(l.to))
                      ? 'text-white bg-white/10 font-medium'
                      : 'text-slate-400 hover:text-white hover:bg-white/5',
                  )}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                  More
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-[#0f172a] border-white/10 min-w-[160px]">
                {moreLinks.map((link) => (
                  <DropdownMenuItem key={link.to} asChild>
                    <Link
                      to={link.to}
                      className={cn(
                        'flex w-full items-center gap-2 cursor-pointer',
                        isActive(link.to) && 'text-blue-400',
                      )}
                    >
                      <link.icon className="h-3.5 w-3.5" />
                      {link.label}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Teams dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    'flex items-center gap-1 text-sm px-3 py-1.5 rounded-md transition-all duration-150',
                    location.pathname.startsWith('/team/')
                      ? 'text-white bg-white/10 font-medium'
                      : 'text-slate-400 hover:text-white hover:bg-white/5',
                  )}
                >
                  Teams
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="bg-[#0f172a] border-white/10 min-w-[160px]"
              >
                {isLoading ? (
                  <DropdownMenuItem disabled className="text-slate-500">
                    Loading…
                  </DropdownMenuItem>
                ) : teams && teams.length > 0 ? (
                  teams.map((team) => (
                    <DropdownMenuItem key={team.id} asChild>
                      <Link
                        to={`/team/${team.id}`}
                        className={cn(
                          'w-full cursor-pointer',
                          location.pathname === `/team/${team.id}` && 'text-blue-400',
                        )}
                      >
                        {team.name}
                      </Link>
                    </DropdownMenuItem>
                  ))
                ) : (
                  <DropdownMenuItem disabled>No teams</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Sync link — last-synced time shown as a tooltip, not inline,
                so the bar's width doesn't grow with it */}
            <Link
              to="/admin"
              title={lastSyncedAt ? `Data last synced ${formatDistanceToNowStrict(new Date(lastSyncedAt), { addSuffix: true })}` : undefined}
              className={cn(
                'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md ml-2 border transition-all duration-150',
                isActive('/admin')
                  ? 'border-blue-500/50 text-blue-400 bg-blue-500/10'
                  : 'border-white/10 text-slate-500 hover:text-blue-400 hover:border-blue-500/30 hover:bg-blue-500/5',
              )}
            >
              <Zap className="h-3 w-3" />
              Sync
            </Link>
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navigation;
