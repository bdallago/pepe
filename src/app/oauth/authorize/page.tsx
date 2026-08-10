import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AlertTriangle, Plug, ShieldCheck } from "lucide-react";

import { CambiarDeCuenta } from "@/app/oauth/authorize/cambiar-de-cuenta";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { mcpUsuarioPermitido } from "@/lib/env";
import { buscarCliente } from "@/lib/oauth/almacen";
import { firmarConsentimiento } from "@/lib/oauth/consentimiento";
import { urlDelRecurso } from "@/lib/oauth/descubrimiento";
import {
  alcancesOtorgados,
  normalizarRecurso,
  origenPublico,
  redirectUriPermitida,
  RUTA_AUTORIZAR,
  RUTA_CONFIRMAR,
  unico,
} from "@/lib/oauth/protocolo";
import { getUser } from "@/lib/supabase/server";

/**
 * RFC 6749 §4.1.1 — el `/authorize`.
 *
 * ## Por qué es una página y no un route handler
 *
 * Porque tiene que sobrevivir a un viaje a Google y volver con los
 * parámetros de OAuth intactos.
 *
 * El login de Pepe es client-side (`signInWithOAuth`, ver
 * `components/auth/login-button.tsx`): manda el browser a Google y vuelve
 * a `/auth/callback?next=…`. Un route handler que quisiera "loguear al
 * usuario" no tiene forma de hacer eso — no puede correr JavaScript en el
 * browser— y tampoco tiene dónde mostrar el consentimiento, que el spec
 * de conectores pide y que acá no es negociable: es la única pantalla en
 * la que Beno ve qué está por darle a Claude.
 *
 * Siendo página, el viaje entero es una cadena de redirects que ya
 * funcionaba para todo lo demás de la app:
 *
 * 1. Claude manda el browser a `/oauth/authorize?client_id=…`.
 * 2. Si no hay sesión, se va a `/login?next=<esta URL completa>`.
 *    ⚠ **Completa, con query.** El middleware guardaba solo el pathname,
 *    así que volvía a `/oauth/authorize` pelado y los parámetros de OAuth
 *    se perdían en el camino: el flujo moría con "falta client_id" y la
 *    causa quedaba tres redirects atrás. Se arregló en `middleware.ts`,
 *    y esta página igual arma el `next` por su cuenta.
 * 3. `/login` → Google → `/auth/callback` → `next`, que es esta misma
 *    URL con todo adentro.
 * 4. Con sesión, se renderiza el consentimiento.
 *
 * El botón hace un POST **de formulario común** a
 * `/oauth/authorize/confirmar`, que contesta un 303 al `redirect_uri`.
 * No es una Server Action a propósito: el final del flujo tiene que ser
 * un redirect HTTP de verdad, y de paso el consentimiento anda aunque no
 * corra JavaScript.
 */

export const metadata: Metadata = { title: "Autorizar conector" };
export const dynamic = "force-dynamic";

type Parametros = Record<string, string | string[] | undefined>;

/** Un error que no se le puede contar al cliente, así que se muestra acá. */
function PantallaDeError({
  titulo,
  detalle,
}: {
  titulo: string;
  detalle: string;
}) {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <AlertTriangle className="size-5" />
          </div>
          <CardTitle>{titulo}</CardTitle>
          <CardDescription>{detalle}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No se emitió ningún permiso. Podés cerrar esta pestaña y volver a
          intentar la conexión desde Claude.
        </CardContent>
      </Card>
    </main>
  );
}

/** Arma el redirect de error que manda RFC 6749 §4.1.2.1. */
function urlDeError(
  redirect_uri: string,
  error: string,
  descripcion: string,
  state: string,
  iss: string,
): string {
  const url = new URL(redirect_uri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", descripcion);
  if (state) url.searchParams.set("state", state);
  url.searchParams.set("iss", iss);
  return url.toString();
}

export default async function AutorizarPage({
  searchParams,
}: {
  searchParams: Promise<Parametros>;
}) {
  const params = await searchParams;
  const cabeceras = await headers();
  const host = cabeceras.get("host") ?? "localhost";
  const origen = origenPublico(cabeceras, `http://${host}`);

  const client_id = unico(params.client_id) ?? "";
  const redirect_uri = unico(params.redirect_uri) ?? "";
  const response_type = unico(params.response_type) ?? "";
  const code_challenge = unico(params.code_challenge) ?? "";
  const code_challenge_method = unico(params.code_challenge_method) ?? "";
  const state = unico(params.state) ?? "";
  const resource = unico(params.resource) ?? "";

  // ------------------------------------------------------------
  // Errores que NO se pueden redirigir.
  //
  // RFC 6749 §4.1.2.1 es tajante: si el `client_id` o la `redirect_uri`
  // no son de fiar, **no** hay que redirigir a ningún lado —sería mandar
  // el error, y en otro flujo el código, a una dirección elegida por
  // quien armó el link—. Se muestran en pantalla y se termina acá.
  // ------------------------------------------------------------
  if (!client_id) {
    return (
      <PantallaDeError
        titulo="Falta el client_id"
        detalle="Este link no tiene los datos que hacen falta para autorizar un conector."
      />
    );
  }

  const cliente = await buscarCliente(client_id);
  if (!cliente) {
    return (
      <PantallaDeError
        titulo="Ese conector no está registrado"
        detalle="El client_id del link no existe. Si la conexión es vieja, borrala en Claude y volvé a agregar el conector para que se registre de nuevo."
      />
    );
  }

  if (!redirect_uri) {
    return (
      <PantallaDeError
        titulo="Falta la redirect_uri"
        detalle="Sin saber a dónde volver, no hay forma segura de contestar."
      />
    );
  }

  if (!redirectUriPermitida(cliente.redirect_uris, redirect_uri)) {
    return (
      <PantallaDeError
        titulo="Esa dirección de vuelta no está registrada"
        detalle={`El conector pidió volver a ${redirect_uri}, que no es ninguna de las que registró. No se contesta a una dirección que no se declaró de antemano.`}
      />
    );
  }

  // ------------------------------------------------------------
  // De acá en adelante, los errores sí vuelven al cliente.
  // ------------------------------------------------------------
  if (response_type !== "code") {
    redirect(
      urlDeError(
        redirect_uri,
        "unsupported_response_type",
        "Solo se soporta response_type=code.",
        state,
        origen,
      ),
    );
  }

  // PKCE no es opcional: el cliente es público, no tiene secreto, y sin
  // PKCE cualquiera que vea el código en la barra de direcciones se lleva
  // el token.
  if (!code_challenge || code_challenge_method !== "S256") {
    redirect(
      urlDeError(
        redirect_uri,
        "invalid_request",
        "Hace falta code_challenge con code_challenge_method=S256.",
        state,
        origen,
      ),
    );
  }

  // RFC 8707: si pide un recurso, tiene que ser este servidor MCP.
  if (
    resource &&
    normalizarRecurso(resource) !==
      normalizarRecurso(urlDelRecurso(cabeceras, `http://${host}`))
  ) {
    redirect(
      urlDeError(
        redirect_uri,
        "invalid_target",
        "El resource pedido no es este servidor MCP.",
        state,
        origen,
      ),
    );
  }

  // ------------------------------------------------------------
  // La identidad
  // ------------------------------------------------------------
  const usuario = await getUser();

  if (!usuario) {
    // El `next` lleva la URL entera, query incluida: si se perdiera la
    // query, se volvería de Google a un `/authorize` sin parámetros.
    const volver = new URLSearchParams();
    for (const [clave, valor] of Object.entries(params)) {
      const v = unico(valor);
      if (v !== undefined) volver.set(clave, v);
    }
    redirect(`/login?next=${encodeURIComponent(`${RUTA_AUTORIZAR}?${volver}`)}`);
  }

  const permitido = mcpUsuarioPermitido();

  if (!permitido) {
    return (
      <PantallaDeError
        titulo="El conector no está configurado"
        detalle="Falta MCP_USUARIO_PERMITIDO en el entorno. Sin esa variable no se sabe quién tiene permiso, así que no se autoriza a nadie."
      />
    );
  }

  // ⚠ **La línea que hace que esto sea "yo y solo yo".** El login de
  // Google es válido para cualquier cuenta de Google del mundo; lo que
  // convierte una identidad válida en un permiso es esta comparación.
  // Cualquier otra persona que llegue hasta acá con su sesión se va con
  // `access_denied` y sin token.
  if (usuario.id !== permitido) {
    // El rechazo se ve en pantalla como "esta cuenta no puede conectar",
    // que manda a mirar la cuenta de Google. Pero la causa más probable
    // **no** es la cuenta: es que la variable esté mal cargada. Ya pasó
    // una vez, con un salto de línea que le pegó un pipe de PowerShell.
    // Sin este log, diagnosticarlo es adivinar.
    console.error(
      "[oauth] cuenta rechazada. " +
        `sesión=${usuario.id} (${usuario.id.length} chars) · ` +
        `permitido=${permitido} (${permitido.length} chars) · ` +
        `iguales_al_recortar=${usuario.id.trim() === permitido.trim()}`,
    );

    const destino = urlDeError(
      redirect_uri,
      "access_denied",
      "Esta cuenta no tiene permiso para usar el conector de Pepe.",
      state,
      origen,
    );

    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        {/* El cliente tiene que enterarse del `access_denied` —si no, se
            queda esperando para siempre— pero antes hay que decirle a la
            persona qué pasó, que en un redirect pelado se pierde. El meta
            refresh compra los dos: la pantalla se lee y el flujo termina
            como manda OAuth. */}
        <meta httpEquiv="refresh" content={`8;url=${destino}`} />
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <ShieldCheck className="size-5" />
            </div>
            <CardTitle>Esta cuenta no puede conectar Pepe</CardTitle>
            <CardDescription>
              Entraste como <strong>{usuario.email}</strong>. Pepe es de una
              sola persona y el conector solo emite permisos para esa cuenta.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              No se emitió ningún permiso. En unos segundos volvés a Claude con
              el error, o podés{" "}
              <a href={destino} className="text-primary underline">
                volver ahora
              </a>
              .
            </p>
            <CambiarDeCuenta />
          </CardContent>
        </Card>
      </main>
    );
  }

  // ------------------------------------------------------------
  // Consentimiento
  // ------------------------------------------------------------
  const scope = alcancesOtorgados(unico(params.scope));
  const firma = firmarConsentimiento({
    client_id,
    redirect_uri,
    code_challenge,
    scope,
    state,
    resource,
    user_id: usuario.id,
  });

  const nombre = cliente.client_name ?? "Un cliente MCP sin nombre";
  const destinoCorto = new URL(redirect_uri).host;

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Plug className="size-5" />
          </div>
          <CardTitle>Conectar {nombre} a Pepe</CardTitle>
          <CardDescription>
            Entraste como {usuario.email}. Esto es lo que estás por darle.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <ul className="space-y-2 text-sm">
            <li className="flex gap-2">
              <span aria-hidden className="text-muted-foreground">
                •
              </span>
              <span>
                Leer y operar tu <strong>servidor MCP</strong> de Pepe: la
                plata, el aprendizaje y la bitácora de todos tus proyectos.
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden className="text-muted-foreground">
                •
              </span>
              <span>
                Seguir conectado sin volver a pedirte permiso, hasta que
                desconectes el conector.
              </span>
            </li>
          </ul>

          <dl className="space-y-1 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            <div className="flex justify-between gap-3">
              <dt>Vuelve a</dt>
              <dd className="cifra text-right break-all">{destinoCorto}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Permisos</dt>
              <dd className="cifra text-right">{scope}</dd>
            </div>
          </dl>

          <p className="text-xs text-muted-foreground">
            Nada de lo que proponga el modelo se guarda solo: sigue entrando
            por la bandeja, como siempre.
          </p>

          <form
            method="post"
            action={RUTA_CONFIRMAR}
            className="flex flex-col gap-2"
          >
            <input type="hidden" name="client_id" value={client_id} />
            <input type="hidden" name="redirect_uri" value={redirect_uri} />
            <input type="hidden" name="code_challenge" value={code_challenge} />
            <input type="hidden" name="scope" value={scope} />
            <input type="hidden" name="state" value={state} />
            <input type="hidden" name="resource" value={resource} />
            <input type="hidden" name="firma" value={firma} />

            <Button type="submit" name="decision" value="autorizar" size="lg">
              Autorizar
            </Button>
            <Button
              type="submit"
              name="decision"
              value="rechazar"
              size="lg"
              variant="ghost"
            >
              Cancelar
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
