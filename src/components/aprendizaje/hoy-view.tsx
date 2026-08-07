"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Layers, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  ChipTrack,
  FilaProgreso,
} from "@/components/aprendizaje/primitivos";
import { SessionCard } from "@/components/aprendizaje/session-card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { borrarEntradaBitacora } from "@/lib/actions/journal";
import { computeToday, trackProgress } from "@/lib/aprendizaje";
import { formatDate, parseISODate } from "@/lib/dates";
import type {
  Block,
  DailyLog,
  StudySession,
  Track,
} from "@/lib/supabase/database.types";

/**
 * Pantalla "Hoy": qué toca estudiar, qué tracks descansan, cómo viene el
 * progreso y las últimas anotaciones.
 *
 * Del original se porta la forma, no el CSS: nada de serif, nada de latón,
 * nada de contenedor angosto. Colores por tokens; el único color que viene
 * del dato es el del track.
 *
 * La lógica no vive acá: `computeToday` y `trackProgress` son puras y están
 * en `@/lib/aprendizaje`.
 */

/** "2026-08-07" → "viernes 7 de agosto". Siempre por `parseISODate`. */
function fechaLarga(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(parseISODate(iso));
}

export function HoyView({
  fecha,
  tracks,
  blocks,
  sessions,
  bitacora,
}: {
  fecha: string;
  tracks: Track[];
  blocks: Block[];
  sessions: StudySession[];
  /** Solo las últimas entradas: el listado completo vive en Bitácora. */
  bitacora: DailyLog[];
}) {
  const hoy = useMemo(
    () => computeToday({ fecha, tracks, blocks, sessions }),
    [fecha, tracks, blocks, sessions],
  );

  const activos = hoy.items.filter((i) => i.esHoy && i.session);
  const descansando = hoy.items.filter((i) => !i.esHoy && i.session);
  const tracksActivos = tracks.filter((t) => t.activo);

  if (!hoy.algunTrackArranco) {
    // La fecha de arranque del plan es la más temprana de los tracks
    // activos. Puede no haber ninguna: un track recién creado todavía no
    // tiene fecha de inicio, y eso es distinto de arrancar hoy.
    const inicios = tracksActivos
      .map((t) => t.fecha_inicio)
      .filter((f): f is string => f !== null)
      .sort();
    const arranque = inicios[0] ?? null;

    return (
      <Card>
        <CardContent className="space-y-2">
          <h2 className="text-lg font-semibold tracking-tight">
            El plan todavía no arrancó
          </h2>
          <p className="text-muted-foreground text-sm">
            {arranque ? (
              <>
                Empieza el{" "}
                <span className="cifra font-medium text-foreground">
                  {fechaLarga(arranque)}
                </span>
                . Mientras tanto podés recorrer el Roadmap completo y dejar
                todo preparado.
              </>
            ) : (
              <>
                Ninguno de los tracks tiene fecha de inicio. Poné una desde el
                Roadmap y esta pantalla empieza a mostrar qué toca cada día.
              </>
            )}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {hoy.diaDoble && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex items-start gap-3">
            <Layers aria-hidden="true" className="text-primary mt-0.5 size-4" />
            <div>
              <p className="font-medium">Día de doble sesión</p>
              <p className="text-muted-foreground text-sm">
                Hoy tocan <span className="cifra">{activos.length}</span>{" "}
                tracks. Bloque teórico de ~1h más la aplicación en tus horas de
                desarrollo.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {activos.length === 0 && (
        <Card>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Hoy no hay sesión programada. Día de descanso o de colchón.
            </p>
          </CardContent>
        </Card>
      )}

      {activos.map(
        ({ track, block, session }) =>
          session && (
            <SessionCard
              key={session.id}
              track={track}
              block={block}
              session={session}
            />
          ),
      )}

      {descansando.map(({ track, block, session }) => (
        <Card key={track.id} className="border-dashed opacity-80">
          <CardContent className="space-y-2">
            <ChipTrack track={track} />
            <p className="text-muted-foreground text-sm">
              Hoy no toca. Próxima:{" "}
              <span className="text-foreground font-medium">
                {session?.titulo}
              </span>
              {block && <> · {block.titulo}</>}
            </p>
          </CardContent>
        </Card>
      ))}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">Progreso</h2>
        <Card>
          <CardContent className="space-y-4">
            {tracksActivos.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No hay tracks activos.
              </p>
            ) : (
              tracksActivos.map((track) => (
                <FilaProgreso
                  key={track.id}
                  etiqueta={track.nombre}
                  progreso={trackProgress(track.id, blocks, sessions)}
                />
              ))
            )}
          </CardContent>
        </Card>
      </section>

      <BitacoraReciente entradas={bitacora} tracks={tracks} />
    </div>
  );
}

/**
 * Atajo a lo último anotado. Bitácora es una sección propia, pero tener las
 * cinco últimas a mano acá sigue siendo útil para no repetirse.
 *
 * El botón de la papelera ARCHIVA, no borra: es la regla del módulo. El
 * texto del diálogo lo dice para que nadie lo lea como un borrado.
 */
function BitacoraReciente({
  entradas,
  tracks,
}: {
  entradas: DailyLog[];
  tracks: Track[];
}) {
  const router = useRouter();
  const [archivando, setArchivando] = useState<DailyLog | null>(null);

  const nombreDeTrack = new Map(tracks.map((t) => [t.id, t.nombre]));

  if (entradas.length === 0) return null;

  async function confirmarArchivado() {
    if (!archivando) return;
    const resultado = await borrarEntradaBitacora(archivando.id);
    setArchivando(null);

    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }
    toast.success("Entrada archivada.");
    router.refresh();
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold tracking-tight">
        Bitácora reciente
      </h2>

      <Card>
        <CardContent className="divide-border divide-y p-0">
          {entradas.map((entrada) => (
            <div
              key={entrada.id}
              className="flex items-start gap-3 px-4 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm whitespace-pre-wrap">
                  {entrada.contenido}
                </p>
                <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
                  <CalendarClock aria-hidden="true" className="size-3" />
                  <span className="cifra">{formatDate(entrada.fecha)}</span>
                  {entrada.track_id && (
                    <>· {nombreDeTrack.get(entrada.track_id) ?? "—"}</>
                  )}
                </p>
              </div>

              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                aria-label="Archivar entrada"
                onClick={() => setArchivando(entrada)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <AlertDialog
        open={archivando !== null}
        onOpenChange={(abierto) => {
          if (!abierto) setArchivando(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Archivar esta entrada?</AlertDialogTitle>
            <AlertDialogDescription>
              No se borra: sale de las listas pero queda en el histórico. Se
              puede recuperar más adelante.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarArchivado}>
              Archivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
