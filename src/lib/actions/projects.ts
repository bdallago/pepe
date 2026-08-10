"use server";

import { revalidatePath } from "next/cache";

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
      activo: parsed.data.activo,
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
      activo: parsed.data.activo,
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

export async function alternarProyectoActivo(
  id: string,
  activo: boolean,
): Promise<ActionResult> {
  const { supabase } = await requireSession();

  const { error } = await supabase
    .from("projects")
    .update({ activo })
    .eq("id", id);

  if (error) return fail(mensajeDeError(error));

  revalidatePath("/", "layout");
  return ok();
}
