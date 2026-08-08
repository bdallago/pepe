import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok, type ActionResult } from "@/lib/actions/shared";
import { generarLecciones, type ReporteGeneracion } from "@/lib/generacion";
import { hayModeloConfigurado, mensajeDeErrorLLM } from "@/lib/llm";
import { createClient, getUser } from "@/lib/supabase/server";

/**
 * Genera lecciones sobre un tema y las deja en la bandeja (spec 6.3).
 *
 * Route handler y no Server Action por el `maxDuration`: es una llamada
 * al modelo grande con salida larga, y el limitador de tokens puede
 * hacerla esperar un minuto antes de salir si venís de otro pase.
 *
 * Si Groq está caído se contesta un error legible y nada más: escribir
 * lecciones a mano sigue funcionando igual.
 */

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const cuerpoSchema = z.object({
  tema: z
    .string()
    .trim()
    .min(3, "Contame un poco más sobre qué tema.")
    .max(300, "Máximo 300 caracteres."),
  projectId: z.string().uuid("Elegí un proyecto."),
});

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ActionResult<ReporteGeneracion>>> {
  const user = await getUser();
  if (!user) {
    return NextResponse.json(fail("Sesión no encontrada."), { status: 401 });
  }

  if (!hayModeloConfigurado()) {
    return NextResponse.json(
      fail("No hay modelo configurado. Podés escribir lecciones a mano."),
      { status: 503 },
    );
  }

  let crudo: unknown;
  try {
    crudo = await request.json();
  } catch {
    return NextResponse.json(fail("El cuerpo no es JSON válido."), {
      status: 400,
    });
  }

  const parseo = cuerpoSchema.safeParse(crudo);
  if (!parseo.success) {
    return NextResponse.json(
      fail(parseo.error.issues[0]?.message ?? "Datos inválidos."),
      { status: 400 },
    );
  }

  const supabase = await createClient();

  try {
    const reporte = await generarLecciones(supabase, user.id, parseo.data);
    return NextResponse.json(ok(reporte));
  } catch (error: unknown) {
    console.error("[generacion] falló:", error);
    return NextResponse.json(fail(mensajeDeErrorLLM(error)), { status: 500 });
  }
}
