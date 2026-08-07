/**
 * Tipos de la base de datos.
 *
 * GENERADO — no editar a mano. Para regenerar:
 *
 *   npx supabase gen types typescript --project-id <ref> --schema public \
 *     > src/lib/supabase/database.types.ts
 *
 * y volver a pegar el bloque de alias del final.
 */

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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      artifacts: {
        Row: {
          archivado_en: string | null
          created_at: string
          estado: Database["public"]["Enums"]["estado_artefacto"]
          fecha_completado: string | null
          id: string
          nombre: string
          orden: number
          slug: string
          track_id: string
          updated_at: string
          url: string | null
          user_id: string
        }
        Insert: {
          archivado_en?: string | null
          created_at?: string
          estado?: Database["public"]["Enums"]["estado_artefacto"]
          fecha_completado?: string | null
          id?: string
          nombre: string
          orden?: number
          slug: string
          track_id: string
          updated_at?: string
          url?: string | null
          user_id: string
        }
        Update: {
          archivado_en?: string | null
          created_at?: string
          estado?: Database["public"]["Enums"]["estado_artefacto"]
          fecha_completado?: string | null
          id?: string
          nombre?: string
          orden?: number
          slug?: string
          track_id?: string
          updated_at?: string
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "artifacts_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      blocks: {
        Row: {
          archivado_en: string | null
          created_at: string
          fuentes: Json
          id: string
          orden: number
          slug: string
          subtitulo: string | null
          titulo: string
          track_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archivado_en?: string | null
          created_at?: string
          fuentes?: Json
          id?: string
          orden?: number
          slug: string
          subtitulo?: string | null
          titulo: string
          track_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          archivado_en?: string | null
          created_at?: string
          fuentes?: Json
          id?: string
          orden?: number
          slug?: string
          subtitulo?: string | null
          titulo?: string
          track_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocks_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          archivada: boolean
          created_at: string
          id: string
          nombre: string
          tipo: Database["public"]["Enums"]["tipo_movimiento"]
          user_id: string
        }
        Insert: {
          archivada?: boolean
          created_at?: string
          id?: string
          nombre: string
          tipo: Database["public"]["Enums"]["tipo_movimiento"]
          user_id: string
        }
        Update: {
          archivada?: boolean
          created_at?: string
          id?: string
          nombre?: string
          tipo?: Database["public"]["Enums"]["tipo_movimiento"]
          user_id?: string
        }
        Relationships: []
      }
      daily_log: {
        Row: {
          archivado_en: string | null
          contenido: string
          created_at: string
          fecha: string
          id: string
          project_id: string
          slug: string | null
          track_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archivado_en?: string | null
          contenido: string
          created_at?: string
          fecha: string
          id?: string
          project_id: string
          slug?: string | null
          track_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archivado_en?: string | null
          contenido?: string
          created_at?: string
          fecha?: string
          id?: string
          project_id?: string
          slug?: string | null
          track_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_log_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      fx_rates: {
        Row: {
          compra: number
          fecha: string
          fetched_at: string
          fuente: string
          venta: number
        }
        Insert: {
          compra: number
          fecha: string
          fetched_at?: string
          fuente?: string
          venta: number
        }
        Update: {
          compra?: number
          fecha?: string
          fetched_at?: string
          fuente?: string
          venta?: number
        }
        Relationships: []
      }
      inbox: {
        Row: {
          clave_dedupe: string | null
          creado_en: string
          entidad_id: string | null
          entidad_tabla: string | null
          error_detalle: string | null
          estado: Database["public"]["Enums"]["estado_bandeja"]
          id: string
          payload: Json
          posponer_hasta: string | null
          resuelto_en: string | null
          tipo: Database["public"]["Enums"]["tipo_bandeja"]
          user_id: string
        }
        Insert: {
          clave_dedupe?: string | null
          creado_en?: string
          entidad_id?: string | null
          entidad_tabla?: string | null
          error_detalle?: string | null
          estado?: Database["public"]["Enums"]["estado_bandeja"]
          id?: string
          payload: Json
          posponer_hasta?: string | null
          resuelto_en?: string | null
          tipo: Database["public"]["Enums"]["tipo_bandeja"]
          user_id: string
        }
        Update: {
          clave_dedupe?: string | null
          creado_en?: string
          entidad_id?: string | null
          entidad_tabla?: string | null
          error_detalle?: string | null
          estado?: Database["public"]["Enums"]["estado_bandeja"]
          id?: string
          payload?: Json
          posponer_hasta?: string | null
          resuelto_en?: string | null
          tipo?: Database["public"]["Enums"]["tipo_bandeja"]
          user_id?: string
        }
        Relationships: []
      }
      lessons: {
        Row: {
          archivado_en: string | null
          categoria: Database["public"]["Enums"]["categoria_leccion"]
          contenido: string
          created_at: string
          embedding: string | null
          fecha: string
          id: string
          movement_id: string | null
          origen: Database["public"]["Enums"]["origen_leccion"]
          project_id: string
          titulo: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archivado_en?: string | null
          categoria: Database["public"]["Enums"]["categoria_leccion"]
          contenido: string
          created_at?: string
          embedding?: string | null
          fecha?: string
          id?: string
          movement_id?: string | null
          origen?: Database["public"]["Enums"]["origen_leccion"]
          project_id: string
          titulo: string
          updated_at?: string
          user_id: string
        }
        Update: {
          archivado_en?: string | null
          categoria?: Database["public"]["Enums"]["categoria_leccion"]
          contenido?: string
          created_at?: string
          embedding?: string | null
          fecha?: string
          id?: string
          movement_id?: string | null
          origen?: Database["public"]["Enums"]["origen_leccion"]
          project_id?: string
          titulo?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lessons_movement_id_fkey"
            columns: ["movement_id"]
            isOneToOne: false
            referencedRelation: "movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      movements: {
        Row: {
          category_id: string
          comprobante_path: string | null
          created_at: string
          descripcion: string
          estado: Database["public"]["Enums"]["estado_movimiento"]
          fecha: string
          id: string
          moneda_origen: Database["public"]["Enums"]["moneda"]
          monto_ars: number
          monto_origen: number
          monto_usd: number
          project_id: string | null
          recurrence_id: string | null
          tasa_fecha: string
          tasa_usada: number
          tipo: Database["public"]["Enums"]["tipo_movimiento"]
          updated_at: string
          user_id: string
        }
        Insert: {
          category_id: string
          comprobante_path?: string | null
          created_at?: string
          descripcion: string
          estado?: Database["public"]["Enums"]["estado_movimiento"]
          fecha: string
          id?: string
          moneda_origen: Database["public"]["Enums"]["moneda"]
          monto_ars: number
          monto_origen: number
          monto_usd: number
          project_id?: string | null
          recurrence_id?: string | null
          tasa_fecha: string
          tasa_usada: number
          tipo: Database["public"]["Enums"]["tipo_movimiento"]
          updated_at?: string
          user_id: string
        }
        Update: {
          category_id?: string
          comprobante_path?: string | null
          created_at?: string
          descripcion?: string
          estado?: Database["public"]["Enums"]["estado_movimiento"]
          fecha?: string
          id?: string
          moneda_origen?: Database["public"]["Enums"]["moneda"]
          monto_ars?: number
          monto_origen?: number
          monto_usd?: number
          project_id?: string | null
          recurrence_id?: string | null
          tasa_fecha?: string
          tasa_usada?: number
          tipo?: Database["public"]["Enums"]["tipo_movimiento"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "movements_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movements_recurrence_id_fkey"
            columns: ["recurrence_id"]
            isOneToOne: false
            referencedRelation: "recurrences"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          activo: boolean
          archivado_en: string | null
          color: string
          created_at: string
          id: string
          nombre: string
          peso_prorrateo: number
          slug: string
          user_id: string
        }
        Insert: {
          activo?: boolean
          archivado_en?: string | null
          color?: string
          created_at?: string
          id?: string
          nombre: string
          peso_prorrateo?: number
          slug: string
          user_id: string
        }
        Update: {
          activo?: boolean
          archivado_en?: string | null
          color?: string
          created_at?: string
          id?: string
          nombre?: string
          peso_prorrateo?: number
          slug?: string
          user_id?: string
        }
        Relationships: []
      }
      recurrences: {
        Row: {
          activa: boolean
          category_id: string
          created_at: string
          descripcion: string
          dia_del_mes: number
          fecha_fin: string | null
          fecha_inicio: string
          frecuencia: Database["public"]["Enums"]["frecuencia_recurrencia"]
          id: string
          moneda_origen: Database["public"]["Enums"]["moneda"]
          monto_origen: number
          project_id: string | null
          tipo: Database["public"]["Enums"]["tipo_movimiento"]
          updated_at: string
          user_id: string
        }
        Insert: {
          activa?: boolean
          category_id: string
          created_at?: string
          descripcion: string
          dia_del_mes: number
          fecha_fin?: string | null
          fecha_inicio: string
          frecuencia: Database["public"]["Enums"]["frecuencia_recurrencia"]
          id?: string
          moneda_origen: Database["public"]["Enums"]["moneda"]
          monto_origen: number
          project_id?: string | null
          tipo: Database["public"]["Enums"]["tipo_movimiento"]
          updated_at?: string
          user_id: string
        }
        Update: {
          activa?: boolean
          category_id?: string
          created_at?: string
          descripcion?: string
          dia_del_mes?: number
          fecha_fin?: string | null
          fecha_inicio?: string
          frecuencia?: Database["public"]["Enums"]["frecuencia_recurrencia"]
          id?: string
          moneda_origen?: Database["public"]["Enums"]["moneda"]
          monto_origen?: number
          project_id?: string | null
          tipo?: Database["public"]["Enums"]["tipo_movimiento"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurrences_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurrences_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          aplicacion_fecha: string | null
          aplicacion_hecha: boolean
          archivado_en: string | null
          block_id: string | null
          consigna: string | null
          created_at: string
          id: string
          orden: number
          slug: string
          teoria_fecha: string | null
          teoria_hecha: boolean
          teoria_link: string | null
          teoria_texto: string | null
          titulo: string
          track_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          aplicacion_fecha?: string | null
          aplicacion_hecha?: boolean
          archivado_en?: string | null
          block_id?: string | null
          consigna?: string | null
          created_at?: string
          id?: string
          orden?: number
          slug: string
          teoria_fecha?: string | null
          teoria_hecha?: boolean
          teoria_link?: string | null
          teoria_texto?: string | null
          titulo: string
          track_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          aplicacion_fecha?: string | null
          aplicacion_hecha?: boolean
          archivado_en?: string | null
          block_id?: string | null
          consigna?: string | null
          created_at?: string
          id?: string
          orden?: number
          slug?: string
          teoria_fecha?: string | null
          teoria_hecha?: boolean
          teoria_link?: string | null
          teoria_texto?: string | null
          titulo?: string
          track_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      tracks: {
        Row: {
          activo: boolean
          archivado_en: string | null
          cadencia: number[]
          color: string
          created_at: string
          fecha_inicio: string | null
          id: string
          nombre: string
          orden: number
          slug: string
          updated_at: string
          user_id: string
        }
        Insert: {
          activo?: boolean
          archivado_en?: string | null
          cadencia?: number[]
          color?: string
          created_at?: string
          fecha_inicio?: string | null
          id?: string
          nombre: string
          orden?: number
          slug: string
          updated_at?: string
          user_id: string
        }
        Update: {
          activo?: boolean
          archivado_en?: string | null
          cadencia?: number[]
          color?: string
          created_at?: string
          fecha_inicio?: string | null
          id?: string
          nombre?: string
          orden?: number
          slug?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      buscar_lecciones_hibrido: {
        Args: {
          p_consulta: string
          p_embedding?: string | null
          p_limite?: number
          p_k?: number
        }
        Returns: {
          archivado_en: string | null
          categoria: Database["public"]["Enums"]["categoria_leccion"]
          contenido: string
          fecha: string
          id: string
          origen: Database["public"]["Enums"]["origen_leccion"]
          project_id: string
          puntaje: number
          rank_texto: number | null
          similitud: number | null
          titulo: string
        }[]
      }
      fx_rate_for_date: {
        Args: { p_fecha: string }
        Returns: {
          compra: number
          fecha: string
          fetched_at: string
          fuente: string
          venta: number
        }[]
        SetofOptions: {
          from: "*"
          to: "fx_rates"
          isOneToOne: false
          isSetofReturn: true
        }
      }
    }
    Enums: {
      categoria_leccion:
        | "tecnica"
        | "producto"
        | "comercial"
        | "proceso"
        | "personal"
      estado_artefacto: "no_empezado" | "en_curso" | "completado"
      estado_bandeja:
        | "pendiente"
        | "aceptado"
        | "rechazado"
        | "pospuesto"
        | "error"
      estado_movimiento: "efectuado" | "planificado"
      frecuencia_recurrencia: "mensual" | "anual"
      moneda: "ARS" | "USD"
      origen_leccion: "manual" | "importada" | "generada" | "retro"
      tipo_bandeja:
        | "categorizacion"
        | "zombie"
        | "leccion_sugerida"
        | "leccion_extraida"
        | "retro"
      tipo_movimiento: "ingreso" | "egreso"
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
    Enums: {
      categoria_leccion: [
        "tecnica",
        "producto",
        "comercial",
        "proceso",
        "personal",
      ],
      estado_artefacto: ["no_empezado", "en_curso", "completado"],
      estado_bandeja: [
        "pendiente",
        "aceptado",
        "rechazado",
        "pospuesto",
        "error",
      ],
      estado_movimiento: ["efectuado", "planificado"],
      frecuencia_recurrencia: ["mensual", "anual"],
      moneda: ["ARS", "USD"],
      origen_leccion: ["manual", "importada", "generada", "retro"],
      tipo_bandeja: [
        "categorizacion",
        "zombie",
        "leccion_sugerida",
        "leccion_extraida",
        "retro",
      ],
      tipo_movimiento: ["ingreso", "egreso"],
    },
  },
} as const

// ─────────────────────────────────────────────────────────────
// Alias de conveniencia usados en toda la app.
// Este bloque se escribe a mano: si regenerás el archivo, volvé a pegarlo.
// ─────────────────────────────────────────────────────────────

export type TipoMovimiento = Database["public"]["Enums"]["tipo_movimiento"];
export type Moneda = Database["public"]["Enums"]["moneda"];
export type EstadoMovimiento =
  Database["public"]["Enums"]["estado_movimiento"];
export type FrecuenciaRecurrencia =
  Database["public"]["Enums"]["frecuencia_recurrencia"];

export type Project = Database["public"]["Tables"]["projects"]["Row"];
export type Category = Database["public"]["Tables"]["categories"]["Row"];
export type Movement = Database["public"]["Tables"]["movements"]["Row"];
export type Recurrence = Database["public"]["Tables"]["recurrences"]["Row"];
export type FxRate = Database["public"]["Tables"]["fx_rates"]["Row"];

export type CategoriaLeccion =
  Database["public"]["Enums"]["categoria_leccion"];
export type OrigenLeccion = Database["public"]["Enums"]["origen_leccion"];
export type EstadoArtefacto =
  Database["public"]["Enums"]["estado_artefacto"];
export type TipoBandeja = Database["public"]["Enums"]["tipo_bandeja"];
export type EstadoBandeja = Database["public"]["Enums"]["estado_bandeja"];

export type Track = Database["public"]["Tables"]["tracks"]["Row"];
export type Block = Database["public"]["Tables"]["blocks"]["Row"];
// `StudySession` y no `Session`: `@supabase/supabase-js` ya exporta un
// `Session` (la sesión de auth) y las pantallas de estudio importan de
// los dos lados.
export type StudySession = Database["public"]["Tables"]["sessions"]["Row"];
export type Artifact = Database["public"]["Tables"]["artifacts"]["Row"];
export type DailyLog = Database["public"]["Tables"]["daily_log"]["Row"];
export type Lesson = Database["public"]["Tables"]["lessons"]["Row"];
export type InboxItem = Database["public"]["Tables"]["inbox"]["Row"];
