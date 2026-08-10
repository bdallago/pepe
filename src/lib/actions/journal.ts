"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { crearEntradaDeBitacora } from "@/lib/bitacora";
import { todayISO } from "@/lib/dates";
import type { DailyLog } from "@/lib/supabase/database.types";

import {
  fail,
  mensajeDeError,
  ok,
  requireSession,
  type ActionResult,
} from "./shared";

/**
 * Bitácora diaria.
 *
 * Una entrada siempre cuelga de un proyecto (`project_id` es NOT NULL): el
 * conocimiento pertenece a un producto, no al aire. El track es opcional.
 *
 * El formulario va a venir con el selector precargado en un proyecto, pero
 * eso es una comodidad de la interfaz: acá el id llega por parámetro y se
 * valida que exista y sea del usuario. Nada de proyectos hardcodeados.
 *
 * El alta en sí vive en `lib/bitacora.ts` y no acá: el agente de bitácora
 * escribe la misma fila desde la caja y recibe el cliente de Supabase ya
 * construido, así que la regla tiene que estar en un módulo que lo tome
 * por parámetro. Esta action quedó como cáscara —valida, resuelve la
 * sesión, llama y revalida—, igual que las de sesiones con
 * `lib/sesiones.ts`.
 */

const uuid = z.string().uuid("Identificador inválido.");

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (formato AAAA-MM-DD).");

const entradaSchema = z.object({
  contenido: z
    .string()
    .trim()
    .min(1, "Escribí algo antes de guardar.")
    .max(5000, "Máximo 5000 caracteres."),
  fecha: isoDate.optional(),
  projectId: uuid,
  trackId: uuid.nullable().optional(),
});

export type EntradaBitacoraInput = z.infer<typeof entradaSchema>;

export async function crearEntradaBitacora(
  input: EntradaBitacoraInput,
): Promise<ActionResult<DailyLog>> {
  const parsed = entradaSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }

  const { supabase, userId } = await requireSession();

  // RLS ya impediría escribir contra un proyecto ajeno, pero la violación
  // saldría como un error de política ilegible. Chequear antes deja un
  // mensaje que se entiende en pantalla.
  const { data: proyecto } = await supabase
    .from("projects")
    .select("id")
    .eq("id", parsed.data.projectId)
    .maybeSingle();

  if (!proyecto) return fail("No se encontró el proyecto.");

  const { data, error } = await crearEntradaDeBitacora(supabase, userId, {
    contenido: parsed.data.contenido,
    fecha: parsed.data.fecha ?? todayISO(),
    projectId: parsed.data.projectId,
    trackId: parsed.data.trackId,
  });

  if (error) return fail(mensajeDeError(error));

  revalidatePath("/", "layout");
  return ok(data);
}

/**
 * Saca la entrada de la bitácora: la archiva, no la borra.
 *
 * Es la regla del módulo — el archivado la esconde de las listas de la
 * interfaz y deja el registro para el histórico y para lo que se extraiga
 * de él más adelante.
 */
export async function borrarEntradaBitacora(
  id: string,
): Promise<ActionResult> {
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return fail("Identificador inválido.");

  const { supabase } = await requireSession();

  const { error } = await supabase
    .from("daily_log")
    .update({ archivado_en: new Date().toISOString() })
    .eq("id", parsed.data);

  if (error) return fail(mensajeDeError(error));

  revalidatePath("/", "layout");
  return ok();
}

/** Vuelve a mostrar una entrada archivada. */
export async function desarchivarEntradaBitacora(
  id: string,
): Promise<ActionResult> {
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return fail("Identificador inválido.");

  const { supabase } = await requireSession();

  const { error } = await supabase
    .from("daily_log")
    .update({ archivado_en: null })
    .eq("id", parsed.data);

  if (error) return fail(mensajeDeError(error));

  revalidatePath("/", "layout");
  return ok();
}

/**
 * Borrado real, sin vuelta atrás. Va aparte y con otro nombre a propósito:
 * el gesto normal de la interfaz es `borrarEntradaBitacora`, que archiva.
 * Esta solo debería colgar de una confirmación explícita.
 */
export async function eliminarEntradaBitacoraDefinitivamente(
  id: string,
): Promise<ActionResult> {
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return fail("Identificador inválido.");

  const { supabase } = await requireSession();

  const { error } = await supabase
    .from("daily_log")
    .delete()
    .eq("id", parsed.data);

  if (error) return fail(mensajeDeError(error));

  revalidatePath("/", "layout");
  return ok();
}
