import type { Metadata } from "next";

import { AjustesView } from "@/components/ajustes/ajustes-view";
import { getUltimaTasa } from "@/lib/fx-server";
import {
  getAjustesPresupuesto,
  getAvisoTarifa,
} from "@/lib/presupuestos-server";
import { getDiasInactividadZombie, getTracks } from "@/lib/queries";

export const metadata: Metadata = { title: "Ajustes" };

export default async function AjustesPage() {
  const [ultimaTasa, tracks, diasInactividadZombie, ajustesPresupuesto] =
    await Promise.all([
      getUltimaTasa(),
      getTracks(),
      getDiasInactividadZombie(),
      getAjustesPresupuesto(),
    ]);

  // Va después y no en el `Promise.all`: el aviso necesita la tarifa y los
  // multiplicadores para comparar, y pedirlos dos veces sería una consulta
  // de más por nada.
  const avisoTarifa = await getAvisoTarifa(ajustesPresupuesto);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ajustes</h1>
        <p className="text-muted-foreground text-sm">
          Proyectos, categorías, cotización, tarifa, tracks de estudio y
          suscripciones.
        </p>
      </div>

      <AjustesView
        ultimaTasa={ultimaTasa}
        tracks={tracks}
        diasInactividadZombie={diasInactividadZombie}
        ajustesPresupuesto={ajustesPresupuesto}
        avisoTarifa={avisoTarifa}
      />
    </div>
  );
}
