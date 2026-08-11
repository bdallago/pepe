"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";

import { BalanceAcumuladoChart } from "@/components/charts/balance-acumulado-chart";
import { EgresosCategoriaChart } from "@/components/charts/egresos-categoria-chart";
import { IngresosEgresosChart } from "@/components/charts/ingresos-egresos-chart";
import {
  FiltrosBalanceBar,
  rangoDePreset,
  type RangoFiltros,
} from "@/components/dashboard/filtros-balance";
import { StatCards } from "@/components/dashboard/stat-cards";
import { MovementDialog } from "@/components/movimientos/movement-dialog";
import { useAppData } from "@/components/providers/app-data-provider";
import { ProyectoMovimientos } from "@/components/proyectos/proyecto-movimientos";
import {
  RetroPanel,
  type RetroGuardada,
} from "@/components/proyectos/retro-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { calcularBalancesProyecto, filtrarMovimientos } from "@/lib/balances";
import { todayISO } from "@/lib/dates";
import { estaVivo, etiquetaProrrateo, imputarAProyecto } from "@/lib/prorrateo";
import { calcularParticipaciones, pesosSonUniformes } from "@/lib/prorrateo";
import type { Movement, Project } from "@/lib/supabase/database.types";

/**
 * Vista de un proyecto: misma estructura que el dashboard pero acotada,
 * incluyendo su porción prorrateada de los gastos compartidos.
 */
export function ProyectoView({
  proyecto,
  movements,
  retros,
  hayModelo,
}: {
  proyecto: Project;
  movements: Movement[];
  retros: RetroGuardada[];
  hayModelo: boolean;
}) {
  const { projects, categories, moneda } = useAppData();

  const [filtros, setFiltros] = useState<RangoFiltros>(() => ({
    ...rangoDePreset("todo"),
    estado: "ambos",
  }));
  const [cargando, setCargando] = useState(false);

  const balances = useMemo(
    () =>
      calcularBalancesProyecto(
        movements,
        projects,
        categories,
        proyecto.id,
        moneda,
        filtros,
      ),
    [movements, projects, categories, proyecto.id, moneda, filtros],
  );

  const participaciones = useMemo(
    () => calcularParticipaciones(projects, todayISO()),
    [projects],
  );
  const uniformes = useMemo(
    () => pesosSonUniformes(projects, todayISO()),
    [projects],
  );
  const participacion = participaciones.get(proyecto.id);

  const imputados = useMemo(
    () =>
      imputarAProyecto(
        filtrarMovimientos(movements, filtros),
        proyecto.id,
        projects,
        moneda,
      ),
    [movements, filtros, proyecto.id, projects, moneda],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <Link
          href="/proyectos"
          className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-3.5" />
          Proyectos
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="size-3 rounded-full"
              style={{ backgroundColor: proyecto.color }}
            />
            <h1 className="text-2xl font-semibold tracking-tight">
              {proyecto.nombre}
            </h1>
            {!estaVivo(proyecto) ? (
              <Badge variant="outline">inactivo</Badge>
            ) : participacion ? (
              <Badge variant="secondary" className="font-normal">
                {etiquetaProrrateo(participacion, uniformes)} de los gastos
                compartidos
              </Badge>
            ) : null}
          </div>

          <Button size="sm" onClick={() => setCargando(true)}>
            <Plus className="size-4" />
            Cargar acá
          </Button>
        </div>

        <FiltrosBalanceBar filtros={filtros} onChange={setFiltros} />
      </div>

      <StatCards balances={balances} moneda={moneda} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Balance acumulado</CardTitle>
            <CardDescription>Mes a mes, en {moneda}.</CardDescription>
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

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Egresos por categoría</CardTitle>
            <CardDescription>
              Incluye la parte prorrateada de lo compartido.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EgresosCategoriaChart
              datos={balances.egresosPorCategoria}
              moneda={moneda}
            />
          </CardContent>
        </Card>
      </div>

      <ProyectoMovimientos
        imputados={imputados}
        uniformes={uniformes}
        moneda={moneda}
      />

      <RetroPanel
        projectId={proyecto.id}
        nombreProyecto={proyecto.nombre}
        retros={retros}
        hayModelo={hayModelo}
        moneda={moneda}
      />

      <MovementDialog
        open={cargando}
        onOpenChange={setCargando}
        projectIdInicial={proyecto.id}
      />
    </div>
  );
}
