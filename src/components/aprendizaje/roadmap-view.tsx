"use client";

import { useState } from "react";
import { Check, ChevronRight, Circle, ExternalLink, Library } from "lucide-react";

import {
  blockProgress,
  isComplete,
  trackProgress,
} from "@/lib/aprendizaje";
import type {
  Block,
  Json,
  StudySession,
  Track,
} from "@/lib/supabase/database.types";

import {
  BarraProgreso,
  ChipTrack,
  FilaProgreso,
} from "@/components/aprendizaje/primitivos";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Roadmap: el temario completo, por track y por bloque.
 *
 * Del original se porta la forma (segmentado + desplegables + sesiones con
 * ✓/○ + bibliografía) y se descarta el CSS entero. Dos diferencias contra
 * el origen que vale la pena anotar:
 *
 * 1. El segmentado etiquetaba con `track.tipo === 'pm' ? 'PM' : 'Dev'`, pero
 *    acá no hay columna `tipo`: la etiqueta corta sale del `slug` y el
 *    nombre completo se muestra en el chip del track.
 * 2. Los desplegables son `<details>` nativo. No hay accordion instalado y
 *    tampoco hace falta: funciona sin JS y el estado abierto/cerrado lo
 *    lleva el navegador.
 */

/** Una fuente de bibliografía del bloque: título y url. */
interface Fuente {
  t: string;
  u: string;
}

/**
 * `blocks.fuentes` es `jsonb`, así que en los tipos generados llega como
 * `Json`: puede ser cualquier cosa. Se valida forma por forma en vez de
 * castear, que es lo único que evita un `undefined.map` en runtime si
 * alguna fila quedó vieja.
 */
function parsearFuentes(fuentes: Json): Fuente[] {
  if (!Array.isArray(fuentes)) return [];

  return fuentes.flatMap((f) => {
    if (typeof f !== "object" || f === null || Array.isArray(f)) return [];
    const { t, u } = f as Record<string, unknown>;
    if (typeof t !== "string" || typeof u !== "string") return [];
    return [{ t, u }];
  });
}

/**
 * Etiqueta corta para el segmentado, derivada del `slug`. Las siglas cortas
 * ("pm") van en mayúsculas; lo demás capitalizado ("dev-hrkit" → "Dev").
 */
function etiquetaCorta(track: Track): string {
  const primera = track.slug.split("-")[0] ?? track.slug;
  if (!primera) return track.nombre;
  return primera.length <= 3
    ? primera.toUpperCase()
    : primera.charAt(0).toUpperCase() + primera.slice(1);
}

function EnlaceFuente({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline underline-offset-2"
    >
      {children}
      <ExternalLink aria-hidden="true" className="size-3" />
    </a>
  );
}

function TarjetaTrack({
  track,
  blocks,
  sessions,
}: {
  track: Track;
  blocks: Block[];
  sessions: StudySession[];
}) {
  const progreso = trackProgress(track.id, blocks, sessions);
  const bloques = blocks
    .filter((b) => b.track_id === track.id)
    .sort((a, b) => a.orden - b.orden);

  /*
    Las sesiones sin bloque son las que se agregaron después del temario
    importado: hoy, las que salen de convertir una sugerencia de estudio
    (spec 6.4). Van en un grupo propio al final y NO dentro del último
    bloque: meterlas ahí las haría pasar por parte del plan original.

    Este grupo no es un detalle de presentación. Sin él, una sesión sin
    bloque no aparecería en ninguna parte del Roadmap, que es la pantalla
    donde uno va a ver el plan completo.
  */
  const sueltas = sessions
    .filter((s) => s.track_id === track.id && s.block_id === null)
    .sort((a, b) => a.orden - b.orden);

  return (
    <section className="bg-card space-y-4 rounded-lg border border-border p-4">
      <div className="space-y-3">
        <ChipTrack track={track} />
        <FilaProgreso progreso={progreso} />
      </div>

      {bloques.length === 0 && sueltas.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Este track todavía no tiene bloques cargados.
        </p>
      ) : (
        <div className="space-y-2">
          {bloques.map((block) => {
            const bp = blockProgress(block.id, sessions);
            const sesiones = sessions
              .filter((s) => s.block_id === block.id)
              .sort((a, b) => a.orden - b.orden);
            const terminado = bp.total > 0 && bp.hechas === bp.total;
            const fuentes = parsearFuentes(block.fuentes);

            return (
              <details
                key={block.id}
                className="group rounded-md border border-border"
              >
                <summary className="hover:bg-muted/50 focus-visible:ring-ring flex cursor-pointer list-none items-center gap-2 rounded-md p-3 focus-visible:ring-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                  <ChevronRight
                    aria-hidden="true"
                    className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-90"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {block.titulo}
                    </p>
                    {block.subtitulo && (
                      <p className="text-muted-foreground truncate text-xs">
                        {block.subtitulo}
                      </p>
                    )}
                  </div>
                  {terminado ? (
                    <Check
                      aria-label="Bloque terminado"
                      className="text-primary size-4 shrink-0"
                    />
                  ) : (
                    <span className="cifra text-muted-foreground shrink-0 text-xs">
                      {bp.pct}%
                    </span>
                  )}
                </summary>

                <div className="space-y-3 px-3 pb-3">
                  <BarraProgreso
                    pct={bp.pct}
                    etiqueta={`Progreso de ${block.titulo}`}
                  />

                  <ListaSesiones sesiones={sesiones} />

                  {fuentes.length > 0 && (
                    <div className="flex gap-2 border-t border-dashed border-border pt-3">
                      <Library
                        aria-hidden="true"
                        className="text-muted-foreground mt-0.5 size-4 shrink-0"
                      />
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {fuentes.map((f) => (
                          <EnlaceFuente key={f.u} href={f.u}>
                            {f.t}
                          </EnlaceFuente>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </details>
            );
          })}

          {sueltas.length > 0 && (
            <details className="group rounded-md border border-dashed border-border">
              <summary className="hover:bg-muted/50 focus-visible:ring-ring flex cursor-pointer list-none items-center gap-2 rounded-md p-3 focus-visible:ring-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  aria-hidden="true"
                  className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-90"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">Agregadas</p>
                  <p className="text-muted-foreground truncate text-xs">
                    Fuera del temario original
                  </p>
                </div>
                <span className="cifra text-muted-foreground shrink-0 text-xs">
                  {sueltas.length}
                </span>
              </summary>

              <div className="px-3 pb-3">
                <ListaSesiones sesiones={sueltas} />
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

function ListaSesiones({ sesiones }: { sesiones: StudySession[] }) {
  return (
    <ul className="space-y-2">
      {sesiones.map((sesion) => {
        const hecha = isComplete(sesion);
        return (
          <li key={sesion.id} className="flex gap-2">
            {hecha ? (
              <Check
                aria-label="Completada"
                className="text-primary mt-0.5 size-4 shrink-0"
              />
            ) : (
              <Circle
                aria-label="Pendiente"
                className="text-muted-foreground mt-0.5 size-4 shrink-0"
              />
            )}
            <div className="min-w-0">
              <p className="text-sm">{sesion.titulo}</p>
              {sesion.teoria_link && (
                <EnlaceFuente href={sesion.teoria_link}>fuente</EnlaceFuente>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function RoadmapView({
  tracks,
  blocks,
  sessions,
}: {
  tracks: Track[];
  blocks: Block[];
  sessions: StudySession[];
}) {
  const [seleccion, setSeleccion] = useState("todos");

  const vistas = [
    { valor: "todos", etiqueta: "Combinado", tracks },
    ...tracks.map((t) => ({
      valor: t.id,
      etiqueta: etiquetaCorta(t),
      tracks: [t],
    })),
  ];

  if (tracks.length === 0) {
    return (
      <p className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
        Todavía no hay tracks cargados.
      </p>
    );
  }

  return (
    <Tabs value={seleccion} onValueChange={setSeleccion}>
      <TabsList>
        {vistas.map((v) => (
          <TabsTrigger key={v.valor} value={v.valor}>
            {v.etiqueta}
          </TabsTrigger>
        ))}
      </TabsList>

      {vistas.map((v) => (
        <TabsContent key={v.valor} value={v.valor} className="space-y-4">
          {v.tracks.map((track) => (
            <TarjetaTrack
              key={track.id}
              track={track}
              blocks={blocks}
              sessions={sessions}
            />
          ))}
        </TabsContent>
      ))}
    </Tabs>
  );
}
