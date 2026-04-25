
import type { Database } from '@/integrations/supabase/types';

// Re-export types for table rows
export type Team = Database['public']['Tables']['teams']['Row'];
export type Season = Database['public']['Tables']['seasons']['Row'];
export type Score = Database['public']['Tables']['scores']['Row'];
export type Trade = Database['public']['Tables']['trades']['Row'];
export type TradeItem = Database['public']['Tables']['trade_items']['Row'];
export type DraftPick = Database['public']['Tables']['draft_picks']['Row'];
export type Schedule = Database['public']['Tables']['schedules']['Row'];

// Re-export types for views
export type MatchupScoresView = Database['public']['Views']['matchup_scores_view']['Row'];
export type TeamRecordsView = Database['public']['Views']['team_records_view']['Row'];
