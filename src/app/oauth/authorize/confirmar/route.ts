import { mcpUsuarioPermitido } from "@/lib/env";
import { buscarCliente, crearCodigo } from "@/lib/oauth/almacen";
import { verificarConsentimiento } from "@/lib/oauth/consentimiento";
import {
  comoTexto,
  leerCuerpo,
  origenPublico,
  redirectUriPermitida,
} from "@/lib/oauth/protocolo";
import { getUser } from "@/lib/supabase/server";

/**
 * El POST del botón "Autorizar" (y del de "Cancelar").
 *
 * Es un route handler y no una Server Action porque el final del flujo
 * tiene que ser un **redirect HTTP de verdad** al `redirect_uri` del
 * cliente, y porque así el consentimiento anda con un formulario común,
 * sin depender de que corra JavaScript.
 *
 * ⚠ **Vuelve a validar todo.** No alcanza con que la página que armó el
 * formulario haya validado: entre aquel render y este POST no hay nada
 * que ate una cosa con la otra salvo lo que viaja en el formulario, y eso
 * lo controla el browser. La firma (`consentimiento.ts`) es lo que hace
 * que los campos no se puedan tocar; el resto de los chequeos están
 * repetidos porque el costo es una consulta y el precio de equivocarse es
 * un código de autorización emitido para otro.
 */

export const dynamic = "force-dynamic";

/** Un error que no se puede contar por redirect, porque no hay a dónde. */
function pantalla(titulo: string, detalle: string, status: number): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${titulo}</title>` +
      `<body style="font-family:system-ui;max-width:34rem;margin:4rem auto;padding:0 1rem;line-height:1.5">` +
      `<h1 style="font-size:1.25rem">${titulo}</h1><p>${detalle}</p>` +
      `<p>No se emitió ningún permiso. Volvé a empezar la conexión desde Claude.</p>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function POST(request: Request) {
  const cuerpo = await leerCuerpo(request);
  if (!cuerpo) {
    return pantalla("No se pudo leer el formulario", "El cuerpo del pedido no vino en un formato esperado.", 400);
  }

  const client_id = comoTexto(cuerpo.client_id) ?? "";
  const redirect_uri = comoTexto(cuerpo.redirect_uri) ?? "";
  const code_challenge = comoTexto(cuerpo.code_challenge) ?? "";
  const scope = comoTexto(cuerpo.scope) ?? "";
  const state = comoTexto(cuerpo.state) ?? "";
  const resource = comoTexto(cuerpo.resource) ?? "";
  const firma = comoTexto(cuerpo.firma) ?? "";
  const decision = comoTexto(cuerpo.decision) ?? "";

  const usuario = await getUser();
  if (!usuario) {
    return pantalla(
      "Se cortó la sesión",
      "Mientras estaba abierta la pantalla de permisos se cerró tu sesión de Pepe.",
      401,
    );
  }

  // La firma cubre todos los campos **y** el `user_id`, así que este
  // chequeo también descarta un formulario firmado para otra sesión.
  if (
    !firma ||
    !verificarConsentimiento(
      { client_id, redirect_uri, code_challenge, scope, state, resource, user_id: usuario.id },
      firma,
    )
  ) {
    return pantalla(
      "Este permiso no se puede confirmar",
      "El formulario no coincide con lo que se mostró en pantalla, o quedó abierto demasiado tiempo.",
      400,
    );
  }

  const permitido = mcpUsuarioPermitido();
  if (!permitido || usuario.id !== permitido) {
    return pantalla(
      "Esta cuenta no puede conectar Pepe",
      "El conector solo emite permisos para la cuenta de Beno.",
      403,
    );
  }

  const cliente = await buscarCliente(client_id);
  if (!cliente || !redirectUriPermitida(cliente.redirect_uris, redirect_uri)) {
    return pantalla(
      "El conector dejó de ser válido",
      "Se borró el registro del cliente, o su dirección de vuelta cambió, entre que se mostró la pantalla y ahora.",
      400,
    );
  }

  const origen = origenPublico(
    request.headers,
    request.url,
  );
  const destino = new URL(redirect_uri);
  if (state) destino.searchParams.set("state", state);
  // RFC 9207: quién contesta. Se anuncia en el metadata del servidor.
  destino.searchParams.set("iss", origen);

  if (decision !== "autorizar") {
    // "Cancelar" es una respuesta legítima del flujo, no un error de la
    // app: el cliente tiene que enterarse para dejar de esperar.
    destino.searchParams.set("error", "access_denied");
    destino.searchParams.set("error_description", "El permiso se rechazó desde Pepe.");
    return Response.redirect(destino.toString(), 303);
  }

  const codigo = await crearCodigo({
    client_id,
    user_id: usuario.id,
    redirect_uri,
    code_challenge,
    scope,
  });

  destino.searchParams.set("code", codigo);

  // 303 y no 302: el pedido que viene es un POST y lo que sigue tiene que
  // ser un GET. Con 302 hay clientes que reenvían el POST al cliente.
  return Response.redirect(destino.toString(), 303);
}
