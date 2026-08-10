"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { tarifasSchema, type TarifasInput } from "@/lib/schemas";

import {
  fail,
  mensajeDeError,
  ok,
  requireSession,
  type ActionResult,
} from "./shared";

/**
 * Preferencias del usuario (spec 6.2: "el umbral lo definís vos y me lo
 * dejás configurable").
 *
 * La fila se crea al vuelo la primera vez que se guarda algo: no hace
 * falta sembrarla al dar de alta el usuario, y quien lee usa el default
 * mientras no exista.
 */

const settingsSchema = z.object({
  diasInactividadZombie: z
    .number()
    .int("Tiene que ser un número entero de días.")
    .min(15, "Menos de 15 días llena la bandeja de falsos positivos.")
    .max(730, "Más de dos años no detecta nada."),
});

export type SettingsInput = z.infer<typeof settingsSchema>;

export async function guardarSettings(
  input: SettingsInput,
): Promise<ActionResult> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }

  const { supabase, userId } = await requireSession();

  const { error } = await supabase.from("settings").upsert(
    {
      user_id: userId,
      dias_inactividad_zombie: parsed.data.diasInactividadZombie,
    },
    { onConflict: "user_id" },
  );

  if (error) return fail(mensajeDeError(error));

  revalidatePath("/", "layout");
  return ok();
}

/**
 * La tarifa hora, los multiplicadores por tipo de cliente y los datos del
 * emisor del PDF.
 *
 * ⚠ **Guardar esto no toca ningún presupuesto ya hecho.** Cada fila de
 * `quotes` se queda con su copia congelada de `tarifa_hora`,
 * `multiplicador` y `horas_por_semana` (regla 1), así que subir la tarifa
 * hoy no le cambia el precio a un presupuesto de marzo. El histórico de la
 * tarifa de Beno *es* esa serie de filas, y por eso no hace falta una
 * tabla aparte.
 *
 * Los defaults ×1 / ×2 / ×3 no son un número redondo elegido a ojo: son la
 * escalera del tarifario de flamahaus, verificada en 93 de 93 filas.
 */
export async function guardarTarifas(
  input: TarifasInput,
): Promise<ActionResult> {
  const parsed = tarifasSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }

  const { supabase, userId } = await requireSession();
  const d = parsed.data;

  const { error } = await supabase.from("settings").upsert(
    {
      user_id: userId,
      tarifa_hora: d.tarifa_hora,
      tarifa_moneda: d.tarifa_moneda,
      multiplicador_particular: d.multiplicador_particular,
      multiplicador_pyme: d.multiplicador_pyme,
      multiplicador_empresa: d.multiplicador_empresa,
      horas_por_semana: d.horas_por_semana,
      emisor_nombre: d.emisor_nombre,
      emisor_contacto: d.emisor_contacto,
      condiciones_default: d.condiciones_default,
    },
    { onConflict: "user_id" },
  );

  if (error) return fail(mensajeDeError(error));

  revalidatePath("/", "layout");
  return ok();
}
