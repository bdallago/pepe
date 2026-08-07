import type { Metadata } from "next";

import { RoadmapView } from "@/components/aprendizaje/roadmap-view";
import { getBlocks, getSessions, getTracks } from "@/lib/queries";

export const metadata: Metadata = { title: "Roadmap" };

export default async function RoadmapPage() {
  const [tracks, blocks, sessions] = await Promise.all([
    getTracks(),
    getBlocks(),
    getSessions(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Roadmap</h1>
        <p className="text-muted-foreground text-sm">
          El temario completo, bloque por bloque. Abrí un bloque para ver sus
          sesiones y la bibliografía.
        </p>
      </div>

      <RoadmapView tracks={tracks} blocks={blocks} sessions={sessions} />
    </div>
  );
}
