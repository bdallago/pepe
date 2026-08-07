import { addDays, mondayOf, todayISO, weekday } from "@/lib/dates";
import type {
  Artifact,
  Block,
  DailyLog,
  EstadoArtefacto,
  StudySession,
  Track,
} from "@/lib/supabase/database.types";

/**
 * Planificación elástica del módulo de aprendizaje.
 *
 * Todo lo de acá son funciones puras: reciben filas y devuelven qué toca.
 * No hay vencimientos. El plan avanza por COMPLETITUD, no por calendario:
 * si un día no estudiás, la próxima sesión sigue siendo la próxima y nada
 * se "vence". Lo único que mira el calendario es en qué días de la semana
 * toca cada track (`tracks.cadencia`) y desde cuándo (`tracks.fecha_inicio`).
 *
 * Diferencia importante contra la app de origen: allá el progreso vivía en
 * un diccionario aparte y se pasaba a cada función. Acá vive en la propia
 * fila de `sessions` (`teoria_hecha` / `aplicacion_hecha` y sus fechas), así
 * que no hay diccionario que arrastrar: `isComplete` mira la sesión.
 *
 * Sin `server-only` a propósito: lo consumen tanto Server Components como
 * componentes cliente.
 */

// ─────────────────────────────────────────────────────────────
// Días de la semana
// ─────────────────────────────────────────────────────────────

/** Día ISO: 1 = lunes … 7 = domingo, igual que `tracks.cadencia`. */
export type DiaSemana = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * Etiquetas indexadas POR EL DÍA ISO, no por posición de array.
 *
 * En la app de origen esto era un array 0-based que se leía con
 * `WEEKDAY_LABELS[weekday - 1]`, y ese `- 1` es un off-by-one esperando
 * suceder. Acá la clave es directamente el día: `WEEKDAY_LABELS[1]` es
 * "Lun" y no hay resta que olvidarse.
 */
export const WEEKDAY_LABELS: Readonly<Record<DiaSemana, string>> = {
  1: "Lun",
  2: "Mar",
  3: "Mié",
  4: "Jue",
  5: "Vie",
  6: "Sáb",
  7: "Dom",
};

export function esDiaSemana(dia: number): dia is DiaSemana {
  return Number.isInteger(dia) && dia >= 1 && dia <= 7;
}

/** Etiqueta corta del día ISO. Devuelve "" si el número no es 1..7. */
export function etiquetaDia(dia: number): string {
  return esDiaSemana(dia) ? WEEKDAY_LABELS[dia] : "";
}

// ─────────────────────────────────────────────────────────────
// Orden y progreso
// ─────────────────────────────────────────────────────────────

/** Progreso de un conjunto de sesiones, listo para una barra. */
export interface Progreso {
  hechas: number;
  total: number;
  /** Entero 0..100. */
  pct: number;
}

function progresoDe(sessions: StudySession[]): Progreso {
  const hechas = sessions.filter(isComplete).length;
  return {
    hechas,
    total: sessions.length,
    pct: sessions.length ? Math.round((hechas / sessions.length) * 100) : 0,
  };
}

/**
 * Sesiones de un track en el orden en que se cursan: primero por el orden
 * del bloque, después por el orden dentro del bloque.
 *
 * Una sesión sin bloque (la FK es ON DELETE SET NULL) se va al final en vez
 * de romper la comparación, que es lo que pasaba en el origen restando un
 * `undefined`.
 */
export function orderedSessions(
  trackId: string,
  blocks: Block[],
  sessions: StudySession[],
): StudySession[] {
  const ordenDeBloque = new Map(
    blocks.filter((b) => b.track_id === trackId).map((b) => [b.id, b.orden]),
  );
  const orden = (blockId: string | null) =>
    (blockId === null ? undefined : ordenDeBloque.get(blockId)) ??
    Number.MAX_SAFE_INTEGER;

  return sessions
    .filter((s) => s.track_id === trackId)
    .sort(
      (a, b) => orden(a.block_id) - orden(b.block_id) || a.orden - b.orden,
    );
}

/**
 * Una sesión está completa cuando se leyó la teoría Y se aplicó. Son dos
 * pasos distintos a propósito: "leí el tema pero todavía no lo apliqué" es
 * un estado real y es el punto de la app.
 */
export function isComplete(
  session: Pick<StudySession, "teoria_hecha" | "aplicacion_hecha">,
): boolean {
  return session.teoria_hecha && session.aplicacion_hecha;
}

/** Próxima sesión incompleta del track, o null si el track está terminado. */
export function nextSession(
  trackId: string,
  blocks: Block[],
  sessions: StudySession[],
): StudySession | null {
  return (
    orderedSessions(trackId, blocks, sessions).find((s) => !isComplete(s)) ??
    null
  );
}

export function trackProgress(
  trackId: string,
  blocks: Block[],
  sessions: StudySession[],
): Progreso {
  return progresoDe(orderedSessions(trackId, blocks, sessions));
}

export function blockProgress(
  blockId: string,
  sessions: StudySession[],
): Progreso {
  return progresoDe(sessions.filter((s) => s.block_id === blockId));
}

/** Bloque en el que está parado el track: el de su próxima sesión. */
export function currentBlock(
  trackId: string,
  blocks: Block[],
  sessions: StudySession[],
): Block | null {
  const proxima = nextSession(trackId, blocks, sessions);
  if (!proxima) return null;
  return blocks.find((b) => b.id === proxima.block_id) ?? null;
}

// ─────────────────────────────────────────────────────────────
// Qué toca hoy
// ─────────────────────────────────────────────────────────────

export interface ItemDeHoy {
  track: Track;
  /** Próxima sesión incompleta, o null si el track ya está terminado. */
  session: StudySession | null;
  block: Block | null;
  /** El track ya arrancó: tiene `fecha_inicio` y no es futura. */
  arrancado: boolean;
  /** Hoy es día de este track y ya arrancó. */
  esHoy: boolean;
}

export interface Hoy {
  fecha: string;
  weekday: number;
  items: ItemDeHoy[];
  /** Dos o más tracks con sesión pendiente el mismo día. */
  diaDoble: boolean;
  /** Falso cuando ningún track activo arrancó todavía. */
  algunTrackArranco: boolean;
}

/**
 * Un track arrancó si tiene fecha de inicio y esa fecha ya pasó.
 *
 * `fecha_inicio` es nullable a propósito: un track recién creado todavía no
 * arrancó, y eso es distinto de haber arrancado hoy.
 */
export function trackArrancado(
  track: Pick<Track, "fecha_inicio">,
  fecha: string,
): boolean {
  return track.fecha_inicio !== null && fecha >= track.fecha_inicio;
}

function tracksActivosEnOrden(tracks: Track[]): Track[] {
  return tracks.filter((t) => t.activo).sort((a, b) => a.orden - b.orden);
}

/** Para cada track activo, qué le toca en `fecha` (por defecto, hoy). */
export function computeToday({
  fecha = todayISO(),
  tracks,
  blocks,
  sessions,
}: {
  fecha?: string;
  tracks: Track[];
  blocks: Block[];
  sessions: StudySession[];
}): Hoy {
  const wd = weekday(fecha);

  const items = tracksActivosEnOrden(tracks).map((track) => {
    const arrancado = trackArrancado(track, fecha);
    return {
      track,
      session: nextSession(track.id, blocks, sessions),
      block: currentBlock(track.id, blocks, sessions),
      arrancado,
      esHoy: arrancado && track.cadencia.includes(wd),
    };
  });

  return {
    fecha,
    weekday: wd,
    items,
    diaDoble: items.filter((i) => i.esHoy && i.session).length >= 2,
    algunTrackArranco: items.some((i) => i.arrancado),
  };
}

// ─────────────────────────────────────────────────────────────
// Proyección de la semana
// ─────────────────────────────────────────────────────────────

export interface EntradaDeDia {
  track: Track;
  session: StudySession;
}

export interface DiaProyectado {
  fecha: string;
  weekday: number;
  entradas: EntradaDeDia[];
}

/**
 * Proyecta la semana que contiene `fecha`: camina las próximas sesiones
 * incompletas de cada track sobre sus días de cadencia.
 *
 * Es una proyección, no un compromiso: si un día no estudiás, la sesión no
 * se pierde, se corre. Por eso cada track lleva su propia cola y se consume
 * de a una por día activo.
 */
export function computeWeek({
  fecha = todayISO(),
  tracks,
  blocks,
  sessions,
}: {
  fecha?: string;
  tracks: Track[];
  blocks: Block[];
  sessions: StudySession[];
}): DiaProyectado[] {
  const lunes = mondayOf(fecha);
  const activos = tracksActivosEnOrden(tracks);

  const colas = new Map<string, StudySession[]>(
    activos.map((t) => [
      t.id,
      orderedSessions(t.id, blocks, sessions).filter((s) => !isComplete(s)),
    ]),
  );

  return Array.from({ length: 7 }, (_, i) => addDays(lunes, i)).map((dia) => {
    const wd = weekday(dia);
    const entradas: EntradaDeDia[] = [];

    for (const track of activos) {
      if (!trackArrancado(track, dia)) continue;
      if (!track.cadencia.includes(wd)) continue;
      const session = colas.get(track.id)?.shift();
      if (session) entradas.push({ track, session });
    }

    return { fecha: dia, weekday: wd, entradas };
  });
}

// ─────────────────────────────────────────────────────────────
// Racha
// ─────────────────────────────────────────────────────────────

/**
 * Días consecutivos con alguna actividad, terminando hoy o ayer.
 *
 * Cuenta como actividad haber marcado teoría o aplicación, y también haber
 * escrito en la bitácora. Se permite cortar en ayer para no "perder" la
 * racha a la mañana, antes de sentarse a estudiar.
 */
export function computeStreak(
  sessions: Pick<StudySession, "teoria_fecha" | "aplicacion_fecha">[],
  logs: Pick<DailyLog, "fecha">[],
  hoy: string = todayISO(),
): number {
  const activos = new Set<string>();
  for (const s of sessions) {
    if (s.teoria_fecha) activos.add(s.teoria_fecha);
    if (s.aplicacion_fecha) activos.add(s.aplicacion_fecha);
  }
  for (const l of logs) if (l.fecha) activos.add(l.fecha);

  let cursor = hoy;
  if (!activos.has(cursor)) {
    const ayer = addDays(hoy, -1);
    if (!activos.has(ayer)) return 0;
    cursor = ayer;
  }

  let racha = 0;
  while (activos.has(cursor)) {
    racha++;
    cursor = addDays(cursor, -1);
  }
  return racha;
}

// ─────────────────────────────────────────────────────────────
// Repaso
// ─────────────────────────────────────────────────────────────

/** Sesión terminada, con el día en que se cerró (el más tardío de los dos). */
export type SesionCompletada = StudySession & { completedOn: string };

/**
 * Sesiones ya completadas, con su fecha de cierre. Es la entrada del quiz de
 * repaso: se ordena por esa fecha para preguntar primero lo más viejo.
 */
export function completedSessions(
  sessions: StudySession[],
): SesionCompletada[] {
  return sessions.filter(isComplete).map((s) => {
    // Las dos fechas existen si la sesión está completa (lo garantizan los
    // check constraints), pero el tipo generado las da como nullable.
    const fechas = [s.teoria_fecha, s.aplicacion_fecha].filter(
      (f): f is string => f !== null,
    );
    fechas.sort();
    return { ...s, completedOn: fechas[fechas.length - 1] ?? "" };
  });
}

// ─────────────────────────────────────────────────────────────
// Artefactos
// ─────────────────────────────────────────────────────────────

export const ESTADO_ARTEFACTO_LABEL: Readonly<Record<EstadoArtefacto, string>> =
  {
    no_empezado: "No empezado",
    en_curso: "En curso",
    completado: "Completado",
  };

/**
 * El estado del artefacto se cambia tocándolo: cicla
 * no_empezado → en_curso → completado → no_empezado.
 */
export function siguienteEstadoArtefacto(
  estado: EstadoArtefacto,
): EstadoArtefacto {
  const ciclo: EstadoArtefacto[] = ["no_empezado", "en_curso", "completado"];
  return ciclo[(ciclo.indexOf(estado) + 1) % ciclo.length];
}

/** Cuántos artefactos del track están completados, sobre el total. */
export function progresoArtefactos(
  trackId: string,
  artifacts: Artifact[],
): Progreso {
  const propios = artifacts.filter((a) => a.track_id === trackId);
  const hechas = propios.filter((a) => a.estado === "completado").length;
  return {
    hechas,
    total: propios.length,
    pct: propios.length ? Math.round((hechas / propios.length) * 100) : 0,
  };
}
