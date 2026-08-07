import type { Metadata } from "next";

import { SemanaView } from "@/components/aprendizaje/semana-view";
import { todayISO } from "@/lib/dates";
import { getBlocks, getSessions, getTracks } from "@/lib/queries";

export const metadata: Metadata = { title: "Semana" };

export default async function AprendizajeSemanaPage() {
  const [tracks, blocks, sessions] = await Promise.all([
    getTracks(),
    getBlocks(),
    getSessions(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Semana</h1>
        <p className="text-muted-foreground text-sm">
          Cómo caen las próximas sesiones de cada track sobre los días que les
          tocan.
        </p>
      </div>

      <SemanaView
        fecha={todayISO()}
        tracks={tracks}
        blocks={blocks}
        sessions={sessions}
      />
    </div>
  );
}
