/**
 * Lectura de variables de entorno con mensajes de error claros.
 *
 * Las NEXT_PUBLIC_* se referencian literalmente (no por índice dinámico)
 * porque Next las inlinea en el bundle del cliente en tiempo de build.
 */

/**
 * ⚠ **Todo se recorta.** Ninguna variable de Pepe —ni una key, ni una
 * URL, ni un uuid— lleva espacios alrededor, así que recortar no puede
 * cambiar un valor legítimo; y cargarlas desde la consola sí les pega
 * basura invisible. Ya pasó dos veces, con las dos formas que tiene
 * PowerShell de ensuciar un valor:
 *
 * - Un **salto de línea** al final, de pasar el valor por un pipe. Le
 *   tocó a `MCP_USUARIO_PERMITIDO`: la comparación fallaba con el uuid
 *   correcto adentro y la pantalla decía "esta cuenta no puede conectar",
 *   mandando a revisar la cuenta de Google, que no tenía nada que ver.
 * - Un **BOM** (U+FEFF) al principio, de escribir el valor a un archivo
 *   con `Out-File`/`Set-Content`. Le tocó a `GROQ_API_KEY`, y ahí el
 *   síntoma fue todavía peor: un BOM no entra en un header HTTP, así que
 *   `fetch` tiraba *"Cannot convert argument to a ByteString"* antes de
 *   salir a la red, `lib/llm.ts` lo clasificaba como error de red y —por
 *   la regla 7, que dice que ninguna feature de LLM puede ser
 *   bloqueante— la app seguía andando y no se quejaba de nada. Todas las
 *   llamadas a Groq en producción estuvieron caídas 16 horas sin que se
 *   notara.
 *
 * `trim()` cubre los dos: U+FEFF cuenta como espacio en blanco para la
 * spec de JavaScript. Se recorta **antes** de decidir si falta, para que
 * una variable cargada con un solo espacio se reporte como faltante en
 * vez de romper más adelante.
 */
function required(value: string | undefined, name: string): string {
  const limpio = value?.trim();
  if (!limpio) {
    throw new Error(
      `Falta la variable de entorno ${name}. Copiá .env.example a .env.local y completala.`,
    );
  }
  return limpio;
}

export function supabaseUrl(): string {
  return required(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    "NEXT_PUBLIC_SUPABASE_URL",
  );
}

export function supabaseAnonKey(): string {
  return required(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );
}

/** Solo server-side. Saltea RLS: nunca importar desde un componente cliente. */
export function supabaseServiceRoleKey(): string {
  return required(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    "SUPABASE_SERVICE_ROLE_KEY",
  );
}

export function cronSecret(): string {
  return required(process.env.CRON_SECRET, "CRON_SECRET");
}

/**
 * El id de Supabase del único usuario que puede obtener un token del
 * conector MCP.
 *
 * **Es la única que no lanza si falta**, y es a propósito: la usa
 * `/oauth/authorize`, que corre en un browser al que Claude acaba de
 * mandar. Un 500 ahí se ve como "el conector está roto" y no dice nada;
 * devolviendo null, la pantalla puede explicar que falta configurarlo.
 *
 * Falta = no autoriza a nadie. Que el modo de falla sea "no entra
 * ninguno" y no "entra cualquiera" es el punto entero de esta variable.
 */
export function mcpUsuarioPermitido(): string | null {
  // El `trim()` está por el mismo motivo que el de `required` —ver el
  // comentario de arriba: esta fue la variable a la que un pipe de
  // PowerShell le pegó el salto de línea—. No se usa `required` porque
  // esta es la única que no lanza si falta.
  return process.env.MCP_USUARIO_PERMITIDO?.trim() || null;
}

/**
 * Key de Groq. Solo server-side: nunca puede viajar al browser.
 *
 * Lanza si falta, igual que las demás. Quien no quiera que falte de forma
 * ruidosa tiene `hayModeloConfigurado()` en `lib/llm.ts`: la app entera
 * funciona en modo manual sin esta variable, y eso es un requisito del
 * spec, no una tolerancia.
 */
export function groqApiKey(): string {
  return required(process.env.GROQ_API_KEY, "GROQ_API_KEY");
}
