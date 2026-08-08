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
