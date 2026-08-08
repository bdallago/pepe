import { NextResponse } from "next/server";

import { fail, ok, type ActionResult } from "@/lib/actions/shared";
import {
  extraerLeccionesPendientes,
  type ReporteExtraccion,
} from "@/lib/extraccion";
import { hayModeloConfigurado, mensajeDeErrorLLM } from "@/lib/llm";
import { createClient, getUser } from "@/lib/supabase/server";

/**
 * Dispara el pase de extracción de lecciones sobre la bitácora (spec 3.1).
 *
 * Es un route handler y no una Server Action por el `maxDuration`: son
 * varias llamadas al modelo en serie, con el limitador de 30 req/min de
 * por medio. Vercel Pro permite hasta 300 s y acá se usan.
 *
 * El pase es retomable: procesa de a lotes y devuelve cuántas entradas
 * quedan. La pantalla vuelve a llamar si `restantes > 0`.
 */

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(): Promise<
  NextResponse<ActionResult<ReporteExtraccion>>
> {
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

  const supabase = await createClient();

  try {
    const reporte = await extraerLeccionesPendientes(supabase, user.id);
    return NextResponse.json(ok(reporte));
  } catch (error: unknown) {
    console.error("[extraccion] el pase falló entero:", error);
    return NextResponse.json(fail(mensajeDeErrorLLM(error)), { status: 500 });
  }
}
