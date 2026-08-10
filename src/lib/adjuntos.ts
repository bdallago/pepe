import "server-only";

import { z } from "zod";
import { extractText, getDocumentProxy } from "unpdf";

import { todayISO } from "@/lib/dates";
import {
  ErrorLLM,
  MODELO_CHICO,
  MODELO_RAZONADOR,
  MODELO_VISION,
  completarJSON,
} from "@/lib/llm";
import type { SupabaseClient } from "@/lib/supabase/server";
import type { Attachment, CategoriaLeccion } from "@/lib/supabase/database.types";

/**
 * El pase de adjuntos: de un archivo que Beno pegó a propuestas en la
 * bandeja.
 *
 * Dos caminos, elegidos por MIME **sin llamar a ningún modelo** — que un
 * archivo sea un PDF o una imagen es un hecho, no una interpretación:
 *
 * - **PDF** → se abre con `unpdf`, se trocea, se resume trozo por trozo
 *   con `MODELO_CHICO` y se sintetiza una sola vez con
 *   `MODELO_RAZONADOR`. Salen lecciones propuestas (`leccion_sugerida`).
 * - **Imagen** → una llamada a `MODELO_VISION`, el único de la cuenta que
 *   ve. Sale una **entrada de bitácora** propuesta (`nota_de_adjunto`).
 *
 * **Nada se escribe en las tablas de dominio.** Todo termina en `inbox`
 * como `pendiente` (regla 6), y con más razón que de costumbre: esto es
 * producción de un modelo sobre material que Beno **no escribió**.
 *
 * ## Por qué esto es un pase por lotes y no una llamada de la caja
 *
 * Aritmética, no ingeniería. Un PDF de 30 páginas son ~32 000 tokens de
 * entrada contra un caño de 5500 por minuto (el techo de `MODELO_CHICO`
 * en `llm.ts`): **diez minutos**. El `maxDuration` más alto del repo es
 * 300 segundos. Así que se copia el mecanismo del pase de extracción
 * (`lib/extraccion.ts`): presupuesto de tiempo interno, corte antes de
 * que corte Vercel, `restantes` en la respuesta y la pantalla vuelve a
 * llamar.
 *
 * ## Qué pasa si el tercero falla
 *
 * Beno manda **varias capturas por mensaje**, y con el techo de qwen
 * entran tres por minuto. Entonces la pregunta no es teórica. La regla,
 * y es distinta según por qué falló:
 *
 * - **La salida no valida contra el esquema** → ese adjunto queda en
 *   `error` con el detalle, se deja una fila de `inbox` en `error` (como
 *   hace `extraccion.ts`) y **el pase sigue con los que faltan**. Un JSON
 *   roto no mejora por reintentarlo y no tiene por qué frenar a los
 *   otros dos.
 * - **Cuota, red o timeout** → el pase **corta** y lo dice en
 *   `interrumpidoPor`. Ese adjunto vuelve a `pendiente`: el archivo ya
 *   está guardado, no se perdió nada, y la pantalla ofrece seguir.
 *   Insistir con los que faltan contra una cuota agotada solo gasta
 *   tiempo.
 * - En los dos casos, **lo que ya salió bien ya está en la bandeja**. Las
 *   dos primeras capturas no se pierden porque la tercera falle: cada
 *   adjunto es su propia unidad de trabajo y su propio estado.
 *
 * Vale igual dentro de un PDF: `trozos_hechos` y `resumenes` se persisten
 * trozo a trozo, así que una corrida cortada a la mitad no vuelve a pagar
 * las llamadas que ya hizo.
 */

const BUCKET_ADJUNTOS = "adjuntos";

/** Techo de tiempo del pase, con margen contra el `maxDuration` de 300 s. */
const PRESUPUESTO_MS = 240_000;

/**
 * Hasta acá se lee un PDF. Sesenta páginas son ~20 minutos de pase.
 *
 * Más que eso es una corrida que nadie espera, así que se procesa hasta
 * ahí y **se dice hasta dónde llegó**. Que lo diga es mejor que que
 * tarde.
 */
const MAX_PAGINAS = 60;

/** Largo de cada trozo. Se corta por párrafo, así que es aproximado. */
const CHARS_POR_TROZO = 6_000;

/**
 * Debajo de esto, el PDF **no tiene capa de texto**: es un escaneo o son
 * puras imágenes. Queda `no_procesable` con el motivo y **no se llama a
 * ningún modelo**.
 */
const MIN_CHARS_UTILES = 400;

/** Cuántas lecciones se le piden a la síntesis. El mismo número que 6.3. */
const MAX_LECCIONES = 5;

const CATEGORIAS = [
  "tecnica",
  "producto",
  "comercial",
  "proceso",
  "personal",
] as const satisfies readonly CategoriaLeccion[];

/* ────────────────────────────────────────────────────────────
 * Lo que queda en `inbox.payload`
 * ──────────────────────────────────────────────────────────── */

/**
 * Una lección propuesta a partir de un PDF.
 *
 * Va como `leccion_sugerida`, el tipo que ya existe: una lección
 * propuesta por un modelo ya tenía su tipo y su acción de aceptación. Lo
 * único que hacía falta era que la lección se acuerde de dónde salió, y
 * eso lo dice `adjunto_id` — `aceptarLeccion()` lo mira para nacer con
 * `origen = 'adjunto'` en vez de `'generada'`.
 *
 * `project_id` es **opcional** acá y no en el resto de los payloads de
 * lección: al pegar un archivo puede no saberse a qué proyecto va. Si
 * falta, la tarjeta de la bandeja lo pide antes de habilitar el botón.
 */
export interface PayloadLeccionDeAdjunto {
  titulo: string;
  contenido: string;
  categoria: CategoriaLeccion;
  fecha: string;
  project_id?: string;
  /** De qué archivo salió. Es lo que la vuelve `origen = 'adjunto'`. */
  adjunto_id: string;
  adjunto_nombre: string;
  /** Lo que Beno escribió al pegarlo, para juzgar la propuesta. */
  frase?: string;
  modelo: string;
}

/**
 * Una entrada de bitácora propuesta a partir de una captura.
 *
 * **No es una lección, y esa es la decisión.** "Te paso capturas para que
 * veas esto que me contestó un cliente" es algo que pasó. Y hay una
 * consecuencia linda: una vez que la entrada está en `daily_log`, el pase
 * de extracción que ya existe la levanta sola y, si tiene una lección
 * adentro, la propone. Ese camino no hay que construirlo.
 */
export interface PayloadNotaDeAdjunto {
  contenido: string;
  fecha: string;
  project_id?: string;
  /** Qué es la imagen, en una línea. Se muestra arriba de la nota. */
  de_que_es: string;
  adjunto_id: string;
  adjunto_nombre: string;
  /** Para firmar la URL y mostrar la miniatura al lado del texto. */
  storage_path: string;
  frase?: string;
  modelo: string;
}

/* ────────────────────────────────────────────────────────────
 * Prompts
 * ──────────────────────────────────────────────────────────── */

const trozoSchema = z.object({
  puntos: z.array(z.string().trim().min(1).max(400)).max(8),
});

/**
 * Resumir un trozo es trabajo mecánico, y por eso lo hace el modelo
 * chico.
 *
 * `AGENTS.md` §6.d midió que contra la generalidad el techo es el
 * modelo, pero eso vale para **escribir la lección**, no para extraer las
 * afirmaciones de un párrafo. Poner el razonador en los dieciséis trozos
 * de un PDF mediano multiplicaría el tiempo por tres sin comprar calidad
 * donde importa.
 */
const SISTEMA_TROZO = `Te dan un FRAGMENTO de un documento. Devolvés las afirmaciones concretas que hace ese fragmento, en punteo.

Reglas:
1. Cada punto tiene que ser algo que el fragmento DICE, no algo que se te ocurra a vos. Si el fragmento no afirma nada (es un índice, una portada, una lista de referencias), devolvé {"puntos": []}.
2. Conservá los números, los nombres propios y las condiciones ("si X, entonces Y"). Son lo primero que se pierde al resumir y lo único que después distingue una lección de un lugar común.
3. No opines, no saques conclusiones, no agregues consejos.
4. Escribí en español rioplatense, sin emojis y sin muletillas de asistente.

Respondé SOLO un objeto JSON con esta forma exacta:
{ "puntos": [string] }`;

const sintesisSchema = z.object({
  lecciones: z
    .array(
      z.object({
        titulo: z.string().trim().min(1).max(120),
        contenido: z.string().trim().min(1).max(2000),
        categoria: z.enum(CATEGORIAS),
      }),
    )
    .max(MAX_LECCIONES),
});

/**
 * La síntesis usa **la vara de 6.3, no la del extractor de bitácora**.
 *
 * `AGENTS.md` §6 es explícito sobre por qué el extractor tiene la vara
 * baja ("ante la duda, proponela"): ahí el modelo **reescribe lo que Beno
 * vivió y escribió**, y un falso negativo le borra algo suyo. Un PDF de
 * un tercero no es eso. Es material ajeno del que el modelo **produce**
 * afirmaciones, y ahí el falso positivo cuesta lo mismo que en 6.3:
 * relleno genérico que ensucia las lecciones.
 *
 * Las reglas de título y los ejemplos en contraste son **a propósito los
 * mismos** que los de `lib/generacion.ts`. Están escritos de nuevo y no
 * importados porque el contexto es distinto —allá hay un tema y un
 * proyecto, acá un documento— pero si alguna vez se afloja una, hay que
 * aflojar la otra: son la misma vara.
 */
const SISTEMA_SINTESIS = `Sos un asesor que lee lo que alguien rescató de un documento y le propone lecciones aprendidas para sus propios proyectos.

Te dan el NOMBRE del documento, lo que esa persona escribió al pasártelo y una lista de afirmaciones sacadas del documento. Devolvés hasta ${MAX_LECCIONES} lecciones.

Reglas que mandan sobre todo lo demás:

1. **El título tiene que ser una AFIRMACIÓN DISCUTIBLE, no un rótulo ni una orden genérica.** Si el título podría estar en la tapa de cualquier libro de negocios, está mal. Tiene que decir algo con lo que alguien podría no estar de acuerdo.
2. Cada lección lleva la CONDICIÓN en la que aplica y QUÉ PASA si la ignorás. Sin eso es un consejo, no una lección. Escribilo como prosa corrida: no pongas las palabras "Condición:" ni "Consecuencia:" en el texto.
3. **No inventes nada que no esté en las afirmaciones que te dieron.** No agregues cifras, ni ejemplos, ni nombres de empresas, ni resultados que el documento no dijo. Si el material da para dos lecciones, devolvé dos.
4. Escribí como si se lo contaras a alguien que va a tener que decidir algo la semana que viene, no como un artículo.

Ejemplos de títulos MAL (rótulos vacíos, rechazalos si se te ocurren):
- "Documentá todo"
- "Capacitá al cliente"
- "Revisá y ajustá"
- "Optimizá tus procesos"
- "Escuchá a tus clientes"

Ejemplos de títulos BIEN (afirmaciones con filo):
- "Al cliente chico cobrale la implementación aparte o te la come el soporte"
- "El primer mes gratis atrae justo a los que nunca van a pagar"
- "Un precio por hora te castiga cada vez que mejorás la herramienta"

Estas lecciones salen de material que la persona NO escribió: son hipótesis leídas, no experiencia vivida, y ella lo sabe.

Categorías posibles:
- "tecnica": código, arquitectura, herramientas, infraestructura.
- "producto": qué construir, alcance, usuarios, prioridades.
- "comercial": precios, clientes, ventas, cobranza.
- "proceso": cómo trabajar, método, organización, estimaciones.
- "personal": energía, foco, hábitos, cómo trabaja uno mismo.

Escribí en español rioplatense, sin emojis y sin muletillas de asistente.

Respondé SOLO un objeto JSON con esta forma exacta:
{
  "lecciones": [
    {
      "titulo": string (máx 80 caracteres, afirmativo y concreto),
      "contenido": string (2 a 5 oraciones),
      "categoria": una de "tecnica" | "producto" | "comercial" | "proceso" | "personal"
    }
  ]
}

Si el material no da para ninguna lección, devolvé {"lecciones": []}.`;

const capturaSchema = z.object({
  legible: z.boolean(),
  de_que_es: z.string().trim().max(200).optional().nullable(),
  transcripcion: z.string().trim().max(4000).optional().nullable(),
  resumen: z.string().trim().max(1000).optional().nullable(),
});

/**
 * El prompt de las capturas.
 *
 * Lo que lo hace viable es la regla 1, y está medida: a un damero en
 * blanco y negro el modelo contestó `legible: false` y describió lo que
 * había, **en vez de inventar una conversación con un cliente**. Una cita
 * falsa de un cliente es peor que no tener la feature, así que esa regla
 * va primera y explícita.
 *
 * Y la transcripción es **literal a propósito**. Es lo mismo que hace
 * `agentes/bitacora.ts` con lo que Beno tipea: el modelo recorta y
 * ordena, no mejora. Pero ojo con la diferencia que importa: allá el
 * texto es de Beno palabra por palabra y por eso puede escribir directo;
 * acá el texto lo produjo un modelo mirando píxeles, así que **pasa por
 * la bandeja sí o sí**.
 */
const SISTEMA_CAPTURA = `Mirás una captura de pantalla o una foto que te pasa una persona y la dejás registrada por escrito, para que pueda volver a leerla dentro de un año sin tener la imagen a mano.

Reglas, en orden de importancia:

1. **Si no podés leer lo que hay, poné "legible": false** y describí en "de_que_es" lo que sí se ve. NO inventes una conversación, ni nombres, ni cifras, ni de qué se trata. Es infinitamente mejor un "no se entiende" que una cita falsa: esto se va a releer como si hubiera pasado.
2. La transcripción es LITERAL. Si es una conversación, quién dijo qué y en qué orden, con las palabras que están escritas. No la resumas, no la corrijas, no la traduzcas y no le agregues cortesías que no dijo nadie.
3. No opines, no saques conclusiones y no des consejos. Lo que hay que hacer con esto lo decide la persona.
4. Si en la imagen hay nombres o números, transcribilos exactamente como aparecen.

Escribí en español rioplatense, sin emojis y sin muletillas de asistente.

Respondé SOLO un objeto JSON con esta forma exacta:
{
  "legible": boolean,
  "de_que_es": string (una línea: "una conversación de WhatsApp con un cliente", "un mail", "un error de consola", "un gráfico de ventas"),
  "transcripcion": string (lo que dice la imagen, textual; null si no es legible),
  "resumen": string (1 a 3 oraciones con lo que importa; null si no es legible)
}`;

/* ────────────────────────────────────────────────────────────
 * El pase
 * ──────────────────────────────────────────────────────────── */

export interface ReporteAdjuntos {
  /** Adjuntos que quedaron `listo` o `no_procesable` en esta corrida. */
  terminados: number;
  /** Lecciones propuestas que quedaron esperando en la bandeja. */
  propuestas: number;
  /** Notas de bitácora propuestas. */
  notas: number;
  /** Adjuntos que quedaron en `no_procesable` (y por qué, en la fila). */
  noProcesables: number;
  /** Adjuntos que quedaron en `error`. */
  errores: number;
  /** Cuántos de los pedidos siguen sin terminar. */
  restantes: number;
  /** Por qué se cortó antes de terminar, si se cortó. */
  interrumpidoPor?: string;
  /**
   * Si el corte fue por el presupuesto de tiempo y no por una falla.
   *
   * La pantalla necesita distinguirlos y no se puede mirando el texto: si
   * se acabó el tiempo, **vuelve a llamar sola** (un PDF de 30 páginas
   * son varias corridas); si se cayó Groq o se acabó la cuota, frena y
   * ofrece un botón, porque insistir en un bucle contra una cuota agotada
   * es peor que esperar.
   */
  cortePorTiempo: boolean;
}

type FilaAdjunto = Pick<
  Attachment,
  | "id"
  | "nombre_original"
  | "storage_path"
  | "mime"
  | "tipo"
  | "estado"
  | "frase"
  | "project_id"
  | "texto_extraido"
  | "paginas"
  | "trozos_totales"
  | "trozos_hechos"
  | "resumenes"
>;

const COLUMNAS_ADJUNTO =
  "id, nombre_original, storage_path, mime, tipo, estado, frase, project_id, texto_extraido, paginas, trozos_totales, trozos_hechos, resumenes";

/**
 * Procesa los adjuntos que se le pidan, hasta donde entre en el tiempo.
 *
 * Recibe ids explícitos y **no** "todo lo pendiente" a propósito: nada se
 * procesa por atrás sin que Beno lo haya pedido. Un adjunto que quedó a
 * medias se retoma desde la pantalla, con un botón.
 *
 * No lanza por culpa del modelo: si Groq se cae, corta y lo cuenta en
 * `interrumpidoPor`. Lo que ya se propuso queda en la bandeja.
 */
export async function procesarAdjuntos(
  supabase: SupabaseClient,
  userId: string,
  ids: string[],
): Promise<ReporteAdjuntos> {
  const arranque = Date.now();

  const { data: filas, error } = await supabase
    .from("attachments")
    .select(COLUMNAS_ADJUNTO)
    .in("id", ids)
    .in("estado", ["pendiente", "procesando"])
    .is("archivado_en", null)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  const pendientes = (filas ?? []) as FilaAdjunto[];

  const reporte: ReporteAdjuntos = {
    terminados: 0,
    propuestas: 0,
    notas: 0,
    noProcesables: 0,
    errores: 0,
    restantes: pendientes.length,
    cortePorTiempo: false,
  };

  for (const adjunto of pendientes) {
    if (Date.now() - arranque > PRESUPUESTO_MS) {
      reporte.interrumpidoPor = "Se acabó el tiempo de la corrida.";
      reporte.cortePorTiempo = true;
      break;
    }

    try {
      const resultado =
        adjunto.tipo === "pdf"
          ? await procesarPdf(supabase, userId, adjunto, arranque)
          : await procesarImagen(supabase, userId, adjunto);

      reporte.propuestas += resultado.propuestas;
      reporte.notas += resultado.notas;

      if (resultado.terminado) {
        reporte.terminados++;
        reporte.restantes--;
        if (resultado.noProcesable) reporte.noProcesables++;
      } else {
        // Un PDF largo que se quedó sin tiempo: `trozos_hechos` quedó
        // persistido y la próxima corrida sigue desde ahí.
        reporte.interrumpidoPor ??= "Se acabó el tiempo de la corrida.";
        reporte.cortePorTiempo = true;
        break;
      }
    } catch (error: unknown) {
      if (error instanceof ErrorLLM && error.tipo === "esquema") {
        // Un JSON roto no mejora por reintentarlo, y no tiene por qué
        // frenar a los adjuntos que faltan. Queda visible en los dos
        // lados: el adjunto en `error` y una fila de bandeja en `error`.
        await marcar(supabase, adjunto.id, "error", error.message);
        await supabase.from("inbox").insert({
          user_id: userId,
          tipo: adjunto.tipo === "pdf" ? "leccion_sugerida" : "nota_de_adjunto",
          estado: "error",
          entidad_tabla: "attachments",
          entidad_id: adjunto.id,
          resuelto_en: new Date().toISOString(),
          error_detalle: error.message,
          payload: {
            crudo: error.crudo ?? null,
            adjunto_nombre: adjunto.nombre_original,
          },
        });
        reporte.errores++;
        reporte.terminados++;
        reporte.restantes--;
        continue;
      }

      if (error instanceof ErrorLLM) {
        // Cuota, red o timeout. El archivo ya está guardado: vuelve a
        // `pendiente` y se reintenta desde la pantalla. Insistir con los
        // que faltan contra una cuota agotada solo gasta tiempo.
        await marcar(supabase, adjunto.id, "pendiente", error.message);
        reporte.interrumpidoPor = error.message;
        break;
      }

      // Cualquier otra cosa —`unpdf` explotando con un PDF raro, el
      // storage que no contesta— es de este adjunto y no de los demás.
      const detalle =
        error instanceof Error ? error.message : "Falló el pase del adjunto.";
      await marcar(supabase, adjunto.id, "error", detalle);
      reporte.errores++;
      reporte.terminados++;
      reporte.restantes--;
    }
  }

  return reporte;
}

interface ResultadoAdjunto {
  /** `false` cuando quedó a medias por tiempo y hay que volver a llamar. */
  terminado: boolean;
  noProcesable: boolean;
  propuestas: number;
  notas: number;
}

/* ────────────────────────────────────────────────────────────
 * PDF
 * ──────────────────────────────────────────────────────────── */

async function procesarPdf(
  supabase: SupabaseClient,
  userId: string,
  adjunto: FilaAdjunto,
  arranque: number,
): Promise<ResultadoAdjunto> {
  await marcar(supabase, adjunto.id, "procesando", null);

  let texto = adjunto.texto_extraido ?? "";
  let trozos: string[];

  if (!texto) {
    // Paso 1: bajar y abrir. Todavía sin modelo: un PDF escaneado se
    // descarta acá, sin gastar un token.
    const bytes = await bajar(supabase, adjunto.storage_path);
    const doc = await getDocumentProxy(bytes);
    const paginasTotales = doc.numPages;

    const { text: porPagina } = await extractText(doc, { mergePages: false });
    const leidas = porPagina.slice(0, MAX_PAGINAS);
    texto = limpiar(leidas.join("\n\n"));

    if (texto.length < MIN_CHARS_UTILES) {
      await marcar(
        supabase,
        adjunto.id,
        "no_procesable",
        paginasTotales > 0
          ? "El PDF no tiene texto: es un escaneo o son puras imágenes. No hay nada que leer sin OCR."
          : "El PDF vino vacío.",
      );
      return { terminado: true, noProcesable: true, propuestas: 0, notas: 0 };
    }

    trozos = trocear(texto);

    const { error } = await supabase
      .from("attachments")
      .update({
        texto_extraido: texto,
        paginas: paginasTotales,
        trozos_totales: trozos.length,
      })
      .eq("id", adjunto.id);

    if (error) throw new Error(error.message);
  } else {
    // Retomando: los trozos se recalculan siempre desde el mismo texto,
    // así que los cortes son idénticos y `trozos_hechos` indexa lo mismo.
    trozos = trocear(texto);
  }

  const resumenes = leerResumenes(adjunto.resumenes);
  let hechos = Math.min(adjunto.trozos_hechos, trozos.length);

  for (let i = hechos; i < trozos.length; i++) {
    if (Date.now() - arranque > PRESUPUESTO_MS) {
      return { terminado: false, noProcesable: false, propuestas: 0, notas: 0 };
    }

    const { datos } = await completarJSON({
      modelo: MODELO_CHICO,
      sistema: SISTEMA_TROZO,
      usuario: `Documento: ${adjunto.nombre_original}\nFragmento ${i + 1} de ${trozos.length}:\n\n${trozos[i]}`,
      esquema: trozoSchema,
      etiqueta: "adjunto-pdf-trozo",
      maxTokens: 700,
    });

    resumenes.push(...datos.puntos);
    hechos = i + 1;

    // Se persiste trozo a trozo, no al final: si la corrida se corta acá,
    // las llamadas que ya se pagaron no se vuelven a pagar.
    const { error } = await supabase
      .from("attachments")
      .update({ trozos_hechos: hechos, resumenes })
      .eq("id", adjunto.id);

    if (error) throw new Error(error.message);
  }

  if (resumenes.length === 0) {
    await marcar(
      supabase,
      adjunto.id,
      "no_procesable",
      "El documento no afirma nada que se pueda convertir en lección (índice, portada o listado).",
    );
    return { terminado: true, noProcesable: true, propuestas: 0, notas: 0 };
  }

  // Paso 4: una sola llamada al razonador. El porqué está en
  // `SISTEMA_SINTESIS`.
  const { datos, uso } = await completarJSON({
    modelo: MODELO_RAZONADOR,
    esfuerzo: "medium",
    sistema: SISTEMA_SINTESIS,
    usuario: [
      `Documento: ${adjunto.nombre_original}`,
      adjunto.paginas ? `Páginas: ${adjunto.paginas}` : null,
      adjunto.frase ? `Lo que escribió al pasártelo: ${adjunto.frase}` : null,
      "",
      "Afirmaciones sacadas del documento:",
      ...resumenes.map((p) => `- ${p}`),
    ]
      .filter((l) => l !== null)
      .join("\n"),
    esquema: sintesisSchema,
    etiqueta: "adjunto-pdf-sintesis",
    // El razonamiento se descuenta de `max_tokens`, y quedarse corto no
    // degrada la respuesta: la trunca, no valida y se pierde la llamada
    // entera. Es el mismo número que usa 6.3.
    maxTokens: 3_500,
  });

  let propuestas = 0;

  for (const [n, leccion] of datos.lecciones.entries()) {
    const payload: PayloadLeccionDeAdjunto = {
      titulo: leccion.titulo,
      contenido: leccion.contenido,
      categoria: leccion.categoria,
      fecha: todayISO(),
      ...(adjunto.project_id ? { project_id: adjunto.project_id } : {}),
      adjunto_id: adjunto.id,
      adjunto_nombre: adjunto.nombre_original,
      ...(adjunto.frase ? { frase: adjunto.frase } : {}),
      modelo: uso.modelo,
    };

    const { error } = await supabase.from("inbox").insert({
      user_id: userId,
      tipo: "leccion_sugerida",
      estado: "pendiente",
      entidad_tabla: "attachments",
      entidad_id: adjunto.id,
      clave_dedupe: `adjunto:${adjunto.id}:${n}`,
      payload: { ...payload },
    });

    // 23505 = choque contra el índice de dedupe: otra corrida ya la
    // propuso. No es un error, es el mecanismo funcionando.
    if (error && error.code !== "23505") throw new Error(error.message);
    if (!error) propuestas++;
  }

  await marcar(supabase, adjunto.id, "listo", null);
  return { terminado: true, noProcesable: false, propuestas, notas: 0 };
}

/* ────────────────────────────────────────────────────────────
 * Imagen
 * ──────────────────────────────────────────────────────────── */

async function procesarImagen(
  supabase: SupabaseClient,
  userId: string,
  adjunto: FilaAdjunto,
): Promise<ResultadoAdjunto> {
  await marcar(supabase, adjunto.id, "procesando", null);

  const bytes = await bajar(supabase, adjunto.storage_path);
  const dataUri = `data:${adjunto.mime};base64,${Buffer.from(bytes).toString("base64")}`;

  const { datos, uso } = await completarJSON({
    modelo: MODELO_VISION,
    sistema: SISTEMA_CAPTURA,
    usuario: adjunto.frase
      ? `Lo que escribió al pasarte la imagen: ${adjunto.frase}`
      : "No escribió nada al pasarte la imagen.",
    // Por acá y no pegada dentro de `usuario`: un data URI medido por
    // largo de string daría cientos de miles de tokens y el limitador
    // esperaría la ventana entera antes de cada captura (ver
    // `TOKENS_POR_IMAGEN` en `llm.ts`).
    imagenes: [dataUri],
    esquema: capturaSchema,
    etiqueta: "adjunto-captura",
    maxTokens: 1_200,
  });

  // `legible: false` **no es un error**: es la respuesta correcta a una
  // foto borrosa, y es la propiedad medida que hace viable todo esto.
  if (!datos.legible || !datos.transcripcion) {
    await marcar(
      supabase,
      adjunto.id,
      "no_procesable",
      datos.de_que_es
        ? `No se pudo leer. El modelo vio: ${datos.de_que_es}`
        : "No se pudo leer la imagen.",
    );
    return { terminado: true, noProcesable: true, propuestas: 0, notas: 0 };
  }

  const contenido = [
    datos.resumen?.trim(),
    "",
    datos.transcripcion.trim(),
  ]
    .filter((l) => l !== undefined)
    .join("\n")
    .trim();

  const payload: PayloadNotaDeAdjunto = {
    contenido,
    fecha: todayISO(),
    ...(adjunto.project_id ? { project_id: adjunto.project_id } : {}),
    de_que_es: datos.de_que_es?.trim() || "Una imagen",
    adjunto_id: adjunto.id,
    adjunto_nombre: adjunto.nombre_original,
    storage_path: adjunto.storage_path,
    ...(adjunto.frase ? { frase: adjunto.frase } : {}),
    modelo: uso.modelo,
  };

  const { error } = await supabase.from("inbox").insert({
    user_id: userId,
    tipo: "nota_de_adjunto",
    estado: "pendiente",
    entidad_tabla: "attachments",
    entidad_id: adjunto.id,
    clave_dedupe: `adjunto:${adjunto.id}:0`,
    payload: { ...payload },
  });

  if (error && error.code !== "23505") throw new Error(error.message);

  await marcar(supabase, adjunto.id, "listo", null);
  return {
    terminado: true,
    noProcesable: false,
    propuestas: 0,
    notas: error ? 0 : 1,
  };
}

/* ────────────────────────────────────────────────────────────
 * Utilidades
 * ──────────────────────────────────────────────────────────── */

async function bajar(
  supabase: SupabaseClient,
  path: string,
): Promise<Uint8Array> {
  const { data, error } = await supabase.storage
    .from(BUCKET_ADJUNTOS)
    .download(path);

  if (error || !data) {
    throw new Error(
      `No se pudo bajar el adjunto: ${error?.message ?? "sin contenido"}`,
    );
  }

  return new Uint8Array(await data.arrayBuffer());
}

async function marcar(
  supabase: SupabaseClient,
  id: string,
  estado: "pendiente" | "procesando" | "listo" | "no_procesable" | "error",
  detalle: string | null,
): Promise<void> {
  await supabase
    .from("attachments")
    .update({ estado, error_detalle: detalle })
    .eq("id", id);
}

/**
 * Parte el texto en trozos de ~`CHARS_POR_TROZO`, cortando por párrafo.
 *
 * Es determinística sobre `texto_extraido`, y eso no es un detalle: es lo
 * que hace que `trozos_hechos` signifique lo mismo entre corridas. Un
 * párrafo más largo que el trozo se corta duro — pasa con las tablas y
 * los PDFs mal extraídos, y es preferible a un trozo de 40 000
 * caracteres que no entra en ninguna ventana.
 */
export function trocear(
  texto: string,
  tamano = CHARS_POR_TROZO,
): string[] {
  const trozos: string[] = [];
  let actual = "";

  for (const parrafo of texto.split(/\n{2,}/)) {
    const limpio = parrafo.trim();
    if (!limpio) continue;

    if (limpio.length > tamano) {
      if (actual) {
        trozos.push(actual);
        actual = "";
      }
      for (let i = 0; i < limpio.length; i += tamano) {
        trozos.push(limpio.slice(i, i + tamano));
      }
      continue;
    }

    if (actual.length + limpio.length + 2 > tamano) {
      trozos.push(actual);
      actual = limpio;
    } else {
      actual = actual ? `${actual}\n\n${limpio}` : limpio;
    }
  }

  if (actual) trozos.push(actual);
  return trozos;
}

/** Junta los saltos de línea sueltos que deja la extracción por página. */
function limpiar(texto: string): string {
  return texto
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** El jsonb es texto libre para la base: se lee con desconfianza. */
function leerResumenes(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter((v): v is string => typeof v === "string");
}
