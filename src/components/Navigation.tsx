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
  BarChart2,
  Calendar,
  BookOpen,
  ArrowLeftRight,
  Swords,
  Star,
  ChevronDown,
  Zap,
  LineChart,
  Flame,
  GraduationCap,
} from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { type Team } from '@/types/database';
import { cn } from '@/lib/utils';

const links = [
  { to: '/season14', label: 'S14 \'26', icon: Flame },
  { to: '/', label: 'Seasons', icon: Trophy },
  { to: '/weekly-scores', label: 'Scores', icon: Calendar },
  { to: '/weekly-records', label: 'By Week', icon: BarChart2 },
  { to: '/draft', label: 'Draft', icon: BookOpen },
  { to: '/trades', label: 'Trades', icon: ArrowLeftRight },
  { to: '/head-to-head', label: 'H2H', icon: Swords },
  { to: '/records', label: 'Records', icon: Star },
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
      return data as Team[];
    },
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
    <nav className="sticky top-0 z-50 border-b border-white/8 bg-[#13131f]/80 backdrop-blur-md">
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
            <SheetContent className="bg-[#13131f] border-white/10">
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
                    </Link>
                  </SheetClose>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        ) : (
          <div className="flex items-center gap-1">
            {links.map((link) => (
              <NavLink key={link.to} {...link} />
            ))}

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
                className="bg-[#1a1a2e] border-white/10 min-w-[160px]"
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

            {/* Sync link */}
            <Link
              to="/admin"
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
