import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok, type ActionResult } from "@/lib/actions/shared";
import { procesarAdjuntos, type ReporteAdjuntos } from "@/lib/adjuntos";
import { hayModeloConfigurado, mensajeDeErrorLLM } from "@/lib/llm";
import { MAX_ADJUNTOS } from "@/lib/agentes/adjuntos";
import { createClient, getUser } from "@/lib/supabase/server";

/**
 * Dispara el pase de adjuntos sobre los archivos que se le pasen.
 *
 * Es un route handler y no una Server Action por el `maxDuration`, igual
 * que `/api/bandeja/extraer`: son varias llamadas al modelo en serie con
 * el limitador de tokens de por medio. Un PDF de 30 páginas son ~32 000
 * tokens contra un caño de 5500 por minuto, o sea diez minutos, así que
 * **el pase es retomable**: procesa hasta que se le acaba el presupuesto
 * de tiempo y devuelve `restantes`. La pantalla vuelve a llamar.
 *
 * Recibe ids explícitos y no "todo lo pendiente": nada se procesa por
 * atrás sin que Beno lo haya pedido.
 */

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const cuerpoSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(MAX_ADJUNTOS),
});

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ActionResult<ReporteAdjuntos>>> {
  const user = await getUser();
  if (!user) {
    return NextResponse.json(fail("Sesión no encontrada."), { status: 401 });
  }

  const parseado = cuerpoSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parseado.success) {
    return NextResponse.json(fail("Pedido inválido."), { status: 400 });
  }

  // Regla 7: sin modelo la app sigue entera. Los archivos ya están
  // guardados y esperando; lo único que no se puede hacer es leerlos.
  if (!hayModeloConfigurado()) {
    return NextResponse.json(
      fail(
        "No hay modelo configurado. Los archivos quedaron guardados igual.",
      ),
      { status: 503 },
    );
  }

  const supabase = await createClient();

  try {
    const reporte = await procesarAdjuntos(supabase, user.id, parseado.data.ids);
    return NextResponse.json(ok(reporte));
  } catch (error: unknown) {
    console.error("[adjuntos] el pase falló entero:", error);
    return NextResponse.json(fail(mensajeDeErrorLLM(error)), { status: 500 });
  }
}
