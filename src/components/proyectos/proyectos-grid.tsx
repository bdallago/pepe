"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import {
  FiltrosBalanceBar,
  rangoDePreset,
  type RangoFiltros,
} from "@/components/dashboard/filtros-balance";
import { useAppData } from "@/components/providers/app-data-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { calcularBalances } from "@/lib/balances";
import { todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import {
  etiquetaProrrateo,
  calcularParticipaciones,
  pesosSonUniformes,
} from "@/lib/prorrateo";
import type { Moneda, Movement } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

export function ProyectosGrid({ movements }: { movements: Movement[] }) {
  const { projects, categories, moneda } = useAppData();

  const [filtros, setFiltros] = useState<RangoFiltros>(() => ({
    ...rangoDePreset("todo"),
    estado: "ambos",
  }));

  const balances = useMemo(
    () => calcularBalances(movements, projects, categories, moneda, filtros),
    [movements, projects, categories, moneda, filtros],
  );

  const participaciones = useMemo(
    () => calcularParticipaciones(projects, todayISO()),
    [projects],
  );
  const uniformes = useMemo(
    () => pesosSonUniformes(projects, todayISO()),
    [projects],
  );

  const slugPorId = useMemo(
    () => new Map(projects.map((p) => [p.id, p.slug])),
    [projects],
  );

  if (projects.length === 0) {
    return (
      <p className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
        Todavía no cargaste ningún proyecto.{" "}
        <Link href="/ajustes" className="underline underline-offset-2">
          Creá el primero en Ajustes.
        </Link>
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <FiltrosBalanceBar filtros={filtros} onChange={setFiltros} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {balances.porProyecto.map((proyecto) => {
          const participacion = participaciones.get(proyecto.projectId);
          const slug = slugPorId.get(proyecto.projectId);

          return (
            <Link
              key={proyecto.projectId}
              href={slug ? `/proyectos/${slug}` : "/proyectos"}
              className="focus-visible:ring-ring rounded-lg focus-visible:ring-2 focus-visible:outline-none"
            >
              <Card className="hover:border-foreground/20 h-full transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: proyecto.color }}
                      />
                      <p className="truncate font-medium">{proyecto.nombre}</p>
                    </div>
                    <ArrowRight className="text-muted-foreground size-4 shrink-0" />
                  </div>

                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {/* `TotalPorProyecto.activo`, que ya viene resuelto
                        con `estaVivo()` contra hoy. */}
                    {!proyecto.activo ? (
                      <Badge variant="outline" className="h-5 text-[10px]">
                        inactivo
                      </Badge>
                    ) : participacion ? (
                      <Badge variant="secondary" className="h-5 text-[10px] font-normal">
                        {etiquetaProrrateo(participacion, uniformes)}
                      </Badge>
                    ) : null}
                  </div>

                  <p
                    className={cn(
                      "mt-3 text-xl font-semibold cifra",
                      proyecto.balance >= 0
                        ? "text-positivo"
                        : "text-destructive",
                    )}
                  >
                    {formatMoney(proyecto.balance, moneda)}
                  </p>

                  <dl className="text-muted-foreground mt-2 grid grid-cols-2 gap-1 text-xs">
                    <div>
                      <dt className="inline">Ingresos: </dt>
                      <dd className="inline cifra">
                        {formatMoney(proyecto.ingresos, moneda)}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline">Egresos: </dt>
                      <dd className="inline cifra">
                        {formatMoney(proyecto.egresos, moneda)}
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Verificación del invariante: la suma por proyecto tiene que dar el
          balance general. Si no cierra es un bug del prorrateo, no un
          detalle de presentación, así que se muestra. */}
      <ComprobacionInvariante
        sumaProyectos={balances.porProyecto.reduce(
          (sum, p) => sum + p.balance,
          0,
        )}
        balanceGeneral={balances.proyectado.balance}
        sinRepartir={balances.compartidoSinRepartir}
        moneda={moneda}
      />
    </div>
  );
}

function ComprobacionInvariante({
  sumaProyectos,
  balanceGeneral,
  sinRepartir,
  moneda,
}: {
  sumaProyectos: number;
  balanceGeneral: number;
  sinRepartir: number;
  moneda: Moneda;
}) {
  const diferencia = Math.round((sumaProyectos - balanceGeneral) * 100) / 100;
  const esperada = sinRepartir !== 0;

  if (Math.abs(diferencia) < 0.01) {
    return (
      <p className="text-muted-foreground text-xs">
        La suma de los balances por proyecto coincide con el balance general:{" "}
        <span className="cifra">
          {formatMoney(balanceGeneral, moneda)}
        </span>
        .
      </p>
    );
  }

  return (
    <p className="text-xs text-amber-600 dark:text-amber-500">
      La suma por proyecto difiere del balance general en{" "}
      <span className="cifra">{formatMoney(diferencia, moneda)}</span>
      {esperada
        ? ": son los gastos compartidos que no se pueden repartir por no haber proyectos activos."
        : "."}
    </p>
  );
}
