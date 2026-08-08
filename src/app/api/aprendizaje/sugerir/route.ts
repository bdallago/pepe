import { NextResponse } from "next/server";

import { fail, ok, type ActionResult } from "@/lib/actions/shared";
import { hayModeloConfigurado, mensajeDeErrorLLM } from "@/lib/llm";
import { sugerirQueEstudiar, type Sugerencia } from "@/lib/sugerencias";
import { createClient, getUser } from "@/lib/supabase/server";

/**
 * Sugiere qué estudiar según lo que Beno viene trabajando (spec 6.4).
 *
 * No recibe cuerpo: el contexto lo arma el servidor leyendo los datos
 * reales. Tampoco escribe nada —la salida es de pantalla— así que no
 * pasa por la bandeja.
 */

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(): Promise<
  NextResponse<ActionResult<Sugerencia[]>>
> {
  const user = await getUser();
  if (!user) {
    return NextResponse.json(fail("Sesión no encontrada."), { status: 401 });
  }

  if (!hayModeloConfigurado()) {
    return NextResponse.json(
      fail("No hay modelo configurado. El resto de Aprendizaje anda igual."),
      { status: 503 },
    );
  }

  const supabase = await createClient();

  try {
    const sugerencias = await sugerirQueEstudiar(supabase);
    return NextResponse.json(ok(sugerencias));
  } catch (error: unknown) {
    console.error("[sugerencias] falló:", error);
    return NextResponse.json(fail(mensajeDeErrorLLM(error)), { status: 500 });
  }
}
