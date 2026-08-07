/**
 * Genera los embeddings que faltan en `lessons`.
 *
 *   npm run backfill:embeddings [tamaño-de-lote]
 *
 * Procesa las lecciones con `embedding is null` en lotes y es
 * **retomable**: el filtro es la propia condición que el script arregla,
 * así que si se corta a mitad de camino, volver a correrlo sigue donde
 * quedó sin repetir nada. La base ya tiene el índice parcial
 * `lessons_sin_embedding_idx` para que ese filtro sea barato.
 *
 * Cuándo se usa:
 *  - Después de un alta o edición cuyo indexado en vivo falló (el diseño
 *    es a propósito que la lección se guarde igual, con embedding null).
 *  - Si alguna vez se cambia de modelo: un `update lessons set embedding
 *    = null` y una corrida de esto recalcula todo.
 *
 * Usa la service role key y saltea RLS, igual que el cron y el
 * importador: es mantenimiento, corre fuera de una sesión de usuario.
 *
 * Se corre con `--conditions=react-server` para que `import "server-only"`
 * resuelva al archivo vacío. Sin ese flag, Node resuelve al `index.js`
 * del paquete, que lanza a propósito.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

import {
  aVectorPg,
  generarEmbedding,
  MODELO_EMBEDDINGS,
  textoDeLeccion,
} from "../src/lib/embeddings.ts";

/**
 * Cuántas lecciones se traen por vuelta. El modelo procesa de a una
 * igual (no se batchea la inferencia), así que esto solo controla el
 * tamaño de cada ida a la base y cada cuánto se ve progreso.
 */
const LOTE_POR_DEFECTO = 20;

// ------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------

/**
 * Lee `.env.local` a mano. El script corre fuera de Next, así que no hay
 * nadie que cargue el archivo por nosotros. Mismo criterio que
 * `importar-colmena.ts`.
 */
function leerEnvLocal(raiz: string): Record<string, string> {
  const contenido = readFileSync(resolve(raiz, ".env.local"), "utf8");
  const vars: Record<string, string> = {};
  for (const linea of contenido.split(/\r?\n/)) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith("#")) continue;
    const separador = limpia.indexOf("=");
    if (separador === -1) continue;
    const clave = limpia.slice(0, separador).trim();
    let valor = limpia.slice(separador + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    vars[clave] = valor;
  }
  return vars;
}

function fallar(mensaje: string): never {
  console.error(`\n✖ ${mensaje}\n`);
  process.exit(1);
}

// ------------------------------------------------------------
// Backfill
// ------------------------------------------------------------

async function main() {
  const raiz = process.cwd();
  const tamanoLote = Number(process.argv[2] ?? LOTE_POR_DEFECTO);
  if (!Number.isInteger(tamanoLote) || tamanoLote < 1) {
    fallar(`Tamaño de lote inválido: ${process.argv[2]}`);
  }

  const env = leerEnvLocal(raiz);
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    fallar(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local",
    );
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`\n▸ Backfill de embeddings`);
  console.log(`  modelo: ${MODELO_EMBEDDINGS}`);
  console.log(`  lote:   ${tamanoLote}\n`);

  let procesadas = 0;
  const fallidas: { id: string; titulo: string; motivo: string }[] = [];

  /**
   * Ids que ya fallaron en esta corrida. Sin esto el bucle sería
   * infinito: una lección que falla sigue con `embedding is null` y
   * volvería a salir en el próximo lote para siempre.
   */
  const descartadas = new Set<string>();

  for (;;) {
    const { data: lote, error } = await supabase
      .from("lessons")
      .select("id, titulo, contenido")
      .is("embedding", null)
      .order("fecha", { ascending: true })
      .limit(tamanoLote);

    if (error) fallar(`No pude leer lecciones: ${error.message}`);

    const pendientes = (lote ?? []).filter((l) => !descartadas.has(l.id));
    if (pendientes.length === 0) break;

    for (const leccion of pendientes) {
      const etiqueta = leccion.titulo.slice(0, 60);
      try {
        const vector = await generarEmbedding(
          textoDeLeccion(leccion.titulo, leccion.contenido),
          // Lo que se indexa va con prefijo "passage: ". La consulta del
          // buscador usa "query: ". e5 es asimétrico y mezclarlos
          // degrada los resultados.
          "passage",
        );

        const { error: errorUpdate } = await supabase
          .from("lessons")
          .update({ embedding: aVectorPg(vector) })
          .eq("id", leccion.id);

        if (errorUpdate) throw new Error(errorUpdate.message);

        procesadas += 1;
        console.log(`  ✔ ${etiqueta}`);
      } catch (e: unknown) {
        const motivo = e instanceof Error ? e.message : String(e);
        descartadas.add(leccion.id);
        fallidas.push({ id: leccion.id, titulo: etiqueta, motivo });
        console.log(`  ✖ ${etiqueta} — ${motivo}`);
      }
    }
  }

  // --- Reporte ------------------------------------------------
  console.log(`\n  procesadas: ${procesadas}`);
  console.log(`  fallidas:   ${fallidas.length}`);

  if (fallidas.length > 0) {
    console.log(`\n  Detalle de las que fallaron:`);
    for (const f of fallidas) {
      console.log(`    ${f.id}  ${f.titulo}`);
      console.log(`      ${f.motivo}`);
    }
    console.log(
      `\n  Siguen con embedding null y se pueden buscar por full-text.` +
        `\n  Volvé a correr el script para reintentarlas.`,
    );
  }

  console.log(
    fallidas.length === 0
      ? `\n✔ Listo, no quedan lecciones sin embedding.\n`
      : `\n▸ Terminó con ${fallidas.length} pendiente(s).\n`,
  );

  // Si alguna falló, el exit code lo refleja: sirve si esto alguna vez
  // corre en CI o en un cron.
  process.exit(fallidas.length === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  fallar(String(error));
});
