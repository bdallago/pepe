"use client";

import { useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";

import type { SesionCompletada } from "@/lib/aprendizaje";
import { generateQuiz, type PreguntaQuiz, type SesionDeQuiz } from "@/lib/quiz";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Modo repaso.
 *
 * Máquina de estados de dos posiciones, igual que el original: `idle` (la
 * portada con el botón) y `ready` (las preguntas en pantalla). No hay un
 * tercer estado de "terminado": el resultado aparece solo cuando están todas
 * contestadas, así se puede seguir leyendo las explicaciones.
 *
 * ⚠️ `generateQuiz` baraja con `Math.random()`. Se llama únicamente desde
 * `empezar()`, que es un handler de evento del cliente. Generarlo durante el
 * render —o en el Server Component— daría markup distinto en cada lado y
 * rompería la hidratación.
 *
 * Del original se descarta el CSS entero. Acierto y error usan los tokens
 * semánticos de la app (`--positivo` y `--destructive`), no el par de marca
 * de los gráficos: ese es para plata, no para corrección.
 */

type Estado = "idle" | "ready";

export function RepasoView({
  completadas,
  sessions,
}: {
  completadas: SesionCompletada[];
  sessions: SesionDeQuiz[];
}) {
  const [estado, setEstado] = useState<Estado>("idle");
  const [preguntas, setPreguntas] = useState<PreguntaQuiz[]>([]);
  /** Índice de pregunta → índice de la opción elegida. */
  const [respuestas, setRespuestas] = useState<Record<number, number>>({});

  function empezar() {
    if (completadas.length === 0) return;
    setRespuestas({});
    setPreguntas(generateQuiz(completadas, sessions, 5));
    setEstado("ready");
  }

  const contestadas = Object.keys(respuestas).length;
  const aciertos = preguntas.reduce(
    (n, pregunta, i) => n + (respuestas[i] === pregunta.respuesta ? 1 : 0),
    0,
  );

  if (estado === "idle") {
    return (
      <Card>
        <CardContent className="space-y-3">
          <p className="text-sm">
            5 preguntas sobre temas que ya completaste, priorizando lo que
            viste hace más tiempo (repaso espaciado). Se arman en tu
            dispositivo: sin IA, sin API y sin red.
          </p>

          <p className="text-muted-foreground text-sm">
            <span className="cifra">{completadas.length}</span>{" "}
            {completadas.length === 1
              ? "sesión completada disponible"
              : "sesiones completadas disponibles"}
            .
          </p>

          <Button onClick={empezar} disabled={completadas.length === 0}>
            Empezar quiz
          </Button>

          {completadas.length === 0 && (
            <p className="text-muted-foreground text-sm">
              Completá al menos una sesión —teoría y aplicación— para habilitar
              el repaso.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  if (preguntas.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm">
            Todavía no se pudieron armar preguntas: hacen falta más temas
            completados para tener opciones plausibles.
          </p>
          <Button variant="outline" onClick={() => setEstado("idle")}>
            Volver
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {preguntas.map((pregunta, i) => {
        const elegida = respuestas[i];
        const cerrada = elegida !== undefined;

        return (
          <Card key={`${i}-${pregunta.pregunta}`}>
            <CardContent className="space-y-3">
              <p className="text-sm font-semibold whitespace-pre-line">
                <span className="cifra">{i + 1}.</span> {pregunta.pregunta}
              </p>

              <ul className="space-y-2">
                {pregunta.opciones.map((opcion, oi) => {
                  const esCorrecta = cerrada && oi === pregunta.respuesta;
                  const esErrada =
                    cerrada && oi === elegida && oi !== pregunta.respuesta;

                  return (
                    <li key={opcion}>
                      <button
                        type="button"
                        disabled={cerrada}
                        onClick={() =>
                          setRespuestas((previas) => ({ ...previas, [i]: oi }))
                        }
                        className={cn(
                          "flex w-full items-start gap-2 rounded-md border p-3 text-left text-sm transition-colors",
                          !cerrada && "hover:bg-accent",
                          cerrada && "cursor-default disabled:opacity-100",
                          cerrada && !esCorrecta && !esErrada && "opacity-60",
                          esCorrecta && "border-positivo bg-positivo/10",
                          esErrada && "border-destructive bg-destructive/10",
                        )}
                      >
                        {esCorrecta && (
                          <Check
                            aria-hidden="true"
                            className="text-positivo mt-0.5 size-4 shrink-0"
                          />
                        )}
                        {esErrada && (
                          <X
                            aria-hidden="true"
                            className="text-destructive mt-0.5 size-4 shrink-0"
                          />
                        )}
                        <span className="min-w-0 flex-1">{opcion}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {cerrada && pregunta.explicacion && (
                <p className="text-muted-foreground border-l-2 pl-3 text-sm">
                  {pregunta.explicacion}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}

      {contestadas === preguntas.length && (
        <Card>
          <CardContent className="space-y-2 text-center">
            <p className="cifra text-3xl font-bold">
              {aciertos}/{preguntas.length}
            </p>
            <p className="text-muted-foreground text-sm">
              Resultado del repaso
            </p>
            <Button variant="outline" onClick={empezar}>
              <RotateCcw className="size-4" />
              Otra ronda
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
