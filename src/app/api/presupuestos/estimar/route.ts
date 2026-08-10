import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok, type ActionResult } from "@/lib/actions/shared";
import { hayModeloConfigurado, mensajeDeErrorLLM } from "@/lib/llm";
import {
  estimarEsfuerzo,
  type EstimacionEsfuerzo,
} from "@/lib/presupuestos/estimacion";
import { createClient, getUser } from "@/lib/supabase/server";

/**
 * Estima el esfuerzo de un pedido de cliente (etapa 2 del spec de
 * presupuestos).
 *
 * Route handler y no Server Action por el `maxDuration`: es el razonador
 * con salida larga, y el limitador de tokens **espera la ventana entera
 * antes de salir** porque la llamada no entra en un minuto (ver el
 * comentario de `maxTokens` en `lib/presupuestos/estimacion.ts`). Con el
 * timeout de una Server Action esto se cortaría solo.
 *
 * **No escribe nada.** La estimación vuelve como borrador editable y la
 * fila de `quotes` nace recién con "Guardar", igual que la retro.
 *
 * Regla 7: si Groq está caído, sin cuota o contesta algo que no valida,
 * acá sale un error legible y nada más. **Cargar el presupuesto a mano
 * sigue andando igual**: es el mismo formulario con la lista vacía.
 */

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const cuerpoSchema = z.object({
  pedidoTexto: z
    .string()
    .trim()
    .min(10, "Pegá el pedido del cliente para poder estimar.")
    // No es el corte de la estimación —ese es
    // `PRESUPUESTO_PEDIDO_CHARS`, lo hace la función y lo avisa en
    // `pedido_recortado`—: es solo un freno para no tragar un cuerpo
    // absurdo. Un pedido más largo que esto no se rechaza en silencio.
    .max(200_000, "Ese pedido es enorme. Recortalo a lo que importa."),
  tipoCliente: z.enum(["particular", "pyme", "empresa"]),
});

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ActionResult<EstimacionEsfuerzo>>> {
  const user = await getUser();
  if (!user) {
    return NextResponse.json(fail("Sesión no encontrada."), { status: 401 });
  }

  if (!hayModeloConfigurado()) {
    return NextResponse.json(
      fail("No hay modelo configurado. Podés cargar el presupuesto a mano."),
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
    const estimacion = await estimarEsfuerzo(supabase, user.id, parseo.data);
    return NextResponse.json(ok(estimacion));
  } catch (error: unknown) {
    console.error("[presupuestos] falló la estimación:", error);
    return NextResponse.json(fail(mensajeDeErrorLLM(error)), { status: 500 });
  }
}
