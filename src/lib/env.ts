/**
 * Lectura de variables de entorno con mensajes de error claros.
 *
 * Las NEXT_PUBLIC_* se referencian literalmente (no por índice dinámico)
 * porque Next las inlinea en el bundle del cliente en tiempo de build.
 */

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `Falta la variable de entorno ${name}. Copiá .env.example a .env.local y completala.`,
    );
  }
  return value;
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
  // ⚠ El `trim()` no es decorativo. Un uuid nunca lleva espacios
  // alrededor, así que recortarlo no puede cambiar un valor legítimo —
  // pero cargar la variable con un pipe (`$id | vercel env add`) le pega
  // un salto de línea, y entonces la comparación falla con el uuid
  // correcto adentro. El síntoma es el peor posible: la pantalla dice
  // "esta cuenta no puede conectar" y manda a revisar la cuenta de
  // Google, que no tiene nada que ver.
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
