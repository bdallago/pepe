import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { MAX_ADJUNTOS, recibirAdjuntos } from "@/lib/agentes/adjuntos";
import { decidirDestinos } from "@/lib/agentes/recepcionista";
import { ejecutarCadena } from "@/lib/agentes/cadena";
import {
  DESTINOS,
  adjuntoSubidoSchema,
  type RespuestaAgente,
} from "@/lib/agentes/tipos";
import { hayModeloConfigurado, mensajeDeErrorLLM } from "@/lib/llm";
import { createClient, getUser } from "@/lib/supabase/server";
import { registrarUso, type DecisionRegistrada } from "@/lib/uso";

/**
 * La puerta de entrada de los agentes.
 *
 * Cáscara delgada, como el resto de los route handlers: autentica, valida
 * el cuerpo y traduce errores. Toda la decisión vive en `lib/agentes/`.
 */

export const dynamic = "force-dynamic";
// El razonador de la retro es lo más lento que puede pasar por acá.
export const maxDuration = 300;

const cuerpoSchema = z
  .object({
    /**
     * Sin adjuntos sigue siendo obligatoria; **con adjuntos puede venir
     * vacía**, y eso es un caso legítimo: arrastrar un PDF y nada más.
     * Antes el `min(1)` lo devolvía como 400.
     */
    frase: z.string().trim().max(1000),
    /** Cuando Beno elige una opción de una pregunta, ya sabemos el destino. */
    destino: z.enum(DESTINOS).optional(),
    /**
     * Hasta 1100 y no 300, que es lo que acepta el argumento del
     * recepcionista (`tipos.ts`).
     *
     * Este campo tiene dos orígenes distintos y solo uno es texto libre.
     * Cuando Beno corrige el destino con "¿no era esto?", la caja manda la
     * frase recortada a 300. Pero **las opciones de una pregunta las arma
     * la app**, y algunas empaquetan el texto de trabajo junto con la
     * entidad elegida (`"<texto> — <slug>"`, en `movimientos`,
     * `lecciones_tema` y `tema_estudio`). Ese texto puede ser la frase
     * entera, que llega hasta 1000: con el tope en 300 la opción volvía
     * **400** y el movimiento se perdía, con Beno teniendo que retipearlo.
     * Medido el 2026-08-11 con una frase de 298 caracteres, que produjo un
     * argumento de 317.
     */
    argumento: z.string().max(1100).nullable().optional(),
    /** Solo lo manda la caja cuando Beno eligió una opción de confirmación. */
    confirmado: z.boolean().optional(),
    /** Los archivos que el browser ya subió al bucket `adjuntos`. */
    adjuntos: z.array(adjuntoSubidoSchema).max(MAX_ADJUNTOS).optional(),
  })
  .refine((c) => c.frase.length > 0 || (c.adjuntos?.length ?? 0) > 0, {
    message: "Escribí algo o pegá un archivo.",
  });

export async function POST(request: NextRequest) {
  const arranque = Date.now();
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Sesión no encontrada." }, { status: 401 });
  }

  const parseado = cuerpoSchema.safeParse(await request.json().catch(() => null));
  if (!parseado.success) {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const { frase, destino, argumento, adjuntos, confirmado } = parseado.data;
  const supabase = await createClient();

  /**
   * Registra y contesta, en un solo lugar.
   *
   * Existe para que **las cuatro salidas de este handler queden
   * loggeadas** —los adjuntos, el modelo caído, la respuesta buena y el
   * error— sin repetir la llamada cuatro veces. Una salida sin log es una
   * interacción que después no se puede revisar, y son justo las salidas
   * raras las que más interesa mirar.
   *
   * `registrarUso` nunca lanza, así que esto no puede romper la respuesta.
   */
  const responder = async (
    respuesta: RespuestaAgente,
    extra: { decisiones?: DecisionRegistrada[]; error?: string } = {},
  ) => {
    await registrarUso(supabase, user.id, {
      superficie: "caja",
      pedido: frase,
      entrada: {
        frase,
        ...(destino ? { destino } : {}),
        ...(argumento ? { argumento } : {}),
        ...(confirmado ? { confirmado } : {}),
        ...(adjuntos?.length ? { adjuntos: adjuntos.length } : {}),
      },
      salida: respuesta,
      duracionMs: Date.now() - arranque,
      ...extra,
    });

    return NextResponse.json(respuesta);
  };

  // Con adjunto **no se llama al recepcionista**: que haya un archivo es
  // un hecho, no una interpretación, y el pase lo elige el MIME. El
  // porqué largo —incluida la contención de la inyección por prompt—
  // está en `agentes/adjuntos.ts`.
  //
  // Va antes que el chequeo de modelo a propósito: guardar el archivo y
  // registrarlo no necesita ninguno, y el archivo tiene que quedar
  // guardado aunque Groq esté caído (regla 7).
  if (adjuntos && adjuntos.length > 0) {
    try {
      const respuesta = await recibirAdjuntos(
        supabase,
        user.id,
        frase,
        adjuntos,
      );
      return await responder(respuesta satisfies RespuestaAgente);
    } catch (error: unknown) {
      console.error("[agentes] falló al recibir adjuntos:", error);
      return await responder(
        {
          clase: "aviso",
          titulo: "No pude registrar los archivos",
          cuerpo: "Se subieron, pero no quedaron anotados. Probá de nuevo.",
        } satisfies RespuestaAgente,
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  // Sin modelo la app sigue entera en modo manual (regla 7). Acá eso
  // significa decirlo y no romper.
  if (!destino && !hayModeloConfigurado()) {
    return await responder({
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
      ? [{ destino, argumento: argumento ?? null, confianza: 1, confirmado }]
      : await decidirDestinos(frase);

    // Una frase puede pedir varias cosas. Se ejecutan en orden y las
    // fallas no se contagian; el porqué está en `cadena.ts`.
    const respuesta = await ejecutarCadena(supabase, user.id, frase, decisiones);

    return await responder(respuesta, {
      // Sin esto el log diría **qué** contestó la app pero no **por qué**:
      // una derivación equivocada se ve igual que una correcta con el
      // argumento mal leído.
      decisiones: decisiones.map((d) => ({
        destino: d.destino,
        argumento: d.argumento,
        confianza: d.confianza,
      })),
    });
  } catch (error: unknown) {
    console.error("[agentes] falló:", error);
    return await responder(
      {
        clase: "aviso",
        titulo: "No pude procesar eso",
        cuerpo: mensajeDeErrorLLM(error),
      } satisfies RespuestaAgente,
      { error: error instanceof Error ? error.message : String(error) },
    );
  }
}
