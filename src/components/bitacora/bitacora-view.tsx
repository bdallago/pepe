"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ChipTrack } from "@/components/aprendizaje/primitivos";
import { useAppData } from "@/components/providers/app-data-provider";
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
import {
  borrarEntradaBitacora,
  crearEntradaBitacora,
} from "@/lib/actions/journal";
import { formatDate, todayISO } from "@/lib/dates";
import type { DailyLog, Track } from "@/lib/supabase/database.types";

/**
 * Bitácora.
 *
 * En el original esto era el bloque "Bitácora reciente" de la pantalla de
 * Hoy: cinco líneas con un texto, la fecha y una cruz para borrar. Acá es
 * una sección propia, con formulario de carga y la lista completa agrupada
 * por día.
 *
 * Dos cosas que no estaban allá:
 *
 * - La entrada cuelga de un proyecto (`daily_log.project_id` es NOT NULL).
 *   El selector arranca en Gentius, que es donde va el estudio, pero se
 *   puede cambiar: el id lo valida la Server Action, no se hardcodea nada.
 * - La cruz **archiva**, no borra, y pasa por una confirmación explícita.
 */

/** Proyecto donde va el estudio; el selector arranca ahí por comodidad. */
const SLUG_ESTUDIO = "gentius";

/** Valor centinela: Radix no acepta `value=""` en un `SelectItem`. */
const SIN_TRACK = "sin-track";

/** A partir de acá la entrada se muestra recortada con un "Ver más". */
const LARGO_RECORTE = 420;

export function BitacoraView({
  entradas,
  tracks,
}: {
  entradas: DailyLog[];
  tracks: Track[];
}) {
  const router = useRouter();
  const { projects, proyectosActivos } = useAppData();

  const proyectoPorDefecto =
    proyectosActivos.find((p) => p.slug === SLUG_ESTUDIO)?.id ??
    proyectosActivos[0]?.id ??
    "";

  const [contenido, setContenido] = useState("");
  const [fecha, setFecha] = useState(todayISO());
  const [projectId, setProjectId] = useState(proyectoPorDefecto);
  const [trackId, setTrackId] = useState(SIN_TRACK);
  const [guardando, setGuardando] = useState(false);
  const [archivando, setArchivando] = useState<DailyLog | null>(null);

  const nombreProyecto = new Map(projects.map((p) => [p.id, p.nombre]));
  const trackPorId = new Map(tracks.map((t) => [t.id, t]));

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!contenido.trim()) {
      toast.error("Escribí algo antes de guardar.");
      return;
    }
    if (!projectId) {
      toast.error("Elegí un proyecto.");
      return;
    }

    setGuardando(true);
    const resultado = await crearEntradaBitacora({
      contenido,
      fecha,
      projectId,
      trackId: trackId === SIN_TRACK ? null : trackId,
    });
    setGuardando(false);

    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }

    setContenido("");
    setFecha(todayISO());
    toast.success("Entrada guardada.");
    router.refresh();
  }

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

  // Ya vienen ordenadas de la más nueva a la más vieja: agrupar en orden
  // conserva ese orden sin volver a ordenar nada.
  const porDia: { fecha: string; entradas: DailyLog[] }[] = [];
  for (const entrada of entradas) {
    const ultimo = porDia[porDia.length - 1];
    if (ultimo && ultimo.fecha === entrada.fecha) ultimo.entradas.push(entrada);
    else porDia.push({ fecha: entrada.fecha, entradas: [entrada] });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent>
          <form onSubmit={guardar} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="bitacora-contenido">Nueva entrada</Label>
              <Textarea
                id="bitacora-contenido"
                value={contenido}
                onChange={(e) => setContenido(e.target.value)}
                rows={4}
                maxLength={5000}
                placeholder="Qué aprendiste, qué te trabó, qué probarías la próxima."
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="bitacora-fecha">Fecha</Label>
                <Input
                  id="bitacora-fecha"
                  type="date"
                  className="cifra"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bitacora-proyecto">Proyecto</Label>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger id="bitacora-proyecto" className="w-full">
                    <SelectValue placeholder="Elegí un proyecto" />
                  </SelectTrigger>
                  <SelectContent>
                    {proyectosActivos.map((proyecto) => (
                      <SelectItem key={proyecto.id} value={proyecto.id}>
                        {proyecto.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bitacora-track">Track</Label>
                <Select value={trackId} onValueChange={setTrackId}>
                  <SelectTrigger id="bitacora-track" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SIN_TRACK}>Sin track</SelectItem>
                    {tracks.map((track) => (
                      <SelectItem key={track.id} value={track.id}>
                        {track.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={guardando}>
                <Plus className="size-4" />
                {guardando ? "Guardando…" : "Guardar entrada"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {porDia.length === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
          Todavía no hay entradas. La bitácora es el registro de lo que fuiste
          aprendiendo: una línea por día ya sirve.
        </p>
      ) : (
        <div className="space-y-6">
          {porDia.map((dia) => (
            <section key={dia.fecha} className="space-y-2">
              <h2 className="cifra text-muted-foreground text-xs font-medium tracking-wide">
                {formatDate(dia.fecha)}
              </h2>

              <ul className="space-y-2">
                {dia.entradas.map((entrada) => {
                  const track = entrada.track_id
                    ? trackPorId.get(entrada.track_id)
                    : undefined;

                  return (
                    <li
                      key={entrada.id}
                      className="flex items-start gap-3 rounded-md border p-3"
                    >
                      <div className="min-w-0 flex-1 space-y-2">
                        <TextoEntrada contenido={entrada.contenido} />

                        <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                          {track && <ChipTrack track={track} />}
                          <span>
                            {nombreProyecto.get(entrada.project_id) ??
                              "Proyecto archivado"}
                          </span>
                        </div>
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
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

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
              Sale de la lista pero no se borra: el registro queda guardado
              para el histórico.
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
    </div>
  );
}

/**
 * Las entradas van de dos renglones a dos mil caracteres. Las cortas se
 * muestran enteras; las largas se recortan y se despliegan, así la lista
 * sigue siendo escaneable sin esconder nada.
 */
function TextoEntrada({ contenido }: { contenido: string }) {
  const [abierta, setAbierta] = useState(false);
  const larga = contenido.length > LARGO_RECORTE;

  return (
    <div className="space-y-1">
      <p
        className={
          larga && !abierta
            ? "line-clamp-3 text-sm whitespace-pre-line"
            : "text-sm whitespace-pre-line"
        }
      >
        {contenido}
      </p>
      {larga && (
        <button
          type="button"
          onClick={() => setAbierta((previa) => !previa)}
          className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
        >
          {abierta ? "Ver menos" : "Ver más"}
        </button>
      )}
    </div>
  );
}
