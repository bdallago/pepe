import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok, type ActionResult } from "@/lib/actions/shared";
import { reindexarLeccion } from "@/lib/actions/lessons";
import { getUser } from "@/lib/supabase/server";

/**
 * Genera el embedding de una lección recién creada.
 *
 * Vive aparte de la action que la crea porque los tiempos son opuestos:
 * aceptar una propuesta de la bandeja tiene que sentirse instantáneo, y
 * cargar 266 MB de modelo en frío no lo es. La pantalla dispara esto y
 * sigue con el ítem siguiente sin esperar la respuesta.
 *
 * Que falle no rompe nada: la lección ya está guardada y sigue siendo
 * buscable por full-text. `npm run backfill:embeddings` levanta después
 * las que quedaron sin vector.
 */

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const cuerpoSchema = z.object({ id: z.string().uuid() });

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ActionResult>> {
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
  if (!parseo.success) {
    return NextResponse.json(fail("Identificador inválido."), { status: 400 });
  }

  // `reindexarLeccion` nunca lanza: loguea y sigue. RLS se encarga de que
  // solo se pueda indexar una lección propia.
  await reindexarLeccion(parseo.data.id);

  return NextResponse.json(ok());
}
