import "server-only";

import { z } from "zod";

import {
  ErrorLLM,
  MODELO_CHICO,
  completarJSON,
  type PromptDeclarado,
} from "@/lib/llm";
import type { SupabaseClient } from "@/lib/supabase/server";
import type { Category, TipoMovimiento } from "@/lib/supabase/database.types";

/**
 * Sugerencia de tipo y categoría al cargar un movimiento (spec 6.1).
 *
 * El orden de resolución es exacto y no es negociable:
 *
 *   1. **Match contra el histórico.** Si la descripción normalizada ya
 *      apareció antes, se usa la categoría de esa vez. Sin modelo, sin
 *      red, instantáneo.
 *   2. **Recién ahí, el modelo**, con la lista de categorías y ejemplos
 *      de movimientos previos.
 *
 * El punto del orden no es ahorrar tokens (aunque los ahorra): es que las
 * decisiones de Beno le ganen siempre a las del modelo. Si una vez puso
 * "Vercel" en Infraestructura, la próxima vez va Infraestructura, aunque
 * un modelo opine distinto. Y como cada movimiento confirmado entra al
 * histórico, el paso 2 se llama cada vez menos.
 *
 * La sugerencia **nunca decide nada**: llega precargada al formulario y
 * Beno confirma o cambia. Ese formulario es el panel de confirmación que
 * pide la sección 6 del spec; por eso esto no pasa por `inbox`.
 *
 * ## El `userId` opcional, y por qué existe
 *
 * Los dos call sites de siempre —el formulario y la caja— hablan con la
 * base con la identidad de Beno, así que **RLS ya acota todo** y pasarlo
 * sería redundante. El conector MCP remoto no: sus tools presentan un
 * token propio de Pepe y del otro lado hay un cliente con la service
 * role key, que saltea RLS (el desarrollo está en `lib/mcp/datos.ts`).
 * Sin el filtro explícito, el histórico que le contesta al conector
 * sería el de todos los usuarios.
 *
 * Hoy hay un solo usuario y las filas serían las mismas. Se filtra
 * igual: la regla que ordena el módulo de datos del MCP es que ninguna
 * consulta salga sin acotar, y el día que la premisa cambie nadie va a
 * acordarse de venir a mirar acá.
 *
 * `?? undefined` y no `null` al llamar al RPC: omitir el argumento deja
 * que Postgres aplique su `default null`, que es "no filtres acá". Los
 * tipos generados no aceptan `null` en un argumento con default.
 */

/** Cuántos ejemplos se le muestran al modelo. */
const EJEMPLOS_PARA_MODELO = 20;

export type OrigenSugerencia = "historico" | "modelo";

export interface Sugerencia {
  tipo: TipoMovimiento;
  categoryId: string;
  categoriaNombre: string;
  origen: OrigenSugerencia;
  /** Cuántas veces se cargó así antes. Solo para el histórico. */
  veces?: number;
  /**
   * Solo para el histórico: `true` si la descripción es idéntica,
   * `false` si coincidió el núcleo (o sea, lo mismo salvo el mes). La
   * interfaz lo dice distinto, porque la evidencia es distinta.
   */
  exacto?: boolean;
}

/**
 * Descripción reducida a lo comparable, del lado del cliente.
 *
 * **Tiene que dar exactamente lo mismo que la columna generada
 * `movements.descripcion_normalizada`** (ver la migración
 * `20260807000005_clasificacion.sql`). El match del histórico lo hace la
 * base contra su columna; esto se usa para comparar nombres de categoría
 * y para no gastar un viaje con una descripción que todavía no dice nada.
 * Si se toca una, hay que tocar la otra.
 */
export function normalizarDescripcion(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Paso 1: ¿esta descripción ya la cargué antes?
 *
 * Lo resuelve `sugerir_categoria_historico` en la base, contra un índice.
 * Gana la categoría **más usada** para esa descripción, y ante empate la
 * más reciente: contar y no quedarse con la última evita que un error de
 * tipeo de la semana pasada se convierta en la sugerencia de siempre.
 */
export async function buscarEnHistorico(
  supabase: SupabaseClient,
  descripcion: string,
  categorias: Category[],
  userId?: string,
): Promise<Sugerencia | null> {
  const { data, error } = await supabase.rpc("sugerir_categoria_historico", {
    p_descripcion: descripcion,
    p_user_id: userId ?? undefined,
  });

  if (error || !data || data.length === 0) return null;

  // La función devuelve hasta 5, ordenadas. Se recorre en orden y se
  // toma la primera que siga existiendo: si la más usada se archivó, la
  // segunda sigue siendo mejor sugerencia que llamar al modelo.
  for (const fila of data) {
    const categoria = categorias.find(
      (c) => c.id === fila.category_id && !c.archivada,
    );
    if (!categoria) continue;

    return {
      tipo: fila.tipo,
      categoryId: fila.category_id,
      categoriaNombre: categoria.nombre,
      origen: "historico",
      veces: Number(fila.veces),
      exacto: fila.exacto,
    };
  }

  return null;
}

const respuestaSchema = z.object({
  tipo: z.enum(["ingreso", "egreso"]),
  categoria: z.string().trim().min(1),
});

const SISTEMA = `Clasificás movimientos de dinero de una app personal de finanzas por proyecto.

Recibís la descripción de un movimiento, la lista de categorías disponibles y ejemplos de cómo se clasificaron movimientos anteriores.

Devolvés el tipo ("ingreso" o "egreso") y UNA categoría, copiada TAL CUAL de la lista de ese tipo. No inventes categorías nuevas ni cambies su redacción.

Los ejemplos previos mandan: si algo parecido ya se clasificó de una manera, seguí ese criterio aunque vos elegirías otro.

Ante la duda sobre el tipo, es "egreso": la enorme mayoría de los movimientos lo son.

Respondé SOLO un objeto JSON:
{"tipo": "ingreso" | "egreso", "categoria": "<nombre exacto de la lista>"}`;

/**
 * El prompt del clasificador, declarado.
 *
 * Lo que su juez cobra es la regla de arriba: la categoría que devuelve
 * tiene que estar **copiada tal cual** de la lista que se le dio. Si
 * inventa una, acá abajo no hay sugerencia —así que el daño ya está
 * contenido— pero el arnés lo hace visible en vez de dejarlo pasar como
 * "el histórico no encontró nada".
 */
export const PROMPT_CLASIFICACION: PromptDeclarado<
  z.infer<typeof respuestaSchema>
> = {
  modelo: MODELO_CHICO,
  sistema: SISTEMA,
  esquema: respuestaSchema,
  etiqueta: "clasificacion-movimiento",
  maxTokens: 80,
  // Un solo reintento: hay alguien mirando el formulario. Si no sale
  // rápido, se carga a mano y listo.
  reintentos: 1,
  timeoutMs: 15_000,
};

/**
 * Paso 2: el modelo, solo si el histórico no encontró nada.
 *
 * **Nunca lanza.** Si Groq está caído, sin cuota o contesta cualquier
 * cosa, devuelve `null` y el formulario queda como estaba. Cargar un
 * gasto no puede depender de que un modelo conteste: es la regla más
 * repetida del spec.
 */
export async function sugerirConModelo(
  supabase: SupabaseClient,
  descripcion: string,
  categorias: Category[],
  userId?: string,
): Promise<Sugerencia | null> {
  const vigentes = categorias.filter((c) => !c.archivada);
  if (vigentes.length === 0) return null;

  let consultaPrevios = supabase
    .from("movements")
    .select("descripcion, tipo, category_id")
    .order("fecha", { ascending: false })
    .limit(EJEMPLOS_PARA_MODELO);

  if (userId) consultaPrevios = consultaPrevios.eq("user_id", userId);

  const { data: previos } = await consultaPrevios;

  const nombrePorId = new Map(categorias.map((c) => [c.id, c.nombre]));

  const listar = (tipo: TipoMovimiento) =>
    vigentes
      .filter((c) => c.tipo === tipo)
      .map((c) => `- ${c.nombre}`)
      .join("\n") || "- (ninguna)";

  const ejemplos = (previos ?? [])
    .map(
      (m) =>
        `- "${m.descripcion}" → ${m.tipo} / ${nombrePorId.get(m.category_id) ?? "?"}`,
    )
    .join("\n");

  const usuario = [
    `Categorías de egreso:\n${listar("egreso")}`,
    `Categorías de ingreso:\n${listar("ingreso")}`,
    ejemplos ? `Movimientos anteriores:\n${ejemplos}` : "",
    `Clasificá este movimiento:\n"${descripcion.trim()}"`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const { datos } = await completarJSON({ ...PROMPT_CLASIFICACION, usuario });

    // El modelo devuelve un nombre; acá se busca el id. Si inventó una
    // categoría que no existe, no hay sugerencia: no se crea nada nuevo.
    const buscado = normalizarDescripcion(datos.categoria);
    const categoria = vigentes.find(
      (c) =>
        c.tipo === datos.tipo && normalizarDescripcion(c.nombre) === buscado,
    );

    if (!categoria) {
      console.warn(
        `[clasificacion] el modelo propuso "${datos.categoria}" (${datos.tipo}), que no está en la lista.`,
      );
      return null;
    }

    return {
      tipo: datos.tipo,
      categoryId: categoria.id,
      categoriaNombre: categoria.nombre,
      origen: "modelo",
    };
  } catch (error: unknown) {
    console.error(
      "[clasificacion] sin sugerencia del modelo:",
      error instanceof ErrorLLM ? `${error.tipo}: ${error.message}` : error,
    );
    return null;
  }
}

/** El flujo completo, en el orden del spec. */
export async function sugerirClasificacion(
  supabase: SupabaseClient,
  descripcion: string,
  userId?: string,
): Promise<Sugerencia | null> {
  let consultaCategorias = supabase.from("categories").select("*");
  if (userId) consultaCategorias = consultaCategorias.eq("user_id", userId);

  const { data: categorias } = await consultaCategorias;
  if (!categorias || categorias.length === 0) return null;

  const delHistorico = await buscarEnHistorico(
    supabase,
    descripcion,
    categorias,
    userId,
  );
  if (delHistorico) return delHistorico;

  return sugerirConModelo(supabase, descripcion, categorias, userId);
}
