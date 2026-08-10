import { NextResponse, type NextRequest } from "next/server";

import { armarRespaldo } from "@/lib/respaldo";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Respaldo automático diario.
 *
 * Mismo contenido que `/api/respaldo`, pero para que lo baje una máquina
 * en vez de Beno: se autentica con `CRON_SECRET` y usa la service role
 * key porque corre sin usuario, igual que el cron del dólar y el de
 * zombies. El middleware ya excluye `/api/cron` de la protección por
 * cookie.
 *
 * **El que lo agenda no es Vercel, es GitHub Actions** — el workflow vive
 * en el repo privado `bdallago/pepe-respaldos`, que además es donde
 * quedan guardados. No es por falta de lugar: la cuenta es Pro y admite
 * de sobra un tercer cron. Es que **agendar y guardar son el mismo paso**.
 * Un cron de Vercel tendría que pushear a GitHub por su cuenta, lo que
 * significa un token de GitHub guardado en Vercel y el disparador
 * viviendo en la misma plataforma que respalda — que es exactamente lo
 * que uno no quiere el día que esa plataforma es el problema.
 *
 * Por eso esta ruta **no** está en `vercel.json`: nadie la llama desde
 * acá adentro.
 *
 * Devuelve el JSON crudo y nada más. Toda la decisión de qué guardar,
 * cuánto conservar y cómo verificarlo vive del otro lado, en el workflow.
 *
 * Los **bytes** de los comprobantes no salen por acá: este JSON trae el
 * inventario y las URLs firmadas para bajarlos salen por
 * `/api/cron/comprobantes`.
 */

export const dynamic = "force-dynamic";
// Catorce tablas leídas de a mil filas, más el listado del bucket. Hoy
// tarda menos de un segundo; el margen es para cuando haya años de datos.
export const maxDuration = 60;

function autorizado(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!autorizado(request)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const admin = createAdminClient();

  try {
    const respaldo = await armarRespaldo(admin);

    return new NextResponse(JSON.stringify(respaldo, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        // Nunca cachear: el respaldo de ayer no sirve.
        "cache-control": "no-store",
      },
    });
  } catch (error: unknown) {
    // Que falle con 500 y no con un JSON a medias es parte del diseño: el
    // workflow del otro lado no pisa el respaldo bueno si el pedido no
    // vino 200.
    console.error("[cron/respaldo] falló:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "No se pudo armar el respaldo.",
      },
      { status: 500 },
    );
  }
}
