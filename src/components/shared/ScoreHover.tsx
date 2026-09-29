import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAllTimeScorePool } from "@/hooks/useAllTimeScorePool";
import { computeWinPct } from "@/utils/scorePercentile";

interface ScoreHoverProps {
  /** The raw score value to look up against the all-time pool. */
  score: number;
  /** Pass true when `score` is itself a historical game already in the pool. */
  excludeSelf?: boolean;
  children: ReactNode;
}

/** Wraps a displayed score with a hover tooltip showing how it stacks up
 * against every regular-season score ever recorded in the league. */
export function ScoreHover({ score, excludeSelf, children }: ScoreHoverProps) {
  const { pool, isLoading } = useAllTimeScorePool();

  if (isLoading || pool.length === 0 || Number.isNaN(score)) {
    return <>{children}</>;
  }

  const result = computeWinPct(score, pool, excludeSelf);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-dotted decoration-slate-600 underline-offset-4">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs max-w-[220px]">
          Beats <span className="font-semibold">{result.pct.toFixed(1)}%</span> of all regular-season scores
          ever ({result.wins}{result.ties > 0 ? ` +${result.ties} tied` : ""} of {result.total})
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
