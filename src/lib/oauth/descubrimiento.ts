import { generateProtectedResourceMetadata } from "mcp-handler";

import {
  ALCANCES_SOPORTADOS,
  origenPublico,
  RUTA_AUTORIZAR,
  RUTA_MCP,
  RUTA_REGISTRO,
  RUTA_TOKEN,
} from "@/lib/oauth/protocolo";

/**
 * Los dos documentos de descubrimiento.
 *
 * Están juntos en un módulo porque tienen que decir lo mismo: el
 * `authorization_servers` del recurso apunta al `issuer` del servidor, y
 * si se escriben en dos lugares distintos, tarde o temprano dejan de
 * coincidir y el síntoma es un conector que "no conecta" sin más pista.
 */

/**
 * El identificador del recurso protegido.
 *
 * ⚠ **Tiene que coincidir carácter por carácter con la URL que Beno
 * escriba en Claude**, path incluido. Por eso se arma con el origen
 * público del request —el dominio que el cliente realmente usó— y no con
 * una constante: así vale igual en `localhost`, en un preview de Vercel y
 * en `pepe-beno.vercel.app`, sin ninguna variable de entorno que se pueda
 * quedar vieja.
 */
export function urlDelRecurso(cabeceras: Headers, urlFallback: string): string {
  return `${origenPublico(cabeceras, urlFallback)}${RUTA_MCP}`;
}

/**
 * RFC 9728 — metadata del recurso protegido.
 *
 * ⚠ **Claude usa la PRIMERA entrada de `authorization_servers` y no
 * prueba las demás.** Acá hay una sola —Pepe es su propio authorization
 * server— así que no hay ambigüedad, pero si alguna vez se agrega otra,
 * el orden es la decisión.
 */
export function metadataDelRecurso(cabeceras: Headers, urlFallback: string) {
  const origen = origenPublico(cabeceras, urlFallback);

  return generateProtectedResourceMetadata({
    authServerUrls: [origen],
    resourceUrl: `${origen}${RUTA_MCP}`,
    additionalMetadata: {
      resource_name: "Pepe",
      scopes_supported: [...ALCANCES_SOPORTADOS],
      // El token va en `Authorization: Bearer`, nunca en la query: una
      // URL termina en logs, en el historial y en el `Referer`.
      bearer_methods_supported: ["header"],
    },
  });
}

/**
 * RFC 8414 — metadata del authorization server.
 *
 * El `issuer` es el origen pelado, sin path, y por eso este documento va
 * en `/.well-known/oauth-authorization-server` a secas: RFC 8414 §3
 * arma la URL insertando `.well-known` **entre el host y el path** del
 * issuer, y acá no hay path que insertar.
 */
export function metadataDelServidor(cabeceras: Headers, urlFallback: string) {
  const origen = origenPublico(cabeceras, urlFallback);

  return {
    issuer: origen,
    authorization_endpoint: `${origen}${RUTA_AUTORIZAR}`,
    token_endpoint: `${origen}${RUTA_TOKEN}`,
    // Sin esto Claude no puede conectarse solo: no hay forma de darle un
    // client_id a mano desde la pantalla de conectores.
    registration_endpoint: `${origen}${RUTA_REGISTRO}`,
    scopes_supported: [...ALCANCES_SOPORTADOS],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    // ⚠ Obligatorio anunciarlo: sin `code_challenge_methods_supported`,
    // Claude asume que el servidor no soporta PKCE y no arranca el flujo.
    // S256 y nada más — `plain` no protege de nada.
    code_challenge_methods_supported: ["S256"],
    // Cliente público: no hay secreto que presentar en `/token`. Lo que
    // ata el canje al cliente es PKCE.
    token_endpoint_auth_methods_supported: ["none"],
    // RFC 9207: el redirect de vuelta trae `iss`, para que el cliente
    // pueda comprobar quién le contestó si algún día hay más de un
    // servidor configurado.
    authorization_response_iss_parameter_supported: true,
  };
}
