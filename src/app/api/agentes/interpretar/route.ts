import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { decidirDestinos } from "@/lib/agentes/recepcionista";
import { ejecutarCadena } from "@/lib/agentes/cadena";
import { DESTINOS, type RespuestaAgente } from "@/lib/agentes/tipos";
import { hayModeloConfigurado, mensajeDeErrorLLM } from "@/lib/llm";
import { createClient, getUser } from "@/lib/supabase/server";

/**
 * La puerta de entrada de los agentes.
 *
 * Cáscara delgada, como el resto de los route handlers: autentica, valida
 * el cuerpo y traduce errores. Toda la decisión vive en `lib/agentes/`.
 */

export const dynamic = "force-dynamic";
// El razonador de la retro es lo más lento que puede pasar por acá.
export const maxDuration = 300;

const cuerpoSchema = z.object({
  frase: z.string().trim().min(1).max(1000),
  /** Cuando Beno elige una opción de una pregunta, ya sabemos el destino. */
  destino: z.enum(DESTINOS).optional(),
  argumento: z.string().max(300).nullable().optional(),
});

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Sesión no encontrada." }, { status: 401 });
  }

  const parseado = cuerpoSchema.safeParse(await request.json().catch(() => null));
  if (!parseado.success) {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const { frase, destino, argumento } = parseado.data;
  const supabase = await createClient();

  // Sin modelo la app sigue entera en modo manual (regla 7). Acá eso
  // significa decirlo y no romper.
  if (!destino && !hayModeloConfigurado()) {
    return NextResponse.json({
      clase: "aviso",
      titulo: "El modelo no está disponible",
      cuerpo: "Podés seguir usando la app normalmente desde el menú.",
    } satisfies RespuestaAgente);
  }

  try {
    // Si viene destino, es porque Beno eligió una opción: no se vuelve a
    // preguntar ni se gasta otra llamada. Con `confianza: 1` no vuelve a
    // caer en la pregunta de confianza baja, y al ser una sola acción la
    // cadena devuelve la respuesta pelada: este camino se comporta igual
    // que antes de que existieran las cadenas.
    const decisiones = destino
      ? [{ destino, argumento: argumento ?? null, confianza: 1 }]
      : await decidirDestinos(frase);

    // Una frase puede pedir varias cosas. Se ejecutan en orden y las
    // fallas no se contagian; el porqué está en `cadena.ts`.
    const respuesta = await ejecutarCadena(supabase, user.id, frase, decisiones);
    return NextResponse.json(respuesta);
  } catch (error: unknown) {
    console.error("[agentes] falló:", error);
    return NextResponse.json({
      clase: "aviso",
      titulo: "No pude procesar eso",
      cuerpo: mensajeDeErrorLLM(error),
    } satisfies RespuestaAgente);
  }
}
