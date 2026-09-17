
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MatchupScoresView } from "@/types/database";
import { 
  StreakRecord, 
  formatSeason, 
  formatWeekRange, 
  getTop10UniqueTeams, 
  getAllOtherTeams 
} from "@/utils/streakUtils";

interface StreakTableProps {
  title: string;
  allRecords: StreakRecord[];
  matchups: MatchupScoresView[];
}

export const StreakTable = ({ title, allRecords, matchups }: StreakTableProps) => {
  const top10Records = getTop10UniqueTeams(allRecords);
  const top10Teams = new Set(top10Records.map(r => r.team));
  const otherRecords = getAllOtherTeams(allRecords, top10Teams, matchups);
  
  return (
    <Card className="p-6 border-white/10 bg-[#1a1a2e]">
      <h2 className="text-xl font-semibold mb-4">{title}</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Team</TableHead>
            <TableHead>Season</TableHead>
            <TableHead>Weeks</TableHead>
            <TableHead>Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {top10Records.map((record, index) => (
            <TableRow key={`top-${index}`}>
              <TableCell className="font-medium">{record.team}</TableCell>
              <TableCell>{record.length > 0 ? formatSeason(record.season) : "-"}</TableCell>
              <TableCell>
                {record.length > 0 ? formatWeekRange(record.startWeek, record.endWeek, record.length) : "-"}
              </TableCell>
              <TableCell>{record.details}</TableCell>
            </TableRow>
          ))}
          
          {otherRecords.length > 0 && (
            <>
              <TableRow>
                <TableCell colSpan={4} className="text-center font-medium py-2 bg-muted/30">
                  Other Teams
                </TableCell>
              </TableRow>
              {otherRecords.map((record, index) => (
                <TableRow key={`other-${index}`}>
                  <TableCell className="font-medium">{record.team}</TableCell>
                  <TableCell>{record.length > 0 ? formatSeason(record.season) : "-"}</TableCell>
                  <TableCell>
                    {record.length > 0 ? formatWeekRange(record.startWeek, record.endWeek, record.length) : "-"}
                  </TableCell>
                  <TableCell>{record.details}</TableCell>
                </TableRow>
              ))}
            </>
          )}
        </TableBody>
      </Table>
    </Card>
  );
};
