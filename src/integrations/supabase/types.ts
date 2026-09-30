export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.4"
  }
  public: {
    Tables: {
      draft_picks: {
        Row: {
          created_at: string
          id: number
          pick_number: number
          player_name: string
          round: number
          season_id: number | null
          team_id: number | null
        }
        Insert: {
          created_at?: string
          id?: number
          pick_number: number
          player_name: string
          round: number
          season_id?: number | null
          team_id?: number | null
        }
        Update: {
          created_at?: string
          id?: number
          pick_number?: number
          player_name?: string
          round?: number
          season_id?: number | null
          team_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "draft_picks_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_picks_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      playoff_sim_history: {
        Row: {
          as_of_week: number
          bracket_size: number
          computed_at: string
          id: number
          num_sims: number
          playoff_pct: number
          proj_ppg: number
          proj_seed: number
          proj_std: number
          proj_wins: number
          season_id: number
          seed_pct: Json
          team_id: number
        }
        Insert: {
          as_of_week: number
          bracket_size: number
          computed_at?: string
          id?: number
          num_sims: number
          playoff_pct: number
          proj_ppg: number
          proj_seed: number
          proj_std: number
          proj_wins: number
          season_id: number
          seed_pct: Json
          team_id: number
        }
        Update: {
          as_of_week?: number
          bracket_size?: number
          computed_at?: string
          id?: number
          num_sims?: number
          playoff_pct?: number
          proj_ppg?: number
          proj_seed?: number
          proj_std?: number
          proj_wins?: number
          season_id?: number
          seed_pct?: Json
          team_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "playoff_sim_history_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoff_sim_history_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          away_team_id: number | null
          created_at: string | null
          home_team_id: number | null
          id: number
          is_consolation: boolean | null
          is_playoff: boolean | null
          scheduled_time: string | null
          season_id: number | null
          week_number: number
        }
        Insert: {
          away_team_id?: number | null
          created_at?: string | null
          home_team_id?: number | null
          id?: number
          is_consolation?: boolean | null
          is_playoff?: boolean | null
          scheduled_time?: string | null
          season_id?: number | null
          week_number: number
        }
        Update: {
          away_team_id?: number | null
          created_at?: string | null
          home_team_id?: number | null
          id?: number
          is_consolation?: boolean | null
          is_playoff?: boolean | null
          scheduled_time?: string | null
          season_id?: number | null
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "schedules_away_team_id_fkey"
            columns: ["away_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_home_team_id_fkey"
            columns: ["home_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      scores: {
        Row: {
          created_at: string
          id: number
          score: number
          season_id: number | null
          team_id: number | null
          week_number: number
        }
        Insert: {
          created_at?: string
          id?: number
          score: number
          season_id?: number | null
          team_id?: number | null
          week_number: number
        }
        Update: {
          created_at?: string
          id?: number
          score?: number
          season_id?: number | null
          team_id?: number | null
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "scores_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scores_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      seasons: {
        Row: {
          created_at: string
          id: number
          playoff_format: string
          season_number: number
          year: number
        }
        Insert: {
          created_at?: string
          id?: number
          playoff_format: string
          season_number: number
          year: number
        }
        Update: {
          created_at?: string
          id?: number
          playoff_format?: string
          season_number?: number
          year?: number
        }
        Relationships: []
      }
      teams: {
        Row: {
          created_at: string
          id: number
          name: string
          owner_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: number
          name: string
          owner_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: number
          name?: string
          owner_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      trade_items: {
        Row: {
          created_at: string
          from_team_id: number | null
          id: number
          item_description: string
          item_type: string
          to_team_id: number | null
          trade_id: number | null
        }
        Insert: {
          created_at?: string
          from_team_id?: number | null
          id?: number
          item_description: string
          item_type: string
          to_team_id?: number | null
          trade_id?: number | null
        }
        Update: {
          created_at?: string
          from_team_id?: number | null
          id?: number
          item_description?: string
          item_type?: string
          to_team_id?: number | null
          trade_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "trade_items_from_team_id_fkey"
            columns: ["from_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_items_to_team_id_fkey"
            columns: ["to_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_items_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      trades: {
        Row: {
          created_at: string
          id: number
          season_id: number | null
          team1_id: number | null
          team2_id: number | null
          trade_date: string
        }
        Insert: {
          created_at?: string
          id?: number
          season_id?: number | null
          team1_id?: number | null
          team2_id?: number | null
          trade_date?: string
        }
        Update: {
          created_at?: string
          id?: number
          season_id?: number | null
          team1_id?: number | null
          team2_id?: number | null
          trade_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "trades_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_team1_id_fkey"
            columns: ["team1_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_team2_id_fkey"
            columns: ["team2_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      matchup_scores_view: {
        Row: {
          away_score: number | null
          away_team_id: number | null
          away_team_name: string | null
          home_score: number | null
          home_team_id: number | null
          home_team_name: string | null
          is_consolation: boolean | null
          is_playoff: boolean | null
          is_playoff_bracket: boolean | null
          scheduled_time: string | null
          season_id: number | null
          week_number: number | null
        }
        Relationships: [
          {
            foreignKeyName: "schedules_away_team_id_fkey"
            columns: ["away_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_home_team_id_fkey"
            columns: ["home_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      team_records_view: {
        Row: {
          playoff_losses: number | null
          playoff_points_against: number | null
          playoff_points_for: number | null
          playoff_ties: number | null
          playoff_wins: number | null
          regular_season_losses: number | null
          regular_season_points_against: number | null
          regular_season_points_for: number | null
          regular_season_ties: number | null
          regular_season_wins: number | null
          season_id: number | null
          team_id: number | null
          team_name: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
