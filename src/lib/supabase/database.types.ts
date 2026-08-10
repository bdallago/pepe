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
          estado_manual: Database["public"]["Enums"]["estado_artefacto"] | null
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
          estado_manual?: Database["public"]["Enums"]["estado_artefacto"] | null
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
          estado_manual?: Database["public"]["Enums"]["estado_artefacto"] | null
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
      attachments: {
        Row: {
          archivado_en: string | null
          bytes: number
          created_at: string
          error_detalle: string | null
          estado: Database["public"]["Enums"]["estado_adjunto"]
          frase: string | null
          id: string
          mime: string
          nombre_original: string
          paginas: number | null
          project_id: string | null
          resumenes: Json
          storage_path: string
          texto_extraido: string | null
          tipo: Database["public"]["Enums"]["tipo_adjunto"]
          trozos_hechos: number
          trozos_totales: number
          updated_at: string
          user_id: string
        }
        Insert: {
          archivado_en?: string | null
          bytes: number
          created_at?: string
          error_detalle?: string | null
          estado?: Database["public"]["Enums"]["estado_adjunto"]
          frase?: string | null
          id?: string
          mime: string
          nombre_original: string
          paginas?: number | null
          project_id?: string | null
          resumenes?: Json
          storage_path: string
          texto_extraido?: string | null
          tipo: Database["public"]["Enums"]["tipo_adjunto"]
          trozos_hechos?: number
          trozos_totales?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          archivado_en?: string | null
          bytes?: number
          created_at?: string
          error_detalle?: string | null
          estado?: Database["public"]["Enums"]["estado_adjunto"]
          frase?: string | null
          id?: string
          mime?: string
          nombre_original?: string
          paginas?: number | null
          project_id?: string | null
          resumenes?: Json
          storage_path?: string
          texto_extraido?: string | null
          tipo?: Database["public"]["Enums"]["tipo_adjunto"]
          trozos_hechos?: number
          trozos_totales?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      blocks: {
        Row: {
          archivado_en: string | null
          artifact_id: string | null
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
          artifact_id?: string | null
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
          artifact_id?: string | null
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
            foreignKeyName: "blocks_artifact_id_fkey"
            columns: ["artifact_id"]
            isOneToOne: false
            referencedRelation: "artifacts"
            referencedColumns: ["id"]
          },
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
          busqueda: unknown
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
          busqueda?: unknown
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
          busqueda?: unknown
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
          descripcion_normalizada: string | null
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
          descripcion_normalizada?: string | null
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
          descripcion_normalizada?: string | null
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
          fecha_fin: string | null
          fecha_inicio: string | null
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
          fecha_fin?: string | null
          fecha_inicio?: string | null
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
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string
          nombre?: string
          peso_prorrateo?: number
          slug?: string
          user_id?: string
        }
        Relationships: []
      }
      rate_references: {
        Row: {
          clave: string
          fecha: string
          fuente: string
          id: string
          monto_ars: number
          segmento: Database["public"]["Enums"]["tipo_cliente"] | null
          unidad: string
        }
        Insert: {
          clave: string
          fecha: string
          fuente: string
          id?: string
          monto_ars: number
          segmento?: Database["public"]["Enums"]["tipo_cliente"] | null
          unidad: string
        }
        Update: {
          clave?: string
          fecha?: string
          fuente?: string
          id?: string
          monto_ars?: number
          segmento?: Database["public"]["Enums"]["tipo_cliente"] | null
          unidad?: string
        }
        Relationships: []
      }
      rate_runs: {
        Row: {
          corrido_en: string
          crudo: Json | null
          estado: string
          fecha: string
          filas: number | null
          fuente: string
          huella: string | null
          id: string
          marca_origen: string | null
          motivo: string | null
        }
        Insert: {
          corrido_en?: string
          crudo?: Json | null
          estado: string
          fecha: string
          filas?: number | null
          fuente: string
          huella?: string | null
          id?: string
          marca_origen?: string | null
          motivo?: string | null
        }
        Update: {
          corrido_en?: string
          crudo?: Json | null
          estado?: string
          fecha?: string
          filas?: number | null
          fuente?: string
          huella?: string | null
          id?: string
          marca_origen?: string | null
          motivo?: string | null
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
      retros: {
        Row: {
          archivado_en: string | null
          balance_ars: number | null
          balance_usd: number | null
          conclusion: string
          costo_real: string
          created_at: string
          fecha: string
          id: string
          modelo: string | null
          project_id: string
          que_funciono: string
          que_no_funciono: string
          titulo: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archivado_en?: string | null
          balance_ars?: number | null
          balance_usd?: number | null
          conclusion?: string
          costo_real?: string
          created_at?: string
          fecha?: string
          id?: string
          modelo?: string | null
          project_id: string
          que_funciono?: string
          que_no_funciono?: string
          titulo: string
          updated_at?: string
          user_id: string
        }
        Update: {
          archivado_en?: string | null
          balance_ars?: number | null
          balance_usd?: number | null
          conclusion?: string
          costo_real?: string
          created_at?: string
          fecha?: string
          id?: string
          modelo?: string | null
          project_id?: string
          que_funciono?: string
          que_no_funciono?: string
          titulo?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retros_project_id_fkey"
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
      settings: {
        Row: {
          created_at: string
          dias_inactividad_zombie: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dias_inactividad_zombie?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          dias_inactividad_zombie?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          p_embedding?: string
          p_k?: number
          p_limite?: number
        }
        Returns: {
          archivado_en: string
          categoria: Database["public"]["Enums"]["categoria_leccion"]
          contenido: string
          fecha: string
          id: string
          origen: Database["public"]["Enums"]["origen_leccion"]
          project_id: string
          puntaje: number
          rank_texto: number
          similitud: number
          titulo: string
        }[]
      }
      detectar_zombies: {
        Args: { p_dias?: number; p_dias_vigencia?: number; p_user_id: string }
        Returns: {
          category_id: string
          descripcion_ultima: string
          dias_sin_actividad: number
          meses_con_cargo: number
          moneda_origen: Database["public"]["Enums"]["moneda"]
          monto_ars: number
          monto_origen: number
          monto_usd: number
          nucleo: string
          primer_cargo: string
          project_id: string
          recurrence_id: string
          ultima_actividad: string
          ultimo_cargo: string
        }[]
      }
      estado_artefacto_derivado: {
        Args: { p_artifact_id: string }
        Returns: Database["public"]["Enums"]["estado_artefacto"]
      }
      fecha_artefacto_derivada: {
        Args: { p_artifact_id: string }
        Returns: string
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
      nucleo_descripcion: { Args: { p_normalizada: string }; Returns: string }
      refrescar_artefacto: {
        Args: { p_artifact_id: string }
        Returns: undefined
      }
      sugerir_categoria_historico: {
        Args: { p_descripcion: string }
        Returns: {
          category_id: string
          exacto: boolean
          tipo: Database["public"]["Enums"]["tipo_movimiento"]
          ultima: string
          veces: number
        }[]
      }
    }
    Enums: {
      categoria_leccion:
        | "tecnica"
        | "producto"
        | "comercial"
        | "proceso"
        | "personal"
      estado_adjunto:
        | "pendiente"
        | "procesando"
        | "listo"
        | "no_procesable"
        | "error"
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
      origen_leccion: "manual" | "importada" | "generada" | "retro" | "adjunto"
      tipo_adjunto: "pdf" | "imagen"
      tipo_bandeja:
        | "categorizacion"
        | "zombie"
        | "leccion_sugerida"
        | "leccion_extraida"
        | "retro"
        | "nota_de_adjunto"
      tipo_cliente: "particular" | "pyme" | "empresa"
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
      estado_adjunto: [
        "pendiente",
        "procesando",
        "listo",
        "no_procesable",
        "error",
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
      origen_leccion: ["manual", "importada", "generada", "retro", "adjunto"],
      tipo_adjunto: ["pdf", "imagen"],
      tipo_bandeja: [
        "categorizacion",
        "zombie",
        "leccion_sugerida",
        "leccion_extraida",
        "retro",
        "nota_de_adjunto",
      ],
      tipo_cliente: ["particular", "pyme", "empresa"],
      tipo_movimiento: ["ingreso", "egreso"],
    },
  },
} as const


// ─────────────────────────────────────────────────────────────
// Alias de conveniencia usados en toda la app.
// Este bloque se escribe a mano: si regenerás el archivo, volvé a pegarlo.
//
// ⚠ Al 2026-08-10 hay algo MÁS escrito a mano acá arriba: la tabla
// `attachments`, el enum `tipo_adjunto`, el enum `estado_adjunto` y los
// valores `nota_de_adjunto` / `adjunto` que se le agregaron a
// `tipo_bandeja` y `origen_leccion`. Sus migraciones
// (`20260810001000_adjuntos_enums.sql` y `20260810001001_adjuntos.sql`)
// están escritas pero **todavía no se aplicaron**: hacen falta el access
// token de Supabase. Después del `db push`, regenerá el archivo y esto
// se va a rellenar solo — momento en el que hay que volver a pegar solo
// este bloque de alias y borrar esta advertencia.
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
export type Attachment = Database["public"]["Tables"]["attachments"]["Row"];
export type TipoAdjunto = Database["public"]["Enums"]["tipo_adjunto"];
export type EstadoAdjunto = Database["public"]["Enums"]["estado_adjunto"];
export type Retro = Database["public"]["Tables"]["retros"]["Row"];
export type Settings = Database["public"]["Tables"]["settings"]["Row"];
