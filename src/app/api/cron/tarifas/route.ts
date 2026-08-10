import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/server";
import { actualizarTarifas } from "@/lib/tarifas";

/**
 * Cron semanal de tarifas de referencia (spec de presupuestos, etapa 1).
 *
 * Corre los lunes a las 13:00 UTC = 10:00 de Argentina (ver vercel.json).
 * Arranque de semana: si falla, Beno tiene la semana entera para verlo
 * antes de que importe.
 *
 * **Semanal y no diario** porque las fuentes se mueven en meses, no en
 * días: flamahaus tiene `modified_gmt` de junio y las respuestas del CSV
 * de salancy son todas de enero. Un cron diario haría siete veces los
 * mismos pedidos para traer lo mismo.
 *
 * Se autentica con `CRON_SECRET`, igual que los otros dos crons; el
 * middleware excluye `/api/cron` de la protección por cookie. Usa la
 * service role porque `rate_runs` y `rate_references` solo permiten
 * lectura vía RLS: escribirlas es del cron y de nadie más.
 *
 * **Devuelve 500 si alguna fuente terminó en `error`**, para que la
 * corrida figure como fallida en el panel de Vercel y no solo en una
 * tabla que nadie mira. Una corrida `sospechosa` no es un error: no
 * escribió nada y queda esperando que Beno la acepte o la descarte.
 */

export const dynamic = "force-dynamic";
// Dos descargas (320 KB de HTML y 190 KB de CSV) más un par de consultas.
// Sobra, pero la red de terceros a veces se hace la difícil.
export const maxDuration = 120;

function autorizado(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!autorizado(request)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  try {
    const reporte = await actualizarTarifas(createAdminClient());
    const huboError = reporte.fuentes.some((f) => f.estado === "error");

    return NextResponse.json(reporte, { status: huboError ? 500 : 200 });
  } catch (error) {
    // Acá solo caen fallas que no son de una fuente (la base, el entorno).
    // Las de fuente ya quedaron registradas en `rate_runs`.
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Error desconocido.",
      },
      { status: 500 },
    );
  }
}
