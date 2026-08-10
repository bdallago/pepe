import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import {
  generarSecreto,
  hashear,
  VIDA_ACCESS_SEGUNDOS,
  VIDA_CODIGO_SEGUNDOS,
} from "@/lib/oauth/protocolo";

/**
 * Todo lo que OAuth escribe y lee en la base.
 *
 * Usa **siempre** la service role: `oauth_clients`, `oauth_codes` y
 * `oauth_tokens` tienen RLS habilitado y **cero policies**, así que con
 * la anon key no se ve nada. Eso es la garantía de que un token no se
 * puede leer desde el browser ni aunque alguien adivine el nombre de la
 * tabla (ver el encabezado de la migración).
 *
 * ⚠ De este archivo **no sale nunca un secreto en claro** salvo en el
 * momento de crearlo: `crearCodigo` y `emitirTokens` devuelven el valor
 * una sola vez, para ponerlo en el redirect o en la respuesta, y lo que
 * queda guardado es el sha256.
 */

function ahora(): Date {
  return new Date();
}

function enSegundos(segundos: number): string {
  return new Date(Date.now() + segundos * 1000).toISOString();
}

// ------------------------------------------------------------
// Clientes (RFC 7591)
// ------------------------------------------------------------

export type ClienteRegistrado = {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
};

/** Registra un cliente público —sin secreto— y devuelve su `client_id`. */
export async function registrarCliente(datos: {
  client_name: string | null;
  redirect_uris: string[];
}): Promise<ClienteRegistrado> {
  const admin = createAdminClient();
  const client_id = generarSecreto("pepe_cli");

  const { data, error } = await admin
    .from("oauth_clients")
    .insert({
      client_id,
      client_name: datos.client_name,
      redirect_uris: datos.redirect_uris,
    })
    .select("client_id, client_name, redirect_uris")
    .single();

  if (error) throw new Error(`No se pudo registrar el cliente: ${error.message}`);
  return data;
}

export async function buscarCliente(
  client_id: string,
): Promise<ClienteRegistrado | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("oauth_clients")
    .select("client_id, client_name, redirect_uris")
    .eq("client_id", client_id)
    .maybeSingle();

  return data ?? null;
}

// ------------------------------------------------------------
// Códigos de autorización
// ------------------------------------------------------------

/**
 * Emite un código para el par (cliente, usuario) y lo guarda hasheado.
 * Devuelve el código en claro **una sola vez**, para el redirect.
 */
export async function crearCodigo(datos: {
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
}): Promise<string> {
  const admin = createAdminClient();
  const codigo = generarSecreto("pepe_cod");

  const { error } = await admin.from("oauth_codes").insert({
    code_hash: hashear(codigo),
    client_id: datos.client_id,
    user_id: datos.user_id,
    redirect_uri: datos.redirect_uri,
    code_challenge: datos.code_challenge,
    code_challenge_method: "S256",
    scope: datos.scope,
    expires_at: enSegundos(VIDA_CODIGO_SEGUNDOS),
  });

  if (error) throw new Error(`No se pudo emitir el código: ${error.message}`);
  return codigo;
}

export type CanjeDeCodigo =
  | {
      estado: "ok";
      client_id: string;
      user_id: string;
      redirect_uri: string;
      code_challenge: string;
      scope: string;
      expires_at: string;
    }
  | { estado: "reusado"; client_id: string }
  | { estado: "desconocido" };

/**
 * Marca el código como usado y lo devuelve, en **una sola sentencia**.
 *
 * El `is("usado_en", null)` dentro del propio `update` es lo que hace que
 * el código sea de un solo uso de verdad: dos canjes simultáneos compiten
 * por la misma fila y solo uno se la lleva. Con un `select` y después un
 * `update` habría una ventana entre los dos en la que los dos pasan.
 *
 * Se quema **antes** de verificar PKCE, no después. Es a propósito: un
 * código es de un solo intento, y dejarlo vivo tras un verifier
 * equivocado le regalaría reintentos a quien lo haya interceptado.
 */
export async function canjearCodigo(codigo: string): Promise<CanjeDeCodigo> {
  const admin = createAdminClient();
  const code_hash = hashear(codigo);

  const { data } = await admin
    .from("oauth_codes")
    .update({ usado_en: ahora().toISOString() })
    .eq("code_hash", code_hash)
    .is("usado_en", null)
    .select("client_id, user_id, redirect_uri, code_challenge, scope, expires_at")
    .maybeSingle();

  if (data) return { estado: "ok", ...data };

  // No se pudo marcar: o el código no existe, o ya se había usado. La
  // diferencia importa — un código canjeado dos veces es la señal de que
  // alguien lo interceptó, y RFC 6749 §4.1.2 pide revocar lo que se emitió
  // con él.
  const { data: previa } = await admin
    .from("oauth_codes")
    .select("client_id, usado_en")
    .eq("code_hash", code_hash)
    .maybeSingle();

  if (previa?.usado_en) return { estado: "reusado", client_id: previa.client_id };
  return { estado: "desconocido" };
}

/**
 * Borra los códigos vencidos hace rato.
 *
 * Se llama al pasar por `/token`, que es barato y frecuente. El colchón
 * de una hora es para no borrar por accidente el código que se está
 * canjeando en este mismo request si los relojes no coinciden.
 */
export async function limpiarCodigosVencidos(): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("oauth_codes")
    .delete()
    .lt("expires_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
}

// ------------------------------------------------------------
// Tokens
// ------------------------------------------------------------

export type TokensEmitidos = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
};

/**
 * Emite un par access + refresh y guarda los dos hasheados.
 *
 * `rotado_de` es el hash del refresh anterior de esta cadena. Null en el
 * token que nace de un código; con valor en cada refresh. Además de dejar
 * la cadena registrada, **es el marcador de "ya se gastó"**: un refresh
 * está consumido exactamente cuando existe otra fila que lo apunta con
 * `rotado_de`. Se usa ese hecho en vez de una columna nueva, y tiene una
 * ventaja concreta: el access token viejo **no** hay que revocarlo al
 * rotar, así que sigue sirviendo hasta su vencimiento natural. Eso mata
 * la carrera clásica de la rotación —Claude refresca de onda, un pedido
 * en vuelo con el token viejo se come un 401, Claude reintenta el refresh
 * con el token que acaba de rotar y se dispara la alarma de reuso— sin
 * inventar ninguna ventana de gracia.
 */
export async function emitirTokens(datos: {
  client_id: string;
  user_id: string;
  scope: string;
  rotado_de?: string | null;
}): Promise<TokensEmitidos> {
  const admin = createAdminClient();
  const access_token = generarSecreto("pepe_at");
  const refresh_token = generarSecreto("pepe_rt");

  const { error } = await admin.from("oauth_tokens").insert({
    access_token_hash: hashear(access_token),
    refresh_token_hash: hashear(refresh_token),
    client_id: datos.client_id,
    user_id: datos.user_id,
    scope: datos.scope,
    expires_at: enSegundos(VIDA_ACCESS_SEGUNDOS),
    rotado_de: datos.rotado_de ?? null,
  });

  if (error) throw new Error(`No se pudieron emitir los tokens: ${error.message}`);

  return {
    access_token,
    refresh_token,
    expires_in: VIDA_ACCESS_SEGUNDOS,
    scope: datos.scope,
  };
}

export type LecturaDeRefresh =
  | { estado: "ok"; hash: string; client_id: string; user_id: string; scope: string }
  | { estado: "reusado"; client_id: string }
  | { estado: "desconocido" };

/**
 * Mira un refresh token y dice en cuál de los tres mundos estamos.
 *
 * - `ok`: existe, no está revocado y nadie lo rotó todavía.
 * - `reusado`: existe pero ya se gastó (hay una fila que lo apunta con
 *   `rotado_de`) o la cadena está revocada. **Es la señal de que se
 *   filtró**: el legítimo ya recibió uno nuevo, así que el que está
 *   presentando el viejo es alguien que se lo copió en el camino.
 * - `desconocido`: nunca existió, o su fila se borró.
 */
export async function leerRefresh(refresh_token: string): Promise<LecturaDeRefresh> {
  const admin = createAdminClient();
  const hash = hashear(refresh_token);

  const { data: fila } = await admin
    .from("oauth_tokens")
    .select("client_id, user_id, scope, revocado_en")
    .eq("refresh_token_hash", hash)
    .maybeSingle();

  if (!fila) return { estado: "desconocido" };
  if (fila.revocado_en) return { estado: "reusado", client_id: fila.client_id };

  const { data: sucesor } = await admin
    .from("oauth_tokens")
    .select("id")
    .eq("rotado_de", hash)
    .limit(1)
    .maybeSingle();

  if (sucesor) return { estado: "reusado", client_id: fila.client_id };

  return {
    estado: "ok",
    hash,
    client_id: fila.client_id,
    user_id: fila.user_id,
    scope: fila.scope,
  };
}

/**
 * Revoca **todos** los tokens vivos de un cliente y devuelve cuántos.
 *
 * Es la respuesta a un reuso de refresh y a un código canjeado dos veces.
 * Se revoca por `client_id` y no solo la cadena de ese token porque el
 * registro dinámico le da a **cada conexión su propio cliente**: el
 * `client_id` *es* la conexión, así que sus tokens *son* la cadena. Y
 * ante la duda de si el filtrado fue el refresh o algo más de esa
 * conexión, tirar todo abajo y obligar a re-autorizar cuesta un click y
 * cierra el caso; dejar vivo lo que quedó, no.
 */
export async function revocarTokensDeCliente(client_id: string): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("oauth_tokens")
    .update({ revocado_en: ahora().toISOString() })
    .eq("client_id", client_id)
    .is("revocado_en", null)
    .select("id");

  return data?.length ?? 0;
}

export type AccesoVerificado = {
  user_id: string;
  client_id: string;
  alcances: string[];
  /** Vencimiento en segundos desde época, como lo quiere `AuthInfo`. */
  vence_en: number;
};

/**
 * Valida un access token. Devuelve null si no sirve, sin decir por qué:
 * a quien presenta un token inválido no se le explica nada.
 *
 * Es lo que va a consumir `withMcpAuth` cuando se le enchufe la auth a
 * `/api/mcp` (otra tarea): el mapeo a `AuthInfo` es
 * `{ token, clientId: client_id, scopes: alcances, expiresAt: vence_en,
 * extra: { userId: user_id } }`.
 */
export async function verificarAccessToken(
  access_token: string,
): Promise<AccesoVerificado | null> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("oauth_tokens")
    .select("user_id, client_id, scope, expires_at, revocado_en")
    .eq("access_token_hash", hashear(access_token))
    .maybeSingle();

  if (!data) return null;
  if (data.revocado_en) return null;

  const vence = Date.parse(data.expires_at);
  if (!Number.isFinite(vence) || vence <= Date.now()) return null;

  return {
    user_id: data.user_id,
    client_id: data.client_id,
    alcances: data.scope ? data.scope.split(/\s+/).filter(Boolean) : [],
    vence_en: Math.floor(vence / 1000),
  };
}
