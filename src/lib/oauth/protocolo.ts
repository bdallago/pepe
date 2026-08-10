import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { getPublicOrigin } from "mcp-handler";

/**
 * Las piezas sueltas del protocolo OAuth 2.1: nombres de rutas, alcances,
 * hashes, PKCE y la comparación de `redirect_uri`.
 *
 * Está separado de `almacen.ts` a propósito: acá no se toca la base, así
 * que todo lo de este archivo es una función pura o casi, y se puede leer
 * (y discutir) sin tener el esquema en la cabeza.
 */

// ------------------------------------------------------------
// Rutas
//
// El `/authorize` es una **página** y los otros dos son route handlers
// bajo `/api`. La diferencia no es cosmética: `/authorize` lo abre el
// browser de Beno y necesita cookie de sesión, mientras que `/token` y
// `/register` los llama el servidor de Claude, sin cookies. Por eso los
// dos últimos viven bajo `/api/oauth`, que el middleware excluye — si no,
// se comerían un 307 a `/login` en vez de contestar JSON.
// ------------------------------------------------------------

/** La página de consentimiento. Bajo el middleware: necesita sesión. */
export const RUTA_AUTORIZAR = "/oauth/authorize";

/** El POST del botón "Autorizar". También necesita sesión. */
export const RUTA_CONFIRMAR = "/oauth/authorize/confirmar";

/** Canje de código y refresh. Sin cookies. */
export const RUTA_TOKEN = "/api/oauth/token";

/** Registro dinámico de clientes (RFC 7591). Sin cookies. */
export const RUTA_REGISTRO = "/api/oauth/register";

/**
 * El recurso protegido: el servidor MCP.
 *
 * ⚠ Este path es parte de la **identidad** del recurso, no solo de su
 * ubicación: el `resource` del metadata tiene que coincidir carácter por
 * carácter con la URL que Beno escriba en Claude, y Claude escribe la
 * URL completa del MCP, no el dominio. Si esto dijera `""`, el metadata
 * anunciaría `https://pepe-beno.vercel.app` y Claude no lo aceptaría.
 */
export const RUTA_MCP = "/api/mcp";

// ------------------------------------------------------------
// Alcances y vidas útiles
// ------------------------------------------------------------

/**
 * Los dos alcances que se anuncian.
 *
 * - `mcp`: usar el conector. Uno solo, no una lista por herramienta:
 *   Pepe es de un solo usuario y partirlo en cinco alcances sería
 *   ceremonia sin nadie a quien limitar.
 * - `offline_access`: la documentación de conectores dice que Claude
 *   **pide** este alcance si lo ve anunciado, y que sin refresh token
 *   hay que volver a autorizar a mano cuando vence el access token.
 */
export const ALCANCES_SOPORTADOS = ["mcp", "offline_access"] as const;

/** Lo que se otorga cuando el cliente no pide nada en particular. */
export const ALCANCE_POR_DEFECTO = ALCANCES_SOPORTADOS.join(" ");

/**
 * El código de autorización vive un minuto.
 *
 * Es un secreto que viaja por la barra de direcciones y queda en el
 * historial del browser: cuanto menos viva, mejor. Un minuto sobra —
 * entre el redirect y el POST a `/token` pasan milisegundos.
 */
export const VIDA_CODIGO_SEGUNDOS = 60;

/**
 * El access token vive una hora.
 *
 * Claude refresca solo: reactivamente ante un 401 y proactivamente hasta
 * 5 minutos antes del vencimiento. Con una hora, el refresh ocurre poco
 * y la ventana de un token filtrado es corta.
 */
export const VIDA_ACCESS_SEGUNDOS = 60 * 60;

/** La firma del formulario de consentimiento no dura más que la pantalla. */
export const VIDA_CONSENTIMIENTO_SEGUNDOS = 10 * 60;

// ------------------------------------------------------------
// Origen público
// ------------------------------------------------------------

/**
 * El origen con el que el mundo ve a Pepe, respetando los headers del
 * proxy de Vercel.
 *
 * Se deriva del request en vez de leerse de una variable de entorno para
 * que el mismo código sirva en `localhost`, en un preview y en
 * producción sin configurar nada — es la misma decisión que ya está
 * tomada para el redirect del login de Google (ver `.env.example`).
 *
 * La precedencia de headers la pone `getPublicOrigin` de `mcp-handler`,
 * que ya la tiene resuelta (X-Forwarded-Host → Forwarded → req.url). Acá
 * solo se le da una forma que también sirva desde `headers()`, donde no
 * hay ningún `Request` a mano.
 */
export function origenPublico(cabeceras: Headers, urlFallback: string): string {
  return getPublicOrigin(
    new Request(urlFallback, { headers: new Headers(cabeceras) }),
  );
}

// ------------------------------------------------------------
// Secretos: generar, hashear, comparar
// ------------------------------------------------------------

/**
 * Un secreto nuevo. 32 bytes de `randomBytes` en base64url: 256 bits de
 * entropía, sin caracteres que haya que escapar en una URL ni en un
 * `application/x-www-form-urlencoded`.
 *
 * El prefijo no es decoración: hace que un token que aparezca en un log
 * o en un pegado se reconozca de un vistazo, y le da algo concreto que
 * buscar a un escaneo de secretos.
 */
export function generarSecreto(prefijo: string): string {
  return `${prefijo}_${randomBytes(32).toString("base64url")}`;
}

/**
 * El hash con el que se guarda un secreto. **Nunca se guarda el valor en
 * claro**: si alguien lee `oauth_tokens`, no se lleva nada canjeable.
 *
 * SHA-256 pelado y no bcrypt/argon a propósito: estos secretos tienen
 * 256 bits de aleatoriedad, no son contraseñas elegidas por una persona,
 * así que no hay diccionario que valga y el costo de derivación no
 * compraría nada. Lo que sí compra es que el lookup sea un índice.
 */
export function hashear(valor: string): string {
  return createHash("sha256").update(valor).digest("hex");
}

/** Comparación en tiempo constante de dos strings ASCII. */
export function igualSeguro(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * PKCE S256: `code_challenge === base64url(sha256(code_verifier))`.
 *
 * Es lo único que ata el canje del código al cliente que lo pidió —
 * Claude se registra como cliente **público**, sin secreto—, así que sin
 * esto cualquiera que intercepte el código se lleva el token.
 */
export function verificarPkce(verifier: string, challenge: string): boolean {
  // RFC 7636 §4.1: entre 43 y 128 caracteres del alfabeto unreserved.
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const calculado = createHash("sha256").update(verifier).digest("base64url");
  return igualSeguro(calculado, challenge);
}

// ------------------------------------------------------------
// redirect_uri
// ------------------------------------------------------------

/**
 * Los tres nombres de la máquina de uno mismo. Se tratan como el mismo
 * host: los tres entregan el código en la computadora de Beno, así que
 * distinguirlos no protege de nada y sí rompe clientes que registran uno
 * y usan el otro.
 */
const HOSTS_LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function esLoopback(url: URL): boolean {
  return url.protocol === "http:" && HOSTS_LOOPBACK.has(url.hostname);
}

/**
 * ¿Se puede registrar esta `redirect_uri`?
 *
 * Solo `https://` (las superficies hospedadas de Claude, que usan
 * `https://claude.ai/api/mcp/auth_callback`) y `http://` de loopback
 * (Claude Code, que levanta un servidor local). Nada de `http://` a un
 * host de internet —el código viajaría en claro— ni de esquemas raros
 * como `javascript:`, que convertirían el redirect en un XSS.
 */
export function redirectUriRegistrable(valor: string): boolean {
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    return false;
  }
  // RFC 6749 §3.1.2: la URI de redirección no puede tener fragmento.
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  return esLoopback(url);
}

/**
 * ¿La `redirect_uri` que llega en `/authorize` es una de las registradas?
 *
 * Comparación exacta, **con una excepción medida**: en loopback se ignora
 * el puerto. Claude Code abre un servidor local en un puerto libre
 * distinto en cada corrida, así que exigir el puerto registrado haría
 * fallar todas las conexiones menos la primera. Es exactamente el caso
 * que contempla RFC 8252 §7.3, que pide que el authorization server
 * acepte cualquier puerto de loopback.
 */
export function redirectUriPermitida(
  registradas: readonly string[],
  solicitada: string,
): boolean {
  if (registradas.includes(solicitada)) return true;

  let pedida: URL;
  try {
    pedida = new URL(solicitada);
  } catch {
    return false;
  }
  if (!esLoopback(pedida)) return false;

  return registradas.some((registrada) => {
    let candidata: URL;
    try {
      candidata = new URL(registrada);
    } catch {
      return false;
    }
    if (!esLoopback(candidata)) return false;
    // Todo tiene que coincidir menos el puerto y cuál de los tres
    // nombres de loopback se usó.
    return (
      candidata.pathname === pedida.pathname &&
      candidata.search === pedida.search
    );
  });
}

// ------------------------------------------------------------
// Respuestas
// ------------------------------------------------------------

/**
 * CORS abierto en los endpoints de OAuth.
 *
 * No es un agujero: ninguno de estos endpoints se autentica con cookie
 * —`/token` y `/register` son públicos por diseño y lo que los protege
 * es PKCE—, así que un browser que los llame desde otro origen no puede
 * hacer nada que no pudiera hacer con un `curl`. Sin esto, un cliente
 * MCP que corra dentro de una página web no puede ni leer el metadata.
 */
export const CABECERAS_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

/**
 * Un error de OAuth, con la forma que pide RFC 6749 §5.2.
 *
 * Los códigos son los del RFC y no inventados: Claude los interpreta. El
 * caso que más importa es `invalid_grant` en el refresh — la
 * documentación de conectores dice que ante ese código Claude vuelve a
 * pedir autorización, y ante cualquier otro se queda colgado.
 */
export function errorOauth(
  error: string,
  descripcion: string,
  status = 400,
): Response {
  return new Response(JSON.stringify({ error, error_description: descripcion }), {
    status,
    headers: {
      ...CABECERAS_CORS,
      "Content-Type": "application/json",
      // RFC 6749 §5.1: nada de esto se cachea nunca.
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  });
}

/** Un JSON común, sin caché y con CORS. */
export function jsonOauth(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: {
      ...CABECERAS_CORS,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  });
}

/** El preflight de los endpoints de OAuth. */
export function opcionesOauth(): Response {
  return new Response(null, { status: 204, headers: CABECERAS_CORS });
}

/**
 * Lee el cuerpo de un POST aceptando **los dos** formatos.
 *
 * RFC 6749 §4.1.3 manda `application/x-www-form-urlencoded` en `/token` y
 * RFC 7591 §3.1 manda `application/json` en `/register`: son dos parsers
 * distintos y un endpoint que soporte uno solo devuelve 415 cuando le
 * llega el otro. Como los dos formatos se leen igual de fácil, acá se
 * aceptan los dos en todos lados: ser liberal en lo que se recibe no
 * afloja ninguna validación y saca del medio una clase entera de fallas
 * difíciles de diagnosticar desde el otro lado.
 */
export async function leerCuerpo(
  request: Request,
): Promise<Record<string, unknown> | null> {
  const tipo = (request.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  const texto = await request.text();

  if (tipo === "application/json") {
    try {
      const objeto: unknown = JSON.parse(texto);
      if (!objeto || typeof objeto !== "object" || Array.isArray(objeto)) {
        return null;
      }
      return objeto as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  if (tipo === "application/x-www-form-urlencoded" || tipo === "") {
    return Object.fromEntries(new URLSearchParams(texto));
  }

  return null;
}

/**
 * El valor de un campo, solo si es un string no vacío.
 *
 * Hace falta porque el cuerpo puede venir de JSON, donde cualquier campo
 * puede ser un número, un objeto o null. Un `client_id` que resulte ser
 * `{}` tiene que caer como "falta el client_id", no romper más adelante.
 */
export function comoTexto(valor: unknown): string | undefined {
  return typeof valor === "string" && valor.length > 0 ? valor : undefined;
}

/** El primer valor de un parámetro que puede venir repetido. */
export function unico(valor: string | string[] | undefined): string | undefined {
  if (Array.isArray(valor)) return valor[0];
  return valor;
}

/**
 * Los alcances que se otorgan a partir de los que se piden.
 *
 * Lo que no está soportado se descarta en silencio, como permite RFC 6749
 * §3.3. Si no queda nada —o si el cliente no pidió nada— se otorgan los
 * dos: un conector sin `mcp` no sirve para nada y uno sin
 * `offline_access` obliga a re-autorizar a mano cada hora.
 */
export function alcancesOtorgados(pedidos: string | undefined): string {
  if (!pedidos) return ALCANCE_POR_DEFECTO;
  const otorgados = pedidos
    .split(/\s+/)
    .filter((a): a is (typeof ALCANCES_SOPORTADOS)[number] =>
      (ALCANCES_SOPORTADOS as readonly string[]).includes(a),
    );
  return otorgados.length > 0 ? otorgados.join(" ") : ALCANCE_POR_DEFECTO;
}

/**
 * Normaliza un identificador de recurso (RFC 8707) para compararlo.
 *
 * Solo se le saca la barra final: `…/api/mcp` y `…/api/mcp/` son el mismo
 * servidor y rechazar por eso sería castigar un tipeo. Todo lo demás se
 * compara tal cual, porque el `resource` **es** la identidad del recurso.
 */
export function normalizarRecurso(valor: string): string {
  return valor.replace(/\/+$/, "");
}
