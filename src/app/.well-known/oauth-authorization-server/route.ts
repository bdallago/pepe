import { metadataDelServidor } from "@/lib/oauth/descubrimiento";
import { CABECERAS_CORS, opcionesOauth } from "@/lib/oauth/protocolo";

/**
 * RFC 8414 — metadata del authorization server.
 *
 * Es el documento al que lleva el `authorization_servers` del recurso, y
 * el que le dice a Claude las tres direcciones que necesita: dónde mandar
 * a Beno a autorizar, dónde canjear el código y dónde registrarse.
 *
 * Pepe es su propio authorization server porque Supabase Auth no puede
 * serlo: no expone `registration_endpoint` ni emite tokens para un
 * tercero. Supabase queda del lado de la **identidad** (el login de
 * Google, que ya existía) y Pepe emite sus propios tokens contra esa
 * identidad. Ver el encabezado de la migración `20260810003000`.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const metadata = metadataDelServidor(request.headers, request.url);

  return new Response(JSON.stringify(metadata), {
    headers: {
      ...CABECERAS_CORS,
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=600",
    },
  });
}

export const OPTIONS = opcionesOauth;
