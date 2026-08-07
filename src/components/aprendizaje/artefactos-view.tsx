"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";

import {
  ESTADO_ARTEFACTO_LABEL,
  progresoArtefactos,
  siguienteEstadoArtefacto,
} from "@/lib/aprendizaje";
import { cambiarEstadoArtefacto } from "@/lib/actions/study";
import { formatDate } from "@/lib/dates";
import type { Artifact, Track } from "@/lib/supabase/database.types";

import { ChipTrack, PastillaEstado } from "@/components/aprendizaje/primitivos";
import { Button } from "@/components/ui/button";

/**
 * Artefactos de portfolio, agrupados por track.
 *
 * El estado se cambia tocándolo: cicla no_empezado → en_curso → completado.
 * El ciclo vive en `siguienteEstadoArtefacto` y la escritura en
 * `cambiarEstadoArtefacto`, que es la que además sella o limpia
 * `fecha_completado` — la base exige que estado y fecha vayan juntos, así
 * que acá no se toca la fecha por las nuestras.
 */
export function ArtefactosView({
  tracks,
  artefactos,
}: {
  tracks: Track[];
  artefactos: Artifact[];
}) {
  const router = useRouter();
  const [cambiando, setCambiando] = useState<string | null>(null);

  async function ciclar(artefacto: Artifact) {
    const proximo = siguienteEstadoArtefacto(artefacto.estado);

    setCambiando(artefacto.id);
    const resultado = await cambiarEstadoArtefacto(artefacto.id, proximo);
    setCambiando(null);

    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }
    router.refresh();
  }

  if (tracks.length === 0) {
    return (
      <p className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
        Todavía no hay tracks cargados.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {tracks.map((track) => {
        const propios = artefactos
          .filter((a) => a.track_id === track.id)
          .sort((a, b) => a.orden - b.orden);
        const progreso = progresoArtefactos(track.id, artefactos);

        return (
          <section
            key={track.id}
            className="bg-card space-y-3 rounded-lg border border-border p-4"
          >
            <div className="flex flex-wrap items-center gap-3">
              <ChipTrack track={track} />
              <span className="text-muted-foreground ml-auto text-xs">
                <span className="cifra">
                  {progreso.hechas}/{progreso.total}
                </span>{" "}
                completados
              </span>
            </div>

            {propios.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Este track todavía no tiene artefactos.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {propios.map((artefacto) => (
                  <li
                    key={artefacto.id}
                    className="flex flex-wrap items-center gap-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{artefacto.nombre}</p>
                      <div className="flex flex-wrap items-center gap-x-3">
                        {artefacto.fecha_completado && (
                          <p className="text-muted-foreground text-xs">
                            Completado el{" "}
                            <span className="cifra">
                              {formatDate(artefacto.fecha_completado)}
                            </span>
                          </p>
                        )}
                        {artefacto.url && (
                          <a
                            href={artefacto.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline underline-offset-2"
                          >
                            ver
                            <ExternalLink aria-hidden="true" className="size-3" />
                          </a>
                        )}
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={cambiando === artefacto.id}
                      onClick={() => void ciclar(artefacto)}
                      title="Tocá para cambiar el estado"
                      aria-label={`${artefacto.nombre}: ${ESTADO_ARTEFACTO_LABEL[artefacto.estado]}. Tocá para pasar a ${ESTADO_ARTEFACTO_LABEL[siguienteEstadoArtefacto(artefacto.estado)]}`}
                    >
                      <PastillaEstado estado={artefacto.estado} />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <p className="text-muted-foreground text-xs">
        Tocá el estado para ciclar: {ESTADO_ARTEFACTO_LABEL.no_empezado} →{" "}
        {ESTADO_ARTEFACTO_LABEL.en_curso} →{" "}
        {ESTADO_ARTEFACTO_LABEL.completado}.
      </p>
    </div>
  );
}
