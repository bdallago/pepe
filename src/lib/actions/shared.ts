import "server-only";

import {
  createClient,
  getUser,
  type SupabaseClient,
} from "@/lib/supabase/server";

/** Resultado uniforme de las Server Actions, para manejarlo en la UI. */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function ok(): ActionResult;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data };
}

export function fail(error: string): ActionResult<never> {
  return { ok: false, error };
}

/**
 * Cliente + usuario para una action. Lanza si no hay sesión: el middleware
 * ya redirige a /login, así que llegar acá sin usuario es un bug.
 */
export async function requireSession() {
  const user = await getUser();
  if (!user) throw new Error("Sesión no encontrada.");
  const supabase = await createClient();
  return { supabase, userId: user.id };
}

/** Convierte errores de Postgres en mensajes que sirvan en pantalla. */
export function mensajeDeError(error: {
  code?: string;
  message: string;
}): string {
  switch (error.code) {
    case "23505":
      return "Ya existe un registro con esos datos.";
    case "23503":
      return "No se puede borrar: hay movimientos que dependen de este registro.";
    case "23514":
      return "Alguno de los valores no cumple las validaciones de la base.";
    default:
      return error.message;
  }
}

/** Slug a partir del nombre del proyecto: "Mi App v2" → "mi-app-v2". */
export function slugify(nombre: string): string {
  const base = nombre
    .normalize("NFD")
    // Saca los diacríticos que NFD dejó sueltos (á → a + U+0301).
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return base || "proyecto";
}

/**
 * Busca un slug libre agregando -2, -3, … si hace falta.
 *
 * Vive acá y no en `projects.ts` porque lo necesitan dos caminos: el alta
 * de proyecto desde Ajustes y la aceptación de un presupuesto, que crea el
 * proyecto al vuelo. Un archivo `"use server"` no puede exportar esto —
 * todo lo que exporta se vuelve una Server Action y el cliente de Supabase
 * no viaja por el cable—, así que va en el módulo compartido.
 */
export async function slugDisponible(
  supabase: SupabaseClient,
  userId: string,
  nombre: string,
  excluirId?: string,
): Promise<string> {
  const base = slugify(nombre);

  const query = supabase
    .from("projects")
    .select("slug")
    .eq("user_id", userId)
    .like("slug", `${base}%`);

  const { data } = excluirId ? await query.neq("id", excluirId) : await query;
  const tomados = new Set((data ?? []).map((row) => row.slug));

  if (!tomados.has(base)) return base;

  for (let i = 2; i < 500; i++) {
    const candidato = `${base}-${i}`;
    if (!tomados.has(candidato)) return candidato;
  }

  return `${base}-${Date.now()}`;
}
