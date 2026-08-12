import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Lee `.env.local` a mano.
 *
 * Los scripts corren fuera de Next, así que no hay nadie que cargue el
 * archivo por nosotros. Estaba copiado en `backfill-embeddings.ts` y en
 * `importar-colmena.ts`; vive acá para que haya un solo parser.
 *
 * ⚠ **Recorta el valor.** No es prolijidad: dos veces se rompió
 * producción por un byte invisible pegado a una variable —un `\n` en
 * `MCP_USUARIO_PERMITIDO` y un BOM en `GROQ_API_KEY`, que dejó todas las
 * llamadas a Groq caídas 16 horas sin un solo error visible, porque la
 * regla 7 hace que la app siga andando—. El archivo además es CRLF.
 */
export function leerEnvLocal(raiz: string): Record<string, string> {
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

/** Mete `.env.local` en `process.env` sin pisar lo que ya venía seteado. */
export function cargarEnvLocal(raiz: string): void {
  for (const [clave, valor] of Object.entries(leerEnvLocal(raiz))) {
    process.env[clave] ??= valor;
  }
}
