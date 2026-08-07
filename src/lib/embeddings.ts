import "server-only";

import { join } from "node:path";

import { env, pipeline } from "@huggingface/transformers";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";

/**
 * Embeddings para la búsqueda semántica de lecciones.
 *
 * Corre **en el servidor de Next** (route handler / script de Node), no en
 * una Edge Function de Supabase ni en el browser: el modelo pesa 266 MB y
 * necesita el runtime de Node para `onnxruntime-node`.
 *
 * ------------------------------------------------------------------
 * Por qué este modelo
 * ------------------------------------------------------------------
 * Se comparó contra `gte-small` (solo inglés, descartado) y contra
 * `multilingual-e5-small` con consultas reales en español: el chico
 * acertó 2 de 4 con márgenes de 0.005 —ruido— y el base acertó 4 de 4 en
 * fp32 y 3 de 4 en q8. El fp32 pesa 1.1 GB y es indesplegable, así que se
 * usa q8: 266 MB por 1 de 4 aciertos de diferencia, y el full-text de la
 * búsqueda híbrida cubre justamente ese hueco.
 *
 * ------------------------------------------------------------------
 * Truncado a 512 tokens
 * ------------------------------------------------------------------
 * e5 corta la entrada en 512 tokens y **la cola se pierde en silencio**:
 * no hay error, simplemente el embedding no representa el final del
 * texto. En español eso son ~350-400 palabras.
 *
 * En la práctica casi no pega, porque las lecciones son cortas por
 * diseño (un título y un párrafo o dos: son notas, no artículos). Si
 * alguna vez se permiten lecciones largas, la salida no es subir el
 * límite —el modelo no puede— sino partir el texto en fragmentos,
 * embeber cada uno y guardar varias filas por lección. Mientras tanto,
 * la columna `busqueda` (full-text) sí indexa el contenido entero, así
 * que la cola truncada sigue siendo encontrable por palabra exacta.
 */

// ------------------------------------------------------------
// Configuración
// ------------------------------------------------------------

/**
 * Repo de Hugging Face. Cambiarlo obliga a recalcular **todos** los
 * embeddings guardados (y, si cambia la dimensión, a migrar la columna
 * `vector(768)` y su índice HNSW).
 */
export const MODELO_EMBEDDINGS = "Xenova/multilingual-e5-base";

/** Dimensión que devuelve el modelo. Tiene que coincidir con `vector(768)`. */
export const DIMENSIONES_EMBEDDING = 768;

/**
 * Variante de los pesos. `q8` = 266 MB; `fp32` = 1.1 GB y no entra en el
 * bundle de una función de Vercel.
 */
export const DTYPE_EMBEDDINGS = "q8" as const;

/** Límite duro del modelo. Documentado arriba. */
export const MAX_TOKENS_EMBEDDINGS = 512;

/**
 * Dónde viven los pesos.
 *
 * Se ancla a `process.cwd()` a propósito, por dos motivos:
 *
 *  1. En esta máquina el disco C tiene menos de 3 GB libres y ya reventó
 *     una vez con ENOSPC. El default de transformers.js es un caché en el
 *     home del usuario (C:), así que hay que sacarlo de ahí sí o sí.
 *  2. En Vercel, `outputFileTracingIncludes` copia este directorio dentro
 *     de la función y el cwd de la función es su raíz, así que la misma
 *     ruta relativa funciona en los dos lados.
 *
 * El directorio lo llena `npm run descargar:modelo` (que corre en el
 * build) y está en `.gitignore`: son 266 MB y el repo es público —
 * GitHub ni siquiera acepta archivos de más de 100 MB.
 */
export const DIRECTORIO_MODELOS = join(process.cwd(), ".modelos");

/**
 * Prefijos que **exige** e5. No son decorativos ni opcionales: el modelo
 * se entrenó con ellos y sin el prefijo la calidad se cae. La consulta y
 * el texto indexado llevan prefijos distintos a propósito — es
 * asimétrico.
 */
const PREFIJOS = {
  query: "query: ",
  passage: "passage: ",
} as const;

export type TipoEmbedding = keyof typeof PREFIJOS;

// ------------------------------------------------------------
// Pipeline
// ------------------------------------------------------------

env.cacheDir = DIRECTORIO_MODELOS;
// Si los pesos están en el caché del repo, no se sale a la red. Se deja
// la descarga habilitada como red de contención para desarrollo: si
// alguien clona y corre `next dev` sin haber corrido el prefetch, la
// primera llamada baja el modelo en vez de explotar.
env.allowLocalModels = true;
env.allowRemoteModels = true;

/**
 * Promesa cacheada a nivel módulo.
 *
 * Se guarda **la promesa** y no el pipeline resuelto: si entran dos
 * pedidos juntos con el modelo frío, los dos esperan la misma carga en
 * vez de bajar y abrir 266 MB dos veces.
 */
let pipelinePendiente: Promise<FeatureExtractionPipeline> | null = null;

function obtenerPipeline(): Promise<FeatureExtractionPipeline> {
  pipelinePendiente ??= pipeline("feature-extraction", MODELO_EMBEDDINGS, {
    dtype: DTYPE_EMBEDDINGS,
  }).catch((error: unknown) => {
    // Si la carga falla, se descarta la promesa para que el próximo
    // intento vuelva a probar. Cachear un rechazo dejaría la búsqueda
    // semántica muerta hasta el próximo arranque en frío.
    pipelinePendiente = null;
    throw error;
  });

  return pipelinePendiente;
}

/**
 * Carga el modelo sin generar nada. La usa el script de descarga para
 * llenar el caché en el build, y sirve para medir el arranque en frío.
 */
export async function precargarModelo(): Promise<void> {
  await obtenerPipeline();
}

// ------------------------------------------------------------
// API
// ------------------------------------------------------------

/**
 * Convierte un texto en un vector de 768 dimensiones, normalizado.
 *
 * @param texto  Lo que se quiere embeber. Se trunca a 512 tokens.
 * @param tipo   `"query"` para lo que escribe el usuario en el buscador,
 *               `"passage"` para el texto de una lección que se indexa.
 *               Mezclarlos degrada los resultados: e5 es asimétrico.
 *
 * Lanza si el modelo no carga o si la salida no tiene 768 dimensiones.
 * Los llamadores tienen que asumir que esto puede fallar y seguir
 * andando sin el vector.
 */
export async function generarEmbedding(
  texto: string,
  tipo: TipoEmbedding,
): Promise<number[]> {
  const limpio = texto.trim();
  if (!limpio) {
    throw new Error("No se puede generar un embedding de un texto vacío.");
  }

  const extractor = await obtenerPipeline();

  const salida = await extractor(PREFIJOS[tipo] + limpio, {
    // `mean` sobre los tokens y normalización L2: es lo que espera e5 y
    // lo que hace que la distancia coseno de pgvector sea comparable.
    pooling: "mean",
    normalize: true,
  });

  const vector = Array.from(salida.data as Float32Array, Number);

  if (vector.length !== DIMENSIONES_EMBEDDING) {
    throw new Error(
      `El modelo ${MODELO_EMBEDDINGS} devolvió ${vector.length} dimensiones ` +
        `y la columna lessons.embedding es vector(${DIMENSIONES_EMBEDDING}). ` +
        "Si cambiaste de modelo, hay que migrar la columna y recalcular todo.",
    );
  }

  return vector;
}

/**
 * Arma el texto que se indexa de una lección.
 *
 * El título va primero porque es lo que más carga semántica tiene y es
 * lo último que se pierde si el contenido es largo y hay truncado. Es el
 * mismo criterio que usa la columna `busqueda`, donde el título pesa 'A'
 * y el contenido 'B'.
 */
export function textoDeLeccion(titulo: string, contenido: string): string {
  return `${titulo.trim()}\n\n${contenido.trim()}`.trim();
}

/**
 * Serializa el vector como lo espera pgvector por PostgREST: el tipo
 * `vector` se recibe como string `"[0.1,0.2,...]"`, no como array JSON.
 */
export function aVectorPg(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
