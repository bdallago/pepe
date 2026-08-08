import { NextResponse } from "next/server";

import { armarRespaldo } from "@/lib/respaldo";
import { createClient, getUser } from "@/lib/supabase/server";

/**
 * Respaldo completo en JSON (spec 8).
 *
 * Route handler y no Server Action porque lo que devuelve es un archivo,
 * no datos para una pantalla: se baja con un `<a download>` y el browser
 * hace el resto.
 *
 * Usa el cliente con la sesión y no el admin: RLS ya acota todo a Beno y
 * un endpoint que exporta la base entera es el último lugar donde
 * conviene saltearla.
 */

export const dynamic = "force-dynamic";
// Son catorce tablas leídas de a mil filas. Hoy tarda menos de un
// segundo; el margen es para cuando haya años de datos.
export const maxDuration = 60;

export async function GET() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Sesión no encontrada." }, { status: 401 });
  }

  const supabase = await createClient();

  try {
    const respaldo = await armarRespaldo(supabase);

    // Indentado a dos espacios: ocupa más, pero un respaldo se abre para
    // mirarlo a mano justo el día que algo salió mal.
    return new NextResponse(JSON.stringify(respaldo, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="pepe-respaldo-${respaldo.fecha}.json"`,
        // Nunca cachear: el respaldo de ayer no sirve.
        "cache-control": "no-store",
      },
    });
  } catch (error: unknown) {
    console.error("[respaldo] falló:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "No se pudo armar el respaldo.",
      },
      { status: 500 },
    );
  }
}
