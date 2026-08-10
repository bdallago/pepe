import { NextResponse, type NextRequest } from "next/server";

import {
  VERSION_RESPALDO,
  firmarAdjuntos,
  firmarComprobantes,
  listarAdjuntos,
  listarComprobantes,
} from "@/lib/respaldo";
import { createAdminClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/dates";

/**
 * Los comprobantes del respaldo automático, con URL firmada para bajarlos.
 *
 * `/api/cron/respaldo` devuelve el **inventario** (qué archivo pertenece a
 * qué movimiento); esta ruta devuelve lo mismo más una URL por archivo,
 * para que el workflow de `bdallago/pepe-respaldos` los baje y los guarde
 * al lado del JSON. Son dos rutas y no una porque **las URLs firmadas no
 * pueden terminar en el repo**: `respaldo.json` se commitea, y una
 * credencial en el historial de git queda publicada para siempre. Lo que
 * se guarda no lleva firmas; lo que lleva firmas no se guarda.
 *
 * Misma autenticación que el resto de los crons (`CRON_SECRET`) y misma
 * service role key, porque corre sin sesión: el bucket es privado y las
 * políticas de Storage cuelgan de `auth.uid()`.
 *
 * Tampoco está en `vercel.json`: la agenda vive del otro lado, igual que
 * el respaldo de tablas.
 */

export const dynamic = "force-dynamic";
// Bajar los archivos lo hace el workflow; acá solo se listan y se firman.
export const maxDuration = 60;

/**
 * Una hora. Alcanza de sobra para que el workflow baje todo y no deja una
 * credencial viva más tiempo del necesario.
 */
const VIGENCIA_FIRMA = 60 * 60;

function autorizado(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!autorizado(request)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const admin = createAdminClient();

  try {
    const inventario = await listarComprobantes(admin);
    const archivos = await firmarComprobantes(admin, inventario, VIGENCIA_FIRMA);

    // Los adjuntos de la caja viven en otro bucket y viajan como clave
    // aparte. Aparte y no mezclados con `archivos` por dos razones: un
    // archivo suelto sin saber de qué bucket salió no se puede restaurar,
    // y —la que decide— el workflow que hay hoy itera `archivos` y no
    // sabe nada de esto. Mezclarlos le cambiaría el significado a una
    // clave que ya usa; agregar una nueva no le rompe nada.
    //
    // ⚠ Hasta que el workflow de `bdallago/pepe-respaldos` recorra
    // también `adjuntos`, **estos bytes no se están guardando en ningún
    // lado**. Del lado de la app está todo listo.
    const inventarioAdjuntos = await listarAdjuntos(admin);
    const adjuntos = await firmarAdjuntos(
      admin,
      inventarioAdjuntos,
      VIGENCIA_FIRMA,
    );

    return new NextResponse(
      JSON.stringify(
        {
          __pepe: "pepe:comprobantes",
          version: VERSION_RESPALDO,
          generado_en: new Date().toISOString(),
          fecha: todayISO(),
          total: inventario.total,
          bytes: inventario.bytes,
          huerfanos: inventario.huerfanos,
          vigencia_segundos: VIGENCIA_FIRMA,
          archivos,
          faltantes: inventario.faltantes,
          adjuntos: {
            total: inventarioAdjuntos.total,
            bytes: inventarioAdjuntos.bytes,
            huerfanos: inventarioAdjuntos.huerfanos,
            archivos: adjuntos,
            faltantes: inventarioAdjuntos.faltantes,
          },
        },
        null,
        2,
      ),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
          // Nunca cachear: las URLs firmadas vencen y el inventario cambia.
          "cache-control": "no-store",
        },
      },
    );
  } catch (error: unknown) {
    // Igual que el respaldo de tablas: 500 y nada más. El workflow no
    // borra ni pisa nada si el pedido no vino 200.
    console.error("[cron/comprobantes] falló:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo listar los comprobantes.",
      },
      { status: 500 },
    );
  }
}
