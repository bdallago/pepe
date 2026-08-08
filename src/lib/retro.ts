import "server-only";

import { z } from "zod";

import {
  calcularBalancesProyecto,
  type Balances,
} from "@/lib/balances";
import { todayISO } from "@/lib/dates";
import { MODELO_GRANDE, completarJSON } from "@/lib/llm";
import type { SupabaseClient } from "@/lib/supabase/server";
import type {
  CategoriaLeccion,
  Movement,
} from "@/lib/supabase/database.types";

/**
 * Retro por proyecto, a demanda (spec 6.5).
 *
 * Beno pide *"cerrá Gentius"* y el modelo devuelve un borrador de retro:
 * qué funcionó, qué no, cuánto costó realmente, y una lista de lecciones
 * candidatas.
 *
 * Las dos mitades siguen caminos distintos, y eso es deliberado:
 *
 * - **Las lecciones van a `inbox` como tipo `retro`** y se confirman una
 *   por una en la bandeja, como todo lo demás. Salen con
 *   `origen = 'retro'`.
 * - **El texto se devuelve y no se guarda.** Es un borrador para leer en
 *   pantalla; recién si Beno aprieta "Guardar" pasa a la tabla `retros`
 *   (`lib/actions/retros.ts`). Una retro es un documento que se relee
 *   dentro de un año: no puede aparecer en la base porque alguien apretó
 *   un botón de generar.
 *
 * El balance se congela en la fila de `retros` al guardar, con el mismo
 * criterio que los montos de `movements`: la retro dice lo que costó
 * **cuando se cerró el proyecto**. Recalcularlo después con los
 * movimientos de hoy cambiaría el sentido de un texto ya aprobado.
 *
 * Es la llamada más pesada de la app: modelo grande, mucho contexto y
 * `maxDuration` alto en el route handler.
 */

type Cliente = SupabaseClient;

/** Cuántas lecciones candidatas se le piden como máximo. */
const CUANTAS_LECCIONES = 6;

/** Techo de movimientos que entran al prompt, del más reciente atrás. */
const MOVIMIENTOS_EN_CONTEXTO = 120;

/** Techo de entradas de bitácora que entran al prompt. */
const ENTRADAS_EN_CONTEXTO = 40;

/** Recorte de cada entrada de bitácora. Las hay muy largas. */
const CHARS_POR_ENTRADA = 800;

const CATEGORIAS = [
  "tecnica",
  "producto",
  "comercial",
  "proceso",
  "personal",
] as const satisfies readonly CategoriaLeccion[];

const respuestaSchema = z.object({
  titulo: z.string().trim().min(1).max(120),
  que_funciono: z.string().trim().max(3000),
  que_no_funciono: z.string().trim().max(3000),
  costo_real: z.string().trim().max(3000),
  conclusion: z.string().trim().max(3000),
  lecciones: z
    .array(
      z.object({
        titulo: z.string().trim().min(1).max(120),
        contenido: z.string().trim().min(1).max(2000),
        categoria: z.enum(CATEGORIAS),
      }),
    )
    .max(CUANTAS_LECCIONES),
});

export type BorradorRetro = Omit<z.infer<typeof respuestaSchema>, "lecciones">;

const SISTEMA = `Sos quien redacta la retrospectiva de cierre de un proyecto para la persona que lo hizo sola.

Te dan todo el contexto real: los movimientos de plata del proyecto (ingresos, egresos, categorías, fechas), las lecciones que ya anotó y sus entradas de bitácora.

Escribís cuatro secciones y una lista de lecciones candidatas.

Reglas:

1. **Todo lo que afirmes tiene que apoyarse en los datos que te di.** No inventes hechos, cifras, clientes ni decisiones que no aparezcan. Si algo no está, no lo digas.
2. Los números ya los tiene calculados en la app y te los paso. En "costo_real" NO repitas la tabla: interpretá. Adónde se fue la plata de verdad, qué salió más caro de lo que parecía, qué gasto era chico pero constante.
3. Nada de tono corporativo ni de informe. Es una nota para uno mismo dentro de un año.
4. Si algo salió mal, decilo derecho. Una retro que no dice qué no funcionó no sirve.
5. Las lecciones candidatas tienen que ser generalizables a otro proyecto. Lo que sirve una sola vez es historia, no lección. Si no hay ninguna que valga, devolvé la lista vacía.
6. **El título de cada lección es una AFIRMACIÓN DISCUTIBLE, no un rótulo.** "Invertir en herramientas de calidad" y "Diversificar los ingresos" no son lecciones: son frases que valen para cualquier proyecto y por eso no valen para ninguno. Tienen que decir algo con lo que alguien podría no estar de acuerdo, y apoyarse en lo que pasó en ESTE proyecto. Por ejemplo: "El 80% de la facturación en dos clientes te deja sin margen para decir que no".

Categorías de lección posibles:
- "tecnica": código, arquitectura, herramientas, infraestructura.
- "producto": qué construir, alcance, usuarios, prioridades.
- "comercial": precios, clientes, ventas, cobranza.
- "proceso": cómo trabajar, método, organización, estimaciones.
- "personal": energía, foco, hábitos, cómo trabaja uno mismo.

Escribí en español rioplatense, sin emojis y sin muletillas de asistente.

Respondé SOLO un objeto JSON con esta forma exacta:
{
  "titulo": string (máx 80 caracteres),
  "que_funciono": string (2 a 5 oraciones),
  "que_no_funciono": string (2 a 5 oraciones),
  "costo_real": string (2 a 5 oraciones),
  "conclusion": string (2 a 4 oraciones),
  "lecciones": [
    {
      "titulo": string (máx 80 caracteres, afirmativo y concreto),
      "contenido": string (2 a 5 oraciones),
      "categoria": una de "tecnica" | "producto" | "comercial" | "proceso" | "personal"
    }
  ]
}`;

/** Lo que queda en `inbox.payload` para una lección salida de una retro. */
export interface PayloadLeccionRetro {
  titulo: string;
  contenido: string;
  categoria: CategoriaLeccion;
  fecha: string;
  project_id: string;
  /** Para saber en la bandeja de qué retro salió. */
  retro_titulo: string;
  modelo: string;
}

export interface ResultadoRetro {
  borrador: BorradorRetro;
  /** Cuántas lecciones candidatas quedaron esperando en la bandeja. */
  leccionesPropuestas: number;
  /** Las que ya estaban propuestas y chocaron contra el dedupe. */
  leccionesRepetidas: number;
  /** Balance del proyecto al momento de generar, para congelar al guardar. */
  balanceArs: number;
  balanceUsd: number;
}

/**
 * Genera la retro de un proyecto.
 *
 * Lanza `ErrorLLM` si el modelo falla. El proyecto y sus datos quedan
 * intactos: no hay nada a medio escribir que limpiar.
 */
export async function generarRetro(
  supabase: Cliente,
  userId: string,
  projectId: string,
): Promise<ResultadoRetro> {
  const [proyectosRes, categoriasRes, movimientosRes, leccionesRes, bitacoraRes] =
    await Promise.all([
      supabase.from("projects").select("*"),
      supabase.from("categories").select("*"),
      supabase
        .from("movements")
        .select("*")
        .order("fecha", { ascending: true })
        .limit(20000),
      supabase
        .from("lessons")
        .select("titulo, contenido, categoria, fecha")
        .eq("project_id", projectId)
        .order("fecha", { ascending: true })
        .limit(100),
      supabase
        .from("daily_log")
        .select("fecha, contenido")
        .eq("project_id", projectId)
        .order("fecha", { ascending: true })
        .limit(500),
    ]);

  const proyectos = proyectosRes.data ?? [];
  const proyecto = proyectos.find((p) => p.id === projectId);
  if (!proyecto) throw new Error("No encontré ese proyecto.");

  const categorias = categoriasRes.data ?? [];
  const movimientos = (movimientosRes.data ?? []) as Movement[];

  // El balance sale del mismo cálculo que usa la pantalla del proyecto,
  // prorrateo incluido: si acá se sumara distinto, la retro contaría una
  // plata que no coincide con la que Beno ve al lado.
  const filtros = { estado: "ambos" as const };
  const enArs = calcularBalancesProyecto(
    movimientos,
    proyectos,
    categorias,
    projectId,
    "ARS",
    filtros,
  );
  const enUsd = calcularBalancesProyecto(
    movimientos,
    proyectos,
    categorias,
    projectId,
    "USD",
    filtros,
  );

  const usuario = armarContexto({
    nombre: proyecto.nombre,
    balances: enArs,
    balancesUsd: enUsd,
    movimientos: movimientos.filter((m) => m.project_id === projectId),
    categorias: new Map(categorias.map((c) => [c.id, c.nombre])),
    lecciones: leccionesRes.data ?? [],
    bitacora: bitacoraRes.data ?? [],
  });

  const { datos, uso } = await completarJSON({
    modelo: MODELO_GRANDE,
    sistema: SISTEMA,
    usuario,
    esquema: respuestaSchema,
    etiqueta: "retro-proyecto",
    temperatura: 0.4,
    maxTokens: 3000,
    // Es la llamada más pesada: mucho contexto de entrada y una salida
    // larga. El timeout por defecto se le queda corto.
    timeoutMs: 180_000,
  });

  const fecha = todayISO();
  let propuestas = 0;
  let repetidas = 0;

  for (const leccion of datos.lecciones) {
    const payload: PayloadLeccionRetro = {
      titulo: leccion.titulo,
      contenido: leccion.contenido,
      categoria: leccion.categoria,
      fecha,
      project_id: projectId,
      retro_titulo: datos.titulo,
      modelo: uso.modelo,
    };

    const { error } = await supabase.from("inbox").insert({
      user_id: userId,
      tipo: "retro",
      estado: "pendiente",
      entidad_tabla: "projects",
      entidad_id: projectId,
      clave_dedupe: `retro:${projectId}:${normalizar(leccion.titulo)}`,
      payload: { ...payload },
    });

    if (error && error.code !== "23505") throw new Error(error.message);
    if (error) repetidas++;
    else propuestas++;
  }

  return {
    borrador: {
      titulo: datos.titulo,
      que_funciono: datos.que_funciono,
      que_no_funciono: datos.que_no_funciono,
      costo_real: datos.costo_real,
      conclusion: datos.conclusion,
    },
    leccionesPropuestas: propuestas,
    leccionesRepetidas: repetidas,
    balanceArs: enArs.proyectado.balance,
    balanceUsd: enUsd.proyectado.balance,
  };
}

interface ContextoRetro {
  nombre: string;
  balances: Balances;
  balancesUsd: Balances;
  movimientos: Movement[];
  categorias: Map<string, string>;
  lecciones: {
    titulo: string;
    contenido: string;
    categoria: string;
    fecha: string;
  }[];
  bitacora: { fecha: string; contenido: string }[];
}

/**
 * Contexto en texto plano.
 *
 * Los agregados van calculados y arriba; el detalle, recortado y abajo.
 * Un modelo sumando cien montos a mano se equivoca, y acá los números ya
 * están bien calculados del lado nuestro.
 */
function armarContexto({
  nombre,
  balances,
  balancesUsd,
  movimientos,
  categorias,
  lecciones,
  bitacora,
}: ContextoRetro): string {
  const partes: string[] = [`Proyecto: ${nombre}`];

  const fechas = movimientos.map((m) => m.fecha).sort();
  if (fechas.length > 0) {
    partes.push(`Duración: del ${fechas[0]} al ${fechas[fechas.length - 1]}.`);
  }

  partes.push(
    [
      "Plata (incluye la parte prorrateada de los gastos compartidos):",
      `- Ingresos: ${miles(balances.proyectado.ingresos)} ARS / ${miles(balancesUsd.proyectado.ingresos)} USD`,
      `- Egresos: ${miles(balances.proyectado.egresos)} ARS / ${miles(balancesUsd.proyectado.egresos)} USD`,
      `- Balance: ${miles(balances.proyectado.balance)} ARS / ${miles(balancesUsd.proyectado.balance)} USD`,
      `- Movimientos imputados: ${balances.cantidadMovimientos}`,
    ].join("\n"),
  );

  if (balances.egresosPorCategoria.length > 0) {
    partes.push(
      "Egresos por categoría (ARS):\n" +
        balances.egresosPorCategoria
          .map((c) => `- ${c.nombre}: ${miles(c.total)}`)
          .join("\n"),
    );
  }

  if (balances.ingresosPorCategoria.length > 0) {
    partes.push(
      "Ingresos por categoría (ARS):\n" +
        balances.ingresosPorCategoria
          .map((c) => `- ${c.nombre}: ${miles(c.total)}`)
          .join("\n"),
    );
  }

  if (movimientos.length > 0) {
    const detalle = movimientos
      .slice(-MOVIMIENTOS_EN_CONTEXTO)
      .map(
        (m) =>
          `- ${m.fecha} · ${m.tipo} · ${m.descripcion} · ${miles(Number(m.monto_ars))} ARS` +
          ` · ${categorias.get(m.category_id) ?? "sin categoría"}` +
          (m.estado === "planificado" ? " (planificado)" : ""),
      )
      .join("\n");
    partes.push(`Movimientos directos del proyecto:\n${detalle}`);
  }

  if (lecciones.length > 0) {
    partes.push(
      "Lecciones que ya tiene de este proyecto (NO las repitas en las candidatas):\n" +
        lecciones
          .map((l) => `- [${l.categoria}] ${l.titulo}: ${l.contenido}`)
          .join("\n"),
    );
  }

  if (bitacora.length > 0) {
    // Las últimas: el cierre de un proyecto se entiende mejor por cómo
    // terminó que por cómo arrancó.
    const detalle = bitacora
      .slice(-ENTRADAS_EN_CONTEXTO)
      .map((e) => `--- ${e.fecha}\n${e.contenido.slice(0, CHARS_POR_ENTRADA)}`)
      .join("\n\n");
    partes.push(`Entradas de bitácora del proyecto:\n${detalle}`);
  }

  return partes.join("\n\n");
}

function miles(n: number): string {
  return Math.round(n).toLocaleString("es-AR");
}

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
