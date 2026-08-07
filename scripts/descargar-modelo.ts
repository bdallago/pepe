/**
 * Descarga los pesos del modelo de embeddings al caché del repo.
 *
 *   npm run descargar:modelo
 *
 * Corre **en el build** (ver el script `build` de package.json), no a
 * mano: los pesos son 266 MB, el repo es público y GitHub no acepta
 * archivos de más de 100 MB, así que no se commitean. El directorio
 * destino (`.modelos/`) está en `.gitignore` y `next.config.ts` lo mete
 * en el bundle de la función con `outputFileTracingIncludes`.
 *
 * Es idempotente y barato de repetir: transformers.js verifica el caché
 * antes de bajar nada, así que la segunda corrida no toca la red.
 *
 * Se corre con `--conditions=react-server` para que `import "server-only"`
 * resuelva al archivo vacío. Sin ese flag, Node resuelve al `index.js`
 * del paquete, que lanza a propósito.
 */

import {
  DIRECTORIO_MODELOS,
  DTYPE_EMBEDDINGS,
  MODELO_EMBEDDINGS,
  precargarModelo,
} from "../src/lib/embeddings.ts";

async function main() {
  console.log(`\n▸ Modelo:  ${MODELO_EMBEDDINGS} (${DTYPE_EMBEDDINGS})`);
  console.log(`  Destino: ${DIRECTORIO_MODELOS}\n`);

  const inicio = Date.now();
  await precargarModelo();
  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);

  console.log(`\n✔ Modelo listo en ${segundos}s\n`);
}

main().catch((error: unknown) => {
  console.error(`\n✖ No pude descargar el modelo: ${String(error)}\n`);
  process.exit(1);
});
