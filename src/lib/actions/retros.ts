"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  fail,
  mensajeDeError,
  ok,
  requireSession,
  type ActionResult,
} from "./shared";

/**
 * Guardar y archivar retros de proyecto (spec 6.5).
 *
 * El modelo genera el borrador y lo devuelve a pantalla; **esta action es
 * el botón que lo convierte en un documento guardado**. Es la misma regla
 * que rige la bandeja: nada que escriba un modelo queda en la base sin
 * que Beno lo apruebe. La diferencia es que una retro no se acepta a
 * ciegas de a una: se lee entera, se puede editar cualquier párrafo, y
 * recién ahí se guarda.
 *
 * El balance viene del cliente y se guarda tal cual, congelado. Es a
 * propósito y sigue el criterio del tipo de cambio en `movements`: la
 * retro dice lo que el proyecto costó **cuando se cerró**. Si se
 * recalculara al leerla, un movimiento cargado el año que viene cambiaría
 * el sentido de un texto que Beno ya aprobó.
 */

const uuid = z.string().uuid("Identificador inválido.");

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (formato AAAA-MM-DD).");

const retroSchema = z.object({
  projectId: uuid,
  fecha: isoDate,
  titulo: z.string().trim().min(1, "Poné un título.").max(200),
  queFunciono: z.string().trim().max(5000),
  queNoFunciono: z.string().trim().max(5000),
  costoReal: z.string().trim().max(5000),
  conclusion: z.string().trim().max(5000),
  balanceArs: z.number().finite().nullable(),
  balanceUsd: z.number().finite().nullable(),
  /** Null si la escribió Beno a mano. */
  modelo: z.string().trim().max(80).nullable(),
});

export type RetroInput = z.infer<typeof retroSchema>;

export async function guardarRetro(
  input: RetroInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = retroSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }

  const { supabase, userId } = await requireSession();
  const d = parsed.data;

  const { data, error } = await supabase
    .from("retros")
    .insert({
      user_id: userId,
      project_id: d.projectId,
      fecha: d.fecha,
      titulo: d.titulo,
      que_funciono: d.queFunciono,
      que_no_funciono: d.queNoFunciono,
      costo_real: d.costoReal,
      conclusion: d.conclusion,
      balance_ars: d.balanceArs,
      balance_usd: d.balanceUsd,
      modelo: d.modelo,
    })
    .select("id")
    .single();

  if (error) return fail(mensajeDeError(error));

  revalidatePath("/", "layout");
  return ok({ id: data.id });
}

/**
 * Archiva una retro. Como todo el módulo de aprendizaje, el borrado por
 * defecto es archivado: sale de la pantalla del proyecto pero el texto no
 * se pierde.
 */
export async function archivarRetro(retroId: string): Promise<ActionResult> {
  const parsed = uuid.safeParse(retroId);
  if (!parsed.success) return fail("Identificador inválido.");

  const { supabase } = await requireSession();

  const { error } = await supabase
    .from("retros")
    .update({ archivado_en: new Date().toISOString() })
    .eq("id", parsed.data);

  if (error) return fail(mensajeDeError(error));

  revalidatePath("/", "layout");
  return ok();
}
