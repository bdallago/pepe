import { metadataDelRecurso } from "@/lib/oauth/descubrimiento";
import { CABECERAS_CORS, opcionesOauth } from "@/lib/oauth/protocolo";

/**
 * RFC 9728 — `/.well-known/oauth-protected-resource`, la variante sin path.
 *
 * ## Por qué hay dos rutas que devuelven lo mismo
 *
 * La forma canónica de arrancar el flujo es el **401 con
 * `WWW-Authenticate: Bearer resource_metadata="…"`**, que le dice a
 * Claude exactamente dónde mirar. Pero si ese header no llegara, Claude
 * adivina: prueba primero
 * `/.well-known/oauth-protected-resource/<path del MCP>` y después
 * `/.well-known/oauth-protected-resource` a secas. Servir las dos cuesta
 * un archivo de diez líneas y saca del medio una clase entera de fallas
 * en las que el conector "no encuentra el login" y no hay nada que
 * mirar.
 *
 * Las dos anuncian el **mismo** `resource`
 * (`https://…/api/mcp`), porque hay un solo recurso protegido: el
 * servidor MCP. Que esta ruta no tenga el path en la URL no significa
 * que describa el dominio entero.
 */

// El documento se arma con el origen público del request (el header
// `Host` / `X-Forwarded-Host`), así que no se puede prerenderizar: si se
// congelara en build, un preview de Vercel serviría el dominio de otro.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const metadata = metadataDelRecurso(request.headers, request.url);

  return new Response(JSON.stringify(metadata), {
    headers: {
      ...CABECERAS_CORS,
      "Content-Type": "application/json",
      // Corto a propósito: es metadata que se corrige de a poco y un
      // error cacheado un día se ve como un conector roto sin causa.
      "Cache-Control": "public, max-age=600",
    },
  });
}

/** Preflight: hay clientes MCP que corren dentro de una página web. */
export const OPTIONS = opcionesOauth;
