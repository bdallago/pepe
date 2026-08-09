import { CajaAgente } from "@/components/agentes/caja-agente";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { getMovimientos } from "@/lib/queries";

export default async function DashboardPage() {
  const movements = await getMovimientos();

  return (
    <div className="space-y-6">
      {/*
        La caja va arriba de todo y antes del balance a propósito: es la
        puerta a las seis cosas que la app sabe hacer sin que haya que
        acordarse en qué pantalla vive el botón.
      */}
      <section aria-label="Pedile algo a Pepe">
        <CajaAgente />
      </section>

      <DashboardView movements={movements} />
    </div>
  );
}
