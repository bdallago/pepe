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
 * Modelo grande, para razonar. La retro por proyecto es su caso: mucho
 * contexto y una sola llamada, donde la calidad vale más que la latencia.
 */
export const MODELO_GRANDE = "llama-3.3-70b-versatile";

const URL_GROQ = "https://api.groq.com/openai/v1/chat/completions";

/** Techo de pedidos del tier gratuito. El limitador se queda un poco abajo. */
const REQUESTS_POR_MINUTO = 28;

/**
 * Techo de **tokens** por minuto, y el límite que realmente muerde.
 *
 * Medido contra la cuenta real el 2026-08-07: el tier gratuito corta en
 * 6000 TPM sobre `llama-3.1-8b-instant`, y el pase de extracción gasta
 * entre 600 y 1000 tokens por entrada. O sea que se choca el techo de
 * tokens en la cuarta llamada, mucho antes de acercarse a los 30
 * pedidos por minuto. Un limitador que solo cuenta pedidos —lo que pedía
 * el spec— no alcanza y come 429 igual.
 *
 * Se deja margen porque el conteo de acá es una estimación hasta que
 * llega el `usage` de la respuesta.
 */
const TOKENS_POR_MINUTO = 5_500;

/** Caracteres por token en español. Conservador a propósito. */
const CHARS_POR_TOKEN = 3;

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
// Limitador: pedidos por minuto Y tokens por minuto
//
// Ventana deslizante sobre las últimas salidas, con su costo en tokens.
// Es estado de módulo, así que vale por instancia de función: con una app
// de un solo usuario y llamadas serializadas alcanza y sobra. Si algún
// día hay varias instancias en paralelo pegándole a Groq, esto se queda
// corto y hay que mover el contador a la base.
// ─────────────────────────────────────────────────────────────

interface Salida {
  t: number;
  /** Estimado antes de salir, corregido con el `usage` de la respuesta. */
  tokens: number;
}

const salidas: Salida[] = [];

/** Cola de un solo carril: las llamadas se serializan para poder contarlas. */
let turno: Promise<void> = Promise.resolve();

function purgar(ahora: number): void {
  while (salidas.length > 0 && ahora - salidas[0]!.t >= VENTANA_MS) {
    salidas.shift();
  }
}

/**
 * Espera hasta que haya cupo de pedidos **y** de tokens, y reserva el
 * lugar. Devuelve la reserva para poder corregirla con el uso real.
 */
async function esperarTurno(tokensEstimados: number): Promise<Salida> {
  const anterior = turno;
  let liberar!: () => void;
  turno = new Promise<void>((resolver) => {
    liberar = resolver;
  });

  await anterior;

  try {
    for (;;) {
      const ahora = Date.now();
      purgar(ahora);

      const usados = salidas.reduce((total, s) => total + s.tokens, 0);
      const hayPedidos = salidas.length < REQUESTS_POR_MINUTO;
      const hayTokens = usados + tokensEstimados <= TOKENS_POR_MINUTO;

      if (hayPedidos && hayTokens) {
        const reserva: Salida = { t: ahora, tokens: tokensEstimados };
        salidas.push(reserva);
        return reserva;
      }

      // La salida más vieja de la ventana define cuándo se libera cupo.
      const espera = VENTANA_MS - (ahora - salidas[0]!.t) + 100;
      console.warn(
        `[llm] limitador: ${salidas.length} pedidos y ${usados} tokens en el último minuto` +
          ` (falta ${hayTokens ? "cupo de pedidos" : "cupo de tokens"}), espero ${espera} ms.`,
      );
      await dormir(espera);
    }
  } finally {
    liberar();
  }
}

/** Cuántos tokens va a costar la llamada, antes de hacerla. */
function estimarTokens(sistema: string, usuario: string, maxTokens: number) {
  return Math.ceil((sistema.length + usuario.length) / CHARS_POR_TOKEN) + maxTokens;
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
  /** Se valida contra la respuesta antes de devolverla. */
  esquema: z.ZodType<T>;
  /** Bajo a propósito: acá se quiere consistencia, no creatividad. */
  temperatura?: number;
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
  esquema,
  temperatura = 0.2,
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
  const estimado = estimarTokens(sistema, usuario, maxTokens);
  let ultimoError: ErrorLLM | undefined;

  for (let intento = 0; intento <= reintentos; intento++) {
    if (signal?.aborted) throw new ErrorLLM("red", "Pase cancelado.");

    const reserva = await esperarTurno(estimado);

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
              // Groq garantiza JSON sintácticamente válido con esto; la
              // forma la garantiza Zod, más abajo.
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: sistema },
                { role: "user", content: usuario },
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
