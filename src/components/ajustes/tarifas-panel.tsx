"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { AvisoTarifaPanel } from "@/components/ajustes/aviso-tarifa";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { guardarTarifas } from "@/lib/actions/settings";
import { ETIQUETA_SEGMENTO, type AvisoTarifa } from "@/lib/avisos-tarifa";
import { formatMoney } from "@/lib/format";
import type { TipoCliente } from "@/lib/presupuestos";
import type { AjustesPresupuesto } from "@/lib/presupuestos-server";
import { tarifasSchema, type TarifasInput } from "@/lib/schemas";
import type { Moneda } from "@/lib/supabase/database.types";

/**
 * La tarifa hora y los tres multiplicadores.
 *
 * Es lo primero que hay que cargar para poder presupuestar: sin tarifa la
 * pantalla de presupuestos no deja crear nada, en vez de inventar un valor
 * por defecto y que Beno cotice con él sin darse cuenta.
 *
 * Los defaults ×1 / ×2 / ×3 salen de la escalera del tarifario de
 * flamahaus (`A = 3×C`, `B = 2×C`, verificada en 93 de 93 filas). El check
 * `particular ≤ pyme ≤ empresa` está en la base y también acá, para que el
 * error de tipeo se vea con un mensaje en castellano y no como un 23514.
 *
 * ⚠ Guardar acá **no toca ningún presupuesto ya hecho**: cada uno se quedó
 * con su copia congelada (regla 1).
 */

const SEGMENTOS: TipoCliente[] = ["particular", "pyme", "empresa"];

const textoONull = {
  setValueAs: (valor: unknown) => {
    const texto = typeof valor === "string" ? valor.trim() : "";
    return texto === "" ? null : texto;
  },
};

const numeroONull = {
  setValueAs: (valor: unknown) => {
    if (valor === "" || valor === null || valor === undefined) return null;
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero : null;
  },
};

export function TarifasPanel({
  ajustes,
  aviso,
}: {
  ajustes: AjustesPresupuesto;
  aviso: AvisoTarifa;
}) {
  const router = useRouter();

  const form = useForm<TarifasInput>({
    resolver: zodResolver(tarifasSchema),
    defaultValues: {
      tarifa_hora: ajustes.tarifa_hora,
      tarifa_moneda: ajustes.tarifa_moneda,
      multiplicador_particular: ajustes.multiplicadores.particular,
      multiplicador_pyme: ajustes.multiplicadores.pyme,
      multiplicador_empresa: ajustes.multiplicadores.empresa,
      horas_por_semana: ajustes.horas_por_semana,
      emisor_nombre: ajustes.emisor_nombre,
      emisor_contacto: ajustes.emisor_contacto,
      condiciones_default: ajustes.condiciones_default,
    },
  });

  const { register, handleSubmit, watch, setValue, formState } = form;

  const tarifa = watch("tarifa_hora");
  const moneda = watch("tarifa_moneda");
  const multiplicadores: Record<TipoCliente, number> = {
    particular: watch("multiplicador_particular"),
    pyme: watch("multiplicador_pyme"),
    empresa: watch("multiplicador_empresa"),
  };

  async function onSubmit(values: TarifasInput) {
    const resultado = await guardarTarifas(values);

    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }

    toast.success("Tarifa guardada. Los presupuestos ya hechos no se tocan.");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tarifa y presupuestos</CardTitle>
        <CardDescription>
          Una tarifa hora y un multiplicador por tipo de cliente. Cada
          presupuesto se queda con una copia congelada de los dos, así que
          cambiarlos acá no le mueve el precio a ninguno de los que ya hiciste.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="tarifa-hora">Tu tarifa hora</Label>
              <Input
                id="tarifa-hora"
                type="number"
                step="0.01"
                min="0"
                placeholder="20000"
                className="cifra"
                {...register("tarifa_hora", numeroONull)}
              />
              {formState.errors.tarifa_hora ? (
                <p className="text-destructive text-xs">
                  {formState.errors.tarifa_hora.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="tarifa-moneda">Moneda</Label>
              <Select
                value={moneda}
                onValueChange={(v) => setValue("tarifa_moneda", v as Moneda)}
              >
                <SelectTrigger id="tarifa-moneda">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ARS">ARS</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Multiplicador por tipo de cliente</Label>
            <div className="grid gap-3 sm:grid-cols-3">
              {SEGMENTOS.map((segmento) => {
                const campo = `multiplicador_${segmento}` as const;
                const factor = multiplicadores[segmento];
                const precio =
                  tarifa && factor > 0 ? tarifa * factor : null;

                return (
                  <div key={segmento} className="space-y-1">
                    <Label
                      htmlFor={`mult-${segmento}`}
                      className="text-muted-foreground text-xs font-normal"
                    >
                      {ETIQUETA_SEGMENTO[segmento]}
                    </Label>
                    <Input
                      id={`mult-${segmento}`}
                      type="number"
                      step="0.1"
                      min="0.1"
                      className="cifra"
                      {...register(campo, { valueAsNumber: true })}
                    />
                    <p className="text-muted-foreground cifra text-xs">
                      {precio === null
                        ? "—"
                        : `${formatMoney(precio, moneda)}/hora`}
                    </p>
                  </div>
                );
              })}
            </div>
            {formState.errors.multiplicador_pyme ? (
              <p className="text-destructive text-xs">
                {formState.errors.multiplicador_pyme.message}
              </p>
            ) : null}
            <p className="text-muted-foreground text-xs">
              ×1 / ×2 / ×3 no es un número redondo elegido a ojo: es la escalera
              del tarifario de referencia, que se cumple en 93 de sus 93 filas.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="horas-semana">Horas por semana</Label>
            <Input
              id="horas-semana"
              type="number"
              step="1"
              min="1"
              max="80"
              className="cifra w-28"
              {...register("horas_por_semana", { valueAsNumber: true })}
            />
            <p className="text-muted-foreground text-xs">
              Es lo que convierte horas en semanas para el plazo del documento.
              El default es 20 y no 40 a propósito: un plazo incumplido en un
              presupuesto cuesta más que uno holgado.
            </p>
            {formState.errors.horas_por_semana ? (
              <p className="text-destructive text-xs">
                {formState.errors.horas_por_semana.message}
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="emisor-nombre">Tu nombre en el documento</Label>
              <Input
                id="emisor-nombre"
                placeholder="Benito Dallago"
                autoComplete="off"
                {...register("emisor_nombre", textoONull)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="emisor-contacto">Tu contacto</Label>
              <Input
                id="emisor-contacto"
                placeholder="mail o teléfono"
                autoComplete="off"
                {...register("emisor_contacto", textoONull)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="condiciones-default">Condiciones por defecto</Label>
            <Textarea
              id="condiciones-default"
              rows={3}
              placeholder="50 % al aceptar, 50 % a la entrega."
              {...register("condiciones_default", textoONull)}
            />
            <p className="text-muted-foreground text-xs">
              Se precargan en cada presupuesto nuevo; después cada uno lleva las
              suyas.
            </p>
          </div>

          <Button type="submit" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-4" aria-hidden="true" />
            )}
            Guardar
          </Button>
        </form>

        <AvisoTarifaPanel aviso={aviso} />
      </CardContent>
    </Card>
  );
}
