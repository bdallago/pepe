import "server-only";

import type { z } from "zod";

import { groqApiKey } from "@/lib/env";

/**
 * Motor de inferencia: **todas** las llamadas a un modelo pasan por acá.
 *
 * La regla del spec (sección 5) es dura: la key nunca llega al browser, la
 * salida es siempre JSON validado con Zod antes de tocar la base, y ninguna
 * feature de modelo puede ser bloqueante. Este módulo es `server-only`
 * justamente para que un import descuidado desde un componente cliente
 * rompa el build en vez de filtrar la credencial.
 *
 * Lo que centraliza:
 *
 * - **Limitador propio** de 30 req/min. El tier gratuito de Groq corta ahí
 *   y el spec pide no confiar en el 429: para cuando te llega, ya gastaste
 *   el pedido. Acá se espera antes de salir.
 * - **Reintentos con backoff exponencial** ante 429 y 5xx, respetando el
 *   header `retry-after` cuando viene.
 * - **Timeout** por intento, con `AbortController`.
 * - **Logging de uso** (tokens y latencia) por llamada.
 * - **Validación de esquema**: si el modelo devuelve algo que no valida,
 *   se lanza `ErrorLLM` con tipo `esquema` y quien llama lo manda a la
 *   bandeja como `error` en vez de descartarlo en silencio.
 */

/**
 * Modelo chico, para clasificar y extraer. Es el que se usa en volumen:
 * el pase de extracción de lecciones y, más adelante, el clasificador de
 * transacciones.
 */
export const MODELO_CHICO = "llama-3.1-8b-instant";

/**
 * Modelo grande, para tragar mucho contexto. La retro por proyecto es su
 * caso: se le pasan todos los movimientos, las lecciones y la bitácora de
 * un proyecto y una sola llamada tiene que salir bien.
 */
export const MODELO_GRANDE = "llama-3.3-70b-versatile";

/**
 * Modelo con razonamiento, para cuando el enemigo es la generalidad.
 *
 * Medido el 2026-08-08 con el prompt real de generación de lecciones
 * (6.3), mismo sistema y mismo usuario:
 *
 * - `llama-3.3-70b-versatile` devolvió cinco lecciones con títulos que
 *   son rótulos: "Establecer límites de soporte", "Priorizar la
 *   documentación", "Revisar contratos". El contenido no está mal, pero
 *   el título podría estar en cualquier libro de negocios, que es
 *   exactamente lo que el prompt prohíbe.
 * - `openai/gpt-oss-120b` con `reasoning_effort: "medium"` devolvió
 *   afirmaciones discutibles: "Los clientes pequeños deben pagar una
 *   cuota de mantenimiento o te devoran", "Cobrar por cada versión mayor
 *   evita que el cliente exija cambios sin fin".
 * - `qwen/qwen3.6-27b` no devolvió JSON válido **con ese prompt** (400 de
 *   Groq). ⚠ Eso NO es una propiedad del modelo, aunque acá estuvo
 *   escrito como si lo fuera: medido el 2026-08-10, qwen responde bien
 *   con `response_format: json_object`. Importa porque es el **único
 *   modelo de la cuenta que lee imágenes** —los otros tres contestan 400
 *   apenas les mandás el array multimodal— y descartarlo por esta frase
 *   dejaba sin salida el caso de las capturas.
 *
 * Los ejemplos en contraste dentro del prompt no alcanzaron para mover a
 * llama: el techo era el modelo. **No reemplaza a `MODELO_GRANDE`**, que
 * sigue siendo el de la retro: ahí la entrada es enorme, la salida ya
 * salía anclada en los datos y el razonamiento se comería el presupuesto
 * de tokens sin comprar nada.
 */
export const MODELO_RAZONADOR = "openai/gpt-oss-120b";

/**
 * El único modelo de la cuenta que **ve imágenes**.
 *
 * Medido el 2026-08-10 disparando contra la API real, no leyendo
 * documentación: `MODELO_CHICO`, `MODELO_GRANDE` y `MODELO_RAZONADOR`
 * contestan los tres **HTTP 400 con el mismo mensaje literal**
 * (`messages[0].content must be a string`) apenas les llega el array
 * multimodal. No es que vean mal: el endpoint rechaza la forma del
 * pedido. Qwen, en la misma corrida, contestó otra cosa —`invalid image
 * data`, porque el PNG de prueba estaba mal armado— y con un PNG válido
 * describió bien el color. Lee.
 *
 * Y lee **con `response_format: json_object`**, que es lo que
 * `completarJSON` manda siempre y sin lo cual no serviría de nada acá.
 *
 * ⚠ Ojo con el docstring de `MODELO_RAZONADOR`: ahí dice que qwen "no
 * devolvió JSON válido". Eso era **con el prompt de 6.3** y sigue siendo
 * cierto de esa medición; lo que no es cierto es leerlo como una
 * propiedad del modelo. Se lo descartó para **redactar lecciones**, que
 * es otra tarea. Para transcribir lo que se ve, se midió que anda y —lo
 * más importante— que **no alucina cuando no puede leer**: a un damero
 * en blanco y negro contestó `legible: false` y describió lo que había,
 * en vez de inventar una conversación con un cliente. Sin esa propiedad,
 * el caso de las capturas no sería viable.
 *
 * Costo medido: entre 780 y 1810 `prompt_tokens` por imagen, **sin
 * correlación con los bytes** (ver `TOKENS_POR_IMAGEN`), y entre 1220 y
 * 1670 tokens el pase completo de una captura. Contra el techo del
 * minuto entran **tres por minuto**, no cinco: Groq reserva
 * `prompt + max_tokens`, igual que el limitador de acá.
 */
export const MODELO_VISION = "qwen/qwen3.6-27b";

/**
 * Cuánto piensa antes de contestar un modelo de razonamiento.
 *
 * Los tokens de razonamiento **cuentan dentro de `max_tokens`** y dentro
 * del techo de tokens por minuto, así que esto es una perilla de costo y
 * no solo de calidad. Medido con el prompt de 6.3: `low` gastó 294
 * tokens de salida y devolvió 3 lecciones; `medium`, 2668 y devolvió 4,
 * bastante mejores. Con una feature que se dispara a mano y de a una,
 * `medium` se paga.
 */
export type EsfuerzoRazonamiento = "low" | "medium" | "high";

const URL_GROQ = "https://api.groq.com/openai/v1/chat/completions";

/** Techo de pedidos del tier gratuito. El limitador se queda un poco abajo. */
const REQUESTS_POR_MINUTO = 28;

/**
 * Techo de **tokens** por minuto, y el límite que realmente muerde.
 *
 * Medido contra la cuenta real el 2026-08-07: el tier gratuito corta por
 * tokens mucho antes que por pedidos. El pase de extracción gasta entre
 * 600 y 1000 tokens por entrada y come un 429 en la cuarta llamada, con
 * el contador de pedidos en 4 de 1000. Un limitador que solo cuenta
 * pedidos —lo que pedía el spec— no alcanza.
 *
 * **El techo es por modelo, y son distintos entre sí.** Leído de los
 * headers `x-ratelimit-limit-tokens` el 2026-08-08: 6000 para el chico,
 * 12000 para llama-70b y 8000 para gpt-oss-120b. Un balde único y global
 * —lo que había antes— frenaba la retro contra el techo del modelo más
 * chico, que ni siquiera estaba usando.
 *
 * Se deja margen porque el conteo de acá es una estimación hasta que
 * llega el `usage` de la respuesta.
 */
const TOKENS_POR_MINUTO: Readonly<Record<string, number>> = {
  [MODELO_CHICO]: 5_500,
  [MODELO_GRANDE]: 11_000,
  [MODELO_RAZONADOR]: 7_300,
  // El único modelo de la cuenta que lee imágenes; lo usa el pase de
  // capturas de `lib/adjuntos.ts`. Sin la fila caería al default
  // conservador de 5500 teniendo 8000 de techo real (leído de
  // `x-ratelimit-limit-tokens` el 2026-08-10, misma liga que el
  // razonador). Un modelo que no está acá no se rompe: se frena de más,
  // y eso no se ve en ningún error.
  // 7300 y no 8000: el techo real medido es 8000, pero todas las filas de
  // esta tabla van un poco por debajo del techo porque la reserva se hace
  // estimando y se corrige recién con el `usage` de la respuesta.
  [MODELO_VISION]: 7_300,
};

/** Para un modelo que no esté en la tabla, el techo más conservador. */
const TOKENS_POR_MINUTO_POR_DEFECTO = 5_500;

function techoDe(modelo: string): number {
  return TOKENS_POR_MINUTO[modelo] ?? TOKENS_POR_MINUTO_POR_DEFECTO;
}

/** Caracteres por token en español. Conservador a propósito. */
const CHARS_POR_TOKEN = 3;

/**
 * Cuántos tokens se le imputa a **cada imagen** en la estimación previa.
 *
 * Es un número fijo y no una función de los bytes, y esa es toda la
 * gracia. Groq reescala la imagen del lado suyo antes de tokenizarla, así
 * que el costo **no crece con el tamaño del archivo**: medido el
 * 2026-08-10 con PNGs de distintas resoluciones, entre **780 y 1810
 * `prompt_tokens`**, y una captura de celular de 1,4 MB salió más barata
 * (782) que una imagen cuadrada de 12 KB (1299).
 *
 * Si en cambio el data URI se midiera por largo de string —que es lo que
 * pasaría si la imagen entrara pegada dentro de `usuario`— un adjunto de
 * 1 MB son ~1,4 millones de caracteres de base64, o sea **~460 000
 * tokens estimados contra un techo de 8000**. El limitador dispararía su
 * salida de emergencia `noEntraNunca` y esperaría la ventana entera
 * **antes de cada imagen**: hasta un minuto de más, por nada. Por eso las
 * imágenes van por un parámetro propio de `completarJSON` y no dentro del
 * texto.
 *
 * Se toma el peor caso medido: reservar de más se corrige con el `usage`
 * de la respuesta, reservar de menos se paga con un 429.
 */
export const TOKENS_POR_IMAGEN = 1_800;

const VENTANA_MS = 60_000;
const TIMEOUT_POR_DEFECTO_MS = 60_000;
const REINTENTOS_POR_DEFECTO = 3;

/** Base del backoff exponencial: 1s, 2s, 4s… */
const BACKOFF_BASE_MS = 1_000;

/** Techo de la espera entre reintentos, incluso si el 429 pide más. */
const BACKOFF_MAX_MS = 30_000;

export type TipoErrorLLM =
  /** Falta `GROQ_API_KEY`. La app sigue en modo manual. */
  | "config"
  /** Se agotaron los reintentos contra 429. */
  | "cuota"
  /** Timeout, DNS caído, socket cortado. */
  | "red"
  /** 4xx que no es 429: pedido mal armado o key inválida. */
  | "http"
  /** Contestó, pero la salida no valida contra el esquema. */
  | "esquema";

export class ErrorLLM extends Error {
  readonly tipo: TipoErrorLLM;
  /** La respuesta cruda, cuando el problema fue de esquema. */
  readonly crudo?: string;

  constructor(tipo: TipoErrorLLM, mensaje: string, crudo?: string) {
    super(mensaje);
    this.name = "ErrorLLM";
    this.tipo = tipo;
    this.crudo = crudo;
  }
}

/**
 * ¿Hay modelo configurado?
 *
 * Sirve para apagar los botones de sugerencia sin romper nada: sin key,
 * cargar un gasto, escribir una lección y registrar la bitácora tienen que
 * seguir funcionando igual.
 */
export function hayModeloConfigurado(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

// ─────────────────────────────────────────────────────────────
// Limitador: pedidos por minuto Y tokens por minuto, POR MODELO
//
// Ventana deslizante sobre las últimas salidas, con su costo en tokens.
// Groq lleva un balde de tokens por modelo, así que acá hay uno por
// modelo también: gastar el cupo del razonador no tiene por qué frenar
// una extracción con el modelo chico.
//
// El carril de espera, en cambio, es **uno solo y compartido**. Las
// llamadas se serializan para poder contarlas antes de salir; con una
// app de un solo usuario que dispara estas cosas de a una, no hay nada
// que ganar dejándolas competir. Es estado de módulo, o sea que vale por
// instancia de función: si algún día hay varias en paralelo pegándole a
// Groq, esto se queda corto y hay que mover el contador a la base.
// ─────────────────────────────────────────────────────────────

interface Salida {
  t: number;
  /** Estimado antes de salir, corregido con el `usage` de la respuesta. */
  tokens: number;
}

/** Una ventana por modelo. */
const salidasPorModelo = new Map<string, Salida[]>();

function ventanaDe(modelo: string): Salida[] {
  let v = salidasPorModelo.get(modelo);
  if (!v) {
    v = [];
    salidasPorModelo.set(modelo, v);
  }
  return v;
}

/** Cola de un solo carril: las llamadas se serializan para poder contarlas. */
let turno: Promise<void> = Promise.resolve();

function purgar(salidas: Salida[], ahora: number): void {
  while (salidas.length > 0 && ahora - salidas[0]!.t >= VENTANA_MS) {
    salidas.shift();
  }
}

/**
 * Espera hasta que haya cupo de pedidos **y** de tokens para ese modelo,
 * y reserva el lugar. Devuelve la reserva para corregirla con el uso real.
 */
async function esperarTurno(
  modelo: string,
  tokensEstimados: number,
): Promise<Salida> {
  const anterior = turno;
  let liberar!: () => void;
  turno = new Promise<void>((resolver) => {
    liberar = resolver;
  });

  await anterior;

  const salidas = ventanaDe(modelo);
  const techo = techoDe(modelo);

  try {
    for (;;) {
      const ahora = Date.now();
      purgar(salidas, ahora);

      const usados = salidas.reduce((total, s) => total + s.tokens, 0);
      const hayPedidos = salidas.length < REQUESTS_POR_MINUTO;
      const hayTokens = usados + tokensEstimados <= techo;

      // Una sola llamada puede estimar más que el techo del minuto: la
      // retro de un proyecto grande, con toda su bitácora adentro, lo
      // pasa. Esperar no lo arregla —el minuto siguiente tiene el mismo
      // techo— así que con la ventana vacía se sale igual y que conteste
      // Groq. Sin esta salida el bucle no termina nunca y, peor, lee
      // `salidas[0]` de un array vacío.
      const noEntraNunca = tokensEstimados > techo;

      if (hayPedidos && (hayTokens || (noEntraNunca && salidas.length === 0))) {
        const reserva: Salida = { t: ahora, tokens: tokensEstimados };
        salidas.push(reserva);
        return reserva;
      }

      // La salida más vieja de la ventana define cuándo se libera cupo.
      // Si no hay ninguna, el freno es el de pedidos y no queda otra que
      // esperar la ventana entera.
      const espera = salidas[0]
        ? VENTANA_MS - (ahora - salidas[0].t) + 100
        : VENTANA_MS;
      console.warn(
        `[llm] limitador de ${modelo}: ${salidas.length} pedidos y ${usados}/${techo} tokens` +
          ` en el último minuto (falta ${hayTokens ? "cupo de pedidos" : "cupo de tokens"}),` +
          ` espero ${espera} ms.`,
      );
      await dormir(espera);
    }
  } finally {
    liberar();
  }
}

/**
 * Cuántos tokens va a costar la llamada, antes de hacerla.
 *
 * El texto se estima por largo; las imágenes, por costo fijo (ver
 * `TOKENS_POR_IMAGEN`). Sin imágenes el resultado es **idéntico** al de
 * antes de que existiera este parámetro: `0 * lo que sea` es 0.
 */
function estimarTokens(
  sistema: string,
  usuario: string,
  maxTokens: number,
  cuantasImagenes = 0,
  tokensPorImagen = TOKENS_POR_IMAGEN,
) {
  return (
    Math.ceil((sistema.length + usuario.length) / CHARS_POR_TOKEN) +
    maxTokens +
    cuantasImagenes * tokensPorImagen
  );
}

// ─────────────────────────────────────────────────────────────
// Llamada
// ─────────────────────────────────────────────────────────────

export interface OpcionesLLM<T> {
  /** `MODELO_CHICO` o `MODELO_GRANDE`. */
  modelo?: string;
  /** Instrucciones y formato esperado. */
  sistema: string;
  /** El dato concreto sobre el que trabaja. */
  usuario: string;
  /**
   * Imágenes que acompañan a `usuario`, como data URI (`data:image/png;
   * base64,…`) o URL.
   *
   * Van por acá y **no pegadas dentro de `usuario`** por dos razones
   * distintas, y las dos importan:
   *
   * 1. **La estimación.** Un data URI mide megabytes de base64 y por
   *    largo de string daría cientos de miles de tokens; acá cada imagen
   *    cuesta `tokensPorImagen` y punto (ver `TOKENS_POR_IMAGEN`).
   * 2. **La forma del pedido.** Con imágenes, `content` del mensaje de
   *    usuario deja de ser un string y pasa a ser el array multimodal de
   *    OpenAI. Armarlo acá adentro es lo que deja a los llamadores sin
   *    enterarse.
   *
   * **Sin este campo no cambia absolutamente nada**: mismo body, mismo
   * `content` string, misma estimación. Es lo que hace que los llamadores
   * de hoy —ninguno manda imágenes— sigan comportándose igual.
   *
   * ⚠ Ojo con el modelo: medido el 2026-08-10, `MODELO_CHICO`,
   * `MODELO_GRANDE` y `MODELO_RAZONADOR` contestan **HTTP 400
   * (`messages[0].content must be a string`)** apenas les llega el array.
   * El único de la cuenta que lee imágenes es `qwen/qwen3.6-27b`.
   */
  imagenes?: string[];
  /**
   * Cuánto reservar por imagen, si algún día se mide otra cosa o se
   * cambia de modelo. Por defecto, `TOKENS_POR_IMAGEN`.
   */
  tokensPorImagen?: number;
  /** Se valida contra la respuesta antes de devolverla. */
  esquema: z.ZodType<T>;
  /** Bajo a propósito: acá se quiere consistencia, no creatividad. */
  temperatura?: number;
  /**
   * Solo para `MODELO_RAZONADOR`. Los modelos sin razonamiento ignoran
   * el parámetro, así que mandarlo de más no rompe nada.
   */
  esfuerzo?: EsfuerzoRazonamiento;
  maxTokens?: number;
  timeoutMs?: number;
  reintentos?: number;
  /** Para cancelar desde afuera (por ejemplo, el pase completo). */
  signal?: AbortSignal;
  /** Aparece en los logs de uso para saber qué feature gastó qué. */
  etiqueta?: string;
}

export interface RespuestaLLM<T> {
  datos: T;
  uso: {
    modelo: string;
    tokensEntrada: number;
    tokensSalida: number;
    latenciaMs: number;
  };
}

/** Las dos piezas del `content` multimodal de OpenAI que usa Groq. */
type ContenidoMultimodal =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface RespuestaGroq {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Pide una salida JSON al modelo y la valida contra un esquema de Zod.
 *
 * Lanza `ErrorLLM` siempre que algo falle: quien llama decide si eso es
 * un ítem de bandeja con estado `error`, un aviso discreto en pantalla o
 * simplemente nada. Lo que **no** puede hacer es dejar caer el flujo
 * manual del usuario.
 */
export async function completarJSON<T>({
  modelo = MODELO_CHICO,
  sistema,
  usuario,
  imagenes,
  tokensPorImagen = TOKENS_POR_IMAGEN,
  esquema,
  temperatura = 0.2,
  esfuerzo,
  maxTokens = 1024,
  timeoutMs = TIMEOUT_POR_DEFECTO_MS,
  reintentos = REINTENTOS_POR_DEFECTO,
  signal,
  etiqueta = "sin-etiqueta",
}: OpcionesLLM<T>): Promise<RespuestaLLM<T>> {
  if (!hayModeloConfigurado()) {
    throw new ErrorLLM(
      "config",
      "No hay modelo configurado (falta GROQ_API_KEY).",
    );
  }

  const key = groqApiKey();
  const estimado = estimarTokens(
    sistema,
    usuario,
    maxTokens,
    imagenes?.length ?? 0,
    tokensPorImagen,
  );

  // Sin imágenes, `content` sigue siendo el string de siempre: es la
  // única forma que aceptan los tres modelos que usa la app hoy.
  const contenidoUsuario: string | ContenidoMultimodal[] =
    imagenes && imagenes.length > 0
      ? [
          { type: "text", text: usuario },
          ...imagenes.map((url) => ({
            type: "image_url" as const,
            image_url: { url },
          })),
        ]
      : usuario;

  let ultimoError: ErrorLLM | undefined;

  for (let intento = 0; intento <= reintentos; intento++) {
    if (signal?.aborted) throw new ErrorLLM("red", "Pase cancelado.");

    const reserva = await esperarTurno(modelo, estimado);

    const arranque = Date.now();
    let respuesta: Response;

    try {
      respuesta = await conTimeout(
        (interna) =>
          fetch(URL_GROQ, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({
              model: modelo,
              temperature: temperatura,
              max_tokens: maxTokens,
              ...(esfuerzo ? { reasoning_effort: esfuerzo } : {}),
              // Groq garantiza JSON sintácticamente válido con esto; la
              // forma la garantiza Zod, más abajo.
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: sistema },
                { role: "user", content: contenidoUsuario },
              ],
            }),
            signal: interna,
          }),
        timeoutMs,
        signal,
      );
    } catch (error: unknown) {
      // No hubo respuesta: no se consumió cuota. Devolver la reserva
      // evita que el limitador se frene por pedidos que nunca llegaron.
      reserva.tokens = 0;
      ultimoError = new ErrorLLM(
        "red",
        error instanceof Error ? error.message : "Falló la conexión con Groq.",
      );
      if (intento < reintentos) {
        await dormir(backoff(intento));
        continue;
      }
      throw ultimoError;
    }

    // --- 429 y 5xx: reintentables --------------------------------
    if (respuesta.status === 429 || respuesta.status >= 500) {
      // Rechazado: tampoco gastó tokens.
      reserva.tokens = 0;
      const cuerpo = await leerTexto(respuesta);
      ultimoError = new ErrorLLM(
        respuesta.status === 429 ? "cuota" : "red",
        `Groq contestó ${respuesta.status}: ${cuerpo.slice(0, 200)}`,
      );

      if (intento < reintentos) {
        await dormir(backoff(intento, respuesta.headers.get("retry-after")));
        continue;
      }
      throw ultimoError;
    }

    // --- Otros 4xx: no tiene sentido reintentar -------------------
    if (!respuesta.ok) {
      reserva.tokens = 0;
      const cuerpo = await leerTexto(respuesta);
      throw new ErrorLLM(
        "http",
        `Groq contestó ${respuesta.status}: ${cuerpo.slice(0, 200)}`,
      );
    }

    const json = (await respuesta.json()) as RespuestaGroq;
    const contenido = json.choices?.[0]?.message?.content ?? "";
    const latenciaMs = Date.now() - arranque;

    const uso = {
      modelo,
      tokensEntrada: json.usage?.prompt_tokens ?? 0,
      tokensSalida: json.usage?.completion_tokens ?? 0,
      latenciaMs,
    };

    // Corrige la reserva con lo que se gastó de verdad. La estimación
    // reserva `maxTokens` completos de salida y casi siempre sobra: sin
    // esta corrección el limitador frenaría de más.
    reserva.tokens = uso.tokensEntrada + uso.tokensSalida;

    console.info(
      `[llm] ${etiqueta} · ${modelo} · ${uso.tokensEntrada}+${uso.tokensSalida} tokens · ${latenciaMs} ms`,
    );

    // --- Validación: acá no se reintenta -------------------------
    //
    // Un JSON que no valida no mejora por pedirlo de nuevo, y el spec
    // quiere ver ese caso en la bandeja marcado como error, no oculto
    // detrás de tres reintentos.
    let crudo: unknown;
    try {
      crudo = JSON.parse(contenido);
    } catch {
      throw new ErrorLLM(
        "esquema",
        "El modelo no devolvió JSON parseable.",
        contenido,
      );
    }

    const parseo = esquema.safeParse(crudo);
    if (!parseo.success) {
      throw new ErrorLLM(
        "esquema",
        parseo.error.issues
          .map((i) => `${i.path.join(".") || "raíz"}: ${i.message}`)
          .join("; "),
        contenido,
      );
    }

    return { datos: parseo.data, uso };
  }

  throw ultimoError ?? new ErrorLLM("red", "No se pudo llamar al modelo.");
}

/** Mensaje corto y en criollo para mostrar en pantalla. */
export function mensajeDeErrorLLM(error: unknown): string {
  if (error instanceof ErrorLLM) {
    switch (error.tipo) {
      case "config":
        return "No hay modelo configurado. Todo lo demás anda igual.";
      case "cuota":
        return "El modelo está sin cupo por ahora. Probá en un rato.";
      case "red":
        return "No pude hablar con el modelo. Probá de nuevo.";
      case "http":
        return "El modelo rechazó el pedido.";
      case "esquema":
        return "El modelo contestó algo que no entiendo. Quedó anotado.";
    }
  }
  return error instanceof Error ? error.message : "Error inesperado.";
}

// ─────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────

function backoff(intento: number, retryAfter?: string | null): number {
  // Si Groq dice cuánto esperar, le hacemos caso (acotado).
  const pedido = retryAfter ? Number(retryAfter) * 1_000 : NaN;
  const base = Number.isFinite(pedido)
    ? pedido
    : BACKOFF_BASE_MS * 2 ** intento;

  // Jitter: sin esto, dos pases que arrancan juntos reintentan juntos.
  return Math.min(base, BACKOFF_MAX_MS) + Math.random() * 250;
}

function dormir(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

async function leerTexto(respuesta: Response): Promise<string> {
  try {
    return await respuesta.text();
  } catch {
    return "";
  }
}

/**
 * Corre un fetch con techo de tiempo, encadenando la señal de afuera.
 *
 * El `AbortController` propio es el que corta por timeout; el `signal`
 * externo (cancelar el pase entero) se reenvía al mismo controlador.
 */
async function conTimeout(
  ejecutar: (signal: AbortSignal) => Promise<Response>,
  ms: number,
  externa?: AbortSignal,
): Promise<Response> {
  const controlador = new AbortController();
  const porTimeout = setTimeout(
    () => controlador.abort(new Error(`El modelo tardó más de ${ms} ms.`)),
    ms,
  );
  const propagar = () => controlador.abort(externa?.reason);
  externa?.addEventListener("abort", propagar);

  try {
    return await ejecutar(controlador.signal);
  } finally {
    clearTimeout(porTimeout);
    externa?.removeEventListener("abort", propagar);
  }
}
