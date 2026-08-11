"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { todayISO } from "@/lib/dates";
import { getTasaParaFecha } from "@/lib/fx-server";
import {
  calcularPresupuesto,
  multiplicadorDe,
  sumarHoras,
} from "@/lib/presupuestos";
import { getAjustesPresupuesto } from "@/lib/presupuestos-server";
import { quoteSchema, type QuoteInput } from "@/lib/schemas";
import type { SupabaseClient } from "@/lib/supabase/server";

import {
  fail,
  mensajeDeError,
  ok,
  requireSession,
  slugDisponible,
  type ActionResult,
} from "./shared";

/**
 * Presupuestos: alta, edición y resolución.
 *
 * ── Regla 1, aplicada a otra tabla ────────────────────────────────────
 *
 * `tarifa_hora`, `multiplicador`, `horas_por_semana`, `tasa_usada` y
 * `tasa_fecha` son **una foto del momento**. Se congelan al crear la fila
 * y **al editar se releen de la propia fila, nunca de `settings`**: si
 * mañana Beno sube su tarifa, corregirle una coma a un presupuesto de
 * marzo no puede cambiarle el precio. Es el mismo criterio con el que
 * `movements` congela la tasa y `retros` su balance.
 *
 * La única recotización posible es explícita y crea una fila nueva:
 * descartar el viejo como `quedo_desactualizado` y crear otro con
 * `reemplaza_a` apuntando al anterior.
 *
 * ── El precio no lo decide esta capa ──────────────────────────────────
 *
 * La cuenta vive en `src/lib/presupuestos.ts`, que es puro y lo comparten
 * el formulario (recalculando con cada tecla) y el servidor al guardar.
 * Acá solo se elige **con qué valores** se la llama.
 */

const uuid = z.string().uuid("Identificador inválido.");

/** Cuántas veces se reintenta el correlativo antes de rendirse. */
const REINTENTOS_NUMERO = 5;

/** El unique que muerde cuando dos altas se pisan el número. */
const CONFLICTO_NUMERO = "quotes_user_id_numero_key";

/**
 * El siguiente correlativo del usuario.
 *
 * **No hay secuencia en la base, y es a propósito**: una secuencia se
 * saltea números cuando un insert falla, y acá el número se muestra
 * ("Presupuesto Nº 7"). Un salto en la numeración de un documento que se
 * manda a clientes es una pregunta que nadie quiere contestar.
 *
 * El costo es que `max(numero) + 1` tiene una carrera: dos altas
 * simultáneas leen el mismo máximo y la segunda choca contra
 * `unique (user_id, numero)`. Se resuelve **dejando que choque y
 * reintentando** (el bucle de `crearPresupuesto`): el unique de la base es
 * la autoridad, no un `select` optimista. Para una app de un solo usuario
 * que hace unos pocos presupuestos por año es la solución proporcionada —
 * el caso real es tener dos pestañas abiertas—, y como el reintento
 * relee el máximo, la carrera no deja huecos en la numeración.
 */
async function siguienteNumero(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { data } = await supabase
    .from("quotes")
    .select("numero")
    .eq("user_id", userId)
    .order("numero", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data?.numero ?? 0) + 1;
}

/** Lo congelado de un presupuesto: lo que no se recalcula nunca. */
interface Congelado {
  tarifa_hora: number;
  tarifa_moneda: "ARS" | "USD";
  multiplicador: number;
  horas_por_semana: number;
}

/**
 * Arma la fila a partir de la entrada del formulario y de los valores
 * congelados. Es la única función que decide el total, así que es el único
 * lugar donde puede romperse la regla 1.
 */
function armarFila(
  input: QuoteInput,
  congelado: Congelado,
  tasa: { valor: number; fecha: string; esAproximada: boolean } | null,
) {
  const horas = sumarHoras(input.items);

  const calculo = calcularPresupuesto({
    horas,
    tarifa_hora: congelado.tarifa_hora,
    tarifa_moneda: congelado.tarifa_moneda,
    cliente_tipo: input.cliente_tipo,
    moneda: input.moneda,
    // El multiplicador ya está congelado, así que se le pasa como la
    // tabla entera con el mismo valor en los tres: `multiplicadorDe` no
    // tiene por qué volver a mirar `settings`.
    multiplicadores: {
      particular: congelado.multiplicador,
      pyme: congelado.multiplicador,
      empresa: congelado.multiplicador,
    },
    horas_por_semana: congelado.horas_por_semana,
    tasa,
  });

  return {
    cliente_nombre: input.cliente_nombre,
    cliente_tipo: input.cliente_tipo,
    titulo: input.titulo,
    resumen_alcance: input.resumen_alcance,
    pedido_texto: input.pedido_texto,
    // Sin cotización el cálculo se cae a la moneda de la tarifa y lo
    // marca; guardar la moneda pedida diría un precio en dólares que
    // nunca se convirtió.
    moneda: calculo.moneda,
    tarifa_hora: congelado.tarifa_hora,
    multiplicador: congelado.multiplicador,
    tasa_usada: calculo.tasa_usada,
    tasa_fecha: calculo.tasa_fecha,
    horas_estimadas: calculo.horas,
    horas_por_semana: calculo.horas_por_semana,
    semanas_estimadas: calculo.semanas,
    // El total sale de la cuenta salvo que Beno lo haya pisado a mano.
    // Es el mismo comportamiento que la sugerencia de categoría, que se
    // apaga apenas él elige: la app propone, no decide.
    total_origen: input.total_editado
      ? input.total_origen
      : calculo.total_origen,
    fecha: input.fecha,
    validez_dias: input.validez_dias,
    mostrar_horas: input.mostrar_horas,
    condiciones: input.condiciones,
    modelo: input.modelo,
    reemplaza_a: input.reemplaza_a,
  };
}

/**
 * Reescribe los ítems, supuestos y preguntas de un presupuesto.
 *
 * Borra y vuelve a insertar en vez de hacer un diff, y no es pereza: el
 * `unique (quote_id, orden)` **no es diferible** (un unique diferible no
 * sirve para `on conflict`), así que mover el ítem 3 al lugar 1 no se
 * puede hacer con dos updates sueltos. Con unas pocas decenas de filas por
 * presupuesto, borrar y reinsertar es la operación correcta y la más
 * simple de leer.
 */
async function guardarHijos(
  supabase: SupabaseClient,
  userId: string,
  quoteId: string,
  input: QuoteInput,
): Promise<string | null> {
  for (const tabla of [
    "quote_items",
    "quote_assumptions",
    "quote_questions",
  ] as const) {
    const { error } = await supabase.from(tabla).delete().eq("quote_id", quoteId);
    if (error) return mensajeDeError(error);
  }

  if (input.items.length > 0) {
    const { error } = await supabase.from("quote_items").insert(
      input.items.map((item, orden) => ({
        user_id: userId,
        quote_id: quoteId,
        orden,
        titulo: item.titulo,
        detalle: item.detalle,
        horas: item.horas,
        origen: item.origen,
        ancla: item.ancla,
        // Sin cita no hay nada que verificar: lo pide un check de la base
        // y acá se respeta en vez de dejar que explote.
        ancla_verificada: item.ancla ? item.ancla_verificada : false,
        confianza: item.confianza,
      })),
    );
    if (error) return mensajeDeError(error);
  }

  if (input.supuestos.length > 0) {
    const { error } = await supabase.from("quote_assumptions").insert(
      input.supuestos.map((texto, orden) => ({
        user_id: userId,
        quote_id: quoteId,
        orden,
        texto,
      })),
    );
    if (error) return mensajeDeError(error);
  }

  if (input.preguntas.length > 0) {
    const { error } = await supabase.from("quote_questions").insert(
      input.preguntas.map((texto, orden) => ({
        user_id: userId,
        quote_id: quoteId,
        orden,
        texto,
      })),
    );
    if (error) return mensajeDeError(error);
  }

  return null;
}

export interface PresupuestoCreado {
  id: string;
  numero: number;
}

export async function crearPresupuesto(
  input: QuoteInput,
): Promise<ActionResult<PresupuestoCreado>> {
  const parsed = quoteSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }

  const { supabase, userId } = await requireSession();
  const ajustes = await getAjustesPresupuesto();

  if (!ajustes.tarifa_hora || ajustes.tarifa_hora <= 0) {
    return fail(
      "Todavía no cargaste tu tarifa hora. Está en Ajustes → Tarifa, y sin ella un presupuesto no tiene precio.",
    );
  }

  const congelado: Congelado = {
    tarifa_hora: ajustes.tarifa_hora,
    tarifa_moneda: ajustes.tarifa_moneda,
    multiplicador: multiplicadorDe(
      parsed.data.cliente_tipo,
      ajustes.multiplicadores,
    ),
    horas_por_semana: ajustes.horas_por_semana,
  };

  // La tasa se resuelve contra **la fecha del presupuesto** (la de esa
  // fecha o la última anterior), igual que en `movements`.
  const tasa =
    parsed.data.moneda === ajustes.tarifa_moneda
      ? null
      : await getTasaParaFecha(parsed.data.fecha);

  const fila = armarFila(parsed.data, congelado, tasa);

  // El correlativo, con reintento sobre el unique. Ver `siguienteNumero`.
  let creado: { id: string; numero: number } | null = null;
  let ultimoError = "No se pudo asignar el número de presupuesto.";

  for (let intento = 0; intento < REINTENTOS_NUMERO; intento++) {
    // Se relee en cada vuelta: si el choque fue por una carrera, la fila
    // que ganó ya está y el máximo subió, así que el reintento no saltea
    // ningún número. Por eso no se hace `numero + intento`.
    const numero = await siguienteNumero(supabase, userId);

    const { data, error } = await supabase
      .from("quotes")
      .insert({ ...fila, user_id: userId, numero })
      .select("id, numero")
      .single();

    if (!error) {
      creado = data;
      break;
    }

    const esCarreraDeNumero =
      error.code === "23505" && error.message.includes(CONFLICTO_NUMERO);
    if (!esCarreraDeNumero) return fail(mensajeDeError(error));

    ultimoError =
      "Otro presupuesto se llevó ese número mientras guardabas. Probá de nuevo.";
  }

  if (!creado) return fail(ultimoError);

  const errorHijos = await guardarHijos(supabase, userId, creado.id, parsed.data);
  if (errorHijos) return fail(errorHijos);

  revalidatePath("/", "layout");
  return ok({ id: creado.id, numero: creado.numero });
}

export async function actualizarPresupuesto(
  id: string,
  input: QuoteInput,
): Promise<ActionResult> {
  const parsedId = uuid.safeParse(id);
  if (!parsedId.success) return fail("Identificador inválido.");

  const parsed = quoteSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }

  const { supabase, userId } = await requireSession();

  const { data: actual } = await supabase
    .from("quotes")
    .select(
      "id, estado, moneda, tarifa_hora, multiplicador, horas_por_semana, tasa_usada, tasa_fecha",
    )
    .eq("id", parsedId.data)
    .maybeSingle();

  if (!actual) return fail("No se encontró el presupuesto.");

  if (actual.estado === "aceptado" || actual.estado === "descartado") {
    return fail(
      "Este presupuesto ya está resuelto y no se edita. Si el número cambió, hacé uno nuevo que reemplace a este.",
    );
  }

  // ⚠ Los valores congelados salen de la fila, NO de `settings`. Editarle
  // una coma a un presupuesto no puede recotizarlo con la tarifa de hoy.
  const congelado: Congelado = {
    tarifa_hora: Number(actual.tarifa_hora),
    // La moneda de la tarifa no se guarda en `quotes`: se deduce del
    // congelado. Si hay tasa, hubo conversión y la tarifa estaba en la
    // otra moneda; si no la hay, la tarifa estaba en la del presupuesto.
    tarifa_moneda:
      actual.tasa_usada === null
        ? actual.moneda
        : actual.moneda === "ARS"
          ? "USD"
          : "ARS",
    multiplicador: Number(actual.multiplicador),
    horas_por_semana: Number(actual.horas_por_semana),
  };

  const tasa =
    actual.tasa_usada === null || actual.tasa_fecha === null
      ? null
      : {
          valor: Number(actual.tasa_usada),
          fecha: actual.tasa_fecha,
          esAproximada: false,
        };

  // La moneda del documento tampoco se puede cambiar editando: cambiarla
  // exigiría una tasa nueva, y eso es una recotización.
  const fila = armarFila(
    { ...parsed.data, moneda: actual.moneda },
    congelado,
    tasa,
  );

  const { error } = await supabase
    .from("quotes")
    .update(fila)
    .eq("id", parsedId.data);

  if (error) return fail(mensajeDeError(error));

  const errorHijos = await guardarHijos(
    supabase,
    userId,
    parsedId.data,
    parsed.data,
  );
  if (errorHijos) return fail(errorHijos);

  revalidatePath("/", "layout");
  return ok();
}

/**
 * Lo marca como enviado. No hay check que exija `enviado_en` para
 * resolverlo —un presupuesto se puede descartar sin haberlo mandado
 * nunca—, pero los días entre enviado y resuelto son lo que después dice
 * si "quedó desactualizado" fue culpa del cliente o de la demora.
 */
export async function marcarEnviado(id: string): Promise<ActionResult> {
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return fail("Identificador inválido.");

  const { supabase } = await requireSession();

  const { error } = await supabase
    .from("quotes")
    .update({ estado: "enviado", enviado_en: todayISO() })
    .eq("id", parsed.data)
    .eq("estado", "borrador");

  if (error) return fail(mensajeDeError(error));

  revalidatePath("/", "layout");
  return ok();
}

const destinoSchema = z.discriminatedUnion("modo", [
  z.object({ modo: z.literal("existente"), projectId: uuid }),
  z.object({
    modo: z.literal("nuevo"),
    nombre: z.string().trim().min(1, "Poné un nombre.").max(80),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido."),
    fecha_inicio: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (formato AAAA-MM-DD).")
      .nullable(),
  }),
]);

export type DestinoAceptacion = z.infer<typeof destinoSchema>;

export interface ResultadoAceptacion {
  projectId: string;
  /** true si el proyecto se creó ahora. La pantalla lo dice distinto. */
  creado: boolean;
}

/**
 * Aceptar un presupuesto **es crear o elegir el proyecto**: lo pide un
 * check de la base (`(estado = 'aceptado') = (project_id is not null)`) y
 * era la mitad de la gracia — sin eso "aceptado" es un rótulo que no
 * cambia nada.
 *
 * ⚠ Y hay un efecto que la pantalla avisa **antes** de llegar acá: un
 * proyecto más **cambia el reparto de los gastos compartidos**.
 * `participacionesEnFecha()` reparte por `peso_prorrateo` entre los que
 * estaban vivos en la fecha de cada gasto (lo explica largo el
 * encabezado de `20260810000001_proyectos_fechas.sql`), así que uno que
 * nace hoy se lleva su parte de lo que venga de hoy en adelante y le
 * mueve a Beno los balances por proyecto que viene mirando. El balance
 * general no se toca: suma el compartido una sola vez.
 *
 * ⚠ `resuelto_en` no es opcional: hay un check
 * `(estado in ('aceptado','descartado')) = (resuelto_en is not null)` y
 * sin fecha la base rechaza el update entero.
 */
export async function aceptarPresupuesto(
  id: string,
  destino: DestinoAceptacion,
): Promise<ActionResult<ResultadoAceptacion>> {
  const parsedId = uuid.safeParse(id);
  if (!parsedId.success) return fail("Identificador inválido.");

  const parsedDestino = destinoSchema.safeParse(destino);
  if (!parsedDestino.success) {
    return fail(parsedDestino.error.issues[0]?.message ?? "Datos inválidos.");
  }

  const { supabase, userId } = await requireSession();

  const { data: actual } = await supabase
    .from("quotes")
    .select("id, estado, titulo, cliente_nombre")
    .eq("id", parsedId.data)
    .maybeSingle();

  if (!actual) return fail("No se encontró el presupuesto.");
  if (actual.estado === "aceptado" || actual.estado === "descartado") {
    return fail("Este presupuesto ya está resuelto.");
  }

  let projectId: string;
  let creado = false;

  if (parsedDestino.data.modo === "existente") {
    const { data: proyecto } = await supabase
      .from("projects")
      .select("id")
      .eq("id", parsedDestino.data.projectId)
      .maybeSingle();

    if (!proyecto) return fail("No se encontró el proyecto elegido.");
    projectId = proyecto.id;
  } else {
    const slug = await slugDisponible(
      supabase,
      userId,
      parsedDestino.data.nombre,
    );

    const { data: proyecto, error } = await supabase
      .from("projects")
      .insert({
        user_id: userId,
        nombre: parsedDestino.data.nombre,
        slug,
        color: parsedDestino.data.color,
        activo: true,
        peso_prorrateo: 1,
        fecha_inicio: parsedDestino.data.fecha_inicio,
      })
      .select("id")
      .single();

    if (error) return fail(mensajeDeError(error));
    projectId = proyecto.id;
    creado = true;
  }

  const { error } = await supabase
    .from("quotes")
    .update({
      estado: "aceptado",
      project_id: projectId,
      // Sin esto la base rechaza el update: es el error más probable de
      // toda esta pantalla.
      resuelto_en: todayISO(),
      motivo_descarte: null,
      motivo_detalle: null,
    })
    .eq("id", parsedId.data);

  if (error) {
    // Si el proyecto se creó y la aceptación falló, el proyecto queda
    // creado y la pantalla lo dice: borrarlo automáticamente sería
    // adivinar, y un proyecto de más se archiva con un click.
    return fail(mensajeDeError(error));
  }

  revalidatePath("/", "layout");
  return ok({ projectId, creado });
}

const descarteSchema = z.object({
  motivo: z.enum([
    "no_era_lo_que_queria",
    "quedo_desactualizado",
    "no_prospero",
    "otro",
  ]),
  detalle: z.string().trim().max(1000).nullable(),
});

export type DescarteInput = z.infer<typeof descarteSchema>;

/**
 * Descartar con motivo. La fila **no se borra**: los cuatro motivos son
 * lo que después le deja releer por qué se le cayeron los presupuestos, y
 * cada uno apunta a otra cosa — `no_era_lo_que_queria` a la estimación,
 * `quedo_desactualizado` al proceso (se cruza con los días entre enviado y
 * resuelto), `no_prospero` a casi nada.
 */
export async function descartarPresupuesto(
  id: string,
  input: DescarteInput,
): Promise<ActionResult> {
  const parsedId = uuid.safeParse(id);
  if (!parsedId.success) return fail("Identificador inválido.");

  const parsed = descarteSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }

  if (parsed.data.motivo === "otro" && !parsed.data.detalle) {
    return fail("Con «otro» hace falta contar qué pasó: lo que enseña está ahí.");
  }

  const { supabase } = await requireSession();

  const { data: actual } = await supabase
    .from("quotes")
    .select("id, estado")
    .eq("id", parsedId.data)
    .maybeSingle();

  if (!actual) return fail("No se encontró el presupuesto.");
  if (actual.estado === "aceptado" || actual.estado === "descartado") {
    return fail("Este presupuesto ya está resuelto.");
  }

  const { error } = await supabase
    .from("quotes")
    .update({
      estado: "descartado",
      motivo_descarte: parsed.data.motivo,
      motivo_detalle: parsed.data.detalle,
      // Mismo check que en aceptar: los dos estados terminales exigen fecha.
      resuelto_en: todayISO(),
    })
    .eq("id", parsedId.data);

  if (error) return fail(mensajeDeError(error));

  revalidatePath("/", "layout");
  return ok();
}

/** Regla 4: el borrado por defecto es archivado. */
export async function archivarPresupuesto(id: string): Promise<ActionResult> {
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return fail("Identificador inválido.");

  const { supabase } = await requireSession();

  const { error } = await supabase
    .from("quotes")
    .update({ archivado_en: new Date().toISOString() })
    .eq("id", parsed.data);

  if (error) return fail(mensajeDeError(error));

  revalidatePath("/", "layout");
  return ok();
}
