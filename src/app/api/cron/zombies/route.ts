import { NextResponse, type NextRequest } from "next/server";

import { escanearZombies, type ReporteZombies } from "@/lib/zombies";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Escaneo diario de suscripciones zombie (spec 6.2 y 7).
 *
 * Es el **único** job nuevo que pide el spec, y no hay que agregar otros:
 * Beno no quiere proactividad, todo lo demás lo dispara él.
 *
 * Se autentica con `CRON_SECRET`, igual que el cron del dólar; el
 * middleware excluye `/api/cron` de la protección por cookie. Usa la
 * service role key porque corre sin usuario.
 *
 * **Idempotente**, como pide el spec: la detección es una consulta sobre
 * todo el histórico, no un delta contra la última corrida, así que si el
 * job no corrió unos días no hay período que recuperar — la corrida de
 * hoy ve lo mismo que habría visto ayer. `clave_dedupe` evita duplicar
 * la propuesta.
 *
 * Y de paso escribe y lee la base en cada corrida, que es el keep-alive
 * contra el pause por inactividad del tier gratuito de Supabase.
 */

export const dynamic = "force-dynamic";
// Una llamada corta al modelo por candidato, con el limitador de por
// medio. Con pocos candidatos sobra, y si hay muchos se corta solo.
export const maxDuration = 300;

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

  // La app es de un solo usuario, pero el cron no tiene por qué saberlo:
  // escanea a todos los que tengan movimientos cargados.
  const { data: filas, error } = await admin
    .from("movements")
    .select("user_id")
    .limit(20000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const usuarios = [...new Set((filas ?? []).map((f) => f.user_id))];

  const resultado = {
    usuarios: usuarios.length,
    detectados: 0,
    propuestos: 0,
    omitidos: 0,
    sinModelo: 0,
    errores: [] as string[],
  };

  for (const userId of usuarios) {
    try {
      const r: ReporteZombies = await escanearZombies(admin, userId);
      resultado.detectados += r.detectados;
      resultado.propuestos += r.propuestos;
      resultado.omitidos += r.omitidos;
      resultado.sinModelo += r.sinModelo;
    } catch (e: unknown) {
      // Un usuario que falla no puede tumbar el escaneo de los demás.
      resultado.errores.push(
        `${userId}: ${e instanceof Error ? e.message : "error desconocido"}`,
      );
    }
  }

  return NextResponse.json(resultado, {
    status: resultado.errores.length === usuarios.length && usuarios.length > 0 ? 500 : 200,
  });
}
