import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { aVectorPg, generarEmbedding } from "@/lib/embeddings";
import { fail, ok, type ActionResult } from "@/lib/actions/shared";
import { createClient, getUser } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Búsqueda de lecciones: semántica + full-text, fusionadas con RRF en la
 * base (`buscar_lecciones_hibrido`).
 *
 * Es un route handler y no una Server Action porque necesita
 * `maxDuration`: el arranque en frío tiene que cargar 266 MB de modelo y
 * el default de la plataforma no alcanza.
 *
 * Regla dura: **la búsqueda nunca falla por culpa del embedding.** Si el
 * modelo no carga, tarda de más o revienta, se llama a la RPC con
 * `p_embedding: null` y el full-text en español sostiene el resultado.
 * Al usuario no se le devuelve un error por eso; como mucho se le avisa
 * en `degradado` que esta vez buscó solo por palabra.
 */

// El arranque en frío carga 266 MB desde el disco de la función.
export const maxDuration = 60;

// Depende de la cookie de sesión: nunca se puede prerenderizar.
export const dynamic = "force-dynamic";

/**
 * Techo del embedding **dentro** del pedido.
 *
 * Es bastante menos que `maxDuration` a propósito: si el modelo está
 * frío, es preferible devolver resultados de full-text en 20 segundos
 * que resultados híbridos en 55. La primera búsqueda de la mañana sale
 * degradada y la siguiente ya encuentra el pipeline cargado en el
 * módulo.
 */
const TIMEOUT_EMBEDDING_MS = 20_000;

const LIMITE_POR_DEFECTO = 10;

const cuerpoSchema = z.object({
  // El mensaje va en el constructor y no solo en `.min()`: sin eso, un
  // body sin `consulta` cae en el default de Zod, que está en inglés.
  consulta: z
    .string({ error: "Escribí algo para buscar." })
    .trim()
    .min(1, "Escribí algo para buscar.")
    // Cota defensiva: e5 trunca a 512 tokens igual, y una consulta de
    // varios kilobytes solo sirve para hacer trabajar al modelo al pedo.
    .max(500, "La consulta es demasiado larga."),
  limite: z.coerce.number().int().min(1).max(50).default(LIMITE_POR_DEFECTO),
});

type Leccion =
  Database["public"]["Functions"]["buscar_lecciones_hibrido"]["Returns"][number];

export type ResultadoBusqueda = {
  resultados: Leccion[];
  /** `true` si se buscó solo por texto porque el embedding no salió. */
  degradado: boolean;
};

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ActionResult<ResultadoBusqueda>>> {
  // La RPC es `security invoker` y RLS filtra por usuario: se usa el
  // cliente con la sesión, nunca el admin.
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
    return NextResponse.json(
      fail(parseo.error.issues[0]?.message ?? "Consulta inválida."),
      { status: 400 },
    );
  }

  const { consulta, limite } = parseo.data;

  // --- Embedding: si falla, se sigue sin él -------------------
  let embedding: string | null = null;
  try {
    embedding = aVectorPg(
      await conTimeout(generarEmbedding(consulta, "query"), TIMEOUT_EMBEDDING_MS),
    );
  } catch (error: unknown) {
    console.error(
      "[embeddings] búsqueda degradada a full-text:",
      error instanceof Error ? error.message : error,
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("buscar_lecciones_hibrido", {
    p_consulta: consulta,
    // `?? undefined` y no `null`: omitir el parámetro deja que Postgres
    // aplique su `default null`, que es exactamente el caso degradado.
    // Los tipos generados no aceptan null en un argumento con default.
    p_embedding: embedding ?? undefined,
    p_limite: limite,
  });

  if (error) {
    // Acá sí es un error de verdad: se cayó la base, no el modelo.
    return NextResponse.json(fail(error.message), { status: 500 });
  }

  return NextResponse.json(
    ok<ResultadoBusqueda>({
      resultados: data ?? [],
      degradado: embedding === null,
    }),
  );
}

/** Corre una promesa con un techo de tiempo. */
async function conTimeout<T>(promesa: Promise<T>, ms: number): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promesa,
      new Promise<never>((_, rechazar) => {
        temporizador = setTimeout(
          () => rechazar(new Error(`El embedding tardó más de ${ms} ms.`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(temporizador);
  }
}
