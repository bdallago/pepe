import "server-only";

import {
  aVectorPg,
  generarEmbedding,
  textoDeLeccion,
} from "@/lib/embeddings";
import { requireSession } from "@/lib/actions/shared";

/**
 * Indexado semántico de lecciones.
 *
 * Todavía no hay una action que cree o edite lecciones — nacen en la
 * etapa siguiente. Esto es la pieza que esa action va a llamar.
 */

/**
 * Cuánto se espera al modelo antes de dar la indexación por perdida.
 *
 * Es generoso a propósito: acá no hay un usuario mirando una pantalla en
 * blanco. Si el modelo está frío hay que cargar 266 MB, y es preferible
 * esperar a quedarse sin embedding. El que sí tiene un usuario esperando
 * es el buscador, y ese usa un timeout mucho más corto.
 */
const TIMEOUT_MS = 45_000;

/**
 * Recalcula y guarda el embedding de una lección.
 *
 * **Nunca lanza.** Es deliberado: el embedding es una mejora de la
 * búsqueda, no parte del dato. Si falla, la lección se guarda igual y
 * queda con `embedding = null`; el índice parcial
 * `lessons_sin_embedding_idx` existe justamente para encontrar las
 * pendientes, y `npm run backfill:embeddings` las levanta después.
 *
 * Mientras tanto la lección sigue siendo buscable: la columna generada
 * `busqueda` (full-text en español) no depende de ningún modelo y se
 * llena sola en el INSERT.
 *
 * Quien la llame **no debe hacer `await` bloqueando la respuesta al
 * usuario** si puede evitarlo: guardar la lección y disparar esto es
 * suficiente.
 */
export async function reindexarLeccion(lessonId: string): Promise<void> {
  try {
    const { supabase } = await requireSession();

    // RLS filtra por usuario, así que esto solo encuentra lecciones
    // propias. No hace falta un `eq("user_id", ...)` extra.
    const { data: leccion, error: errorLectura } = await supabase
      .from("lessons")
      .select("titulo, contenido")
      .eq("id", lessonId)
      .maybeSingle();

    if (errorLectura) throw new Error(errorLectura.message);
    if (!leccion) throw new Error(`No encontré la lección ${lessonId}.`);

    const vector = await conTimeout(
      generarEmbedding(
        textoDeLeccion(leccion.titulo, leccion.contenido),
        "passage",
      ),
      TIMEOUT_MS,
    );

    const { error: errorEscritura } = await supabase
      .from("lessons")
      .update({ embedding: aVectorPg(vector) })
      .eq("id", lessonId);

    if (errorEscritura) throw new Error(errorEscritura.message);
  } catch (error: unknown) {
    // Se registra y se sigue. La lección ya está guardada.
    console.error(
      `[embeddings] no pude indexar la lección ${lessonId}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

/** Corre una promesa con un techo de tiempo. */
async function conTimeout<T>(promesa: Promise<T>, ms: number): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promesa,
      new Promise<never>((_, rechazar) => {
        temporizador = setTimeout(
          () => rechazar(new Error(`El embedding tardó más de ${ms} ms.`)),
          ms,
        );
      }),
    ]);
  } finally {
    // Sin esto, el timer pendiente mantiene vivo el event loop del
    // proceso aunque el embedding haya salido rápido.
    clearTimeout(temporizador);
  }
}
