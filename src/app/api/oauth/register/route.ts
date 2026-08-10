import { registrarCliente } from "@/lib/oauth/almacen";
import {
  comoTexto,
  errorOauth,
  jsonOauth,
  leerCuerpo,
  opcionesOauth,
  redirectUriRegistrable,
} from "@/lib/oauth/protocolo";

/**
 * RFC 7591 — registro dinámico de clientes.
 *
 * Claude no tiene forma de que le demos un `client_id` a mano: la
 * pantalla de conectores pide una URL y nada más. Sin este endpoint no
 * hay conexión posible.
 *
 * ## Es abierto, y eso está bien
 *
 * Cualquiera puede registrar un cliente acá. No es un descuido: un
 * `client_id` no da acceso a nada. Lo único que hace es habilitar a
 * mandar a alguien a `/authorize`, y ahí la puerta la abre Beno con su
 * cuenta de Google —y solo la suya, contra `MCP_USUARIO_PERMITIDO`—.
 * Un atacante que registre mil clientes consigue mil filas y cero datos.
 *
 * Lo que sí cierra el registro es **a dónde puede volver el código**:
 * `redirect_uris` solo acepta `https://` y loopback (ver
 * `redirectUriRegistrable`).
 *
 * ## Cuidado con el volumen
 *
 * La documentación de conectores avisa que **cada conexión fresca
 * registra un cliente nuevo**. Con un solo usuario son unas pocas filas;
 * `oauth_clients` tiene `created_at` indexado justamente para poder
 * limpiar los viejos si alguna vez molestan.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // ⚠ Acá **sí** se exige JSON, al revés que en `/token`, que acepta los
  // dos formatos. La diferencia no es capricho: la metadata de RFC 7591
  // tiene arreglos adentro (`redirect_uris`), y en form-urlencoded no
  // existen. Aceptarlo obligaría a adivinar cómo vienen separadas las
  // URIs, y una URI mal partida es una dirección de vuelta registrada que
  // nadie pidió. Mejor un 415 que dice exactamente qué falta.
  const tipo = (request.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (tipo !== "application/json") {
    return errorOauth(
      "invalid_client_metadata",
      `El registro de clientes se manda como application/json (RFC 7591 §3.1); llegó \`${tipo || "sin Content-Type"}\`.`,
      415,
    );
  }

  const cuerpo = await leerCuerpo(request);

  if (!cuerpo) {
    return errorOauth(
      "invalid_client_metadata",
      "El cuerpo no es un objeto JSON válido.",
      400,
    );
  }

  const crudas: unknown = cuerpo.redirect_uris;
  const uris: unknown[] = Array.isArray(crudas) ? crudas : [];

  if (uris.length === 0) {
    return errorOauth(
      "invalid_redirect_uri",
      "Falta `redirect_uris`, que es obligatorio y tiene que ser un arreglo con al menos una URI.",
      400,
    );
  }

  const limpias: string[] = [];
  for (const uri of uris) {
    if (typeof uri !== "string" || !redirectUriRegistrable(uri)) {
      return errorOauth(
        "invalid_redirect_uri",
        `\`${String(uri)}\` no sirve como redirect_uri: se aceptan URLs https sin fragmento ` +
          "y http de loopback (localhost, 127.0.0.1, [::1]).",
        400,
      );
    }
    limpias.push(uri);
  }

  const nombreCrudo = comoTexto(cuerpo.client_name)?.trim();
  const nombre = nombreCrudo ? nombreCrudo.slice(0, 200) : null;

  const cliente = await registrarCliente({
    client_name: nombre,
    redirect_uris: limpias,
  });

  // RFC 7591 §3.2.1: 201 con la metadata registrada. Sin `client_secret`
  // ni `client_secret_expires_at`: es un cliente **público**, y decir que
  // no hay secreto es parte de la respuesta, no una omisión.
  return jsonOauth(
    {
      client_id: cliente.client_id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: cliente.client_name ?? undefined,
      redirect_uris: cliente.redirect_uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
  );
}

export const OPTIONS = opcionesOauth;
