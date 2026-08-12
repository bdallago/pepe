import "server-only";

import { adosarSubconjuntos, type MovimientoConReparto } from "@/lib/prorrateo";
import { createClient } from "@/lib/supabase/server";
import type {
  Artifact,
  Block,
  DailyLog,
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

export async function getMovimientos(): Promise<MovimientoConReparto[]> {
  const supabase = await createClient();

  // Las dos lecturas van juntas y en paralelo porque **el reparto no es
  // correcto sin las dos**: un compartido con subconjunto explícito al
  // que no le llega su subconjunto se reparte por ventana de fecha, que
  // es un número plausible y equivocado. Es el modo de fallar caro de
  // este módulo, así que no se separan en dos funciones que alguien
  // pueda llamar de a una.
  const [movimientos, subconjuntos] = await Promise.all([
    supabase
      .from("movements")
      .select("*")
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(LIMITE),
    supabase.from("movement_projects").select("movement_id, project_id"),
  ]);

  return adosarSubconjuntos(movimientos.data ?? [], subconjuntos.data ?? []);
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

/**
 * Días de inactividad a partir de los cuales un gasto recurrente se
 * considera sospechoso (spec 6.2).
 *
 * La fila de `settings` se crea recién la primera vez que Beno guarda
 * algo, así que mientras no exista vale el default. El mismo número está
 * como `default` en la columna: si se toca uno, tocar el otro.
 */
export const DIAS_INACTIVIDAD_ZOMBIE_POR_DEFECTO = 90;

export async function getDiasInactividadZombie(): Promise<number> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("settings")
    .select("dias_inactividad_zombie")
    .maybeSingle();

  return data?.dias_inactividad_zombie ?? DIAS_INACTIVIDAD_ZOMBIE_POR_DEFECTO;
}

/**
 * Retros vigentes de un proyecto, de la más nueva a la más vieja.
 *
 * Un proyecto puede tener más de una: se cierra una etapa, se reabre, se
 * vuelve a cerrar. Por eso es una lista y no una fila sola.
 */
export async function getRetros(projectId: string) {
  const supabase = await createClient();

  const { data } = await supabase
    .from("retros")
    .select("*")
    .eq("project_id", projectId)
    .is("archivado_en", null)
    .order("fecha", { ascending: false });

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
