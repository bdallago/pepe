import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

/**
 * Cliente de Supabase para el servidor MCP.
 *
 * **Este código no corre en Next.** Corre como un proceso local en la
 * máquina de Beno, arrancado por Claude Code, así que no puede usar
 * `lib/supabase/server.ts`: ese lee la sesión con `next/headers`, que
 * fuera de Next no existe. Por el mismo motivo el MCP no puede importar
 * ninguno de los módulos marcados con `server-only`.
 *
 * Las credenciales salen de `.env.local`, que está gitignoreado y vive
 * solo en su disco. **Nunca salen de la máquina**: no hay endpoint, no
 * hay URL, no hay nada escuchando. Esa es toda la razón por la que el
 * MCP es local y no una ruta de la app.
 *
 * Usa la service role key, que saltea RLS. Se puede porque la app es de
 * un solo usuario y todo lo que hay en la base es de Beno; igual las
 * lecturas filtran por `user_id` para no depender de que eso siga siendo
 * cierto.
 */

// Node ≥ 20.12 lee el archivo sin necesidad de dotenv. Se resuelve
// relativo a este archivo y no al cwd, porque quien arranca el servidor
// es Claude Code y no hay ninguna garantía sobre desde dónde lo hace.
// `fileURLToPath` y no `.pathname`: en Windows eso devuelve "/B:/CC%20Agents/…",
// con la unidad colgando de una barra y los espacios escapados.
try {
  process.loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url)));
} catch {
  // Si no está, el chequeo de abajo da un error entendible.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error(
    "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. " +
      "El servidor MCP los lee de .env.local, en la raíz del repo.",
  );
}

export const supabase = createClient<Database>(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * El id del único usuario de la app.
 *
 * Se resuelve una vez y se cachea. Si algún día hay más de uno, esto
 * falla ruidosamente en vez de mezclar datos de dos personas en el
 * mismo balance.
 */
let userIdCache: string | null = null;

export async function getUserId(): Promise<string> {
  if (userIdCache) return userIdCache;

  const { data, error } = await supabase
    .from("projects")
    .select("user_id")
    .limit(1000);

  if (error) throw new Error(`No se pudo resolver el usuario: ${error.message}`);

  const ids = [...new Set((data ?? []).map((f) => f.user_id))];

  if (ids.length === 0) {
    throw new Error("No hay ningún proyecto cargado; no hay usuario que resolver.");
  }
  if (ids.length > 1) {
    throw new Error(
      `La base tiene ${ids.length} usuarios y este MCP asume uno solo. ` +
        "Hay que pasarle el usuario explícitamente antes de seguir.",
    );
  }

  userIdCache = ids[0];
  return userIdCache;
}
