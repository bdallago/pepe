/**
 * Importador del backup de La Colmena (la app de estudio que vivía aparte)
 * al módulo de aprendizaje de esta app.
 *
 *   npm run import:colmena [ruta-al-json]
 *
 * Es **idempotente**: cada entidad del export tiene un id estable ('pm',
 * 'pm-w1', 'pm-w1-s1', ...) que acá se guarda como `slug`, y todas las
 * tablas destino tienen un único `(user_id, slug)`. Correrlo dos veces
 * actualiza en vez de duplicar.
 *
 * Usa la service role key y saltea RLS, igual que el cron: es un proceso de
 * mantenimiento que corre fuera de una sesión de usuario.
 *
 * Nada de acá toca las tablas de finanzas. La única escritura fuera del
 * módulo de aprendizaje es crear el proyecto Gentius, que es a lo que
 * cuelga la bitácora importada.
 *
 * ⚠ **Ya no se puede volver a correr sobre el JSON original sin perder
 * trabajo.** El 2026-08-08 se renombró "HRKit" a "Gentius" en el temario
 * ya importado —1 track, 8 bloques y 36 sesiones—, y el backup de origen
 * sigue diciendo HRKit. Como el upsert es por `slug`, una corrida nueva
 * pisaría los títulos, subtítulos y consignas con el nombre viejo.
 *
 * La entrada de bitácora que menciona HRKit **quedó intacta a propósito**:
 * es registro de lo que Beno pensó ese día, y ese día el proyecto se
 * llamaba así.
 *
 * Si alguna vez hace falta reimportar, corregir antes el JSON de origen.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

import { leerEnvLocal } from "./env-local.ts";

// ------------------------------------------------------------
// Configuración
// ------------------------------------------------------------

const RUTA_POR_DEFECTO = "colmena-backup-2026-08-07.json";

/**
 * Los colores salen de los ocho tonos validados de `globals.css`
 * (`--chart-1..8`) y no de los `accent` del export (#d97706 y #0f766e):
 * esos dos nunca pasaron por el validador de contraste contra las
 * superficies crema/verde-negro de esta app, y el teal #0f766e además
 * tiene la croma demasiado baja para leerse como color de datos.
 *
 * Gentius va en naranja porque el teal y el azul ya están tomados por
 * "El Prode de Beno" y "Proder".
 */
const COLOR_GENTIUS = "#d63f00"; // chart-2, naranja de marca
const COLOR_POR_TRACK: Record<string, string> = {
  pm: "#eda100", // chart-4, amarillo: lo más cerca del ámbar original
  dev: "#008300", // chart-6, verde: reemplaza al teal original, que ya usa un proyecto
};

const ESTADOS_ARTEFACTO: Record<string, string> = {
  "no-empezado": "no_empezado",
  "en-curso": "en_curso",
  completado: "completado",
};

// ------------------------------------------------------------
// Tipos del export (lo que hay en el JSON, no lo que hay en la base)
// ------------------------------------------------------------

type Indexado<T> = Record<string, T>;

type TrackExport = {
  id: string;
  nombre: string;
  daysOfWeek: number[];
  activo: boolean;
  orden: number;
  tipo?: string;
  accent?: string;
};

type BlockExport = {
  id: string;
  titulo: string;
  subtitulo?: string | null;
  fuentes?: { t: string; u: string }[];
  orden: number;
  trackId: string;
};

type SessionExport = {
  id: string;
  titulo: string;
  teoria?: { texto?: string | null; link?: string | null } | null;
  consigna?: string | null;
  orden: number;
  blockId: string;
  trackId: string;
};

type ProgressExport = {
  id: string;
  teoriaDone?: boolean;
  teoriaDate?: string | null;
  aplicacionDone?: boolean;
  aplicacionDate?: string | null;
};

type ArtifactExport = {
  id: string;
  nombre: string;
  estado: string;
  trackId: string;
};

type LogExport = {
  id: string;
  fecha: string;
  texto: string;
  trackId?: string | null;
};

type Backup = {
  exportedAt?: string;
  meta?: Record<string, unknown>;
  entities: {
    tracks: Indexado<TrackExport>;
    blocks: Indexado<BlockExport>;
    sessions: Indexado<SessionExport>;
    progress: Indexado<ProgressExport>;
    artifacts: Indexado<ArtifactExport>;
    logs: Indexado<LogExport>;
  };
};

// ------------------------------------------------------------
// Reporte
// ------------------------------------------------------------

type Reporte = {
  entidad: string;
  tabla: string;
  enJson: number;
  insertadas: number;
  actualizadas: number;
  omitidas: { slug: string; motivo: string }[];
};

const reportes: Reporte[] = [];

function anotar(reporte: Reporte) {
  reportes.push(reporte);
  return reporte;
}

// ------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------

/** Ordena por el sufijo numérico del id: 'pm-art-10' va después de 'pm-art-2'. */
function ordenDesdeSufijo(id: string): number {
  const match = id.match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

/** Cliente con service role: saltea RLS y no persiste sesión (es un script). */
function crearCliente(url: string, serviceKey: string) {
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function fallar(mensaje: string): never {
  console.error(`\n✖ ${mensaje}\n`);
  process.exit(1);
}

// ------------------------------------------------------------
// Importador
// ------------------------------------------------------------

async function main() {
  const raiz = process.cwd();
  const rutaJson = resolve(raiz, process.argv[2] ?? RUTA_POR_DEFECTO);

  const env = leerEnvLocal(raiz);
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    fallar(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local",
    );
  }

  const supabase = crearCliente(url, serviceKey);

  const backup = JSON.parse(readFileSync(rutaJson, "utf8")) as Backup;
  const { tracks, blocks, sessions, progress, artifacts, logs } =
    backup.entities;

  console.log(`\n▸ Importando ${rutaJson}`);
  console.log(`  exportado el ${backup.exportedAt ?? "(sin fecha)"}\n`);

  // --- Usuario ------------------------------------------------
  // App de un solo usuario. Si hay 0 o más de 1, no hay forma correcta de
  // elegir: abortamos antes de escribir nada.
  const { data: usuarios, error: errorUsuarios } =
    await supabase.auth.admin.listUsers();
  if (errorUsuarios) fallar(`No pude listar usuarios: ${errorUsuarios.message}`);
  if (usuarios.users.length !== 1) {
    fallar(
      `Esperaba exactamente 1 usuario en auth.users y encontré ${usuarios.users.length}. ` +
        "Es una app de un solo usuario: no elijo por vos.",
    );
  }
  const userId = usuarios.users[0].id;
  console.log(`  usuario: ${usuarios.users[0].email} (${userId})\n`);

  // --- Proyecto Gentius ---------------------------------------
  // Nace sin ventana (`fecha_inicio` y `fecha_fin` en null, que es el
  // default de la tabla): "existió desde siempre y sigue abierto". El
  // importador no sabe cuándo arrancó de verdad —el export de la app de
  // estudio no trae esa fecha— y adivinarla acá le movería el prorrateo
  // de todo el histórico. Si hace falta acotarla, se hace a mano en
  // Ajustes, que es donde se ve el efecto.
  const { data: proyectoPrevio } = await supabase
    .from("projects")
    .select("id")
    .eq("user_id", userId)
    .eq("slug", "gentius")
    .maybeSingle();

  const { data: gentius, error: errorProyecto } = await supabase
    .from("projects")
    .upsert(
      {
        user_id: userId,
        slug: "gentius",
        nombre: "Gentius",
        color: COLOR_GENTIUS,
        peso_prorrateo: 1,
      },
      { onConflict: "user_id,slug" },
    )
    .select("id")
    .single();
  if (errorProyecto) fallar(`Proyecto Gentius: ${errorProyecto.message}`);

  anotar({
    entidad: "proyecto Gentius",
    tabla: "projects",
    enJson: 1,
    insertadas: proyectoPrevio ? 0 : 1,
    actualizadas: proyectoPrevio ? 1 : 0,
    omitidas: [],
  });

  const projectId = gentius.id;

  // --- Tracks --------------------------------------------------
  const previosTracks = await slugsExistentes(supabase, "tracks", userId);
  const filasTracks = Object.values(tracks).map((t) => ({
    user_id: userId,
    slug: t.id,
    nombre: t.nombre,
    cadencia: t.daysOfWeek,
    color: COLOR_POR_TRACK[t.id] ?? "#008f8f",
    activo: t.activo,
    orden: t.orden,
  }));
  const { data: tracksGuardados, error: errorTracks } = await supabase
    .from("tracks")
    .upsert(filasTracks, { onConflict: "user_id,slug" })
    .select("id, slug");
  if (errorTracks) fallar(`tracks: ${errorTracks.message}`);

  const idPorTrack = new Map(tracksGuardados.map((t) => [t.slug, t.id]));
  anotar(
    contar("tracks", "tracks", Object.keys(tracks).length, filasTracks, previosTracks, []),
  );

  // --- Blocks --------------------------------------------------
  const previosBlocks = await slugsExistentes(supabase, "blocks", userId);
  const omitidosBlocks: { slug: string; motivo: string }[] = [];
  const filasBlocks = [];
  for (const b of Object.values(blocks)) {
    const trackId = idPorTrack.get(b.trackId);
    if (!trackId) {
      omitidosBlocks.push({ slug: b.id, motivo: `track '${b.trackId}' inexistente` });
      continue;
    }
    filasBlocks.push({
      user_id: userId,
      track_id: trackId,
      slug: b.id,
      titulo: b.titulo,
      subtitulo: b.subtitulo ?? null,
      fuentes: b.fuentes ?? [],
      orden: b.orden,
    });
  }
  const { data: blocksGuardados, error: errorBlocks } = await supabase
    .from("blocks")
    .upsert(filasBlocks, { onConflict: "user_id,slug" })
    .select("id, slug");
  if (errorBlocks) fallar(`blocks: ${errorBlocks.message}`);

  const idPorBlock = new Map(blocksGuardados.map((b) => [b.slug, b.id]));
  anotar(
    contar(
      "blocks",
      "blocks",
      Object.keys(blocks).length,
      filasBlocks,
      previosBlocks,
      omitidosBlocks,
    ),
  );

  // --- Sessions (fusionadas con progress) -----------------------
  // El progreso viene en una entidad aparte, indexada por el mismo id de la
  // sesión. Acá se fusiona: en el esquema nuevo es parte de la fila.
  const previosSessions = await slugsExistentes(supabase, "sessions", userId);
  const omitidasSessions: { slug: string; motivo: string }[] = [];
  const filasSessions = [];
  for (const s of Object.values(sessions)) {
    const trackId = idPorTrack.get(s.trackId);
    if (!trackId) {
      omitidasSessions.push({ slug: s.id, motivo: `track '${s.trackId}' inexistente` });
      continue;
    }
    const p = progress[s.id];
    const teoriaFecha = p?.teoriaDate ?? null;
    const teoriaHecha = Boolean(p?.teoriaDone);
    const aplicacionFecha = p?.aplicacionDate ?? null;
    const aplicacionHecha = Boolean(p?.aplicacionDone);

    // El esquema exige hecha ⇔ fecha. Si el export trae uno sin el otro,
    // no inventamos ni la fecha ni el booleano: es un dato roto y hay que
    // verlo, no taparlo con un default.
    if (teoriaHecha !== (teoriaFecha !== null)) {
      omitidasSessions.push({
        slug: s.id,
        motivo: `progreso de teoría inconsistente (hecha=${teoriaHecha}, fecha=${teoriaFecha})`,
      });
      continue;
    }
    if (aplicacionHecha !== (aplicacionFecha !== null)) {
      omitidasSessions.push({
        slug: s.id,
        motivo: `progreso de aplicación inconsistente (hecha=${aplicacionHecha}, fecha=${aplicacionFecha})`,
      });
      continue;
    }

    filasSessions.push({
      user_id: userId,
      track_id: trackId,
      block_id: idPorBlock.get(s.blockId) ?? null,
      slug: s.id,
      titulo: s.titulo,
      teoria_texto: s.teoria?.texto ?? null,
      teoria_link: s.teoria?.link ?? null,
      consigna: s.consigna ?? null,
      orden: s.orden,
      teoria_hecha: teoriaHecha,
      teoria_fecha: teoriaFecha,
      aplicacion_hecha: aplicacionHecha,
      aplicacion_fecha: aplicacionFecha,
    });
  }
  const { error: errorSessions } = await supabase
    .from("sessions")
    .upsert(filasSessions, { onConflict: "user_id,slug" })
    .select("id");
  if (errorSessions) fallar(`sessions: ${errorSessions.message}`);
  anotar(
    contar(
      "sessions",
      "sessions",
      Object.keys(sessions).length,
      filasSessions,
      previosSessions,
      omitidasSessions,
    ),
  );

  // --- Artifacts ------------------------------------------------
  const previosArtifacts = await slugsExistentes(supabase, "artifacts", userId);
  const omitidosArtifacts: { slug: string; motivo: string }[] = [];
  const filasArtifacts = [];
  for (const a of Object.values(artifacts)) {
    const trackId = idPorTrack.get(a.trackId);
    if (!trackId) {
      omitidosArtifacts.push({ slug: a.id, motivo: `track '${a.trackId}' inexistente` });
      continue;
    }
    const estado = ESTADOS_ARTEFACTO[a.estado];
    if (!estado) {
      omitidosArtifacts.push({ slug: a.id, motivo: `estado desconocido '${a.estado}'` });
      continue;
    }
    // El check exige completado ⇔ fecha_completado. El export no guarda la
    // fecha de completado, así que un artefacto completado no se puede
    // importar sin inventarla: se reporta.
    if (estado === "completado") {
      omitidosArtifacts.push({
        slug: a.id,
        motivo: "completado pero el export no trae fecha de completado",
      });
      continue;
    }
    filasArtifacts.push({
      user_id: userId,
      track_id: trackId,
      slug: a.id,
      nombre: a.nombre,
      estado: estado as "no_empezado" | "en_curso" | "completado",
      fecha_completado: null,
      orden: ordenDesdeSufijo(a.id),
    });
  }
  const { error: errorArtifacts } = await supabase
    .from("artifacts")
    .upsert(filasArtifacts, { onConflict: "user_id,slug" })
    .select("id");
  if (errorArtifacts) fallar(`artifacts: ${errorArtifacts.message}`);
  anotar(
    contar(
      "artifacts",
      "artifacts",
      Object.keys(artifacts).length,
      filasArtifacts,
      previosArtifacts,
      omitidosArtifacts,
    ),
  );

  // --- Bitácora --------------------------------------------------
  // Todas las entradas cuelgan de Gentius: el roadmap de estudio se
  // aplicaba a ese producto.
  const previosLogs = await slugsExistentes(supabase, "daily_log", userId);
  const filasLogs = Object.values(logs).map((l) => ({
    user_id: userId,
    project_id: projectId,
    track_id: l.trackId ? (idPorTrack.get(l.trackId) ?? null) : null,
    slug: l.id,
    fecha: l.fecha,
    contenido: l.texto,
  }));
  const { error: errorLogs } = await supabase
    .from("daily_log")
    .upsert(filasLogs, { onConflict: "user_id,slug" })
    .select("id");
  if (errorLogs) fallar(`daily_log: ${errorLogs.message}`);
  anotar(
    contar("logs", "daily_log", Object.keys(logs).length, filasLogs, previosLogs, []),
  );

  imprimirReporte();
  await imprimirVerificacion(supabase, userId, {
    tracks: Object.keys(tracks).length,
    blocks: Object.keys(blocks).length,
    sessions: Object.keys(sessions).length,
    artifacts: Object.keys(artifacts).length,
    daily_log: Object.keys(logs).length,
  });
  imprimirSinDestino(backup);
}

// ------------------------------------------------------------
// Helpers de reporte
// ------------------------------------------------------------

// El tipo se deriva del cliente que realmente creamos: escribir
// `ReturnType<typeof createClient>` toma los genéricos por defecto y no
// coincide con la instancia concreta.
type Cliente = ReturnType<typeof crearCliente>;

/** Slugs ya presentes en la base, para distinguir insert de update. */
async function slugsExistentes(
  supabase: Cliente,
  tabla: string,
  userId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from(tabla)
    .select("slug")
    .eq("user_id", userId);
  if (error) fallar(`No pude leer ${tabla}: ${error.message}`);
  return new Set(
    (data as { slug: string | null }[])
      .map((f) => f.slug)
      .filter((s): s is string => s !== null),
  );
}

function contar(
  entidad: string,
  tabla: string,
  enJson: number,
  filas: { slug: string }[],
  previos: Set<string>,
  omitidas: { slug: string; motivo: string }[],
): Reporte {
  let insertadas = 0;
  let actualizadas = 0;
  for (const fila of filas) {
    if (previos.has(fila.slug)) actualizadas++;
    else insertadas++;
  }
  return { entidad, tabla, enJson, insertadas, actualizadas, omitidas };
}

function imprimirReporte() {
  console.log("── Resultado ────────────────────────────────────────────");
  for (const r of reportes) {
    console.log(
      `  ${r.entidad.padEnd(18)} json ${String(r.enJson).padStart(3)}  ` +
        `insertadas ${String(r.insertadas).padStart(3)}  ` +
        `actualizadas ${String(r.actualizadas).padStart(3)}  ` +
        `omitidas ${String(r.omitidas.length).padStart(3)}`,
    );
    for (const o of r.omitidas) {
      console.log(`      ↳ ${o.slug}: ${o.motivo}`);
    }
  }
}

async function imprimirVerificacion(
  supabase: Cliente,
  userId: string,
  esperado: Record<string, number>,
) {
  console.log("\n── Verificación (base vs. json) ─────────────────────────");
  for (const [tabla, enJson] of Object.entries(esperado)) {
    const { count, error } = await supabase
      .from(tabla)
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);
    if (error) fallar(`No pude contar ${tabla}: ${error.message}`);
    const marca = count === enJson ? "✓" : "≠";
    console.log(
      `  ${marca} ${tabla.padEnd(12)} base ${String(count).padStart(3)}  json ${String(enJson).padStart(3)}`,
    );
  }
}

/**
 * Lo que existe en el origen y no tiene columna donde caer. No se inventa
 * un destino ni se descarta en silencio: queda listado en cada corrida.
 */
function imprimirSinDestino(backup: Backup) {
  console.log("\n── Sin destino en el esquema ────────────────────────────");
  const meta = backup.meta ?? {};
  console.log(
    `  meta.startDate (${meta.startDate}) — el esquema no guarda fecha de arranque del plan.`,
  );
  console.log(
    `  meta.seeded (${meta.seeded}) / meta.updatedAt (${meta.updatedAt}) — banderas internas de la app vieja.`,
  );
  console.log(
    "  tracks.tipo ('pm' / 'dev') — redundante con el slug, que ya es ese mismo valor.",
  );
  console.log(
    "  tracks.accent (#d97706, #0f766e) — descartados: no son de la paleta validada de globals.css.",
  );
  console.log(
    "  entities.progress — no se pierde: se fusionó dentro de cada fila de sessions.",
  );
  console.log(
    "  Nada se importa a lessons ni a inbox en esta etapa (fuera de alcance).\n",
  );
}

main().catch((e) => fallar(String(e)));
