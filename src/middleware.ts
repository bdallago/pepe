import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/supabase/database.types";

const PUBLIC_PATHS = ["/login", "/auth/callback", "/auth/auth-code-error"];

/**
 * Refresca la sesión de Supabase en cada request y protege las rutas
 * privadas. El refresh tiene que pasar por acá: los Server Components no
 * pueden escribir cookies, así que sin middleware la sesión expiraría.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Sin configuración de Supabase no hay sesión que refrescar. Dejar pasar
  // el request permite que la app muestre un error entendible en vez de
  // romper con un 500 opaco desde el middleware.
  if (!url || !anonKey) return response;

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  if (!user && !isPublic) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && pathname === "/login") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Todas las rutas menos:
     * - archivos estáticos de Next y assets con extensión
     * - /api/cron/* , que se autentica con CRON_SECRET, no con sesión
     * - /api/mcp , el servidor MCP: habla JSON-RPC con clientes que no
     *   tienen cookies. Si el middleware lo tocara, un cliente sin sesión
     *   se comería un 307 a `/login` en vez del 401 con
     *   `WWW-Authenticate` que el protocolo necesita para arrancar el
     *   flujo de OAuth — y el síntoma sería "no llego al servidor", que
     *   manda a buscar el problema al lugar equivocado. La autenticación
     *   la resuelve el propio handler.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/cron|api/mcp|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
