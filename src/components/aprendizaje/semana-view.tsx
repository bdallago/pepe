"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { computeWeek, etiquetaDia } from "@/lib/aprendizaje";
import { addDays, mondayOf, parseISODate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { Block, StudySession, Track } from "@/lib/supabase/database.types";

/**
 * Proyección de la semana, de lunes a domingo.
 *
 * Toda la lógica está en `computeWeek`: acá solo se navega entre semanas
 * moviendo el lunes de referencia. Es una proyección elástica, no una
 * agenda: si un día no estudiás, la sesión se corre, no se vence.
 */

function etiquetaDeMes(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    month: "long",
    year: "numeric",
  }).format(parseISODate(iso));
}

/** Número de día del mes, sin pasar por `new Date(iso)` a secas. */
function numeroDeDia(iso: string): number {
  return parseISODate(iso).getDate();
}

export function SemanaView({
  fecha,
  tracks,
  blocks,
  sessions,
}: {
  /** Hoy, resuelto en el servidor para que las dos mitades coincidan. */
  fecha: string;
  tracks: Track[];
  blocks: Block[];
  sessions: StudySession[];
}) {
  const [offset, setOffset] = useState(0);

  const lunes = addDays(mondayOf(fecha), offset * 7);
  const dias = useMemo(
    () => computeWeek({ fecha: lunes, tracks, blocks, sessions }),
    [lunes, tracks, blocks, sessions],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight capitalize">
          {etiquetaDeMes(lunes)}
        </h2>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Semana anterior"
            onClick={() => setOffset((o) => o - 1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(0)}
          >
            Hoy
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Semana siguiente"
            onClick={() => setOffset((o) => o + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="divide-border divide-y p-0">
          {dias.map((dia) => {
            const esHoy = dia.fecha === fecha;

            return (
              <div
                key={dia.fecha}
                className={cn(
                  "flex items-start gap-4 px-4 py-3",
                  esHoy && "bg-accent/40",
                )}
              >
                <div className="w-12 shrink-0 text-center">
                  <div className="text-muted-foreground text-xs">
                    {etiquetaDia(dia.weekday)}
                  </div>
                  <div
                    className={cn(
                      "cifra text-lg leading-tight",
                      esHoy ? "text-primary font-semibold" : "text-foreground",
                    )}
                  >
                    {numeroDeDia(dia.fecha)}
                  </div>
                </div>

                <div className="min-w-0 flex-1 space-y-2">
                  {dia.entradas.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      Descanso o colchón
                    </p>
                  ) : (
                    dia.entradas.map(({ track, session }) => (
                      <div
                        key={track.id}
                        className="border-l-2 pl-3"
                        style={{ borderLeftColor: track.color }}
                      >
                        <p className="text-muted-foreground text-xs font-medium">
                          {track.nombre}
                        </p>
                        <p className="text-sm">{session.titulo}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-sm">
        Proyección elástica: se recalcula según lo que vas completando. Nada se
        vence.
      </p>
    </div>
  );
}
