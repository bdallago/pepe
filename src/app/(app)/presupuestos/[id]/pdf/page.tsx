import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { aImprimible } from "@/components/presupuestos/desde-fila";
import { PresupuestoVistaPrevia } from "@/components/presupuestos/presupuesto-vista-previa";
import { Button } from "@/components/ui/button";
import {
  getAjustesPresupuesto,
  getPresupuesto,
} from "@/lib/presupuestos-server";

/**
 * El documento que se manda al cliente.
 *
 * **El PDF es esta misma pantalla**: Ctrl+P → "Guardar como PDF", con la
 * hoja de impresión que vive al final de `globals.css`. No hay ninguna
 * dependencia de PDF en el proyecto y no la hay a propósito — con una
 * librería serían dos layouts que se van separando en silencio, y el que
 * se rompe es el que nadie mira: el que se manda al cliente.
 *
 * Todo lo que no es el documento lleva `no-imprimir`.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const completo = await getPresupuesto(id);

  if (!completo) return { title: "Presupuesto" };

  // El navegador saca de acá el nombre del archivo sugerido al guardar.
  return {
    title: `Presupuesto ${completo.quote.numero} – ${completo.quote.cliente_nombre}`,
  };
}

export default async function PresupuestoPdfPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [completo, ajustes] = await Promise.all([
    getPresupuesto(id),
    getAjustesPresupuesto(),
  ]);

  if (!completo) notFound();

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" asChild className="no-imprimir">
        <Link href={`/presupuestos/${completo.quote.id}`}>
          <ArrowLeft className="size-4" />
          Volver al presupuesto
        </Link>
      </Button>

      <PresupuestoVistaPrevia
        presupuesto={aImprimible(completo, ajustes)}
      />
    </div>
  );
}
