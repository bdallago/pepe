"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { todayISO } from "@/lib/dates";
import type {
  Artifact,
  StudySession,
  Track,
} from "@/lib/supabase/database.types";

import {
  fail,
  mensajeDeError,
  ok,
  requireSession,
  slugify,
  type ActionResult,
} from "./shared";

/**
 * Acciones del temario: progreso de las sesiones, estado de los artefactos
 * y ajustes del track.
 *
 * Ojo con los check constraints del esquema. Hay dos pares que la base exige
 * consistentes y que acá se escriben SIEMPRE juntos:
 *   - `teoria_hecha = (teoria_fecha is not null)` (ídem aplicación)
 *   - `(estado = 'completado') = (fecha_completado is not null)`
 * Escribir el booleano sin la fecha (o al revés) no es un bug silencioso:
 * la base rechaza el UPDATE con un 23514.
 */

const uuid = z.string().uuid("Identificador inválido.");

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (formato AAAA-MM-DD).");

const estadoArtefactoSchema = z.enum([
  "no_empezado",
  "en_curso",
  "completado",
]);

const trackUpdateSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, "Poné un nombre.")
    .max(80, "Máximo 80 caracteres.")
    .optional(),
  // Días ISO, 1 = lunes .. 7 = domingo. Sin repetidos y ordenados, para que
  // la fila quede canónica venga como venga del formulario.
  cadencia: z
    .array(z.number().int().min(1).max(7))
    .min(1, "Elegí al menos un día.")
    .optional(),
  activo: z.boolean().optional(),
  // `null` es "todavía no arrancó", distinto de no mandar el campo.
  fecha_inicio: isoDate.nullable().optional(),
});

export type TrackUpdateInput = z.infer<typeof trackUpdateSchema>;

/**
 * Marca o desmarca un paso de una sesión.
 *
 * Al marcar se sella con la fecha de hoy; al desmarcar la fecha vuelve a
 * null. Nunca uno sin el otro.
 */
async function alternarPaso(
  sessionId: string,
  paso: "teoria" | "aplicacion",
): Promise<ActionResult<StudySession>> {
  const parsed = uuid.safeParse(sessionId);
  if (!parsed.success) return fail("Identificador inválido.");

  const { supabase } = await requireSession();

  const { data: actual, error: errorLectura } = await supabase
    .from("sessions")
    .select("teoria_hecha, aplicacion_hecha")
    .eq("id", parsed.data)
    .maybeSingle();

  if (errorLectura) return fail(mensajeDeError(errorLectura));
  if (!actual) return fail("No se encontró la sesión.");

  const hecha = paso === "teoria" ? actual.teoria_hecha : actual.aplicacion_hecha;
  const proxima = !hecha;
  const fecha = proxima ? todayISO() : null;

  const cambio =
    paso === "teoria"
      ? { teoria_hecha: proxima, teoria_fecha: fecha }
      : { aplicacion_hecha: proxima, aplicacion_fecha: fecha };

  const { data, error } = await supabase
    .from("sessions")
    .update(cambio)
    .eq("id", parsed.data)
    .select()
    .single();

  if (error) return fail(mensajeDeError(error));

  revalidatePath("/", "layout");
  return ok(data);
}

export async function alternarTeoria(
  sessionId: string,
): Promise<ActionResult<StudySession>> {
  return alternarPaso(sessionId, "teoria");
}

export async function alternarAplicacion(
  sessionId: string,
): Promise<ActionResult<StudySession>> {
  return alternarPaso(sessionId, "aplicacion");
}

/**
 * Cambia el estado de un artefacto. La fecha de completado acompaña al
 * estado: se pone al pasar a 'completado' y se limpia al salir.
 */
export async function cambiarEstadoArtefacto(
  artifactId: string,
  estado: Artifact["estado"],
): Promise<ActionResult<Artifact>> {
  const parsedId = uuid.safeParse(artifactId);
  if (!parsedId.success) return fail("Identificador inválido.");

  const parsedEstado = estadoArtefactoSchema.safeParse(estado);
  if (!parsedEstado.success) return fail("Estado inválido.");

  const { supabase } = await requireSession();

  const { data, error } = await supabase
    .from("artifacts")
    .update({
      estado: parsedEstado.data,
      fecha_completado:
        parsedEstado.data === "completado" ? todayISO() : null,
    })
    .eq("id", parsedId.data)
    .select()
    .single();

  if (error) return fail(mensajeDeError(error));

  revalidatePath("/", "layout");
  return ok(data);
}

/**
 * Actualiza el track. Todos los campos son opcionales: manda solo lo que
 * cambia. Sin campos no toca nada y devuelve la fila tal cual está.
 */
export async function actualizarTrack(
  trackId: string,
  input: TrackUpdateInput,
): Promise<ActionResult<Track>> {
  const parsedId = uuid.safeParse(trackId);
  if (!parsedId.success) return fail("Identificador inválido.");

  const parsed = trackUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }

  const { cadencia, ...resto } = parsed.data;
  const cambio = {
    ...resto,
    ...(cadencia ? { cadencia: [...new Set(cadencia)].sort((a, b) => a - b) } : {}),
  };

  const { supabase } = await requireSession();

  const { data, error } = await supabase
    .from("tracks")
    .update(cambio)
    .eq("id", parsedId.data)
    .select()
    .single();

  if (error) return fail(mensajeDeError(error));

  revalidatePath("/", "layout");
  return ok(data);
}

/**
 * Convierte una sugerencia de estudio en una sesión de un track (spec 6.4).
 *
 * Es lo único que la pantalla de sugerencias escribe en la base, y lo
 * escribe porque Beno apretó el botón: la sugerencia en sí es salida en
 * pantalla y no pasa por la bandeja.
 *
 * La sesión nace al final del track y sin bloque: no es parte del temario
 * que vino del importador, es algo que se agregó después. Meterla en un
 * bloque existente mentiría sobre de dónde salió.
 */
export async function crearSesionDesdeSugerencia(
  trackId: string,
  input: { titulo: string; consigna: string; teoriaTexto?: string },
): Promise<ActionResult<StudySession>> {
  const parsedTrack = uuid.safeParse(trackId);
  if (!parsedTrack.success) return fail("Identificador inválido.");

  const parsed = z
    .object({
      titulo: z.string().trim().min(1, "Poné un título.").max(200),
      consigna: z.string().trim().min(1, "Poné una consigna.").max(2000),
      teoriaTexto: z.string().trim().max(4000).optional(),
    })
    .safeParse(input);

  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }

  const { supabase, userId } = await requireSession();

  // El orden va después de la última del track, archivadas incluidas: si
  // se contaran solo las visibles, desarchivar una podría dejar dos
  // sesiones con el mismo número.
  const { data: ultima } = await supabase
    .from("sessions")
    .select("orden")
    .eq("track_id", parsedTrack.data)
    .order("orden", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("sessions")
    .insert({
      user_id: userId,
      track_id: parsedTrack.data,
      // El slug es único por usuario y acá no viene de ningún export, así
      // que se genera. El sufijo aleatorio evita chocar con una sesión
      // vieja de título parecido.
      slug: `sugerida-${slugify(parsed.data.titulo).slice(0, 60)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      titulo: parsed.data.titulo,
      consigna: parsed.data.consigna,
      teoria_texto: parsed.data.teoriaTexto ?? null,
      orden: (ultima?.orden ?? 0) + 1,
    })
    .select()
    .single();

  if (error) return fail(mensajeDeError(error));

  revalidatePath("/", "layout");
  return ok(data);
}
