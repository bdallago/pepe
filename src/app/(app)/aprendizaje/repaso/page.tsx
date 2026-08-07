import type { Metadata } from "next";

import { RepasoView } from "@/components/aprendizaje/repaso-view";
import { completedSessions } from "@/lib/aprendizaje";
import { getSessions } from "@/lib/queries";

export const metadata: Metadata = { title: "Repaso" };

/**
 * Repaso.
 *
 * El servidor solo trae el temario: las preguntas NO se generan acá.
 * `generateQuiz` usa `Math.random()`, así que armarlas durante el render
 * daría un HTML distinto al del cliente y rompería la hidratación. La
 * generación vive en un handler de evento dentro de `RepasoView`.
 */
export default async function RepasoPage() {
  const sessions = await getSessions();
  const completadas = completedSessions(sessions);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Repaso</h1>
        <p className="text-muted-foreground text-sm">
          Preguntas armadas con los temas que ya completaste, empezando por los
          que viste hace más tiempo.
        </p>
      </div>

      <RepasoView completadas={completadas} sessions={sessions} />
    </div>
  );
}
