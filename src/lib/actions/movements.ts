"use server";

import { revalidatePath } from "next/cache";

import { congelarMontos } from "@/lib/fx";
import { getTasaParaFecha } from "@/lib/fx-server";
import { movementSchema, type MovementInput } from "@/lib/schemas";
import type { Movement } from "@/lib/supabase/database.types";

import {
  fail,
  mensajeDeError,
  ok,
  requireSession,
  type ActionResult,
} from "./shared";

/**
 * Alta y edición de movimientos.
 *
 * El par ARS/USD se congela acá con la tasa que mandó el formulario. El
 * servidor no la sustituye por la del día: el usuario puede haber forzado
 * una cotización distinta (por ejemplo una venta cobrada a otro tipo de
 * cambio) y eso es parte del diseño.
 */

export async function crearMovimiento(
  input: MovementInput,
): Promise<ActionResult<Movement>> {
  const parsed = movementSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }

  const { supabase, userId } = await requireSession();
  const d = parsed.data;

  const montos = congelarMontos(d.monto_origen, d.moneda_origen, {
    valor: d.tasa_usada,
    fecha: d.tasa_fecha,
    esAproximada: false,
  });

  const { data, error } = await supabase
    .from("movements")
    .insert({
      user_id: userId,
      project_id: d.project_id,
      category_id: d.category_id,
      fecha: d.fecha,
      descripcion: d.descripcion,
      tipo: d.tipo,
      monto_origen: d.monto_origen,
      moneda_origen: d.moneda_origen,
      estado: d.estado,
      comprobante_path: d.comprobante_path ?? null,
      ...montos,
    })
    .select()
    .single();

  if (error) return fail(mensajeDeError(error));

  const errorSubconjunto = await guardarSubconjunto(
    supabase,
    userId,
    data.id,
    d.proyectos_explicitos,
  );
  if (errorSubconjunto) return fail(errorSubconjunto);

  revalidatePath("/", "layout");
  return ok(data);
}

/**
 * Reescribe el subconjunto explícito de un movimiento compartido.
 *
 * Borra y vuelve a insertar en vez de hacer un diff: son dos o tres
 * filas y el diff es más código del que ahorra. El borrado corre
 * **siempre**, también cuando la lista viene vacía, porque sacarle el
 * subconjunto a un gasto es una edición válida y frecuente —"esto en
 * realidad sí es de todos"— y si el borrado dependiera de que llegue
 * algo, esa edición no se podría hacer nunca.
 *
 * No es transaccional con el `insert` del movimiento, y no hace falta
 * que lo sea: si esto falla, el movimiento ya existe y queda repartido
 * por ventana de fecha, que es el default correcto. Se devuelve el error
 * igual para que no pase inadvertido.
 */
async function guardarSubconjunto(
  supabase: Awaited<ReturnType<typeof requireSession>>["supabase"],
  userId: string,
  movementId: string,
  proyectos: string[] | null | undefined,
): Promise<string | null> {
  const { error: errorBorrado } = await supabase
    .from("movement_projects")
    .delete()
    .eq("movement_id", movementId);
  if (errorBorrado) return mensajeDeError(errorBorrado);

  if (!proyectos || proyectos.length === 0) return null;

  const { error } = await supabase.from("movement_projects").insert(
    proyectos.map((project_id) => ({
      movement_id: movementId,
      project_id,
      user_id: userId,
    })),
  );

  return error ? mensajeDeError(error) : null;
}

export async function actualizarMovimiento(
  id: string,
  input: MovementInput,
): Promise<ActionResult<Movement>> {
  const parsed = movementSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }

  const { supabase, userId } = await requireSession();
  const d = parsed.data;

  const montos = congelarMontos(d.monto_origen, d.moneda_origen, {
    valor: d.tasa_usada,
    fecha: d.tasa_fecha,
    esAproximada: false,
  });

  const { data, error } = await supabase
    .from("movements")
    .update({
      project_id: d.project_id,
      category_id: d.category_id,
      fecha: d.fecha,
      descripcion: d.descripcion,
      tipo: d.tipo,
      monto_origen: d.monto_origen,
      moneda_origen: d.moneda_origen,
      estado: d.estado,
      comprobante_path: d.comprobante_path ?? null,
      ...montos,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return fail(mensajeDeError(error));

  // Va después del update: si el movimiento acaba de dejar de ser
  // compartido, el trigger de la base ya borró su subconjunto y el
  // `delete` de acá no encuentra nada, que es lo correcto. Al revés
  // —escribir el subconjunto antes— el trigger lo rechazaría.
  const errorSubconjunto = await guardarSubconjunto(
    supabase,
    userId,
    id,
    d.proyectos_explicitos,
  );
  if (errorSubconjunto) return fail(errorSubconjunto);

  revalidatePath("/", "layout");
  return ok(data);
}

export async function borrarMovimiento(id: string): Promise<ActionResult> {
  const { supabase } = await requireSession();

  // Si tenía comprobante, se borra el archivo para no dejar huérfanos.
  const { data: movimiento } = await supabase
    .from("movements")
    .select("comprobante_path")
    .eq("id", id)
    .single();

  const { error } = await supabase.from("movements").delete().eq("id", id);
  if (error) return fail(mensajeDeError(error));

  if (movimiento?.comprobante_path) {
    await supabase.storage
      .from("comprobantes")
      .remove([movimiento.comprobante_path]);
  }

  revalidatePath("/", "layout");
  return ok();
}

/**
 * Marca un planificado como efectuado.
 *
 * Acá SÍ se recalcula la tasa, contra la fecha real de efectivización: el
 * movimiento planificado tenía una cotización estimada y ahora pasa a ser
 * plata que se movió de verdad. Es la única recotización de la app.
 */
export async function efectuarMovimiento(
  id: string,
  fechaEfectiva: string,
): Promise<ActionResult<Movement>> {
  const { supabase } = await requireSession();

  const { data: actual, error: errorLectura } = await supabase
    .from("movements")
    .select("monto_origen, moneda_origen, tasa_usada, tasa_fecha")
    .eq("id", id)
    .single();

  if (errorLectura || !actual) {
    return fail("No se encontró el movimiento.");
  }

  const tasa = await getTasaParaFecha(fechaEfectiva);

  // Sin cotización para esa fecha se conserva la que ya tenía, antes que
  // impedir marcarlo como efectuado.
  const tasaAplicada = tasa ?? {
    valor: Number(actual.tasa_usada),
    fecha: actual.tasa_fecha,
    esAproximada: true,
  };

  const montos = congelarMontos(
    Number(actual.monto_origen),
    actual.moneda_origen,
    tasaAplicada,
  );

  const { data, error } = await supabase
    .from("movements")
    .update({
      estado: "efectuado",
      fecha: fechaEfectiva,
      ...montos,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return fail(mensajeDeError(error));

  revalidatePath("/", "layout");
  return ok(data);
}
