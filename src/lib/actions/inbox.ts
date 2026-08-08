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
import type {
  OrigenLeccion,
  TipoBandeja,
} from "@/lib/supabase/database.types";

/**
 * Bandeja: el único lugar por donde entra a la app lo que propone un
 * modelo.
 *
 * La regla del proyecto es que **nada se escribe en las tablas de dominio
 * sin que Beno apriete un botón**. Estas actions son ese botón. El pase de
 * extracción (`lib/extraccion.ts`) solo deja propuestas; recién acá una
 * propuesta se convierte en una lección de verdad.
 *
 * Las tres acciones del triage —aceptar, rechazar, posponer— resuelven el
 * ítem y devuelven de inmediato. La indexación semántica de la lección
 * nueva queda **fuera** de este camino a propósito: generar un embedding
 * puede tardar decenas de segundos con el modelo frío, y la vara de
 * diseño del spec es que procesar la cola sea instantáneo. La dispara la
 * pantalla contra `/api/lecciones/indexar` sin esperarla.
 */

const uuid = z.string().uuid("Identificador inválido.");

/**
 * Los tres tipos de bandeja que terminan en una fila de `lessons`, y con
 * qué `origen` nace cada uno.
 *
 * El origen no es decorativo: `generada` sale de una hipótesis del modelo
 * sobre un tema y la lista de Lecciones la muestra distinta (borde
 * punteado, "Hipótesis generada"). `importada` salió de algo que Beno
 * escribió y vivió; `retro`, del cierre de un proyecto. Perder esa
 * distinción sería perder de dónde viene cada cosa que uno cree saber.
 */
const ORIGEN_POR_TIPO = {
  leccion_extraida: "importada",
  leccion_sugerida: "generada",
  retro: "retro",
} as const satisfies Partial<Record<TipoBandeja, OrigenLeccion>>;

type TipoConLeccion = keyof typeof ORIGEN_POR_TIPO;

function esTipoConLeccion(tipo: TipoBandeja): tipo is TipoConLeccion {
  return tipo in ORIGEN_POR_TIPO;
}

/** Lo que el pase dejó en `payload`, revalidado antes de escribir. */
const payloadSchema = z.object({
  titulo: z.string().trim().min(1).max(200),
  contenido: z.string().trim().min(1).max(5000),
  categoria: z.enum([
    "tecnica",
    "producto",
    "comercial",
    "proceso",
    "personal",
  ]),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  project_id: uuid,
});

/**
 * Lo que la pantalla puede cambiar antes de aceptar.
 *
 * "Aceptar editando" es parte del spec: la propuesta del modelo es un
 * borrador, no un dictamen. Lo que no se puede tocar acá es el proyecto
 * ni la fecha — los hereda de la entrada de bitácora de la que salió, y
 * cambiarlos sería inventar de dónde vino el conocimiento.
 */
const edicionSchema = z
  .object({
    titulo: z.string().trim().min(1, "El título no puede quedar vacío.").max(200),
    contenido: z
      .string()
      .trim()
      .min(1, "El contenido no puede quedar vacío.")
      .max(5000),
    categoria: payloadSchema.shape.categoria,
  })
  .partial();

export type EdicionLeccion = z.infer<typeof edicionSchema>;

/**
 * Acepta una propuesta de lección: la crea de verdad y resuelve el ítem.
 *
 * Sirve para los tres tipos que terminan en una lección —la extraída de
 * la bitácora, la generada sobre un tema y la que salió de una retro—:
 * el payload tiene la misma forma en los tres y lo único que cambia es
 * el `origen` con el que nace la fila.
 *
 * Devuelve el id de la lección creada para que la pantalla dispare la
 * indexación sin bloquear el triage.
 */
export async function aceptarLeccion(
  itemId: string,
  edicion?: EdicionLeccion,
): Promise<ActionResult<{ lessonId: string }>> {
  const idParseado = uuid.safeParse(itemId);
  if (!idParseado.success) return fail("Identificador inválido.");

  const edicionParseada = edicionSchema.safeParse(edicion ?? {});
  if (!edicionParseada.success) {
    return fail(edicionParseada.error.issues[0]?.message ?? "Datos inválidos.");
  }

  const { supabase, userId } = await requireSession();

  const { data: item, error: errorLectura } = await supabase
    .from("inbox")
    .select("id, tipo, estado, payload")
    .eq("id", idParseado.data)
    .maybeSingle();

  if (errorLectura) return fail(mensajeDeError(errorLectura));
  if (!item) return fail("No encontré esa propuesta.");
  if (!esTipoConLeccion(item.tipo)) {
    return fail("Esa propuesta no genera una lección.");
  }
  if (item.estado !== "pendiente" && item.estado !== "pospuesto") {
    return fail("Esa propuesta ya estaba resuelta.");
  }

  // El payload es jsonb: la base no garantiza su forma. Se revalida acá
  // porque de esto sale una fila de dominio.
  const payload = payloadSchema.safeParse(item.payload);
  if (!payload.success) {
    return fail("La propuesta guardada está incompleta. Rechazala.");
  }

  const { data: leccion, error: errorLeccion } = await supabase
    .from("lessons")
    .insert({
      user_id: userId,
      project_id: payload.data.project_id,
      fecha: payload.data.fecha,
      titulo: edicionParseada.data.titulo ?? payload.data.titulo,
      contenido: edicionParseada.data.contenido ?? payload.data.contenido,
      categoria: edicionParseada.data.categoria ?? payload.data.categoria,
      origen: ORIGEN_POR_TIPO[item.tipo],
    })
    .select("id")
    .single();

  if (errorLeccion) return fail(mensajeDeError(errorLeccion));

  const { error: errorCierre } = await supabase
    .from("inbox")
    .update({
      estado: "aceptado",
      resuelto_en: new Date().toISOString(),
      // Deja de apuntar a la entrada de bitácora y pasa a apuntar a lo
      // que se creó: así se puede ir de la propuesta a la lección.
      entidad_tabla: "lessons",
      entidad_id: leccion.id,
      clave_dedupe: null,
    })
    .eq("id", idParseado.data);

  if (errorCierre) return fail(mensajeDeError(errorCierre));

  revalidatePath("/", "layout");
  return ok({ lessonId: leccion.id });
}

/** Descarta la propuesta. La entrada de bitácora queda intacta. */
export async function rechazarItemBandeja(
  itemId: string,
): Promise<ActionResult> {
  return resolver(itemId, "rechazado");
}

/**
 * Saca el ítem de la cola por un tiempo.
 *
 * El enum tiene `pospuesto` justamente para esto: hay propuestas que uno
 * no quiere aceptar ni descartar hoy. Sigue contando como no resuelto
 * (`resuelto_en` en null), así que el índice de dedupe lo sigue cubriendo
 * y el pase no vuelve a proponer lo mismo.
 */
export async function posponerItemBandeja(
  itemId: string,
  dias = 7,
): Promise<ActionResult> {
  const idParseado = uuid.safeParse(itemId);
  if (!idParseado.success) return fail("Identificador inválido.");

  const diasParseados = z.number().int().min(1).max(365).safeParse(dias);
  if (!diasParseados.success) return fail("Cantidad de días inválida.");

  const hasta = new Date();
  hasta.setDate(hasta.getDate() + diasParseados.data);

  const { supabase } = await requireSession();

  const { error } = await supabase
    .from("inbox")
    .update({ estado: "pospuesto", posponer_hasta: hasta.toISOString() })
    .eq("id", idParseado.data)
    .in("estado", ["pendiente", "pospuesto"]);

  if (error) return fail(mensajeDeError(error));

  revalidatePath("/", "layout");
  return ok();
}

/**
 * Cierra un ítem que quedó en `error` (la salida del modelo no validó).
 *
 * No hay nada que aceptar ahí: se lo saca de la vista y listo.
 */
export async function descartarErrorBandeja(
  itemId: string,
): Promise<ActionResult> {
  return resolver(itemId, "rechazado");
}

async function resolver(
  itemId: string,
  estado: "rechazado",
): Promise<ActionResult> {
  const idParseado = uuid.safeParse(itemId);
  if (!idParseado.success) return fail("Identificador inválido.");

  const { supabase } = await requireSession();

  const { error } = await supabase
    .from("inbox")
    .update({
      estado,
      resuelto_en: new Date().toISOString(),
      // Liberar la clave permite que una corrida futura vuelva a
      // proponer sobre la misma entidad si algo cambia. El índice único
      // solo cubre lo no resuelto.
      clave_dedupe: null,
    })
    .eq("id", idParseado.data)
    .in("estado", ["pendiente", "pospuesto", "error"]);

  if (error) return fail(mensajeDeError(error));

  revalidatePath("/", "layout");
  return ok();
}
