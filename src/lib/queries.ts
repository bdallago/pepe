import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  Artifact,
  Block,
  DailyLog,
  Movement,
  StudySession,
  Track,
} from "@/lib/supabase/database.types";

/**
 * Lecturas de movimientos.
 *
 * Se traen todos los del usuario y se filtra/agrega en memoria: es una app
 * de un solo usuario con unos pocos miles de filas, y así el conmutador de
 * moneda y los filtros de rango responden sin ir a la base.
 */

const LIMITE = 20000;

export async function getMovimientos(): Promise<Movement[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("movements")
    .select("*")
    .order("fecha", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(LIMITE);

  return data ?? [];
}

export async function getProyectoPorSlug(slug: string) {
  const supabase = await createClient();

  const { data } = await supabase
    .from("projects")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  return data;
}

export async function getRecurrencias() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("recurrences")
    .select("*")
    .order("activa", { ascending: false })
    .order("descripcion");

  return data ?? [];
}

// ─────────────────────────────────────────────────────────────
// Aprendizaje
//
// Mismo criterio que arriba: el temario entero son cientos de filas, así
// que se trae completo y la lógica de `aprendizaje.ts` lo cruza en memoria.
//
// Todas estas listas excluyen lo archivado (`archivado_en is null`): el
// archivado saca de la interfaz sin borrar. Lo archivado sigue existiendo
// en la base para el histórico y para la búsqueda semántica.
// ─────────────────────────────────────────────────────────────

export async function getTracks(): Promise<Track[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("tracks")
    .select("*")
    .is("archivado_en", null)
    .order("orden");

  return data ?? [];
}

export async function getBlocks(): Promise<Block[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("blocks")
    .select("*")
    .is("archivado_en", null)
    .order("orden");

  return data ?? [];
}

export async function getSessions(): Promise<StudySession[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("sessions")
    .select("*")
    .is("archivado_en", null)
    .order("orden");

  return data ?? [];
}

export async function getArtefactos(): Promise<Artifact[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("artifacts")
    .select("*")
    .is("archivado_en", null)
    .order("orden");

  return data ?? [];
}

/** Bitácora, de la entrada más nueva a la más vieja. */
export async function getBitacora(): Promise<DailyLog[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("daily_log")
    .select("*")
    .is("archivado_en", null)
    .order("fecha", { ascending: false })
    .order("created_at", { ascending: false });

  return data ?? [];
}
