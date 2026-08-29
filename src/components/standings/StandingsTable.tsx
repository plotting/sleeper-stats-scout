
import { Table, TableBody } from "@/components/ui/table";
import StandingsTableHeader from "./StandingsTableHeader";
import StandingsTableRow from "./StandingsTableRow";
import { useStandingsData } from "./useStandingsData";

interface StandingsTableProps {
  seasonId: number;
}

const StandingsTable = ({ seasonId }: StandingsTableProps) => {
  const { sortedByRegularSeason, teamPlacements, computedRecords, isLoading } = useStandingsData(seasonId);

  if (isLoading) {
    return <p className="text-center py-4">Loading standings...</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table className="w-full">
        <StandingsTableHeader />
        <TableBody>
          {sortedByRegularSeason.map((team, index) => (
            <StandingsTableRow
              key={team.team_id}
              team={team}
              index={index}
              seasonId={seasonId}
              teamPlacement={teamPlacements.get(team.team_id!)}
              computedRecord={computedRecords.get(team.team_id!)}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export default StandingsTable;
