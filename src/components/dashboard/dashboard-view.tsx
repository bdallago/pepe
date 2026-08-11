"use client";

import { useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";

import { BalanceAcumuladoChart } from "@/components/charts/balance-acumulado-chart";
import { BalanceProyectoChart } from "@/components/charts/balance-proyecto-chart";
import { EgresosCategoriaChart } from "@/components/charts/egresos-categoria-chart";
import { IngresosEgresosChart } from "@/components/charts/ingresos-egresos-chart";
import {
  FiltrosBalanceBar,
  rangoDePreset,
  type RangoFiltros,
} from "@/components/dashboard/filtros-balance";
import { StatCards } from "@/components/dashboard/stat-cards";
import { useAppData } from "@/components/providers/app-data-provider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { calcularBalances } from "@/lib/balances";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import type { Movement } from "@/lib/supabase/database.types";

/**
 * Cuántos gastos sin repartir se nombran antes de resumir en "y N más".
 * El aviso tiene que caber en el bloque sin empujar los gráficos.
 */
const MAX_SIN_REPARTIR = 5;

/**
 * Balance general.
 *
 * Los cálculos corren en el cliente sobre los movimientos ya traídos, así
 * cambiar de moneda o de rango es instantáneo y no golpea la base.
 */
export function DashboardView({ movements }: { movements: Movement[] }) {
  const { projects, categories, moneda } = useAppData();

  const [filtros, setFiltros] = useState<RangoFiltros>(() => ({
    ...rangoDePreset("12m"),
    estado: "ambos",
  }));

  const balances = useMemo(
    () => calcularBalances(movements, projects, categories, moneda, filtros),
    [movements, projects, categories, moneda, filtros],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Balance</h1>
          <p className="text-muted-foreground text-sm">
            {balances.cantidadMovimientos} movimientos en el rango elegido.
          </p>
        </div>
        <FiltrosBalanceBar filtros={filtros} onChange={setFiltros} />
      </div>

      <StatCards balances={balances} moneda={moneda} />

      {balances.compartidoSinRepartir !== 0 ? (
        <div className="border-destructive/40 bg-destructive/5 text-destructive flex items-start gap-2 rounded-md border p-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p>
              Hay{" "}
              <span className="cifra">
                {formatMoney(Math.abs(balances.compartidoSinRepartir), moneda)}
              </span>{" "}
              en gastos compartidos que no se repartieron: no había ningún
              proyecto abierto en esas fechas. Cuentan en el balance general
              pero no en los balances por proyecto.
            </p>
            {/* Cuáles fueron. Antes el caso era todo o nada y alcanzaba con
                el monto; ahora depende de la fecha de cada gasto, y un
                aviso que no dice de qué habla no se puede accionar. */}
            <ul className="mt-2 space-y-0.5 text-xs">
              {balances.movimientosSinRepartir.slice(0, MAX_SIN_REPARTIR).map(
                (m) => (
                  <li key={m.id} className="truncate">
                    <span className="cifra">{formatDate(m.fecha)}</span> ·{" "}
                    {m.descripcion}
                  </li>
                ),
              )}
              {balances.movimientosSinRepartir.length > MAX_SIN_REPARTIR ? (
                <li>
                  y{" "}
                  {balances.movimientosSinRepartir.length - MAX_SIN_REPARTIR}{" "}
                  más.
                </li>
              ) : null}
            </ul>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Balance acumulado</CardTitle>
            <CardDescription>
              Cómo viene la suma mes a mes, en {moneda}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BalanceAcumuladoChart datos={balances.porMes} moneda={moneda} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ingresos y egresos</CardTitle>
            <CardDescription>Por mes, en {moneda}.</CardDescription>
          </CardHeader>
          <CardContent>
            <IngresosEgresosChart datos={balances.porMes} moneda={moneda} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Egresos por categoría</CardTitle>
            <CardDescription>
              En qué se va la plata, en {moneda}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EgresosCategoriaChart
              datos={balances.egresosPorCategoria}
              moneda={moneda}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Balance por proyecto</CardTitle>
            <CardDescription>
              Con su parte de los gastos compartidos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BalanceProyectoChart
              datos={balances.porProyecto}
              moneda={moneda}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
