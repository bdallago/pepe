import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok, type ActionResult } from "@/lib/actions/shared";
import { hayModeloConfigurado, mensajeDeErrorLLM } from "@/lib/llm";
import { generarRetro, type ResultadoRetro } from "@/lib/retro";
import { createClient, getUser } from "@/lib/supabase/server";

/**
 * Genera el borrador de retro de un proyecto (spec 6.5).
 *
 * Es la llamada más pesada de la app: modelo grande, todo el contexto del
 * proyecto y una salida larga. De ahí el `maxDuration` en el techo de
 * Vercel Pro y el timeout largo del lado del modelo.
 *
 * Devuelve el texto **sin guardarlo**: la pantalla lo muestra y Beno
 * decide. Las lecciones candidatas sí quedan esperando en la bandeja, que
 * es donde se confirman de a una.
 */

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const cuerpoSchema = z.object({
  projectId: z.string().uuid("Elegí un proyecto."),
});

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ActionResult<ResultadoRetro>>> {
  const user = await getUser();
  if (!user) {
    return NextResponse.json(fail("Sesión no encontrada."), { status: 401 });
  }

  if (!hayModeloConfigurado()) {
    return NextResponse.json(
      fail("No hay modelo configurado. Podés escribir la retro a mano."),
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
    const resultado = await generarRetro(
      supabase,
      user.id,
      parseo.data.projectId,
    );
    return NextResponse.json(ok(resultado));
  } catch (error: unknown) {
    console.error("[retro] falló:", error);
    return NextResponse.json(fail(mensajeDeErrorLLM(error)), { status: 500 });
  }
}
