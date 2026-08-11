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
import { crearEntradaDeBitacora } from "@/lib/bitacora";
import { congelarMontos } from "@/lib/fx";
import { getTasaParaFecha } from "@/lib/fx-server";
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
 * Los cuatro tipos de bandeja que terminan en una fila de `lessons`, y
 * con qué `origen` nace cada uno.
 *
 * El origen no es decorativo: `generada` sale de una hipótesis del modelo
 * sobre un tema y la lista de Lecciones la muestra distinta (borde
 * punteado, "Hipótesis generada"). `importada` salió de algo que Beno
 * escribió y vivió; `retro`, del cierre de un proyecto. Perder esa
 * distinción sería perder de dónde viene cada cosa que uno cree saber.
 *
 * `leccion_dictada` es la que llega por el conector MCP y nace
 * **`manual`**, como si la hubiera escrito en el formulario: es suya. Que
 * pase por la bandeja no la convierte en producción de un modelo — pasa
 * porque del otro lado hay uno redactando y no hay garantía mecánica de
 * que no haya reformulado, no porque la idea sea de él en menor medida.
 */
const ORIGEN_POR_TIPO = {
  leccion_extraida: "importada",
  leccion_sugerida: "generada",
  leccion_dictada: "manual",
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
  /**
   * **Opcional acá, obligatorio en `lessons`.**
   *
   * Todas las propuestas que existían antes lo traen resuelto: heredan el
   * proyecto de la entrada de bitácora, del tema pedido o de la retro. La
   * que puede no traerlo es la que sale de un archivo pegado, porque al
   * pegarlo puede no saberse a qué proyecto va. Cuando falta, lo trae la
   * edición (ver `edicionSchema`) y la tarjeta de la bandeja lo pide antes
   * de habilitar el botón.
   */
  project_id: uuid.optional(),
  /** Solo en las que salieron de un adjunto. Cambia el `origen`. */
  adjunto_id: uuid.optional(),
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
    /**
     * **Se usa solo si el payload no trae proyecto.**
     *
     * No es una excepción a la regla de arriba, es su complemento: la
     * regla existe para que no se pueda mover una lección a un proyecto
     * que no es el que la originó. Cuando el payload trae `project_id`,
     * esto se ignora. Cuando no lo trae —el adjunto pegado sin nombrar
     * proyecto— es el único lugar donde puede salir el dato, porque
     * `lessons.project_id` es NOT NULL.
     */
    projectId: uuid,
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

  const projectId = payload.data.project_id ?? edicionParseada.data.projectId;
  if (!projectId) {
    return fail("Elegí a qué proyecto va la lección.");
  }

  // Una lección que entró por un archivo no es ni `importada` (no la
  // vivió) ni `generada` (no salió de un tema que él pidió): salió de
  // material de un tercero. La lista de Lecciones tiene que poder
  // distinguirlo, igual que distingue las hipótesis.
  const origen = payload.data.adjunto_id ? "adjunto" : ORIGEN_POR_TIPO[item.tipo];

  const { data: leccion, error: errorLeccion } = await supabase
    .from("lessons")
    .insert({
      user_id: userId,
      project_id: projectId,
      fecha: payload.data.fecha,
      titulo: edicionParseada.data.titulo ?? payload.data.titulo,
      contenido: edicionParseada.data.contenido ?? payload.data.contenido,
      categoria: edicionParseada.data.categoria ?? payload.data.categoria,
      origen,
    })
    .select("id")
    .single();

  if (errorLeccion) return fail(mensajeDeError(errorLeccion));

  const { error: errorCierre } = await supabase
    .from("inbox")
    .update({
      estado: "aceptado",
      resuelto_en: new Date().toISOString(),
      // `entidad_tabla` / `entidad_id` NO se tocan: siguen apuntando a
      // la entrada de bitácora de la que salió la propuesta.
      //
      // Antes se repuntaban a la lección creada, para poder ir de la
      // propuesta a la lección. Eso rompía el pase de extracción: busca
      // lo ya mirado por `entidad_tabla = 'daily_log'`, así que apenas
      // aceptabas una propuesta su entrada de origen volvía a parecer
      // sin mirar y el pase la proponía de nuevo. Estuvo latente desde
      // la etapa 6 y se vio el 2026-08-08, la primera vez que se aceptó
      // algo: la corrida siguiente duplicó las cuatro lecciones.
      //
      // El vínculo hacia adelante no se pierde, va en el payload. Se
      // parte del payload crudo y no del parseado para no perder los
      // campos propios de cada tipo (`tema`, `retro_titulo`, `modelo`).
      payload: {
        ...(item.payload as Record<string, unknown>),
        lesson_id: leccion.id,
      },
      clave_dedupe: null,
    })
    .eq("id", idParseado.data);

  if (errorCierre) return fail(mensajeDeError(errorCierre));

  revalidatePath("/", "layout");
  return ok({ lessonId: leccion.id });
}

/* ────────────────────────────────────────────────────────────
 * Notas que salieron de una captura
 * ──────────────────────────────────────────────────────────── */

const payloadNotaSchema = z.object({
  contenido: z.string().trim().min(1).max(6000),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  project_id: uuid.optional(),
});

const edicionNotaSchema = z
  .object({
    contenido: z
      .string()
      .trim()
      .min(1, "La nota no puede quedar vacía.")
      .max(6000),
    projectId: uuid,
  })
  .partial();

export type EdicionNota = z.infer<typeof edicionNotaSchema>;

/**
 * Acepta una nota que salió de una captura: crea la entrada de bitácora.
 *
 * Es una acción aparte de `aceptarLeccion()` porque escribe en otra tabla
 * y con otro criterio, no por prolijidad. Y la distinción que la ordena
 * está en la regla 6 de `AGENTS.md`: el agente de bitácora escribe
 * directo porque **el texto es de Beno palabra por palabra**; acá el
 * texto lo produjo un modelo mirando píxeles, así que pasa por la bandeja
 * como cualquier otra producción de un modelo.
 *
 * Una vez que la entrada existe, el pase de extracción que ya está hecho
 * la mira y, si tiene una lección adentro, la propone. Ese camino no hay
 * que construirlo.
 *
 * Sirve para los **dos** tipos que terminan en una entrada de bitácora: la
 * que un modelo sacó de una captura y la que un modelo dictó por el
 * conector. El payload tiene la misma forma en los dos y el criterio
 * también — en los dos el texto lo produjo un modelo, así que pasa por la
 * bandeja—. Lo único que cambia es de dónde vino, y eso lo muestra la
 * tarjeta, no la action. Por eso no se renombró: el nombre quedó corto,
 * pero renombrarla es ruido en el diff sin ninguna ganancia.
 */
export async function aceptarNotaDeAdjunto(
  itemId: string,
  edicion?: EdicionNota,
): Promise<ActionResult<{ entradaId: string }>> {
  const idParseado = uuid.safeParse(itemId);
  if (!idParseado.success) return fail("Identificador inválido.");

  const edicionParseada = edicionNotaSchema.safeParse(edicion ?? {});
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
  if (item.tipo !== "nota_de_adjunto" && item.tipo !== "nota_dictada") {
    return fail("Esa propuesta no es una nota de bitácora.");
  }
  if (item.estado !== "pendiente" && item.estado !== "pospuesto") {
    return fail("Esa propuesta ya estaba resuelta.");
  }

  const payload = payloadNotaSchema.safeParse(item.payload);
  if (!payload.success) {
    return fail("La propuesta guardada está incompleta. Rechazala.");
  }

  // `daily_log.project_id` es NOT NULL y el adjunto puede haber llegado
  // sin proyecto: la tarjeta lo pide antes de habilitar el botón.
  const projectId = payload.data.project_id ?? edicionParseada.data.projectId;
  if (!projectId) return fail("Elegí a qué proyecto va la nota.");

  const { data: entrada, error: errorEntrada } = await crearEntradaDeBitacora(
    supabase,
    userId,
    {
      contenido: edicionParseada.data.contenido ?? payload.data.contenido,
      fecha: payload.data.fecha,
      projectId,
    },
  );

  if (errorEntrada || !entrada) {
    return fail(
      errorEntrada ? mensajeDeError(errorEntrada) : "La nota no se guardó.",
    );
  }

  const { error: errorCierre } = await supabase
    .from("inbox")
    .update({
      estado: "aceptado",
      resuelto_en: new Date().toISOString(),
      // `entidad_tabla` / `entidad_id` siguen apuntando al adjunto, por el
      // mismo motivo que en `aceptarLeccion()`: repuntarlos rompería la
      // trazabilidad hacia el archivo del que salió. El vínculo hacia
      // adelante va en el payload.
      payload: {
        ...(item.payload as Record<string, unknown>),
        daily_log_id: entrada.id,
      },
      clave_dedupe: null,
    })
    .eq("id", idParseado.data);

  if (errorCierre) return fail(mensajeDeError(errorCierre));

  revalidatePath("/", "layout");
  return ok({ entradaId: entrada.id });
}

/* ────────────────────────────────────────────────────────────
 * Movimientos dictados por el conector MCP
 * ──────────────────────────────────────────────────────────── */

/**
 * Lo que dejó `registrar_movimiento`.
 *
 * `project_id` y `category_id` son opcionales y no por descuido: el
 * conector no inventa ninguno de los dos. Si Claude no supo a qué
 * proyecto va, o si el histórico no tenía con qué sugerir una categoría
 * y el modelo estaba caído, la propuesta entra igual y la tarjeta los
 * pide antes de habilitar el botón. Es el mismo patrón que ya usa lo que
 * entra por un archivo pegado.
 *
 * `compartido: true` es distinto de "no vino `project_id`": el primero
 * es una decisión —el gasto se reparte entre los proyectos que estaban
 * abiertos en su fecha— y el segundo es una pregunta sin responder. En
 * la base los dos terminan en
 * `project_id = null`, así que si se confundieran, "no sé de quién es"
 * se guardaría como "es de todos" sin que nadie lo note.
 */
const payloadMovimientoSchema = z.object({
  descripcion: z.string().trim().min(1).max(200),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  monto_origen: z.number().positive().max(1e12),
  moneda_origen: z.enum(["ARS", "USD"]),
  estado: z.enum(["efectuado", "planificado"]),
  project_id: uuid.optional(),
  compartido: z.boolean().optional(),
  category_id: uuid.optional(),
  categoria_nombre: z.string().optional(),
  sugerencia: z.string().optional(),
});

/**
 * Lo que la tarjeta puede cambiar antes de aceptar: **el proyecto y la
 * categoría, nada más**.
 *
 * No es una limitación técnica, es dónde está la línea. El monto, la
 * fecha y la descripción son lo que Beno dictó: si alguno está mal, la
 * propuesta está mal y el gesto correcto es rechazarla, no corregirla a
 * mano en un triage que tiene que ser de una tecla. El proyecto y la
 * categoría, en cambio, son cosas que el conector **no puede saber** y
 * que se eligen de una lista.
 *
 * `projectId: null` significa compartido, y por eso el nullable: acá
 * tampoco pueden colapsar "compartido" y "sin decidir".
 */
const edicionMovimientoSchema = z
  .object({
    categoryId: uuid,
    projectId: uuid.nullable(),
  })
  .partial();

export type EdicionMovimiento = z.infer<typeof edicionMovimientoSchema>;

/**
 * Acepta un movimiento dictado: lo crea de verdad y resuelve el ítem.
 *
 * Es el botón que pide la regla 6 para todo lo que entra por el conector
 * MCP. Hasta acá no había ni un peso cargado: solo una fila en `inbox`.
 */
export async function aceptarMovimientoDictado(
  itemId: string,
  edicion?: EdicionMovimiento,
): Promise<ActionResult<{ movementId: string }>> {
  const idParseado = uuid.safeParse(itemId);
  if (!idParseado.success) return fail("Identificador inválido.");

  const edicionParseada = edicionMovimientoSchema.safeParse(edicion ?? {});
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
  if (item.tipo !== "movimiento_dictado") {
    return fail("Esa propuesta no es un movimiento.");
  }
  if (item.estado !== "pendiente" && item.estado !== "pospuesto") {
    return fail("Esa propuesta ya estaba resuelta.");
  }

  const payload = payloadMovimientoSchema.safeParse(item.payload);
  if (!payload.success) {
    return fail("La propuesta guardada está incompleta. Rechazala.");
  }

  const categoryId = edicionParseada.data.categoryId ?? payload.data.category_id;
  if (!categoryId) return fail("Elegí una categoría.");

  // `"projectId" in …` y no `??`: el valor válido `null` significa
  // compartido y con `??` se confundiría con "no eligió nada".
  const projectId =
    "projectId" in edicionParseada.data
      ? (edicionParseada.data.projectId ?? null)
      : payload.data.compartido
        ? null
        : (payload.data.project_id ?? undefined);

  if (projectId === undefined) {
    return fail("Elegí a qué proyecto va, o marcalo como compartido.");
  }

  // El tipo sale de la categoría y no del payload, así que no pueden
  // contradecirse: una categoría de egreso jamás va a crear un ingreso.
  const { data: categoria, error: errorCategoria } = await supabase
    .from("categories")
    .select("id, tipo")
    .eq("id", categoryId)
    .maybeSingle();

  if (errorCategoria) return fail(mensajeDeError(errorCategoria));
  if (!categoria) return fail("Esa categoría ya no existe. Elegí otra.");

  // ⚠ **Acá se congela el par ARS/USD, y recién acá.** La propuesta no
  // trae cotización: la tasa aplicable se resuelve contra la fecha del
  // movimiento en el momento en que el movimiento pasa a existir. Es la
  // regla 1 —"la tasa de esa fecha o la última anterior"— y congelarla
  // al proponer habría fijado la del día en que se dictó, que puede ser
  // otro, o incluso una anterior a la que ya cargó el cron.
  const tasa = await getTasaParaFecha(payload.data.fecha);
  if (!tasa) {
    return fail(
      "No hay ninguna cotización cargada, así que no puedo congelar el par ARS/USD. Actualizá la cotización en Ajustes y volvé a intentar.",
    );
  }

  const montos = congelarMontos(
    payload.data.monto_origen,
    payload.data.moneda_origen,
    tasa,
  );

  const { data: movimiento, error: errorMovimiento } = await supabase
    .from("movements")
    .insert({
      user_id: userId,
      project_id: projectId,
      category_id: categoria.id,
      fecha: payload.data.fecha,
      descripcion: payload.data.descripcion,
      tipo: categoria.tipo,
      monto_origen: payload.data.monto_origen,
      moneda_origen: payload.data.moneda_origen,
      estado: payload.data.estado,
      ...montos,
    })
    .select("id")
    .single();

  if (errorMovimiento) return fail(mensajeDeError(errorMovimiento));

  const { error: errorCierre } = await supabase
    .from("inbox")
    .update({
      estado: "aceptado",
      resuelto_en: new Date().toISOString(),
      // El vínculo hacia adelante va en el payload, igual que en
      // `aceptarLeccion()`. Acá `entidad_tabla`/`entidad_id` vienen en
      // null —la propuesta no salió de ninguna fila de la app, salió de
      // una frase— así que no hay nada que preservar; se deja igual por
      // consistencia y para no darle a nadie la idea de repuntarlos.
      payload: {
        ...(item.payload as Record<string, unknown>),
        movement_id: movimiento.id,
      },
      clave_dedupe: null,
    })
    .eq("id", idParseado.data);

  if (errorCierre) return fail(mensajeDeError(errorCierre));

  revalidatePath("/", "layout");
  return ok({ movementId: movimiento.id });
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

/**
 * Acepta un zombie: "sí, lo doy de baja" (spec 6.2).
 *
 * Si el gasto tenía una **recurrencia declarada**, se desactiva: es lo
 * único que la app puede dar de baja de verdad, y evita que el cron
 * siga generando el movimiento planificado todos los meses.
 *
 * Si no la tenía —el caso de los datos reales, donde las suscripciones
 * son movimientos sueltos— no hay ninguna fila que apagar: la baja la
 * hace Beno en el sitio del proveedor y esto solo cierra el aviso. La
 * pantalla lo dice con todas las letras en vez de fingir que hizo algo.
 */
export async function aceptarZombie(
  itemId: string,
): Promise<ActionResult<{ recurrenciaDesactivada: boolean }>> {
  const idParseado = uuid.safeParse(itemId);
  if (!idParseado.success) return fail("Identificador inválido.");

  const { supabase } = await requireSession();

  const { data: item, error: errorLectura } = await supabase
    .from("inbox")
    .select("id, tipo, estado, payload")
    .eq("id", idParseado.data)
    .maybeSingle();

  if (errorLectura) return fail(mensajeDeError(errorLectura));
  if (!item) return fail("No encontré ese aviso.");
  if (item.tipo !== "zombie") return fail("Ese ítem no es una suscripción.");
  if (item.estado !== "pendiente" && item.estado !== "pospuesto") {
    return fail("Ese aviso ya estaba resuelto.");
  }

  const payload = item.payload as { recurrence_id?: unknown } | null;
  const recurrenceId =
    typeof payload?.recurrence_id === "string" ? payload.recurrence_id : null;

  let desactivada = false;

  if (recurrenceId) {
    const { error } = await supabase
      .from("recurrences")
      .update({ activa: false })
      .eq("id", recurrenceId);

    if (error) return fail(mensajeDeError(error));
    desactivada = true;
  }

  const { error: errorCierre } = await supabase
    .from("inbox")
    .update({
      estado: "aceptado",
      resuelto_en: new Date().toISOString(),
      // La clave se conserva: el gasto sigue existiendo en el histórico
      // y el detector lo volvería a ver. Si se liberara, el próximo
      // escaneo propondría de nuevo algo que Beno ya dio de baja.
    })
    .eq("id", idParseado.data);

  if (errorCierre) return fail(mensajeDeError(errorCierre));

  revalidatePath("/", "layout");
  return ok({ recurrenciaDesactivada: desactivada });
}

async function resolver(
  itemId: string,
  estado: "rechazado",
): Promise<ActionResult> {
  const idParseado = uuid.safeParse(itemId);
  if (!idParseado.success) return fail("Identificador inválido.");

  const { supabase } = await requireSession();

  // Los zombies son la excepción, y es un requisito del spec: "lo marco
  // como falso positivo **y no me lo vuelve a mostrar**". Como la
  // detección es una consulta sobre todo el histórico, el gasto va a
  // seguir apareciendo en cada corrida; lo único que puede acordarse de
  // que Beno ya dijo que no es la clave conservada en la fila rechazada,
  // que el escaneo lee antes de proponer.
  //
  // Para el resto, liberar la clave es lo correcto: permite volver a
  // proponer sobre la misma entidad si algo cambia. El índice único solo
  // cubre lo no resuelto, así que conservarla acá no bloquea nada.
  const { data: item } = await supabase
    .from("inbox")
    .select("tipo")
    .eq("id", idParseado.data)
    .maybeSingle();

  const esZombie = item?.tipo === "zombie";

  const { error } = await supabase
    .from("inbox")
    .update({
      estado,
      resuelto_en: new Date().toISOString(),
      ...(esZombie ? {} : { clave_dedupe: null }),
    })
    .eq("id", idParseado.data)
    .in("estado", ["pendiente", "pospuesto", "error"]);

  if (error) return fail(mensajeDeError(error));

  revalidatePath("/", "layout");
  return ok();
}
