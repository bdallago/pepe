"use client";

import { Check, Circle } from "lucide-react";

import {
  ESTADO_ARTEFACTO_LABEL,
  type Progreso,
} from "@/lib/aprendizaje";
import type { EstadoArtefacto, Track } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

/**
 * Primitivos compartidos del módulo de aprendizaje.
 *
 * Viven acá y no dentro de cada pantalla porque las tres vistas (Hoy,
 * Temario, Artefactos) muestran las mismas cinco cosas y si cada una se
 * arma la suya terminan divergiendo.
 *
 * Del original solo se porta la forma: el CSS se descarta entero. Nada de
 * serif, nada de latón, nada de `.track-pm` / `.track-dev`. Los colores
 * salen de los tokens y el color del track sale del dato (`tracks.color`),
 * que es lo que también alimenta los gráficos. Todo número, porcentaje o
 * fecha lleva `.cifra`.
 */

/**
 * Barra de progreso. `Progress` de Radix aporta el `role="progressbar"` y
 * los `aria-value*` que el original no tenía.
 */
export function BarraProgreso({
  pct,
  etiqueta,
  className,
}: {
  pct: number;
  /** Nombre accesible; si la barra ya va al lado de un texto, omitilo. */
  etiqueta?: string;
  className?: string;
}) {
  const valor = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <Progress
      value={valor}
      aria-label={etiqueta}
      className={cn("h-1.5", className)}
    />
  );
}

/** Barra + etiqueta + el "{pct}% · {hechas}/{total}" del original. */
export function FilaProgreso({
  progreso,
  etiqueta,
  className,
}: {
  progreso: Progreso;
  etiqueta?: string;
  className?: string;
}) {
  const { pct, hechas, total } = progreso;

  return (
    <div className={cn("space-y-1", className)}>
      {etiqueta && (
        <p className="text-sm text-muted-foreground">{etiqueta}</p>
      )}
      <div className="flex items-center gap-3">
        <BarraProgreso pct={pct} etiqueta={etiqueta} className="flex-1" />
        <span className="cifra shrink-0 text-xs text-muted-foreground">
          {pct}% · {hechas}/{total}
        </span>
      </div>
    </div>
  );
}

/**
 * Chip con el nombre del track. El color viene del dato, así que se aplica
 * inline: es el único lugar donde eso es correcto.
 */
export function ChipTrack({
  track,
  className,
}: {
  track: Pick<Track, "nombre" | "color">;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: track.color }}
      />
      {track.nombre}
    </span>
  );
}

/**
 * El toggle grande de teoría / aplicación.
 *
 * Es un botón y no un checkbox: no vive dentro de un formulario, cada clic
 * dispara una Server Action. El estado lo comunica `aria-pressed`.
 */
export function BotonCheck({
  hecha,
  etiqueta,
  onClick,
  disabled,
  className,
}: {
  hecha: boolean;
  etiqueta: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      aria-pressed={hecha}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "w-full justify-start",
        hecha && "border-primary/40 bg-primary/10 text-foreground",
        className,
      )}
    >
      {hecha ? (
        <Check aria-hidden="true" className="text-primary" />
      ) : (
        <Circle aria-hidden="true" className="text-muted-foreground" />
      )}
      {etiqueta}
    </Button>
  );
}

const VARIANTE_ESTADO: Record<
  EstadoArtefacto,
  "outline" | "secondary" | "default"
> = {
  no_empezado: "outline",
  en_curso: "secondary",
  completado: "default",
};

export function PastillaEstado({
  estado,
  className,
}: {
  estado: EstadoArtefacto;
  className?: string;
}) {
  return (
    <Badge variant={VARIANTE_ESTADO[estado]} className={className}>
      {ESTADO_ARTEFACTO_LABEL[estado]}
    </Badge>
  );
}
