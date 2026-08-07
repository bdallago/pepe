import type { Metadata } from "next";

import { ArtefactosView } from "@/components/aprendizaje/artefactos-view";
import { getArtefactos, getTracks } from "@/lib/queries";

export const metadata: Metadata = { title: "Artefactos" };

export default async function ArtefactosPage() {
  const [tracks, artefactos] = await Promise.all([
    getTracks(),
    getArtefactos(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Artefactos de portfolio
        </h1>
        <p className="text-muted-foreground text-sm">
          Lo que queda hecho al terminar cada track. Tocá el estado para
          cambiarlo.
        </p>
      </div>

      <ArtefactosView tracks={tracks} artefactos={artefactos} />
    </div>
  );
}
