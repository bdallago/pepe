import { metadataDelRecurso } from "@/lib/oauth/descubrimiento";
import { CABECERAS_CORS, opcionesOauth } from "@/lib/oauth/protocolo";

/**
 * RFC 9728 — `/.well-known/oauth-protected-resource/api/mcp`.
 *
 * La variante **con el path del recurso pegado atrás**, que es la que
 * Claude prueba primero cuando tiene que adivinar. El path del archivo no
 * es casual: replica `/api/mcp`, la ruta del servidor MCP. Si el MCP se
 * mudara, esta carpeta se muda con él.
 *
 * Devuelve exactamente el mismo documento que la variante sin path: ver
 * el comentario largo en `../route.ts`.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const metadata = metadataDelRecurso(request.headers, request.url);

  return new Response(JSON.stringify(metadata), {
    headers: {
      ...CABECERAS_CORS,
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=600",
    },
  });
}

export const OPTIONS = opcionesOauth;
