
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface SeasonRecord {
  team: string;
  season: string;
  record: string;
  percentage: number;
}

interface MiscRecordsSectionProps {
  bestRecords: SeasonRecord[];
  worstRecords: SeasonRecord[];
}

export const MiscRecordsSection = ({
  bestRecords,
  worstRecords,
}: MiscRecordsSectionProps) => {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <p className="md:col-span-2 text-sm text-muted-foreground -mb-2">
        These are single-season all-play records. For a career-long composite ranking (all-play
        win%, PPG, titles, and playoff rate combined), see{" "}
        <Link to="/analytics" className="text-primary hover:underline">
          Analytics → Career Rankings
        </Link>
        .
      </p>
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">Best Seasons vs All Teams</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Team</TableHead>
              <TableHead>Season</TableHead>
              <TableHead>Record</TableHead>
              <TableHead>Win %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bestRecords.map((record, index) => (
              <TableRow key={index}>
                <TableCell className="font-medium">{record.team}</TableCell>
                <TableCell>{record.season}</TableCell>
                <TableCell>{record.record}</TableCell>
                <TableCell>{record.percentage.toFixed(1)}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">Worst Seasons vs All Teams</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Team</TableHead>
              <TableHead>Season</TableHead>
              <TableHead>Record</TableHead>
              <TableHead>Win %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {worstRecords.map((record, index) => (
              <TableRow key={index}>
                <TableCell className="font-medium">{record.team}</TableCell>
                <TableCell>{record.season}</TableCell>
                <TableCell>{record.record}</TableCell>
                <TableCell>{record.percentage.toFixed(1)}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
};
