import "server-only";

import { todayISO } from "@/lib/dates";
import type { SupabaseClient } from "@/lib/supabase/server";

/**
 * Respaldo completo en JSON (spec 8).
 *
 * El tier gratuito de Supabase **no tiene backups automáticos**. Este
 * archivo es la única red que hay, y esa frase es del spec, no una
 * licencia poética: si la base se pierde, lo que no esté acá adentro no
 * está en ningún lado.
 *
 * De ahí las decisiones de forma:
 *
 * - **Se exporta todo, incluido lo archivado.** Un respaldo que filtra
 *   por lo que hoy se ve en pantalla no es un respaldo. Es la única
 *   lectura de la app que ignora `archivado_en` a propósito.
 * - **Filas crudas, tal como salen de la base**, sin renombrar campos ni
 *   resolver ids a nombres. Lo lindo de leer es tarea del CSV; esto
 *   tiene que poder volver a entrar a una base vacía.
 * - **Se incluyen `fx_rates`**, que no son datos de Beno pero cuestan un
 *   año de cron diario recuperar.
 * - **El embedding de las lecciones se saca.** Son 768 números por
 *   lección, multiplican por diez el peso del archivo y se regeneran con
 *   `npm run backfill:embeddings`. Lo irrecuperable es el texto.
 */

/** Sube el número si alguna vez cambia la forma del archivo. */
export const VERSION_RESPALDO = 1;

/**
 * Las tablas del respaldo, en orden de dependencia: si algún día esto se
 * reimporta, insertarlas en este orden respeta las claves foráneas.
 */
const TABLAS = [
  "projects",
  "categories",
  "recurrences",
  "movements",
  "tracks",
  "blocks",
  "sessions",
  "artifacts",
  "daily_log",
  "lessons",
  "retros",
  "inbox",
  "settings",
  "fx_rates",
] as const;

type Tabla = (typeof TABLAS)[number];

export interface Respaldo {
  __pepe: string;
  version: number;
  generado_en: string;
  fecha: string;
  /** Cuántas filas trae cada tabla. Sirve para verificar de un vistazo. */
  conteos: Record<string, number>;
  datos: Record<string, unknown[]>;
}

/** Cuántas filas se piden por página. Supabase corta en 1000 por defecto. */
const PAGINA = 1000;

export async function armarRespaldo(supabase: SupabaseClient): Promise<Respaldo> {
  const datos: Record<string, unknown[]> = {};
  const conteos: Record<string, number> = {};

  for (const tabla of TABLAS) {
    const filas = await leerTodo(supabase, tabla);
    datos[tabla] = filas;
    conteos[tabla] = filas.length;
  }

  return {
    // Marca de agua para reconocer el archivo, igual que el `__colmena`
    // que traía el export de la app vieja.
    __pepe: "pepe:respaldo",
    version: VERSION_RESPALDO,
    generado_en: new Date().toISOString(),
    fecha: todayISO(),
    conteos,
    datos,
  };
}

/**
 * Lee una tabla entera, paginando.
 *
 * Sin paginar, una tabla de más de mil filas se exportaría cortada **sin
 * ningún error visible**, que es la peor forma posible de fallar en un
 * respaldo. `movements` ya tiene 22 filas y `sessions` 70, pero esto
 * tiene que seguir siendo cierto dentro de cinco años.
 */
async function leerTodo(
  supabase: SupabaseClient,
  tabla: Tabla,
): Promise<unknown[]> {
  const filas: unknown[] = [];

  for (let desde = 0; ; desde += PAGINA) {
    // `lessons` va sin `embedding` ni `busqueda`: los dos son derivados
    // del texto. El embedding pesa diez veces más que la lección y se
    // regenera con `npm run backfill:embeddings`; `busqueda` es una
    // columna generada que la base recalcula sola al insertar.
    const columnas =
      tabla === "lessons"
        ? "id, user_id, project_id, movement_id, fecha, titulo, contenido, categoria, origen, archivado_en, created_at, updated_at"
        : "*";

    const { data, error } = await supabase
      .from(tabla)
      .select(columnas)
      .range(desde, desde + PAGINA - 1);

    if (error) {
      throw new Error(`No se pudo leer ${tabla}: ${error.message}`);
    }

    filas.push(...(data ?? []));

    if (!data || data.length < PAGINA) break;
  }

  return filas;
}
