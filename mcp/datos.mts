import { getUserId, supabase } from "./supabase.mts";

import type {
  Block,
  Category,
  DailyLog,
  Database,
  Movement,
  Project,
  StudySession,
  Track,
} from "@/lib/supabase/database.types";

/**
 * Lecturas del servidor MCP.
 *
 * Es el equivalente de `lib/queries.ts`, que no se puede importar acá
 * porque está marcado con `server-only`. Se duplican **las consultas**,
 * que son triviales; **no se duplica ninguna regla de dominio**: los
 * balances y el prorrateo salen de `lib/balances.ts` y `lib/prorrateo.ts`
 * tal cual, que son módulos puros y sí se importan.
 *
 * Esa división es a propósito. El invariante que sostiene la app
 * —`suma(balance de cada proyecto) === balance general`— tiene un solo
 * lugar donde vive, y este archivo no es ese lugar.
 */

const LIMITE = 20000;

export async function getMovimientos(): Promise<Movement[]> {
  const userId = await getUserId();

  const { data, error } = await supabase
    .from("movements")
    .select("*")
    .eq("user_id", userId)
    .order("fecha", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(LIMITE);

  if (error) throw new Error(`No se pudieron leer los movimientos: ${error.message}`);
  return data ?? [];
}

/**
 * Proyectos, **sin filtrar los archivados y ordenados por nombre**, que
 * es exactamente lo que hace `app/(app)/layout.tsx`.
 *
 * Ojo con "mejorar" esto filtrando `archivado_en`: los balances y el
 * prorrateo se calculan sobre esta lista, así que filtrar acá haría que
 * el MCP contestara números distintos a los que muestra la pantalla. Un
 * proyecto archivado de más en una lista molesta; dos balances que no
 * coinciden erosionan la confianza en los dos.
 */
export async function getProyectos(): Promise<Project[]> {
  const userId = await getUserId();

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", userId)
    .order("nombre");

  if (error) throw new Error(`No se pudieron leer los proyectos: ${error.message}`);
  return data ?? [];
}

export async function getCategorias(): Promise<Category[]> {
  const userId = await getUserId();

  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .eq("user_id", userId)
    .order("tipo")
    .order("nombre");

  if (error) throw new Error(`No se pudieron leer las categorías: ${error.message}`);
  return data ?? [];
}

export async function getBitacora(desde?: string, hasta?: string): Promise<DailyLog[]> {
  const userId = await getUserId();

  let q = supabase
    .from("daily_log")
    .select("*")
    .eq("user_id", userId)
    .is("archivado_en", null)
    .order("fecha", { ascending: false });

  if (desde) q = q.gte("fecha", desde);
  if (hasta) q = q.lte("fecha", hasta);

  const { data, error } = await q.limit(500);

  if (error) throw new Error(`No se pudo leer la bitácora: ${error.message}`);
  return data ?? [];
}

// ---------------------------------------------------------------------
// Aprendizaje
// ---------------------------------------------------------------------

export async function getTracks(): Promise<Track[]> {
  const userId = await getUserId();

  const { data, error } = await supabase
    .from("tracks")
    .select("*")
    .eq("user_id", userId)
    .is("archivado_en", null)
    .order("orden");

  if (error) throw new Error(`No se pudieron leer los tracks: ${error.message}`);
  return data ?? [];
}

export async function getBlocks(): Promise<Block[]> {
  const userId = await getUserId();

  const { data, error } = await supabase
    .from("blocks")
    .select("*")
    .eq("user_id", userId)
    .is("archivado_en", null)
    .order("orden");

  if (error) throw new Error(`No se pudieron leer los bloques: ${error.message}`);
  return data ?? [];
}

export async function getSessions(): Promise<StudySession[]> {
  const userId = await getUserId();

  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("user_id", userId)
    .is("archivado_en", null)
    .order("orden")
    .limit(5000);

  if (error) throw new Error(`No se pudieron leer las sesiones: ${error.message}`);
  return data ?? [];
}

export type ResultadoLeccion =
  Database["public"]["Functions"]["buscar_lecciones_hibrido"]["Returns"][number];

/**
 * Búsqueda de lecciones, **solo full-text**.
 *
 * La búsqueda de la app es híbrida: full-text en español + similitud
 * vectorial, fusionados con Reciprocal Rank Fusion. Acá se llama al mismo
 * RPC pero sin `p_embedding`, y eso **no es una versión degradada por
 * accidente**: es el modo que la propia app declara válido cuando el
 * embedding falla o tarda ("eso no es un error", regla 7). Generarlo
 * requiere los 266 MB del modelo, que hoy viven dentro de la función de
 * Vercel.
 *
 * Además, con el corpus actual es lo que mejor midió: con 6 lecciones el
 * full-text solo acertó 5/5. Cuando haya lecciones reales y variadas hay
 * que volver a medirlo, y ahí se decide si vale traer el modelo acá.
 *
 * `?? undefined` y no `null`: omitir el parámetro deja que Postgres aplique
 * su `default null`. Los tipos generados no aceptan null en un argumento
 * con default.
 */
export async function buscarLecciones(
  consulta: string,
  limite: number,
): Promise<ResultadoLeccion[]> {
  const { data, error } = await supabase.rpc("buscar_lecciones_hibrido", {
    p_consulta: consulta,
    p_embedding: undefined,
    p_limite: limite,
  });

  if (error) throw new Error(`Falló la búsqueda: ${error.message}`);
  return data ?? [];
}
