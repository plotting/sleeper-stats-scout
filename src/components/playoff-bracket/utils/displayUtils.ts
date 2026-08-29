
/**
 * Get emoji for final placement
 */
export const getFinalPlacementEmoji = (placement: number | undefined): string => {
  if (!placement) return "";

  switch (placement) {
    case 1:  return "🏆";
    case 2:  return "🥈";
    case 3:  return "🥉";
    case 4:  return "🎖️";
    case 5:  return "⭐";
    case 6:  return "🌟";
    case 7:  return "7️⃣";
    case 8:  return "8️⃣";
    case 9:  return "🚽";
    case 10: return "💩";
    case 11: return "🤡";
    case 12: return "☠️";
    default: return "";
  }
};

export const getPlacementLabel = (placement: number | undefined): string => {
  if (!placement) return "";
  switch (placement) {
    case 1:  return "Champion";
    case 2:  return "Runner-Up";
    case 3:  return "3rd Place";
    case 4:  return "4th Place";
    case 5:  return "5th Place";
    case 6:  return "6th Place";
    case 7:  return "7th Place";
    case 8:  return "8th Place";
    case 9:  return "Toilet Bowl W";
    case 10: return "Toilet Bowl L";
    case 11: return "11th Place";
    case 12: return "Last Place";
    default: return `${placement}th Place`;
  }
};

export const getPlacementColors = (placement: number | undefined): string => {
  if (!placement) return "";
  if (placement === 1)  return "border-amber-400/50 text-amber-300 bg-amber-400/10";
  if (placement === 2)  return "border-slate-400/50 text-slate-300 bg-slate-400/10";
  if (placement === 3)  return "border-orange-400/50 text-orange-300 bg-orange-400/10";
  if (placement === 4)  return "border-blue-400/30 text-blue-300 bg-blue-400/10";
  if (placement <= 6)   return "border-white/10 text-slate-400 bg-white/5";
  if (placement <= 8)   return "border-white/8 text-slate-500 bg-white/3";
  // Toilet bowl (9th/10th) and below
  return "border-red-500/20 text-red-400/70 bg-red-500/5";
};
