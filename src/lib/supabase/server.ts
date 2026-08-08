import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { supabaseAnonKey, supabaseServiceRoleKey, supabaseUrl } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Cliente para Server Components, Server Actions y Route Handlers.
 * Lee y refresca la sesión desde las cookies.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Los Server Components no pueden escribir cookies. El refresh de
          // sesión lo hace el middleware, así que se puede ignorar.
        }
      },
    },
  });
}

/**
 * El cliente con sesión, tipado contra el esquema. Sirve para pasarlo a
 * funciones de dominio (`lib/extraccion.ts`, por ejemplo) en vez de que
 * cada una lo cree por su cuenta: la lógica queda reusable y testeable, y
 * el día que haya un MCP propio se le pasa otro cliente y listo.
 */
export type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Cliente con service role: saltea RLS. Lo usa únicamente el cron, que
 * corre sin sesión de usuario y necesita escribir fx_rates y generar
 * movimientos recurrentes de todos los usuarios.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    supabaseUrl(),
    supabaseServiceRoleKey(),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** Devuelve el usuario logueado o null. Valida el token contra Supabase. */
export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
