import "server-only";

import { todayISO } from "@/lib/dates";
import type { SupabaseClient } from "@/lib/supabase/server";

/**
 * Respaldo completo en JSON (spec 8).
 *
 * El tier gratuito de Supabase **no tiene backups automáticos**. Este
 * archivo es la única red que hay, y esa frase es del spec, no una
 * licencia poética: si la base se pierde, lo que no esté acá adentro no
 * está en ningún lado.
 *
 * De ahí las decisiones de forma:
 *
 * - **Se exporta todo, incluido lo archivado.** Un respaldo que filtra
 *   por lo que hoy se ve en pantalla no es un respaldo. Es la única
 *   lectura de la app que ignora `archivado_en` a propósito.
 * - **Filas crudas, tal como salen de la base**, sin renombrar campos ni
 *   resolver ids a nombres. Lo lindo de leer es tarea del CSV; esto
 *   tiene que poder volver a entrar a una base vacía.
 * - **Se incluyen `fx_rates`**, que no son datos de Beno pero cuestan un
 *   año de cron diario recuperar.
 * - **El embedding de las lecciones se saca.** Son 768 números por
 *   lección, multiplican por diez el peso del archivo y se regeneran con
 *   `npm run backfill:embeddings`. Lo irrecuperable es el texto.
 * - **De los comprobantes viaja el inventario, no los bytes.** Ver
 *   `listarComprobantes()` acá abajo.
 */

/**
 * Sube el número si alguna vez cambia la forma del archivo.
 *
 * 2 — agrega `comprobantes`. El workflow de `bdallago/pepe-respaldos` usa
 * este número para saber si le puede exigir el inventario a la app: con
 * `version < 2` avisa y sigue, con `version >= 2` la falta de inventario
 * es un error. Así el respaldo no se rompe entre que se mergea esto y se
 * despliega, pero tampoco queda un agujero permanente.
 *
 * 3 — agrega la tabla `attachments` y el inventario del bucket
 * `adjuntos`. Los dos son **claves nuevas al lado de las que ya estaban**,
 * a propósito: el workflow que hay hoy sigue andando sin tocar una línea
 * y sigue bajando los comprobantes igual.
 *
 * ⚠ **Pero hasta que el workflow lea `adjuntos`, los bytes de los
 * adjuntos no se están copiando a ningún lado.** El inventario viaja y
 * las URLs firmadas salen por `/api/cron/comprobantes`, así que del lado
 * de la app está todo; falta el `for` del otro lado, que es un cambio de
 * cinco líneas. Está anotado en `AGENTS.md` para que no se pierda: un
 * respaldo que uno cree tener y no tiene es peor que no tenerlo.
 */
export const VERSION_RESPALDO = 3;

/**
 * Las tablas del respaldo, en orden de dependencia: si algún día esto se
 * reimporta, insertarlas en este orden respeta las claves foráneas.
 */
const TABLAS = [
  "projects",
  "categories",
  "recurrences",
  "movements",
  "tracks",
  "blocks",
  "sessions",
  "artifacts",
  "daily_log",
  "lessons",
  "retros",
  // `attachments` va antes de `inbox` porque las filas de la bandeja que
  // salieron de un archivo apuntan a él por `entidad_id`. No hay FK
  // declarada, pero el orden de esta lista es lo que hace reimportable el
  // respaldo y conviene que siga siendo cierto.
  "attachments",
  "inbox",
  "settings",
  "fx_rates",
  // Las tarifas de referencia del mercado. No son datos de Beno —las trae
  // un cron de fuentes públicas— pero se respaldan igual por el mismo
  // motivo que `fx_rates`: reconstruirlas es imposible hacia atrás. Una
  // fuente puede caerse o rediseñarse, y el histórico de cómo se movió la
  // referencia es justamente lo que dice cuándo hay que subir la tarifa.
  "rate_runs",
  "rate_references",
  // Los presupuestos y sus tres tablas hijas. Van después de `projects`
  // porque un presupuesto aceptado apunta al proyecto que creó, y en ese
  // orden el respaldo sigue siendo reimportable.
  "quotes",
  "quote_items",
  "quote_assumptions",
  "quote_questions",
] as const;

type Tabla = (typeof TABLAS)[number];

export interface Respaldo {
  __pepe: string;
  version: number;
  generado_en: string;
  fecha: string;
  /** Cuántas filas trae cada tabla. Sirve para verificar de un vistazo. */
  conteos: Record<string, number>;
  datos: Record<string, unknown[]>;
  /**
   * Los comprobantes que hay en el storage, con a qué movimiento
   * pertenece cada uno. Los bytes no están acá: ver `listarComprobantes()`.
   */
  comprobantes: InventarioComprobantes;
  /**
   * Lo mismo para el bucket `adjuntos`: los archivos que Beno pega en la
   * caja de agentes.
   *
   * Va como clave aparte y no mezclado con `comprobantes` porque son dos
   * buckets distintos y un archivo suelto sin saber de qué bucket salió
   * no se puede restaurar. Y porque las dos relaciones son distintas: un
   * comprobante cuelga de un movimiento, un adjunto de una fila de
   * `attachments`.
   */
  adjuntos: InventarioAdjuntos;
}

/** Cuántas filas se piden por página. Supabase corta en 1000 por defecto. */
const PAGINA = 1000;

export async function armarRespaldo(supabase: SupabaseClient): Promise<Respaldo> {
  const datos: Record<string, unknown[]> = {};
  const conteos: Record<string, number> = {};

  for (const tabla of TABLAS) {
    const filas = await leerTodo(supabase, tabla);
    datos[tabla] = filas;
    conteos[tabla] = filas.length;
  }

  return {
    // Marca de agua para reconocer el archivo, igual que el `__colmena`
    // que traía el export de la app vieja.
    __pepe: "pepe:respaldo",
    version: VERSION_RESPALDO,
    generado_en: new Date().toISOString(),
    fecha: todayISO(),
    conteos,
    datos,
    comprobantes: await listarComprobantes(supabase),
    adjuntos: await listarAdjuntos(supabase),
  };
}

/**
 * Lee una tabla entera, paginando.
 *
 * Sin paginar, una tabla de más de mil filas se exportaría cortada **sin
 * ningún error visible**, que es la peor forma posible de fallar en un
 * respaldo. `movements` ya tiene 22 filas y `sessions` 70, pero esto
 * tiene que seguir siendo cierto dentro de cinco años.
 */
async function leerTodo(
  supabase: SupabaseClient,
  tabla: Tabla,
): Promise<unknown[]> {
  const filas: unknown[] = [];

  for (let desde = 0; ; desde += PAGINA) {
    // `lessons` va sin `embedding` ni `busqueda`: los dos son derivados
    // del texto. El embedding pesa diez veces más que la lección y se
    // regenera con `npm run backfill:embeddings`; `busqueda` es una
    // columna generada que la base recalcula sola al insertar.
    const columnas =
      tabla === "lessons"
        ? "id, user_id, project_id, movement_id, fecha, titulo, contenido, categoria, origen, archivado_en, created_at, updated_at"
        : "*";

    const { data, error } = await supabase
      .from(tabla)
      .select(columnas)
      .range(desde, desde + PAGINA - 1);

    if (error) {
      throw new Error(`No se pudo leer ${tabla}: ${error.message}`);
    }

    filas.push(...(data ?? []));

    if (!data || data.length < PAGINA) break;
  }

  return filas;
}

/* ────────────────────────────────────────────────────────────
 * Comprobantes
 * ──────────────────────────────────────────────────────────── */

/**
 * Los comprobantes viven en un bucket privado, no en la base, así que el
 * JSON de arriba no los cubría: hasta hoy la frase del encabezado —"lo
 * que no esté acá adentro no está en ningún lado"— era falsa para ellos.
 *
 * **Los bytes van al lado del JSON, como archivos sueltos, no en base64
 * adentro.** Se decidió midiendo el costo a diez años, no por gusto:
 *
 * - El respaldo es **un solo archivo que se sobrescribe todos los días**;
 *   el histórico es el historial de git. Meter los adjuntos adentro
 *   significa que un PDF de 10 MB entra en el blob de `respaldo.json` y
 *   git guarda **una copia nueva entera cada día**, aunque no haya
 *   cambiado un byte. Como archivo suelto con nombre `<uuid>.<ext>`, el
 *   path es inmutable: git lo guarda **una vez y para siempre**, y las
 *   corridas siguientes ni siquiera lo vuelven a bajar.
 * - base64 infla un 33 % y, sobre todo, **rompe la compresión**: git
 *   comprime y deltifica texto, no chorizos base64 de un JPEG.
 * - Hoy el respaldo pesa 148 KB y se abre a mano el día que algo salió
 *   mal. Un adjunto adentro lo vuelve inabrible.
 *
 * Lo que sí viaja en el JSON es el **inventario**: un comprobante suelto
 * sin saber a qué movimiento pertenece no sirve de nada. Además de
 * `movements.comprobante_path`, que ya estaba, acá queda la relación
 * explícita en un solo lugar, con tamaño y tipo para poder verificar que
 * el archivo guardado es el que dice ser.
 *
 * Y queda registrado lo que **no se pudo respaldar**: `faltantes` son los
 * movimientos que apuntan a un archivo que ya no está en el storage. Un
 * respaldo no puede fallar en silencio, y ese es exactamente el caso en
 * que uno cree tener el comprobante y no lo tiene.
 */
const BUCKET_COMPROBANTES = "comprobantes";
const BUCKET_ADJUNTOS = "adjuntos";

/** Cuántos objetos se piden por página al storage. */
const PAGINA_STORAGE = 1000;

/**
 * Los paths son `<user_id>/<uuid>.<ext>`, o sea dos niveles. Se recorre
 * igual en profundidad por si alguna vez se agrega un nivel, con tope
 * para que un bucket raro no cuelgue el respaldo.
 */
const PROFUNDIDAD_MAXIMA = 4;

export interface ArchivoComprobante {
  /** Path dentro del bucket. Es también el path relativo del archivo guardado. */
  path: string;
  /** A qué movimiento pertenece. `null` = huérfano (ver abajo). */
  movement_id: string | null;
  fecha: string | null;
  descripcion: string | null;
  tamano: number | null;
  mime: string | null;
  actualizado_en: string | null;
}

/** Un movimiento que apunta a un archivo que ya no está en el storage. */
export interface ComprobanteFaltante {
  movement_id: string;
  path: string;
  fecha: string | null;
  descripcion: string | null;
}

export interface InventarioComprobantes {
  total: number;
  bytes: number;
  /** Archivos que no referencia ningún movimiento. Se respaldan igual. */
  huerfanos: number;
  archivos: ArchivoComprobante[];
  faltantes: ComprobanteFaltante[];
}

/** Lo que devuelve `storage.list()`. Las carpetas vienen con `id` en null. */
interface ObjetoStorage {
  name: string;
  id: string | null;
  updated_at: string | null;
  metadata: { size?: number; mimetype?: string } | null;
}

interface MovimientoConComprobante {
  id: string;
  fecha: string | null;
  descripcion: string | null;
  comprobante_path: string | null;
}

/**
 * Cruza lo que hay en el bucket con lo que dicen los movimientos.
 *
 * Las dos direcciones importan y son distintas:
 *
 * - Archivo sin movimiento (**huérfano**): pasa cuando se sube un
 *   comprobante y se cancela el formulario. Se respalda igual —los bytes
 *   son de Beno y no cuesta nada— pero queda contado aparte.
 * - Movimiento sin archivo (**faltante**): el comprobante ya se perdió y
 *   ningún respaldo lo va a traer de vuelta. No se puede arreglar acá,
 *   pero sí gritarlo: el workflow lo convierte en un error visible.
 */
export async function listarComprobantes(
  supabase: SupabaseClient,
): Promise<InventarioComprobantes> {
  const objetos = await listarObjetos(supabase, BUCKET_COMPROBANTES, "");

  const { data: movimientos, error } = await supabase
    .from("movements")
    .select("id, fecha, descripcion, comprobante_path")
    .not("comprobante_path", "is", null);

  if (error) {
    throw new Error(
      `No se pudieron leer los comprobantes de movements: ${error.message}`,
    );
  }

  const porPath = new Map<string, MovimientoConComprobante>();
  for (const movimiento of (movimientos ?? []) as MovimientoConComprobante[]) {
    if (movimiento.comprobante_path) {
      porPath.set(movimiento.comprobante_path, movimiento);
    }
  }

  const archivos: ArchivoComprobante[] = objetos.map((objeto) => {
    const movimiento = porPath.get(objeto.path);
    return {
      path: objeto.path,
      movement_id: movimiento?.id ?? null,
      fecha: movimiento?.fecha ?? null,
      descripcion: movimiento?.descripcion ?? null,
      tamano: objeto.metadata?.size ?? null,
      mime: objeto.metadata?.mimetype ?? null,
      actualizado_en: objeto.updated_at,
    };
  });

  const enStorage = new Set(objetos.map((objeto) => objeto.path));
  const faltantes: ComprobanteFaltante[] = [];
  for (const [path, movimiento] of porPath) {
    if (!enStorage.has(path)) {
      faltantes.push({
        movement_id: movimiento.id,
        path,
        fecha: movimiento.fecha,
        descripcion: movimiento.descripcion,
      });
    }
  }

  // Orden estable: si no, el inventario cambia de orden entre corridas y
  // el diff del respaldo se llena de ruido.
  archivos.sort((a, b) => a.path.localeCompare(b.path));
  faltantes.sort((a, b) => a.path.localeCompare(b.path));

  return {
    total: archivos.length,
    bytes: archivos.reduce((suma, archivo) => suma + (archivo.tamano ?? 0), 0),
    huerfanos: archivos.filter((archivo) => archivo.movement_id === null).length,
    archivos,
    faltantes,
  };
}

/** Recorre el bucket entero, paginando igual que las tablas. */
async function listarObjetos(
  supabase: SupabaseClient,
  bucket: string,
  prefijo: string,
  profundidad = 0,
): Promise<(ObjetoStorage & { path: string })[]> {
  if (profundidad >= PROFUNDIDAD_MAXIMA) return [];

  const encontrados: (ObjetoStorage & { path: string })[] = [];

  for (let desde = 0; ; desde += PAGINA_STORAGE) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefijo, {
        limit: PAGINA_STORAGE,
        offset: desde,
        sortBy: { column: "name", order: "asc" },
      });

    if (error) {
      // Igual que con las tablas: mejor un 500 que un respaldo a medias
      // que nadie mira hasta que lo necesita.
      throw new Error(
        `No se pudo listar ${bucket}${prefijo ? ` (${prefijo})` : ""}: ${error.message}`,
      );
    }

    const entradas = (data ?? []) as unknown as ObjetoStorage[];

    for (const entrada of entradas) {
      const path = prefijo ? `${prefijo}/${entrada.name}` : entrada.name;

      if (entrada.id === null) {
        // Carpeta: `list()` no es recursivo, hay que bajar un nivel.
        encontrados.push(
          ...(await listarObjetos(supabase, bucket, path, profundidad + 1)),
        );
      } else {
        encontrados.push({ ...entrada, path });
      }
    }

    if (entradas.length < PAGINA_STORAGE) break;
  }

  return encontrados;
}

/* ────────────────────────────────────────────────────────────
 * Adjuntos
 * ──────────────────────────────────────────────────────────── */

/**
 * El inventario del bucket `adjuntos`, con el mismo criterio que el de
 * comprobantes: los bytes van al lado del JSON, acá viaja la relación.
 *
 * Lo que se guarda de cada archivo es más que el path porque un adjunto
 * dice bastante de sí mismo: `estado` cuenta si el pase llegó a leerlo, y
 * `texto_extraido` —que viaja en la tabla, no acá— es lo caro de
 * reconstruir. Los bytes se pueden volver a leer; los tokens gastados
 * en leerlos, no.
 */
export interface ArchivoAdjunto {
  path: string;
  /** A qué fila de `attachments` pertenece. `null` = huérfano. */
  attachment_id: string | null;
  nombre_original: string | null;
  tipo: string | null;
  estado: string | null;
  tamano: number | null;
  mime: string | null;
  actualizado_en: string | null;
}

/** Una fila de `attachments` cuyo archivo ya no está en el storage. */
export interface AdjuntoFaltante {
  attachment_id: string;
  path: string;
  nombre_original: string | null;
}

export interface InventarioAdjuntos {
  total: number;
  bytes: number;
  huerfanos: number;
  archivos: ArchivoAdjunto[];
  faltantes: AdjuntoFaltante[];
}

interface FilaAdjuntoRespaldo {
  id: string;
  storage_path: string;
  nombre_original: string | null;
  tipo: string | null;
  estado: string | null;
}

/**
 * Cruza el bucket `adjuntos` con la tabla `attachments`.
 *
 * Las dos direcciones importan por lo mismo que en comprobantes:
 * **huérfano** es un archivo que se subió y cuyo registro no llegó a
 * escribirse (se respalda igual, los bytes son de Beno); **faltante** es
 * una fila que apunta a un archivo que ya no está, y eso hay que
 * gritarlo aunque no se pueda arreglar.
 */
export async function listarAdjuntos(
  supabase: SupabaseClient,
): Promise<InventarioAdjuntos> {
  const objetos = await listarObjetos(supabase, BUCKET_ADJUNTOS, "");

  const { data: filas, error } = await supabase
    .from("attachments")
    .select("id, storage_path, nombre_original, tipo, estado");

  if (error) {
    throw new Error(`No se pudo leer attachments: ${error.message}`);
  }

  const porPath = new Map<string, FilaAdjuntoRespaldo>();
  for (const fila of (filas ?? []) as FilaAdjuntoRespaldo[]) {
    if (fila.storage_path) porPath.set(fila.storage_path, fila);
  }

  const archivos: ArchivoAdjunto[] = objetos.map((objeto) => {
    const fila = porPath.get(objeto.path);
    return {
      path: objeto.path,
      attachment_id: fila?.id ?? null,
      nombre_original: fila?.nombre_original ?? null,
      tipo: fila?.tipo ?? null,
      estado: fila?.estado ?? null,
      tamano: objeto.metadata?.size ?? null,
      mime: objeto.metadata?.mimetype ?? null,
      actualizado_en: objeto.updated_at,
    };
  });

  const enStorage = new Set(objetos.map((objeto) => objeto.path));
  const faltantes: AdjuntoFaltante[] = [];
  for (const [path, fila] of porPath) {
    if (!enStorage.has(path)) {
      faltantes.push({
        attachment_id: fila.id,
        path,
        nombre_original: fila.nombre_original,
      });
    }
  }

  archivos.sort((a, b) => a.path.localeCompare(b.path));
  faltantes.sort((a, b) => a.path.localeCompare(b.path));

  return {
    total: archivos.length,
    bytes: archivos.reduce((suma, archivo) => suma + (archivo.tamano ?? 0), 0),
    huerfanos: archivos.filter((a) => a.attachment_id === null).length,
    archivos,
    faltantes,
  };
}

/** Cuántas URLs se firman por llamada. */
const LOTE_FIRMAS = 100;

/**
 * El mismo inventario, con una URL firmada por archivo.
 *
 * Va aparte del respaldo a propósito: las URLs firmadas son credenciales
 * de lectura con vencimiento, y `respaldo.json` **se commitea**. Una URL
 * firmada en el historial de git es un secreto publicado para siempre,
 * aunque hoy esté vencida. Por eso las firmas solo salen por
 * `/api/cron/comprobantes`, que es de transporte, y nunca por el archivo
 * que se guarda.
 */
export async function firmarComprobantes(
  supabase: SupabaseClient,
  inventario: InventarioComprobantes,
  segundos: number,
): Promise<(ArchivoComprobante & { url: string })[]> {
  return await firmar(supabase, BUCKET_COMPROBANTES, inventario.archivos, segundos);
}

/** Lo mismo para el bucket `adjuntos`. */
export async function firmarAdjuntos(
  supabase: SupabaseClient,
  inventario: InventarioAdjuntos,
  segundos: number,
): Promise<(ArchivoAdjunto & { url: string })[]> {
  return await firmar(supabase, BUCKET_ADJUNTOS, inventario.archivos, segundos);
}

async function firmar<T extends { path: string }>(
  supabase: SupabaseClient,
  bucket: string,
  archivos: T[],
  segundos: number,
): Promise<(T & { url: string })[]> {
  const firmados: (T & { url: string })[] = [];

  for (let i = 0; i < archivos.length; i += LOTE_FIRMAS) {
    const lote = archivos.slice(i, i + LOTE_FIRMAS);

    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrls(
        lote.map((archivo) => archivo.path),
        segundos,
      );

    if (error) {
      throw new Error(`No se pudieron firmar los archivos de ${bucket}: ${error.message}`);
    }

    const porPath = new Map(
      (data ?? []).map((firma) => [firma.path ?? "", firma]),
    );

    for (const archivo of lote) {
      const firma = porPath.get(archivo.path);

      // Que una firma falle no se puede tragar: el archivo existe y no lo
      // vamos a poder bajar, que es justo lo que hay que respaldar.
      if (!firma?.signedUrl) {
        throw new Error(
          `No se pudo firmar ${archivo.path}: ${firma?.error ?? "sin URL"}`,
        );
      }

      firmados.push({ ...archivo, url: firma.signedUrl });
    }
  }

  return firmados;
}
