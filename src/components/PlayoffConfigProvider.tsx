import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { setPlayoffConfigs } from "@/utils/playoffRegistry";
import type { PlayoffConfig } from "@/utils/playoffBracket";

/** Loads every season's synced playoff structure before the app renders, so
 *  format questions can be answered synchronously (see playoffRegistry). */
const PlayoffConfigProvider = ({ children }: { children: ReactNode }) => {
  const { isLoading } = useQuery({
    queryKey: ["season-playoffs"],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.from("season_playoffs").select("*");
      // Table missing (migration not run yet) → behave as "nothing synced".
      const rows = error ? [] : (data as unknown as PlayoffConfig[]);
      setPlayoffConfigs(rows);
      return rows;
    },
  });
  if (isLoading) return null;
  return <>{children}</>;
};

export default PlayoffConfigProvider;
