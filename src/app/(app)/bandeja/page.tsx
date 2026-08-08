import type { Metadata } from "next";

import { BandejaView, type ItemBandeja } from "@/components/bandeja/bandeja-view";
import { hayModeloConfigurado } from "@/lib/llm";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Bandeja" };

/**
 * La cola de todo lo que un modelo propuso y espera confirmación.
 *
 * Se muestran los pendientes, los pospuestos que ya vencieron y los que
 * quedaron en `error` porque la salida del modelo no validó. Lo resuelto
 * no vuelve a aparecer.
 */
async function getItems(): Promise<ItemBandeja[]> {
  const supabase = await createClient();
  const ahora = new Date().toISOString();

  const { data: filas } = await supabase
    .from("inbox")
    .select(
      "id, tipo, estado, payload, entidad_tabla, entidad_id, error_detalle, creado_en",
    )
    .or(
      `estado.eq.pendiente,estado.eq.error,and(estado.eq.pospuesto,posponer_hasta.lte.${ahora})`,
    )
    .order("creado_en", { ascending: true })
    .limit(200);

  if (!filas || filas.length === 0) return [];

  // La entrada de bitácora de la que salió cada propuesta: el spec pide
  // verla al lado de la lección para poder juzgarla sin adivinar.
  const idsBitacora = filas
    .filter((f) => f.entidad_tabla === "daily_log" && f.entidad_id)
    .map((f) => f.entidad_id!);

  const entradas = new Map<string, { fecha: string; contenido: string }>();

  if (idsBitacora.length > 0) {
    const { data } = await supabase
      .from("daily_log")
      .select("id, fecha, contenido")
      .in("id", idsBitacora);

    for (const e of data ?? []) {
      entradas.set(e.id, { fecha: e.fecha, contenido: e.contenido });
    }
  }

  return filas.map((f) => ({
    id: f.id,
    tipo: f.tipo,
    estado: f.estado,
    payload: f.payload,
    errorDetalle: f.error_detalle,
    entrada:
      f.entidad_tabla === "daily_log" && f.entidad_id
        ? (entradas.get(f.entidad_id) ?? null)
        : null,
  }));
}

export default async function BandejaPage() {
  const items = await getItems();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bandeja</h1>
        <p className="text-muted-foreground text-sm">
          Todo lo que propone el modelo pasa por acá. Nada se guarda hasta que
          lo aceptes.
        </p>
      </div>

      <BandejaView items={items} hayModelo={hayModeloConfigurado()} />
    </div>
  );
}
