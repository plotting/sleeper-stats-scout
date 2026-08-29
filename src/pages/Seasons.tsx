
import { Card } from "@/components/ui/card";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import PlayoffBracket from "@/components/PlayoffBracket";
import StandingsTable from "@/components/standings/StandingsTable";
import SeasonHeader from "@/components/seasons/SeasonHeader";
import ScheduleSwapTable from "@/components/schedule/ScheduleSwapTable";
import TeamComparison from "@/components/seasons/TeamComparison";
import StrengthOfSchedule from "@/components/seasons/StrengthOfSchedule";
import WeeklyPowerRankings from "@/components/seasons/WeeklyPowerRankings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const Seasons = () => {
  const [selectedSeason, setSelectedSeason] = useState("14");
  const [activeTab, setActiveTab] = useState("overview");
  const seasonNumber = parseInt(selectedSeason);

  // Reset to overview tab when season changes
  useEffect(() => {
    setActiveTab("overview");
  }, [selectedSeason]);

  const { data: teams } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("*")
        .order("id");
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="min-h-screen container mx-auto px-4 py-6">
      <SeasonHeader 
        selectedSeason={selectedSeason}
        setSelectedSeason={setSelectedSeason}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-6 flex justify-center">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="power-rankings">Power Rankings</TabsTrigger>
          <TabsTrigger value="comparison">Team Comparison</TabsTrigger>
          <TabsTrigger value="playoffs">Playoff Bracket</TabsTrigger>
          <TabsTrigger value="schedule">Schedule Analysis</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card className="mb-8">
            <div className="p-6">
              <h2 className="text-2xl font-bold mb-4">League Standings</h2>
              <StandingsTable seasonId={parseInt(selectedSeason)} />
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="power-rankings">
          <Card>
            <div className="p-6">
              <h2 className="text-2xl font-bold mb-1">Weekly Power Rankings</h2>
              <p className="text-muted-foreground text-sm mb-6">Cumulative PPG-based rankings through each week of the regular season</p>
              <WeeklyPowerRankings seasonId={seasonNumber} />
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="comparison">
          <TeamComparison seasonId={seasonNumber} teams={teams} />
        </TabsContent>

        <TabsContent value="playoffs">
          <PlayoffBracket season={selectedSeason} />
        </TabsContent>

        <TabsContent value="schedule">
          <div className="space-y-8">
            <Card>
              <div className="p-6">
                <h2 className="text-2xl font-bold mb-4">Schedule Analysis</h2>
                <ScheduleSwapTable seasonId={seasonNumber} />
              </div>
            </Card>
            
            <Card>
              <div className="p-6">
                <h2 className="text-2xl font-bold mb-4">Strength of Schedule</h2>
                <StrengthOfSchedule seasonId={seasonNumber} />
              </div>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Seasons;
