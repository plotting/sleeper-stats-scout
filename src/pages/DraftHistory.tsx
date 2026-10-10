
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getAllSeasons } from "@/utils/seasonUtils";
import { useTeams } from "@/hooks/useTeams";

const DraftHistory = () => {
  const [selectedSeason, setSelectedSeason] = useState("1");

  const { data: teams } = useTeams();

  const { data: draftPicks, isLoading } = useQuery({
    queryKey: ["draft-picks", selectedSeason],
    queryFn: async () => {
      const { data: picksData, error } = await supabase
        .from("draft_picks")
        .select("*")
        .eq("season_id", parseInt(selectedSeason))
        .order("round")
        .order("pick_number");
      if (error) throw error;
      return picksData;
    },
  });

  // Calculate total rounds
  const totalRounds = draftPicks 
    ? Math.max(...draftPicks.map(pick => pick.round))
    : 0;

  // Organize picks by round and team
  const picksByRound = Array.from({ length: totalRounds }, (_, roundIndex) => {
    const round = roundIndex + 1;
    return draftPicks
      ?.filter(pick => pick.round === round)
      .reduce((acc, pick) => {
        acc[pick.team_id || 0] = `${pick.player_name} (${round}.${pick.pick_number.toString().padStart(2, '0')})`;
        return acc;
      }, {} as Record<number, string>);
  });

  return (
    <div className="min-h-screen">
      <header className="mb-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">Draft History</h1>
            <p className="text-muted-foreground">Track draft picks by round</p>
          </div>
          <Select value={selectedSeason} onValueChange={setSelectedSeason}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select Season" />
            </SelectTrigger>
            <SelectContent>
              {getAllSeasons().reverse().map((season) => (
                <SelectItem key={season.value} value={season.value}>
                  {season.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="bg-card sticky left-0 z-10">Team</TableHead>
              {Array.from({ length: totalRounds }, (_, i) => (
                <TableHead key={i} className="text-center">
                  Round {i + 1}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {teams?.map((team) => (
              <TableRow key={team.id}>
                <TableCell className="font-medium sticky left-0 bg-background z-10">
                  <Link 
                    to={`/team/${team.id}?season=${selectedSeason}`} 
                    className="text-primary hover:underline"
                  >
                    {team.name}
                  </Link>
                </TableCell>
                {picksByRound.map((roundPicks, roundIndex) => (
                  <TableCell key={roundIndex} className="text-center">
                    {roundPicks[team.id] || "-"}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
};

export default DraftHistory;
