"use server";

import { revalidatePath } from "next/cache";

import { todayISO } from "@/lib/dates";
import { projectSchema, type ProjectInput } from "@/lib/schemas";
import type { Project } from "@/lib/supabase/database.types";

import {
  fail,
  mensajeDeError,
  ok,
  requireSession,
  slugDisponible,
  type ActionResult,
} from "./shared";

export async function crearProyecto(
  input: ProjectInput,
): Promise<ActionResult<Project>> {
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }

  const { supabase, userId } = await requireSession();
  const slug = await slugDisponible(supabase, userId, parsed.data.nombre);

  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: userId,
      nombre: parsed.data.nombre,
      slug,
      color: parsed.data.color,
      fecha_inicio: parsed.data.fecha_inicio,
      fecha_fin: parsed.data.fecha_fin,
      peso_prorrateo: parsed.data.peso_prorrateo,
    })
    .select()
    .single();

  if (error) return fail(mensajeDeError(error));

  revalidatePath("/", "layout");
  return ok(data);
}

export async function actualizarProyecto(
  id: string,
  input: ProjectInput,
): Promise<ActionResult<Project>> {
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }

  const { supabase, userId } = await requireSession();

  const { data: actual } = await supabase
    .from("projects")
    .select("nombre, slug")
    .eq("id", id)
    .single();

  // El slug solo se regenera si cambió el nombre, así los links viejos
  // a /proyectos/<slug> siguen andando mientras el nombre no se toque.
  const slug =
    actual && actual.nombre !== parsed.data.nombre
      ? await slugDisponible(supabase, userId, parsed.data.nombre, id)
      : (actual?.slug ?? (await slugDisponible(supabase, userId, parsed.data.nombre, id)));

  const { data, error } = await supabase
    .from("projects")
    .update({
      nombre: parsed.data.nombre,
      slug,
      color: parsed.data.color,
      fecha_inicio: parsed.data.fecha_inicio,
      fecha_fin: parsed.data.fecha_fin,
      peso_prorrateo: parsed.data.peso_prorrateo,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return fail(mensajeDeError(error));

  revalidatePath("/", "layout");
  return ok(data);
}

/**
 * Borra el proyecto. Los movimientos NO se borran: la FK es ON DELETE SET
 * NULL, así que pasan a contar como gasto compartido. Es deliberado —
 * perder historia de plata sería peor que reclasificarla.
 */
export async function borrarProyecto(id: string): Promise<ActionResult> {
  const { supabase } = await requireSession();

  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) return fail(mensajeDeError(error));

  revalidatePath("/", "layout");
  return ok();
}

/**
 * El botón de abrir/cerrar un proyecto.
 *
 * No escribe una bandera porque ya no hay ninguna: **edita la ventana**.
 * Cerrar pone `fecha_fin` en hoy; reabrir la vuelve a `null`. Así no
 * puede existir un proyecto marcado abierto con el cierre vencido.
 *
 * Reabrir no toca `fecha_inicio`: si el proyecto arrancó el 01/04 y se
 * cerró por error, tiene que volver a arrancar el 01/04 y no hoy.
 *
 * El cierre se corre al inicio cuando el proyecto todavía no arrancó.
 * Cerrar hoy un proyecto que empieza el mes que viene violaría
 * `projects_fechas_coherentes` y devolvería un error de Postgres para
 * algo que tiene una respuesta obvia: un proyecto que se cierra antes de
 * arrancar duró cero días, y su ventana es su día de inicio.
 */
export async function alternarProyectoActivo(
  id: string,
  abierto: boolean,
): Promise<ActionResult> {
  const { supabase } = await requireSession();

  // Se lee siempre, incluso para reabrir, y no solo cuando hace falta
  // `fecha_inicio`: un `update` sobre cero filas **no devuelve error**,
  // así que sin esta lectura la action contestaría `ok()` para un
  // proyecto que no existe. Es una consulta por clave primaria.
  const { data: proyecto, error: errorLectura } = await supabase
    .from("projects")
    .select("fecha_inicio")
    .eq("id", id)
    .maybeSingle();

  if (errorLectura) return fail(mensajeDeError(errorLectura));
  if (!proyecto) return fail("No se encontró el proyecto.");

  let fecha_fin: string | null = null;

  if (!abierto) {
    const hoy = todayISO();
    fecha_fin =
      proyecto.fecha_inicio && proyecto.fecha_inicio > hoy
        ? proyecto.fecha_inicio
        : hoy;
  }

  const { error } = await supabase
    .from("projects")
    .update({ fecha_fin })
    .eq("id", id);

  if (error) return fail(mensajeDeError(error));

  revalidatePath("/", "layout");
  return ok();
}
