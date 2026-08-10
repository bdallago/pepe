import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";

import { AccionesPresupuesto } from "@/components/presupuestos/acciones-presupuesto";
import { aFormulario, aImprimible } from "@/components/presupuestos/desde-fila";
import { PresupuestoDocumento } from "@/components/presupuestos/presupuesto-documento";
import { PresupuestoForm } from "@/components/presupuestos/presupuesto-form";
import { ETIQUETA_MOTIVO } from "@/components/presupuestos/presupuestos-lista";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import {
  calcularPresupuesto,
  sumarHoras,
} from "@/lib/presupuestos";
import {
  getAjustesPresupuesto,
  getPresupuesto,
} from "@/lib/presupuestos-server";

export const metadata: Metadata = { title: "Presupuesto" };

export default async function PresupuestoPage({
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

  const { quote, items } = completo;

  // ⚠ Regla 1: los valores congelados salen de la fila, nunca de
  // `settings`. Un presupuesto de marzo tiene que decir lo que decía en
  // marzo, aunque hoy la tarifa sea otra.
  //
  // La moneda de la tarifa no se guarda en `quotes` porque se deduce: si
  // hay tasa congelada hubo conversión, así que la tarifa estaba en la
  // otra moneda; si no la hay, estaba en la misma.
  const tarifaMoneda =
    quote.tasa_usada === null
      ? quote.moneda
      : quote.moneda === "ARS"
        ? "USD"
        : "ARS";

  const tasa =
    quote.tasa_usada === null || quote.tasa_fecha === null
      ? null
      : {
          valor: Number(quote.tasa_usada),
          fecha: quote.tasa_fecha,
          esAproximada: false,
        };

  const congelado = {
    tarifa_hora: Number(quote.tarifa_hora),
    tarifa_moneda: tarifaMoneda,
    horas_por_semana: Number(quote.horas_por_semana),
    multiplicador: Number(quote.multiplicador),
  };

  // Solo para saber si el total guardado lo puso Beno a mano; no pisa nada.
  const calculado = calcularPresupuesto({
    horas: sumarHoras(items.map((item) => ({ horas: Number(item.horas) }))),
    tarifa_hora: congelado.tarifa_hora,
    tarifa_moneda: congelado.tarifa_moneda,
    cliente_tipo: quote.cliente_tipo,
    moneda: quote.moneda,
    multiplicadores: {
      particular: congelado.multiplicador,
      pyme: congelado.multiplicador,
      empresa: congelado.multiplicador,
    },
    horas_por_semana: congelado.horas_por_semana,
    tasa,
  });

  const resuelto =
    quote.estado === "aceptado" || quote.estado === "descartado";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-sm">
            <Link href="/presupuestos" className="hover:underline">
              Presupuestos
            </Link>{" "}
            / <span className="cifra">Nº {quote.numero}</span>
          </p>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            {quote.titulo}
            <Badge variant="secondary" className="h-5 text-[10px] font-normal">
              {quote.estado}
            </Badge>
          </h1>
          <p className="text-muted-foreground text-sm">
            {quote.cliente_nombre} ·{" "}
            <span className="cifra">{formatDate(quote.fecha)}</span>
            {quote.enviado_en ? (
              <>
                {" "}
                · enviado el{" "}
                <span className="cifra">{formatDate(quote.enviado_en)}</span>
              </>
            ) : null}
            {quote.resuelto_en ? (
              <>
                {" "}
                · resuelto el{" "}
                <span className="cifra">{formatDate(quote.resuelto_en)}</span>
              </>
            ) : null}
          </p>
        </div>

        <Button variant="outline" asChild>
          <Link href={`/presupuestos/${quote.id}/pdf`}>
            <FileText className="size-4" />
            Ver documento
          </Link>
        </Button>
      </div>

      <AccionesPresupuesto
        presupuestoId={quote.id}
        estado={quote.estado}
        titulo={quote.titulo}
        clienteNombre={quote.cliente_nombre}
        projectId={quote.project_id}
      />

      {quote.motivo_descarte ? (
        <div className="rounded-md border p-4 text-sm">
          <p className="rotulo text-muted-foreground">Por qué se cayó</p>
          <p className="mt-1 font-medium">
            {ETIQUETA_MOTIVO[quote.motivo_descarte]}
          </p>
          {quote.motivo_detalle ? (
            <p className="text-muted-foreground mt-1 whitespace-pre-line">
              {quote.motivo_detalle}
            </p>
          ) : null}
        </div>
      ) : null}

      {resuelto ? (
        <>
          <p className="text-muted-foreground text-sm">
            Este presupuesto ya está resuelto y no se edita. Si el número
            cambió, hacé uno nuevo: editar un documento que el cliente ya tiene
            en la mano es mentirle al histórico.
          </p>
          <PresupuestoDocumento
            presupuesto={aImprimible(completo, ajustes)}
          />
        </>
      ) : (
        <PresupuestoForm
          modo="editar"
          presupuestoId={quote.id}
          base={{
            ...congelado,
            multiplicadores: ajustes.multiplicadores,
            tasa,
          }}
          inicial={aFormulario(completo, calculado.total_origen)}
        />
      )}
    </div>
  );
}
