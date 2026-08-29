
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { getAllSeasons, getSeasonLabel } from "@/utils/seasonUtils";

const Draft = () => {
  const [selectedSeason, setSelectedSeason] = useState("14");

  const { data: draftPicks, isLoading } = useQuery({
    queryKey: ['draft', selectedSeason],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('draft_picks')
        .select(`
          *,
          team:teams(id, name)
        `)
        .eq('season_id', parseInt(selectedSeason))
        .order('round')
        .order('pick_number');

      if (error) throw error;
      return data;
    },
  });

  // For Season 1, organize picks by team (old format)
  const organizedPicks = selectedSeason === "1" && draftPicks ? draftPicks.reduce((acc, pick) => {
    if (!acc[pick.round]) {
      acc[pick.round] = {};
    }
    acc[pick.round][pick.team?.name || 'Unknown'] = {
      player: pick.player_name,
      pick: `${pick.round}.${String(pick.pick_number).padStart(2, '0')}`
    };
    return acc;
  }, {} as Record<number, Record<string, { player: string; pick: string }>>) : null;

  // Get unique team names for Season 1
  const teams = selectedSeason === "1" ? Array.from(new Set(draftPicks?.map(pick => pick.team?.name || 'Unknown'))) : [];

  return (
    <div className="min-h-screen">
      <header className="mb-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">
              {getSeasonLabel(selectedSeason)} Draft
            </h1>
            <p className="text-muted-foreground">View draft picks across seasons</p>
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

      <Card className="p-6">
        {isLoading ? (
          <div className="text-center py-4">Loading draft picks...</div>
        ) : draftPicks && draftPicks.length > 0 ? (
          selectedSeason === "1" ? (
            // Season 1 format - organize by team columns
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Round</TableHead>
                  {teams.map((team) => (
                    <TableHead key={team}>
                      <Link 
                        to={`/team/${draftPicks.find(p => p.team?.name === team)?.team?.id}?season=${selectedSeason}`}
                        className="text-primary hover:underline"
                      >
                        {team}
                      </Link>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(organizedPicks || {}).map(([round, roundPicks]) => (
                  <TableRow key={round}>
                    <TableCell className="font-medium">Round {round}</TableCell>
                    {teams.map((team) => (
                      <TableCell key={team} className="text-center">
                        <div>{roundPicks[team]?.player || '-'}</div>
                        <div className="text-xs text-muted-foreground">
                          {roundPicks[team]?.pick || '-'}
                        </div>
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            // Season 2+ format - show in rows with Round, Pick #, Team, Player
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Round</TableHead>
                  <TableHead>Pick #</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Player</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {draftPicks.map((pick) => (
                  <TableRow key={`${pick.round}-${pick.pick_number}`}>
                    <TableCell>{pick.round}</TableCell>
                    <TableCell>{pick.pick_number}</TableCell>
                    <TableCell>
                      {pick.team && (
                        <Link 
                          to={`/team/${pick.team.id}?season=${selectedSeason}`}
                          className="text-primary hover:underline"
                        >
                          {pick.team.name}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell>{pick.player_name}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        ) : (
          <div className="text-center py-4 text-muted-foreground">
            No draft picks found for this season
          </div>
        )}
      </Card>
    </div>
  );
};

export default Draft;
