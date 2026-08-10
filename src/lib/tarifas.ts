import "server-only";

import { createHash } from "node:crypto";

import { todayISO } from "@/lib/dates";
import { resolverTasa } from "@/lib/fx";
import type { Database } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@/lib/supabase/server";

/**
 * Tarifas de referencia del mercado (spec de presupuestos, etapa 1).
 *
 * Baja dos fuentes públicas, las valida y guarda el resultado en
 * `rate_references`, con una fila por corrida en `rate_runs`.
 *
 *   · **flamahaus** — un tarifario publicado, scrapeado del `const DATA`
 *     que la página trae en el HTML. Da precio por segmento de cliente.
 *   · **salancy** — la encuesta abierta de sueldos, CSV público. Da
 *     sueldo en relación de dependencia por seniority.
 *
 * Son dos métodos totalmente independientes y por eso valen: la validación
 * cruzada entre un tarifario y una encuesta es lo que le permite a la app
 * decirle a Beno que su tarifa está corrida sin que sea una opinión.
 *
 * **Nada de esto decide nada.** Escribe números de referencia; quién los
 * mira y qué hace con ellos es de otra pieza.
 *
 * ── El punto entero de `rate_runs` es que esto falle ruidoso ──────────
 *
 * Un scraper roto no avisa: sigue devolviendo el precio de hace ocho
 * meses, que se lee igual de convincente que uno bueno. Por eso:
 *
 *   1. **Se valida antes de escribir.** Si una assert falla no entra ni
 *      una fila a `rate_references`; queda la corrida en `error` con el
 *      motivo en castellano y el handler devuelve HTTP 500.
 *   2. **Una corrida sin cambios no escribe referencias.** Si escribiera,
 *      un año serían 52 filas idénticas por clave y el histórico dejaría
 *      de mostrar los saltos, que es lo único que se le pide. Las
 *      corridas quedan igual en `rate_runs`, que es donde se mira si el
 *      cron está vivo.
 *   3. **Un salto grande no se escribe: se marca `sospechoso`.** En
 *      Argentina un +80 % puede ser un aumento real, así que la app no
 *      decide — guarda lo parseado en `rate_runs.crudo` y lo deja para
 *      que Beno acepte o descarte.
 */

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

export type FuenteTarifas = "flamahaus" | "salancy";

/** Los cuatro estados de `rate_runs.estado` (check en la base). */
export type EstadoCorrida = "ok" | "sin_cambios" | "sospechoso" | "error";

export type UnidadReferencia = "hora" | "mes" | "proyecto";

export type Segmento = Database["public"]["Enums"]["tipo_cliente"];

/** Una referencia lista para escribir, antes de tocar la base. */
export interface ReferenciaCalculada {
  clave: string;
  /** `null` en salancy: un sueldo no tiene tipo de cliente. */
  segmento: Segmento | null;
  unidad: UnidadReferencia;
  monto_ars: number;
}

export interface ResultadoFuente {
  fuente: FuenteTarifas;
  estado: EstadoCorrida;
  /** En castellano y entendible: esto se lee el día que algo falló. */
  motivo: string | null;
  filas: number | null;
  huella: string | null;
  marca_origen: string | null;
  /** Cuántas filas quedaron escritas en `rate_references`. */
  referencias: number;
}

export interface ReporteTarifas {
  fecha: string;
  fuentes: ResultadoFuente[];
}

/**
 * Falla de validación de una fuente, con el motivo ya redactado para que
 * lo lea una persona. Se distingue de un `Error` cualquiera solo para no
 * confundir "la fuente cambió" con "se rompió el código".
 */
class ErrorFuente extends Error {}

function asertar(condicion: boolean, motivo: string): asserts condicion {
  if (!condicion) throw new ErrorFuente(motivo);
}

// ------------------------------------------------------------
// Parámetros
// ------------------------------------------------------------

export const FLAMAHAUS_URL = "https://flamahaus.com/tarifarios/";

/**
 * El `id=859` no está inventado: sale del header `Link:` que devuelve la
 * propia página (`rel="alternate"; type="application/json"`). Se deja
 * escrito para no pagar un pedido extra solo para descubrirlo.
 *
 * `content.rendered` viene vacío (la página la arma un page builder), así
 * que este endpoint **no reemplaza al scraping**. Sirve para una sola
 * cosa, y es la que hace accionable la alarma: `modified_gmt` separa
 * "rediseñaron la página" de "se cayó el fetch".
 */
export const FLAMAHAUS_WP_JSON =
  "https://flamahaus.com/wp-json/wp/v2/pages/859";

export const SALANCY_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSUM26bFZJB-LuoeHG9fcw1GNWeK5tDc1F3UVCcw4WotD6otLLP4WAdU5LO__nqx3oKrw8NukHn6TvO/pub?gid=1702330776&single=true&output=csv";

/** Umbral de la assert 9: un salto mayor deja la corrida en `sospechoso`. */
export const SALTO_SOSPECHOSO = 0.6;

const TIMEOUT_MS = 30_000;

const USER_AGENT =
  "Mozilla/5.0 (compatible; PepeBot/1.0; +https://pepe-beno.vercel.app)";

/**
 * Qué filas del tarifario se guardan.
 *
 * No se guardan las 93: la mayoría son de audiovisual, marketing y diseño
 * y no dicen nada sobre lo que cobra Beno. Se guardan los tres servicios
 * por hora del rubro y los cuatro proyectos cerrados que sirven de ancla.
 *
 * Los tres `requerido: true` son las anclas del spec: si flamahaus les
 * cambia el nombre, la corrida falla en vez de guardar de menos en
 * silencio. Los otros cuatro se anotan en el motivo si faltan, porque
 * perder un ancla de proyecto no invalida la corrida.
 */
export const SERVICIOS_FLAMAHAUS: {
  clave: string;
  nombre: string;
  unidad: UnidadReferencia;
  requerido: boolean;
}[] = [
  {
    clave: "desarrollo-web-hora",
    nombre: "Desarrollo Web Frontend / Backend (por hora)",
    unidad: "hora",
    requerido: true,
  },
  {
    clave: "backend-devops-hora",
    nombre: "Programación Backend / DevOps / Cloud (por hora)",
    unidad: "hora",
    requerido: true,
  },
  {
    clave: "apps-moviles-hora",
    nombre: "Desarrollo Aplicaciones Móviles (por hora)",
    unidad: "hora",
    requerido: true,
  },
  {
    clave: "landing",
    nombre: "Diseño y Desarrollo de Landing Page Optimizada",
    unidad: "proyecto",
    requerido: false,
  },
  {
    clave: "app-web-mvp",
    nombre: "Desarrollo Aplicación Web a Medida (MVP)",
    unidad: "proyecto",
    requerido: false,
  },
  {
    clave: "sitio-corporativo",
    nombre: "Desarrollo Sitio Web Corporativo / Institucional",
    unidad: "proyecto",
    requerido: false,
  },
  {
    clave: "mantenimiento-mensual",
    nombre: "Mantenimiento Web/App Mensual",
    unidad: "mes",
    requerido: false,
  },
];

/**
 * Los escalones de salancy que se guardan, con la etiqueta **exacta** del
 * CSV. Los tres requeridos son los que tienen muestra grande; trainee se
 * guarda si llega a `MUESTRA_MINIMA` y si no se omite con motivo.
 */
export const SENIORITY_SALANCY: {
  clave: string;
  etiqueta: string;
  requerido: boolean;
}[] = [
  {
    clave: "salario-trainee",
    etiqueta: "Iniciante / Trainee (hasta 1 año)",
    requerido: false,
  },
  { clave: "salario-junior", etiqueta: "Junior (1 a 3 años)", requerido: true },
  {
    clave: "salario-semi-senior",
    etiqueta: "Semi Senior (3 a 5 años)",
    requerido: true,
  },
  { clave: "salario-senior", etiqueta: "Senior (+5 años)", requerido: true },
];

/**
 * Qué cuenta como "dev" en la encuesta.
 *
 * Se midió que el filtro casi no mueve la mediana: con este regex, con
 * solo Fullstack/Backend/Frontend, o con todas las posiciones de
 * Argentina, la mediana junior da 1.824.000 / 1.815.420 / 1.826.910 —
 * menos de 1 % entre los tres. Que la referencia no dependa de esta
 * decisión es exactamente lo que uno quiere de una referencia.
 */
const POSICION_DEV = /Developer|Engineer|Programador|Desarroll/i;

/** Bajo esta muestra la mediana no se guarda: es ruido con dos decimales. */
const MUESTRA_MINIMA = 30;

const ENCABEZADO_SALANCY = [
  "Marca temporal",
  "Posición",
  "Seniority",
  "Pais de residencia",
  "Moneda",
  "Salario bruto mensual",
];

// ------------------------------------------------------------
// Descarga
// ------------------------------------------------------------

async function bajar(
  url: string,
  accept: string,
): Promise<{ texto: string; contentType: string }> {
  const respuesta = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept, "user-agent": USER_AGENT },
  });

  asertar(
    respuesta.ok,
    `la fuente respondió ${respuesta.status} ${respuesta.statusText}`,
  );

  return {
    texto: await respuesta.text(),
    contentType: respuesta.headers.get("content-type") ?? "",
  };
}

// ------------------------------------------------------------
// flamahaus
// ------------------------------------------------------------

export interface FilaFlamahaus {
  cat: string;
  name: string;
  desc: string;
  /** Empresa (>100 empleados). */
  A: number;
  /** Pyme. */
  B: number;
  /** Particular / emprendedor. */
  C: number;
}

/**
 * Saca las 93 filas del `const DATA = [ … ];` que la página trae en el
 * HTML servido, y las valida.
 *
 * La assert que más vale es la de la escalera. Si mañana flamahaus pasa a
 * `A = 2,5 × C`, el regex sigue andando y devuelve números perfectamente
 * plausibles, pero el mapeo A/B/C → segmento y los multiplicadores por
 * defecto (×1 / ×2 / ×3) se quedan sin el respaldo que los justifica. Es
 * la clase de rotura que un `try/catch` no ve nunca.
 */
export function parsearFlamahaus(html: string): FilaFlamahaus[] {
  const ocurrencias = html.match(/const\s+DATA\s*=\s*\[/g) ?? [];
  asertar(
    ocurrencias.length === 1,
    // Sin conclusión: el motivo dice lo que se vio y el diagnóstico por
    // `modified_gmt` dice qué clase de falla es. Adivinar acá ("cambió la
    // página") contradice al diagnóstico justo cuando no cambió.
    `se esperaba un solo bloque "const DATA = [" en el HTML y hay ${ocurrencias.length}`,
  );

  const bloque = html.match(/const\s+DATA\s*=\s*(\[[\s\S]*?\])\s*;/);
  asertar(
    bloque !== null,
    'no se pudo delimitar el bloque "const DATA = [ … ];" en el HTML',
  );

  let filas: unknown;
  try {
    filas = JSON.parse(bloque[1]);
  } catch (error) {
    throw new ErrorFuente(
      `el bloque DATA no es JSON válido: ${error instanceof Error ? error.message : "error desconocido"}`,
    );
  }

  asertar(Array.isArray(filas), "el bloque DATA no es un array");
  asertar(
    filas.length >= 80,
    `el tarifario trajo ${filas.length} filas y se esperaban al menos 80`,
  );

  const parseadas: FilaFlamahaus[] = [];
  for (const cruda of filas) {
    const fila = cruda as Partial<FilaFlamahaus>;
    asertar(
      typeof fila?.cat === "string" &&
        typeof fila.name === "string" &&
        typeof fila.desc === "string",
      `una fila del tarifario no tiene cat/name/desc: ${JSON.stringify(cruda).slice(0, 160)}`,
    );

    const { A, B, C } = fila as FilaFlamahaus;
    asertar(
      Number.isFinite(A) && Number.isFinite(B) && Number.isFinite(C),
      `"${fila.name}" no tiene precios numéricos (A=${A} B=${B} C=${C})`,
    );
    asertar(
      A > 0 && B > 0 && C > 0,
      `"${fila.name}" tiene algún precio en cero o negativo (A=${A} B=${B} C=${C})`,
    );

    // La escalera, con tolerancia de un peso por el redondeo de la fuente.
    asertar(
      Math.abs(A - 3 * C) <= 1 && Math.abs(B - 2 * C) <= 1,
      `"${fila.name}" rompe la escalera A=3×C / B=2×C (A=${A} B=${B} C=${C}): ` +
        "cambió la lógica de segmentos de la fuente y los multiplicadores por defecto se quedaron sin respaldo",
    );

    parseadas.push({ cat: fila.cat, name: fila.name, desc: fila.desc, A, B, C });
  }

  return parseadas;
}

/**
 * `modified_gmt` de la página, o `null` si el endpoint no contesta.
 *
 * **No falla la corrida**: es un dato de diagnóstico, no de negocio. Se
 * pide antes de parsear justamente para tenerlo cuando el parseo falla,
 * que es cuando sirve.
 */
async function marcaFlamahaus(): Promise<string | null> {
  try {
    const { texto } = await bajar(FLAMAHAUS_WP_JSON, "application/json");
    const json = JSON.parse(texto) as { modified_gmt?: unknown };
    return typeof json.modified_gmt === "string" ? json.modified_gmt : null;
  } catch {
    return null;
  }
}

function referenciasFlamahaus(filas: FilaFlamahaus[]): {
  referencias: ReferenciaCalculada[];
  faltantes: string[];
} {
  const porNombre = new Map(filas.map((f) => [f.name, f]));
  const referencias: ReferenciaCalculada[] = [];
  const faltantes: string[] = [];

  for (const servicio of SERVICIOS_FLAMAHAUS) {
    const fila = porNombre.get(servicio.nombre);

    if (!fila) {
      asertar(
        !servicio.requerido,
        `el tarifario ya no trae "${servicio.nombre}", que es uno de los tres servicios ancla`,
      );
      faltantes.push(servicio.nombre);
      continue;
    }

    // A = empresa, B = pyme, C = particular. Está en el encabezado de la
    // tabla de la fuente y lo confirma la escalera.
    referencias.push(
      {
        clave: servicio.clave,
        segmento: "empresa",
        unidad: servicio.unidad,
        monto_ars: fila.A,
      },
      {
        clave: servicio.clave,
        segmento: "pyme",
        unidad: servicio.unidad,
        monto_ars: fila.B,
      },
      {
        clave: servicio.clave,
        segmento: "particular",
        unidad: servicio.unidad,
        monto_ars: fila.C,
      },
    );
  }

  // El ancla principal, con rango de cordura: un valor fuera de esto no es
  // un aumento, es otra unidad (centavos, dólares o miles).
  const ancla = referencias.find(
    (r) => r.clave === "desarrollo-web-hora" && r.segmento === "particular",
  );
  asertar(
    ancla !== undefined &&
      ancla.monto_ars >= 2_000 &&
      ancla.monto_ars <= 2_000_000,
    `el ancla "desarrollo web por hora / particular" quedó en ${ancla?.monto_ars} ARS/hora, fuera del rango razonable (2.000 a 2.000.000)`,
  );

  return { referencias, faltantes };
}

// ------------------------------------------------------------
// salancy
// ------------------------------------------------------------

/**
 * CSV mínimo pero con comillas: las posiciones de la encuesta traen comas
 * adentro y partir por `,` a secas corre las columnas sin avisar.
 */
export function parsearCSV(texto: string): string[][] {
  const filas: string[][] = [];
  let campo = "";
  let fila: string[] = [];
  let enComillas = false;

  // El CSV de Google Sheets viene con BOM.
  const limpio = texto.replace(/^﻿/, "");

  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];

    if (enComillas) {
      if (c === '"') {
        if (limpio[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          enComillas = false;
        }
      } else {
        campo += c;
      }
      continue;
    }

    if (c === '"') enComillas = true;
    else if (c === ",") {
      fila.push(campo);
      campo = "";
    } else if (c === "\n") {
      fila.push(campo);
      campo = "";
      filas.push(fila);
      fila = [];
    } else if (c !== "\r") campo += c;
  }

  if (campo !== "" || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }

  return filas;
}

export interface RespuestaSalancy {
  marca: string;
  posicion: string;
  seniority: string;
  pais: string;
  moneda: string;
  bruto: number;
}

export function parsearSalancy(csv: string): RespuestaSalancy[] {
  const filas = parsearCSV(csv);
  asertar(filas.length > 1, "el CSV vino vacío");

  const encabezado = filas[0].map((c) => c.trim());
  asertar(
    encabezado.length === ENCABEZADO_SALANCY.length &&
      encabezado.every((c, i) => c === ENCABEZADO_SALANCY[i]),
    `el encabezado del CSV cambió: se esperaba "${ENCABEZADO_SALANCY.join(", ")}" y llegó "${encabezado.join(", ")}"`,
  );

  const cuerpo = filas
    .slice(1)
    .filter((f) => f.length === ENCABEZADO_SALANCY.length);

  asertar(
    cuerpo.length >= 1500,
    `la encuesta trajo ${cuerpo.length} respuestas y se esperaban al menos 1500`,
  );

  const respuestas = cuerpo.map((f) => ({
    marca: f[0].trim(),
    posicion: f[1].trim(),
    seniority: f[2].trim(),
    pais: f[3].trim(),
    moneda: f[4].trim(),
    bruto: Number(f[5]),
  }));

  const monedas = [...new Set(respuestas.map((r) => r.moneda))].sort();
  asertar(
    monedas.every((m) => m === "ARS" || m === "USD"),
    // Si aparece una moneda nueva la conversión no está definida, y una
    // mediana sobre unidades mezcladas es un número sin significado que
    // igual se ve razonable. Ese es el peor caso posible.
    `aparecieron monedas que no se saben convertir: ${monedas.join(", ")}`,
  );

  const argentina = respuestas.filter((r) => r.pais === "Argentina");
  asertar(
    argentina.length >= 1000,
    `solo ${argentina.length} respuestas de Argentina y se esperaban al menos 1000`,
  );

  return respuestas;
}

/** Mediana, con la convención habitual del promedio de los dos del medio. */
export function mediana(valores: number[]): number {
  const ordenados = [...valores].sort((a, b) => a - b);
  const n = ordenados.length;
  if (n === 0) return 0;
  return n % 2 === 1
    ? ordenados[(n - 1) / 2]
    : (ordenados[n / 2 - 1] + ordenados[n / 2]) / 2;
}

/** "12/01/2026 21:37:39" → "2026-01-12". Devuelve null si no matchea. */
function fechaDeMarca(marca: string): string | null {
  const m = marca.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function referenciasSalancy(
  respuestas: RespuestaSalancy[],
  tasa: number,
): { referencias: ReferenciaCalculada[]; omitidos: string[] } {
  const devsArgentinos = respuestas.filter(
    (r) =>
      r.pais === "Argentina" &&
      POSICION_DEV.test(r.posicion) &&
      Number.isFinite(r.bruto) &&
      r.bruto > 0,
  );

  const referencias: ReferenciaCalculada[] = [];
  const omitidos: string[] = [];

  for (const escalon of SENIORITY_SALANCY) {
    const brutos = devsArgentinos
      .filter((r) => r.seniority === escalon.etiqueta)
      // Se convierte con la cotización de la base, no con un número
      // clavado: se midió que mover el dólar ±18 % mueve la mediana
      // solo ±4 %, así que la referencia no depende de la elección.
      .map((r) => (r.moneda === "USD" ? r.bruto * tasa : r.bruto));

    if (brutos.length < MUESTRA_MINIMA) {
      asertar(
        !escalon.requerido,
        `"${escalon.etiqueta}" quedó con ${brutos.length} respuestas y hacen falta ${MUESTRA_MINIMA}`,
      );
      omitidos.push(`${escalon.etiqueta} (n=${brutos.length})`);
      continue;
    }

    referencias.push({
      clave: escalon.clave,
      // Un sueldo en relación de dependencia no tiene tipo de cliente.
      segmento: null,
      unidad: "mes",
      monto_ars: Math.round(mediana(brutos) * 100) / 100,
    });
  }

  asertar(
    referencias.length > 0,
    "ningún escalón de seniority llegó a la muestra mínima",
  );

  return { referencias, omitidos };
}

// ------------------------------------------------------------
// Comparación con lo vigente
// ------------------------------------------------------------

function claveDe(r: { clave: string; segmento: Segmento | null }): string {
  return `${r.clave}|${r.segmento ?? ""}`;
}

/** sha256 de las referencias, canonicalizado y estable entre corridas. */
export function huellaDe(referencias: ReferenciaCalculada[]): string {
  const canonico = [...referencias]
    .map((r) => `${claveDe(r)}|${r.unidad}|${r.monto_ars.toFixed(2)}`)
    .sort()
    .join("\n");

  return createHash("sha256").update(canonico).digest("hex");
}

interface Comparacion {
  sinCambios: boolean;
  saltos: string[];
}

function comparar(
  nuevas: ReferenciaCalculada[],
  vigentes: Map<string, number>,
): Comparacion {
  const saltos: string[] = [];
  let sinCambios = nuevas.length === vigentes.size;

  for (const nueva of nuevas) {
    const anterior = vigentes.get(claveDe(nueva));

    if (anterior === undefined) {
      sinCambios = false;
      continue;
    }

    if (Math.abs(nueva.monto_ars - anterior) >= 0.01) sinCambios = false;

    const salto = (nueva.monto_ars - anterior) / anterior;
    if (Math.abs(salto) > SALTO_SOSPECHOSO) {
      saltos.push(
        `${claveDe(nueva)}: ${anterior} → ${nueva.monto_ars} (${(salto * 100).toFixed(1)} %)`,
      );
    }
  }

  return { sinCambios, saltos };
}

/**
 * Las referencias vigentes **antes de hoy**, por clave y segmento.
 *
 * "Vigente para una fecha es la última fila con `fecha <= X`", el mismo
 * criterio de `fx_rate_for_date`. Se excluye la fecha de la corrida a
 * propósito: así volver a correr el cron el mismo día compara contra lo
 * que estaba vigente al entrar al día y no contra lo que escribió la
 * corrida anterior, que daría "sin cambios" siempre.
 */
async function vigentesAntesDe(
  supabase: SupabaseClient,
  fuente: FuenteTarifas,
  fecha: string,
): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("rate_references")
    .select("clave, segmento, monto_ars, fecha")
    .eq("fuente", fuente)
    .lt("fecha", fecha)
    .order("fecha", { ascending: false });

  if (error) throw new Error(error.message);

  const vigentes = new Map<string, number>();
  for (const fila of data ?? []) {
    const clave = claveDe(fila);
    // Vienen ordenadas por fecha descendente: la primera de cada clave
    // es la vigente y las siguientes son histórico.
    if (!vigentes.has(clave)) vigentes.set(clave, Number(fila.monto_ars));
  }

  return vigentes;
}

// ------------------------------------------------------------
// Una fuente, de punta a punta
// ------------------------------------------------------------

async function escribirCorrida(
  supabase: SupabaseClient,
  fila: {
    fuente: FuenteTarifas;
    fecha: string;
    estado: EstadoCorrida;
    motivo: string | null;
    filas: number | null;
    huella: string | null;
    marca_origen: string | null;
    crudo: unknown;
  },
): Promise<void> {
  const { error } = await supabase.from("rate_runs").upsert(
    {
      ...fila,
      crudo: (fila.crudo ?? null) as Database["public"]["Tables"]["rate_runs"]["Insert"]["crudo"],
      corrido_en: new Date().toISOString(),
    },
    { onConflict: "fuente,fecha" },
  );

  if (error) throw new Error(error.message);
}

async function escribirReferencias(
  supabase: SupabaseClient,
  fuente: FuenteTarifas,
  fecha: string,
  referencias: ReferenciaCalculada[],
): Promise<number> {
  // Se borra antes de insertar en vez de hacer upsert sobre el único
  // `(fuente, fecha, clave, segmento)`: en Postgres dos NULL no colisionan,
  // así que las filas de salancy —que van con `segmento` nulo— se
  // duplicarían en cada corrida repetida del mismo día. Borrar y volver a
  // escribir la corrida del día es idempotente sin depender de eso.
  const { error: errorBorrado } = await supabase
    .from("rate_references")
    .delete()
    .eq("fuente", fuente)
    .eq("fecha", fecha);

  if (errorBorrado) throw new Error(errorBorrado.message);

  const { data, error } = await supabase
    .from("rate_references")
    .insert(referencias.map((r) => ({ ...r, fuente, fecha })))
    .select("id");

  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/**
 * El diagnóstico que hace accionable la alarma.
 *
 * Cuando el parseo de flamahaus falla, el mensaje no puede ser "falló el
 * parser": eso es lo que dice cualquier scraper roto y no se puede
 * priorizar. Comparando `modified_gmt` contra el de la última corrida
 * buena, el aviso ya trae la primera mitad del diagnóstico.
 */
async function diagnosticoFlamahaus(
  supabase: SupabaseClient,
  marcaHoy: string | null,
): Promise<string> {
  if (!marcaHoy) {
    return "Además, el endpoint wp-json no contestó: mirá la red antes que el regex.";
  }

  const { data } = await supabase
    .from("rate_runs")
    .select("fecha, marca_origen")
    .eq("fuente", "flamahaus")
    .in("estado", ["ok", "sin_cambios"])
    .not("marca_origen", "is", null)
    .order("fecha", { ascending: false })
    .limit(1);

  const anterior = data?.[0]?.marca_origen ?? null;

  if (!anterior) {
    return `No hay corrida buena anterior con la que comparar; modified_gmt de hoy: ${marcaHoy}.`;
  }

  return anterior === marcaHoy
    ? `modified_gmt sigue en ${marcaHoy}: la página no cambió, así que mirá la red (fetch caído, theme movido o WAF nuevo) antes que el regex.`
    : `modified_gmt cambió (${anterior} → ${marcaHoy}): tocaron la página, hay que arreglar el parser contra el HTML nuevo.`;
}

async function correrFlamahaus(
  supabase: SupabaseClient,
  fecha: string,
): Promise<ResultadoFuente> {
  // Primero la marca: cuando el parseo falla, es el dato que dice qué
  // clase de falla es.
  const marca = await marcaFlamahaus();

  try {
    const { texto, contentType } = await bajar(FLAMAHAUS_URL, "text/html");
    asertar(
      contentType.includes("text/html"),
      `el tarifario devolvió content-type "${contentType}" en vez de text/html`,
    );

    const filas = parsearFlamahaus(texto);
    const { referencias, faltantes } = referenciasFlamahaus(filas);

    return await resolverYEscribir(supabase, "flamahaus", fecha, {
      referencias,
      filas: filas.length,
      marca,
      nota:
        faltantes.length > 0
          ? `Faltaron servicios opcionales: ${faltantes.join("; ")}.`
          : null,
    });
  } catch (error) {
    const motivo = mensaje(error);
    const diagnostico =
      error instanceof ErrorFuente
        ? `. ${await diagnosticoFlamahaus(supabase, marca)}`
        : "";

    await escribirCorrida(supabase, {
      fuente: "flamahaus",
      fecha,
      estado: "error",
      motivo: `${motivo}${diagnostico}`,
      filas: null,
      huella: null,
      marca_origen: marca,
      crudo: null,
    });

    return {
      fuente: "flamahaus",
      estado: "error",
      motivo: `${motivo}${diagnostico}`,
      filas: null,
      huella: null,
      marca_origen: marca,
      referencias: 0,
    };
  }
}

async function correrSalancy(
  supabase: SupabaseClient,
  fecha: string,
): Promise<ResultadoFuente> {
  let marca: string | null = null;

  try {
    const { texto, contentType } = await bajar(SALANCY_CSV_URL, "text/csv");
    asertar(
      contentType.includes("text/csv"),
      `la encuesta devolvió content-type "${contentType}" en vez de text/csv`,
    );

    const respuestas = parsearSalancy(texto);

    // La marca de origen es la respuesta más nueva de la encuesta, que no
    // es la fecha de la corrida: salancy es una encuesta de enero que
    // probablemente no se actualice nunca, y eso no es un error. Mezclar
    // las dos fechas es cómo se termina confiando en un número viejo.
    const fechas = respuestas
      .map((r) => fechaDeMarca(r.marca))
      .filter((f): f is string => f !== null);
    marca = fechas.length > 0 ? fechas.reduce((a, b) => (a > b ? a : b)) : null;

    // La cotización sale de la propia base (el Oficial BNA que guarda
    // /api/cron/fx), no de una constante en el código.
    const { data: rates, error } = await supabase
      .from("fx_rates")
      .select("fecha, venta")
      .lte("fecha", fecha)
      .order("fecha", { ascending: true });

    if (error) throw new Error(error.message);

    const tasa = resolverTasa(rates ?? [], fecha);
    asertar(
      tasa !== null && tasa.valor > 0,
      "no hay ninguna cotización en fx_rates con la que convertir los sueldos en dólares",
    );

    const { referencias, omitidos } = referenciasSalancy(
      respuestas,
      tasa.valor,
    );

    return await resolverYEscribir(supabase, "salancy", fecha, {
      referencias,
      filas: respuestas.length,
      marca,
      nota: [
        `Dólar ${tasa.valor} del ${tasa.fecha}.`,
        omitidos.length > 0 ? `Sin muestra: ${omitidos.join("; ")}.` : null,
      ]
        .filter(Boolean)
        .join(" "),
    });
  } catch (error) {
    const motivo = mensaje(error);

    await escribirCorrida(supabase, {
      fuente: "salancy",
      fecha,
      estado: "error",
      motivo,
      filas: null,
      huella: null,
      marca_origen: marca,
      crudo: null,
    });

    return {
      fuente: "salancy",
      estado: "error",
      motivo,
      filas: null,
      huella: null,
      marca_origen: marca,
      referencias: 0,
    };
  }
}

/**
 * El tramo común: comparar con lo vigente, decidir el estado y recién ahí
 * escribir. Nunca se escribe una referencia antes de esta función.
 */
async function resolverYEscribir(
  supabase: SupabaseClient,
  fuente: FuenteTarifas,
  fecha: string,
  datos: {
    referencias: ReferenciaCalculada[];
    filas: number;
    marca: string | null;
    nota: string | null;
  },
): Promise<ResultadoFuente> {
  const huella = huellaDe(datos.referencias);
  const vigentes = await vigentesAntesDe(supabase, fuente, fecha);
  const { sinCambios, saltos } = comparar(datos.referencias, vigentes);

  let estado: EstadoCorrida = "ok";
  let motivo = datos.nota;
  let crudo: unknown = null;
  let escritas = 0;

  if (sinCambios) {
    estado = "sin_cambios";
    motivo = [
      `Las ${datos.referencias.length} referencias vinieron iguales a las vigentes; no se escribió ninguna fila.`,
      datos.nota,
    ]
      .filter(Boolean)
      .join(" ");
  } else if (saltos.length > 0) {
    // No se escribe nada. Un salto grande puede ser un aumento real, así
    // que la app no decide: guarda lo parseado y lo deja para que Beno
    // acepte o descarte la corrida.
    estado = "sospechoso";
    motivo = `Salto de más de ${SALTO_SOSPECHOSO * 100} % contra la referencia anterior: ${saltos.join(" · ")}. No se escribió ninguna referencia.`;
    crudo = { referencias: datos.referencias };
  } else {
    escritas = await escribirReferencias(
      supabase,
      fuente,
      fecha,
      datos.referencias,
    );
  }

  await escribirCorrida(supabase, {
    fuente,
    fecha,
    estado,
    motivo: motivo || null,
    filas: datos.filas,
    huella,
    marca_origen: datos.marca,
    crudo,
  });

  return {
    fuente,
    estado,
    motivo: motivo || null,
    filas: datos.filas,
    huella,
    marca_origen: datos.marca,
    referencias: escritas,
  };
}

function mensaje(error: unknown): string {
  return error instanceof Error ? error.message : "error desconocido";
}

// ------------------------------------------------------------
// Entrada
// ------------------------------------------------------------

/**
 * Corre las dos fuentes. **Una fuente caída no puede tumbar a la otra**:
 * cada una se resuelve por separado y deja su propia fila en `rate_runs`.
 */
export async function actualizarTarifas(
  supabase: SupabaseClient,
  fecha: string = todayISO(),
): Promise<ReporteTarifas> {
  const fuentes = await Promise.all([
    correrFlamahaus(supabase, fecha),
    correrSalancy(supabase, fecha),
  ]);

  return { fecha, fuentes };
}
