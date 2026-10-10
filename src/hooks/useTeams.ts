import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Team } from "@/types/database";

/**
 * Every team, in the one order the whole site uses (team id, the same as the Teams menu). All pages and charts that list teams
 * should read them from here (or sort by `teamOrderOf`) so the order can never differ between a menu, a table and a matrix.
 * One shared query key: queries that select different columns or filters must not reuse it.
 */
export function useTeams() {
  return useQuery({
    queryKey: ["teams", "all"],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Team[]> => {
      const { data, error } = await supabase.from("teams").select("*").order("id");
      if (error) throw error;
      return data as Team[];
    },
  });
}

/** Sort anything that has a team id into the site-wide team order (ascending team id). */
export function sortByTeamOrder<T>(items: T[], idOf: (item: T) => number): T[] {
  return [...items].sort((a, b) => idOf(a) - idOf(b));
}
