"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { useAppData } from "@/components/providers/app-data-provider";
import { BotonCheck, ChipTrack } from "@/components/aprendizaje/primitivos";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { crearEntradaBitacora } from "@/lib/actions/journal";
import { alternarAplicacion, alternarTeoria } from "@/lib/actions/study";
import type { Block, StudySession, Track } from "@/lib/supabase/database.types";

/**
 * Tarjeta de la sesión del día: teoría, consigna, los dos checks y el log
 * rápido.
 *
 * Teoría y aplicación son dos checks INDEPENDIENTES a propósito: "leí el
 * tema pero todavía no lo apliqué" es un estado real y es el punto de la
 * app. No se colapsan en uno solo.
 *
 * El color del track sale del dato (`tracks.color`), que es el único caso
 * donde un color va inline. Todo lo demás son tokens.
 */

/**
 * Proyecto donde vive el estudio. El selector arranca precargado acá por
 * comodidad, pero se puede cambiar: la bitácora exige `project_id` y la
 * acción valida el que le llegue.
 */
const SLUG_PROYECTO_ESTUDIO = "gentius";

export function SessionCard({
  track,
  block,
  session,
  mostrarLog = true,
}: {
  track: Track;
  block: Block | null;
  session: StudySession;
  mostrarLog?: boolean;
}) {
  const router = useRouter();
  const { projects } = useAppData();

  const proyectosDisponibles = projects.filter((p) => p.activo);
  const porDefecto =
    proyectosDisponibles.find((p) => p.slug === SLUG_PROYECTO_ESTUDIO) ??
    proyectosDisponibles[0] ??
    null;

  const [texto, setTexto] = useState("");
  const [projectId, setProjectId] = useState<string>(porDefecto?.id ?? "");
  const [guardando, setGuardando] = useState(false);
  const [pendiente, iniciar] = useTransition();

  function alternar(paso: "teoria" | "aplicacion") {
    iniciar(async () => {
      const resultado =
        paso === "teoria"
          ? await alternarTeoria(session.id)
          : await alternarAplicacion(session.id);

      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }
      router.refresh();
    });
  }

  async function guardarLog() {
    if (!texto.trim()) return;
    if (!projectId) {
      toast.error("Elegí un proyecto para la entrada de bitácora.");
      return;
    }

    setGuardando(true);
    const resultado = await crearEntradaBitacora({
      contenido: texto,
      projectId,
      trackId: track.id,
    });
    setGuardando(false);

    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }

    setTexto("");
    toast.success("Anotado en la bitácora.");
    router.refresh();
  }

  const idLog = `log-${session.id}`;
  const idProyecto = `proyecto-${session.id}`;

  return (
    <Card
      className="border-l-4"
      style={{ borderLeftColor: track.color }}
    >
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <ChipTrack track={track} />
          {block && (
            <p className="text-muted-foreground text-xs">{block.titulo}</p>
          )}
          <h3 className="text-lg font-semibold tracking-tight">
            {session.titulo}
          </h3>
        </div>

        {session.teoria_texto && (
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs font-medium uppercase">
              Teoría de hoy
            </p>
            <p className="text-sm">{session.teoria_texto}</p>
          </div>
        )}

        {session.teoria_link && (
          <a
            href={session.teoria_link}
            target="_blank"
            rel="noreferrer"
            className="text-primary inline-flex items-center gap-1.5 text-sm underline underline-offset-4"
          >
            Abrir fuente
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </a>
        )}

        {session.consigna && (
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs font-medium uppercase">
              Consigna aplicada
            </p>
            <p className="text-sm">{session.consigna}</p>
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <BotonCheck
            hecha={session.teoria_hecha}
            etiqueta="Teoría"
            disabled={pendiente}
            onClick={() => alternar("teoria")}
          />
          <BotonCheck
            hecha={session.aplicacion_hecha}
            etiqueta="Aplicación"
            disabled={pendiente}
            onClick={() => alternar("aplicacion")}
          />
        </div>

        {mostrarLog && (
          <div className="space-y-2 border-t border-border pt-4">
            <Label htmlFor={idLog}>¿Qué aprendí? (2 o 3 líneas)</Label>
            <Textarea
              id={idLog}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Material para entrevistas futuras…"
            />

            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="space-y-1">
                <Label htmlFor={idProyecto} className="text-xs">
                  Proyecto
                </Label>
                <Select
                  value={projectId}
                  onValueChange={setProjectId}
                  disabled={proyectosDisponibles.length === 0}
                >
                  <SelectTrigger id={idProyecto} size="sm" className="w-56">
                    <SelectValue placeholder="Elegí un proyecto" />
                  </SelectTrigger>
                  <SelectContent>
                    {proyectosDisponibles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                size="sm"
                disabled={!texto.trim() || !projectId || guardando}
                onClick={() => void guardarLog()}
              >
                Guardar en bitácora
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
