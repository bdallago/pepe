import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { PresupuestosLista } from "@/components/presupuestos/presupuestos-lista";
import { TablaConversion } from "@/components/presupuestos/tabla-conversion";
import { Button } from "@/components/ui/button";
import { calcularConversion } from "@/lib/presupuestos/conversion";
import {
  getAjustesPresupuesto,
  getPresupuestos,
  getPresupuestosParaConversion,
} from "@/lib/presupuestos-server";

export const metadata: Metadata = { title: "Presupuestos" };

export default async function PresupuestosPage() {
  const [presupuestos, ajustes, paraConversion] = await Promise.all([
    getPresupuestos(),
    getAjustesPresupuesto(),
    getPresupuestosParaConversion(),
  ]);

  const conversion = calcularConversion(paraConversion);

  const sinTarifa = !ajustes.tarifa_hora || ajustes.tarifa_hora <= 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Presupuestos</h1>
          <p className="text-muted-foreground text-sm">
            Lo que cotizaste, en qué quedó y por qué.
          </p>
        </div>

        <Button asChild disabled={sinTarifa}>
          <Link href="/presupuestos/nuevo">
            <Plus className="size-4" />
            Nuevo presupuesto
          </Link>
        </Button>
      </div>

      {/*
        Sin tarifa cargada no se inventa un default: la app la pide. Cotizar
        con un número que uno no puso es peor que no poder cotizar.
      */}
      {sinTarifa ? (
        <p className="rounded-md border border-[var(--mango)] p-4 text-sm">
          Todavía no cargaste tu tarifa hora, y sin ella un presupuesto no tiene
          precio.{" "}
          <Link href="/ajustes" className="underline">
            Cargala en Ajustes → Tarifa
          </Link>
          .
        </p>
      ) : null}

      <PresupuestosLista presupuestos={presupuestos} />

      {/*
        Va debajo de la lista y no arriba: lo primero que uno viene a
        buscar acá es un presupuesto concreto, no la estadística.
      */}
      <TablaConversion conversion={conversion} />
    </div>
  );
}
