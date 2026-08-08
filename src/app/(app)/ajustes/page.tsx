import type { Metadata } from "next";

import { AjustesView } from "@/components/ajustes/ajustes-view";
import { getUltimaTasa } from "@/lib/fx-server";
import { getDiasInactividadZombie, getTracks } from "@/lib/queries";

export const metadata: Metadata = { title: "Ajustes" };

export default async function AjustesPage() {
  const [ultimaTasa, tracks, diasInactividadZombie] = await Promise.all([
    getUltimaTasa(),
    getTracks(),
    getDiasInactividadZombie(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ajustes</h1>
        <p className="text-muted-foreground text-sm">
          Proyectos, categorías, cotización, tracks de estudio y suscripciones.
        </p>
      </div>

      <AjustesView
        ultimaTasa={ultimaTasa}
        tracks={tracks}
        diasInactividadZombie={diasInactividadZombie}
      />
    </div>
  );
}
