import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok, type ActionResult } from "@/lib/actions/shared";
import { sugerirClasificacion, type Sugerencia } from "@/lib/clasificacion";
import { createClient, getUser } from "@/lib/supabase/server";

/**
 * Sugiere tipo y categoría para una descripción (spec 6.1).
 *
 * Route handler y no Server Action porque lo llama el formulario mientras
 * se escribe, y una Server Action serializa contra el resto de la cola de
 * acciones de la página: la sugerencia terminaría trabando el guardado.
 *
 * **Nunca devuelve error por culpa del modelo.** Si no hay sugerencia,
 * contesta `null` con 200 y el formulario sigue igual de vacío que antes.
 * La key de Groq no sale de acá: el cliente solo ve un id de categoría.
 */

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const cuerpoSchema = z.object({
  descripcion: z.string().trim().min(2).max(200),
});

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ActionResult<Sugerencia | null>>> {
  const user = await getUser();
  if (!user) {
    return NextResponse.json(fail("Sesión no encontrada."), { status: 401 });
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
  // Una descripción de un caracter no es un error del usuario: es que
  // todavía está escribiendo. Se contesta "no hay sugerencia".
  if (!parseo.success) return NextResponse.json(ok<Sugerencia | null>(null));

  const supabase = await createClient();

  try {
    const sugerencia = await sugerirClasificacion(
      supabase,
      parseo.data.descripcion,
    );
    return NextResponse.json(ok(sugerencia));
  } catch (error: unknown) {
    // Ni siquiera esto llega al usuario como error: sin sugerencia,
    // el formulario funciona igual.
    console.error("[clasificacion] falló la sugerencia:", error);
    return NextResponse.json(ok<Sugerencia | null>(null));
  }
}
