import type { Metadata } from "next";

import { BitacoraView } from "@/components/bitacora/bitacora-view";
import { getBitacora, getTracks } from "@/lib/queries";

export const metadata: Metadata = { title: "Bitácora" };

/**
 * Bitácora.
 *
 * Los proyectos no se traen acá: ya viajan por `AppDataProvider`, que es de
 * donde los toma el selector del formulario. Traerlos de nuevo sería una
 * consulta redundante en cada navegación.
 */
export default async function BitacoraPage() {
  const [entradas, tracks] = await Promise.all([getBitacora(), getTracks()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bitácora</h1>
        <p className="text-muted-foreground text-sm">
          Lo que fuiste aprendiendo, día por día. Sacar una entrada la archiva:
          desaparece de la lista pero el registro queda.
        </p>
      </div>

      <BitacoraView entradas={entradas} tracks={tracks} />
    </div>
  );
}
