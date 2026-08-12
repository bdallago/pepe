import "server-only";

import {
  calcularAvisoTarifa,
  type AvisoTarifa,
  type CorridaVigente,
  type RateReference,
} from "@/lib/avisos-tarifa";
import { todayISO } from "@/lib/dates";
import { getTasaParaFecha } from "@/lib/fx-server";
import {
  HORAS_POR_SEMANA_POR_DEFECTO,
  MULTIPLICADORES_POR_DEFECTO,
  type Multiplicadores,
} from "@/lib/presupuestos";
import type { QuoteParaConversion } from "@/lib/presupuestos/conversion";
import { createClient } from "@/lib/supabase/server";
import type { Database, Moneda } from "@/lib/supabase/database.types";

/**
 * Lecturas del módulo de presupuestos.
 *
 * Va aparte de `presupuestos.ts` por el mismo motivo por el que `fx.ts` y
 * `fx-server.ts` son dos archivos: el cálculo tiene que poder importarse
 * desde el formulario (componente cliente) y desde un MCP, y `server-only`
 * lo haría imposible. Acá adentro va todo lo que toca la base.
 */

export type Quote = Database["public"]["Tables"]["quotes"]["Row"];
export type QuoteItem = Database["public"]["Tables"]["quote_items"]["Row"];
export type QuoteTexto =
  Database["public"]["Tables"]["quote_assumptions"]["Row"];
export type EstadoPresupuesto =
  Database["public"]["Enums"]["estado_presupuesto"];
export type MotivoDescarte = Database["public"]["Enums"]["motivo_descarte"];

/**
 * Lo que hace falta de `settings` para armar un presupuesto, con los
 * defaults ya resueltos.
 *
 * `tarifa_hora` se queda en `null` a propósito cuando no está cargada: la
 * pantalla la pide antes que nada en vez de inventar un valor y que Beno
 * cotice con él sin darse cuenta.
 */
export interface AjustesPresupuesto {
  tarifa_hora: number | null;
  tarifa_moneda: Moneda;
  multiplicadores: Multiplicadores;
  horas_por_semana: number;
  servicio_referencia: string;
  seniority_referencia: string;
  emisor_nombre: string | null;
  emisor_contacto: string | null;
  condiciones_default: string | null;
}

export const AJUSTES_POR_DEFECTO: AjustesPresupuesto = {
  tarifa_hora: null,
  tarifa_moneda: "ARS",
  multiplicadores: MULTIPLICADORES_POR_DEFECTO,
  horas_por_semana: HORAS_POR_SEMANA_POR_DEFECTO,
  servicio_referencia: "desarrollo-web-hora",
  seniority_referencia: "junior",
  emisor_nombre: null,
  emisor_contacto: null,
  condiciones_default: null,
};

export async function getAjustesPresupuesto(): Promise<AjustesPresupuesto> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("settings")
    .select(
      "tarifa_hora, tarifa_moneda, multiplicador_particular, multiplicador_pyme, multiplicador_empresa, horas_por_semana, servicio_referencia, seniority_referencia, emisor_nombre, emisor_contacto, condiciones_default",
    )
    .maybeSingle();

  // Sin fila de settings se usan los defaults: la fila se crea al vuelo la
  // primera vez que se guarda algo, igual que con el umbral de zombies.
  if (!data) return AJUSTES_POR_DEFECTO;

  return {
    tarifa_hora: data.tarifa_hora === null ? null : Number(data.tarifa_hora),
    tarifa_moneda: data.tarifa_moneda,
    multiplicadores: {
      particular: Number(data.multiplicador_particular),
      pyme: Number(data.multiplicador_pyme),
      empresa: Number(data.multiplicador_empresa),
    },
    horas_por_semana: Number(data.horas_por_semana),
    servicio_referencia: data.servicio_referencia,
    seniority_referencia: data.seniority_referencia,
    emisor_nombre: data.emisor_nombre,
    emisor_contacto: data.emisor_contacto,
    condiciones_default: data.condiciones_default,
  };
}

/**
 * El aviso de tarifa desfasada, con las dos fuentes ya resueltas.
 *
 * Se lee todo `rate_references` (son unas pocas decenas de filas por año:
 * el cron solo escribe cuando algo cambia) y la elección de la vigente se
 * hace en `calcularAvisoTarifa`, que es puro y por lo tanto testeable.
 */
export async function getAvisoTarifa(
  ajustes?: AjustesPresupuesto,
): Promise<AvisoTarifa> {
  const supabase = await createClient();
  const hoy = todayISO();

  const config = ajustes ?? (await getAjustesPresupuesto());

  const [referenciasResult, corridasResult] = await Promise.all([
    supabase
      .from("rate_references")
      .select("*")
      .order("fecha", { ascending: true }),
    supabase
      .from("rate_runs")
      .select("fuente, fecha, estado")
      .in("estado", ["ok", "sin_cambios"])
      .order("fecha", { ascending: false }),
  ]);

  const referencias: RateReference[] = referenciasResult.data ?? [];

  // La primera de cada fuente, que por el orden descendente es la última
  // corrida buena. Es lo que decide si una fuente está vencida.
  const corridas: CorridaVigente[] = [];
  for (const fila of corridasResult.data ?? []) {
    if (corridas.some((c) => c.fuente === fila.fuente)) continue;
    corridas.push({ fuente: fila.fuente, fecha: fila.fecha });
  }

  const tasa =
    config.tarifa_moneda === "ARS"
      ? null
      : ((await getTasaParaFecha(hoy))?.valor ?? null);

  return calcularAvisoTarifa({
    tarifa_hora: config.tarifa_hora,
    tarifa_moneda: config.tarifa_moneda,
    multiplicadores: config.multiplicadores,
    servicio_referencia: config.servicio_referencia,
    seniority_referencia: config.seniority_referencia,
    referencias,
    corridas,
    hoy,
    tasa,
  });
}

/**
 * La lista. Los archivados quedan afuera (regla 4) y el orden es por
 * número descendente: el último presupuesto es el que se está mirando.
 */
export async function getPresupuestos(): Promise<Quote[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("quotes")
    .select("*")
    .is("archivado_en", null)
    .order("numero", { ascending: false });

  return data ?? [];
}

/**
 * Las filas que alimentan la tabla de conversión.
 *
 * ⚠ **Esta es la única lectura del módulo que NO filtra `archivado_en`**,
 * y la diferencia con `getPresupuestos()` de arriba es deliberada: la
 * lista es la interfaz y los archivados la ensucian, pero la conversión
 * es una lectura histórica y sacarlos le subiría la tasa de aceptación
 * cada vez que Beno ordena la pantalla. El motivo está desarrollado en
 * el encabezado de `presupuestos/conversion.ts`.
 *
 * Se piden las nueve columnas que usa el cálculo y no `*`: así se ve de
 * un vistazo que el panel no toca ni el pedido ni el texto del
 * presupuesto.
 */
export async function getPresupuestosParaConversion(): Promise<
  QuoteParaConversion[]
> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("quotes")
    .select(
      "id, estado, cliente_tipo, moneda, total_origen, enviado_en, resuelto_en, motivo_descarte, reemplaza_a",
    );

  return data ?? [];
}

export interface PresupuestoCompleto {
  quote: Quote;
  items: QuoteItem[];
  supuestos: QuoteTexto[];
  preguntas: QuoteTexto[];
}

export async function getPresupuesto(
  id: string,
): Promise<PresupuestoCompleto | null> {
  const supabase = await createClient();

  const { data: quote } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!quote) return null;

  const [items, supuestos, preguntas] = await Promise.all([
    supabase
      .from("quote_items")
      .select("*")
      .eq("quote_id", id)
      .order("orden", { ascending: true }),
    supabase
      .from("quote_assumptions")
      .select("*")
      .eq("quote_id", id)
      .order("orden", { ascending: true }),
    supabase
      .from("quote_questions")
      .select("*")
      .eq("quote_id", id)
      .order("orden", { ascending: true }),
  ]);

  return {
    quote,
    items: items.data ?? [],
    supuestos: supuestos.data ?? [],
    preguntas: preguntas.data ?? [],
  };
}
