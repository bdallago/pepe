"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarOff, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";

import { ChipTrack } from "@/components/aprendizaje/primitivos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { actualizarTrack } from "@/lib/actions/study";
import { WEEKDAY_LABELS, type DiaSemana } from "@/lib/aprendizaje";
import { formatDate } from "@/lib/dates";
import type { Track } from "@/lib/supabase/database.types";

/**
 * Tracks de estudio: qué está activo y en qué días de la semana toca.
 *
 * Los días se recorren por el día ISO (1 = lunes … 7 = domingo), que es
 * como los guarda `tracks.cadencia`. Nada de indexar un array 0-based y
 * sumarle uno: acá la clave del objeto ES el día.
 *
 * El toggle de activo y los días guardan al toque, como el archivar de
 * Categorías. El nombre y la fecha de inicio van por diálogo, como el
 * editar de Proyectos.
 */
const DIAS = Object.keys(WEEKDAY_LABELS).map(Number) as DiaSemana[];

export function TracksPanel({ tracks }: { tracks: Track[] }) {
  const router = useRouter();

  const [editando, setEditando] = useState<Track | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);

  async function guardar(
    track: Track,
    cambio: Parameters<typeof actualizarTrack>[1],
  ) {
    setGuardando(track.id);
    const resultado = await actualizarTrack(track.id, cambio);
    setGuardando(null);

    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }
    router.refresh();
  }

  function alternarDia(track: Track, dia: DiaSemana) {
    const cadencia = track.cadencia.includes(dia)
      ? track.cadencia.filter((d) => d !== dia)
      : [...track.cadencia, dia];

    // La action rechaza la cadencia vacía; el aviso lo damos acá para que
    // no salga un error de validación por algo que es una decisión de uso.
    if (cadencia.length === 0) {
      toast.error("Dejá al menos un día. Si no querés que corra, pausalo.");
      return;
    }
    void guardar(track, { cadencia });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tracks de estudio</CardTitle>
        <CardDescription>
          Los pausados no aparecen en Hoy ni en la semana. La cadencia define
          en qué días toca cada track.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-2">
        {tracks.length === 0 ? (
          <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
            Todavía no hay tracks.
          </p>
        ) : (
          tracks.map((track) => (
            <div key={track.id} className="space-y-3 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-3">
                <ChipTrack track={track} />

                {track.fecha_inicio ? (
                  <span className="text-muted-foreground text-xs">
                    desde <span className="cifra">{formatDate(track.fecha_inicio)}</span>
                  </span>
                ) : (
                  <Badge variant="outline" className="gap-1">
                    <CalendarOff className="size-3" />
                    sin arrancar
                  </Badge>
                )}

                <div className="flex-1" />

                {guardando === track.id ? (
                  <Loader2 className="text-muted-foreground size-4 animate-spin" />
                ) : null}

                <Label
                  htmlFor={`t-activo-${track.id}`}
                  className="text-muted-foreground text-xs font-normal"
                >
                  {track.activo ? "Activo" : "En pausa"}
                </Label>
                <Switch
                  id={`t-activo-${track.id}`}
                  checked={track.activo}
                  disabled={guardando === track.id}
                  onCheckedChange={(v) => void guardar(track, { activo: v })}
                />

                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Editar ${track.nombre}`}
                  onClick={() => setEditando(track)}
                >
                  <Pencil className="size-3.5" />
                </Button>
              </div>

              <div className="space-y-1.5">
                <p className="text-muted-foreground text-xs">
                  Días de la semana (
                  <span className="cifra">{track.cadencia.length}</span> por
                  semana)
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {DIAS.map((dia) => {
                    const puesto = track.cadencia.includes(dia);
                    return (
                      <Button
                        key={dia}
                        type="button"
                        size="sm"
                        variant={puesto ? "default" : "outline"}
                        aria-pressed={puesto}
                        disabled={guardando === track.id}
                        className="h-7 px-2.5 text-xs"
                        onClick={() => alternarDia(track, dia)}
                      >
                        {WEEKDAY_LABELS[dia]}
                      </Button>
                    );
                  })}
                </div>
              </div>
            </div>
          ))
        )}
      </CardContent>

      {/* key fuerza el remount para que el formulario tome el track que se
          está editando y no el de la apertura anterior. */}
      <TrackDialog
        key={editando?.id ?? "ninguno"}
        track={editando}
        open={editando !== null}
        onOpenChange={(abierto) => {
          if (!abierto) setEditando(null);
        }}
      />
    </Card>
  );
}

function TrackDialog({
  track,
  open,
  onOpenChange,
}: {
  track: Track | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();

  const [nombre, setNombre] = useState(track?.nombre ?? "");
  // El input date usa "" para vacío; en la base eso es null, que significa
  // "todavía no arrancó" y es distinto de haber arrancado hoy.
  const [fechaInicio, setFechaInicio] = useState(track?.fecha_inicio ?? "");
  const [guardando, setGuardando] = useState(false);

  async function onSubmit(evento: React.FormEvent) {
    evento.preventDefault();
    if (!track) return;

    setGuardando(true);
    const resultado = await actualizarTrack(track.id, {
      nombre,
      fecha_inicio: fechaInicio === "" ? null : fechaInicio,
    });
    setGuardando(false);

    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }

    toast.success("Track actualizado.");
    router.refresh();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Editar track</DialogTitle>
          <DialogDescription>
            Sin fecha de inicio, el track todavía no arrancó y no aparece en
            Hoy.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="t-nombre">Nombre</Label>
            <Input
              id="t-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              autoComplete="off"
              placeholder="Ej: Product Management"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="t-inicio">Fecha de inicio</Label>
            <Input
              id="t-inicio"
              type="date"
              className="cifra"
              value={fechaInicio}
              onChange={(e) => setFechaInicio(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              Vacío = todavía no arrancó.
            </p>
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={guardando} className="flex-1">
              {guardando ? <Loader2 className="size-4 animate-spin" /> : null}
              Guardar
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
