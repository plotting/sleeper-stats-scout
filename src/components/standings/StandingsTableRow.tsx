
import { Link } from "react-router-dom";
import { TableCell, TableRow } from "@/components/ui/table";
import { TeamRecordsView } from "@/types/database";
import { ComputedTeamRecord } from "./useStandingsData";
import {
  getFinalPlacementEmoji,
  getPlacementLabel,
  getPlacementColors,
} from "../playoff-bracket/utils/displayUtils";
import { cn } from "@/lib/utils";

interface StandingsTableRowProps {
  team: TeamRecordsView;
  index: number;
  seasonId: number;
  teamPlacement?: number;
  computedRecord?: ComputedTeamRecord;
}

const StandingsTableRow = ({ team, index, seasonId, teamPlacement, computedRecord }: StandingsTableRowProps) => {
  const emoji = getFinalPlacementEmoji(teamPlacement);
  const label = getPlacementLabel(teamPlacement);
  const colors = getPlacementColors(teamPlacement);

  // Prefer computed values (derived from raw matchup data) over view values
  const rsWins   = computedRecord?.rsWins   ?? team.regular_season_wins   ?? 0;
  const rsLosses = computedRecord?.rsLosses ?? team.regular_season_losses ?? 0;
  const rsTies   = computedRecord?.rsTies   ?? team.regular_season_ties   ?? 0;
  const rsPF     = computedRecord?.rsPF     ?? team.regular_season_points_for    ?? 0;
  const rsPA     = computedRecord?.rsPA     ?? team.regular_season_points_against ?? 0;
  const poWins   = computedRecord?.poWins   ?? team.playoff_wins   ?? 0;
  const poLosses = computedRecord?.poLosses ?? team.playoff_losses ?? 0;
  const poTies   = computedRecord?.poTies   ?? team.playoff_ties   ?? 0;

  return (
    <TableRow key={team.team_id}>
      <TableCell className="font-medium">
        {index + 1}
      </TableCell>
      <TableCell>
        <Link
          to={`/team/${team.team_id}?season=${seasonId}`}
          className="text-primary hover:underline"
        >
          {team.team_name}
        </Link>
      </TableCell>
      <TableCell className="text-center">
        {rsWins}-{rsLosses}
        {rsTies > 0 ? `-${rsTies}` : ""}
      </TableCell>
      <TableCell className="text-center">
        {poWins}-{poLosses}
        {poTies > 0 ? `-${poTies}` : ""}
      </TableCell>
      <TableCell className="text-center">{rsPF.toFixed(1)}</TableCell>
      <TableCell className="text-center">{rsPA.toFixed(1)}</TableCell>
      <TableCell className="text-center">
        {teamPlacement ? (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap",
              colors,
            )}
          >
            <span>{emoji}</span>
            <span>{label}</span>
          </span>
        ) : ""}
      </TableCell>
    </TableRow>
  );
};

export default StandingsTableRow;
