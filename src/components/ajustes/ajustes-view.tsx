"use client";

import { CategoriasPanel } from "@/components/ajustes/categorias-panel";
import { CotizacionPanel } from "@/components/ajustes/cotizacion-panel";
import { ProyectosPanel } from "@/components/ajustes/proyectos-panel";
import { RespaldoPanel } from "@/components/ajustes/respaldo-panel";
import { SuscripcionesPanel } from "@/components/ajustes/suscripciones-panel";
import { TracksPanel } from "@/components/ajustes/tracks-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { FxRate, Track } from "@/lib/supabase/database.types";

export function AjustesView({
  ultimaTasa,
  tracks,
  diasInactividadZombie,
}: {
  ultimaTasa: FxRate | null;
  tracks: Track[];
  diasInactividadZombie: number;
}) {
  return (
    <Tabs defaultValue="proyectos" className="space-y-4">
      <TabsList>
        <TabsTrigger value="proyectos">Proyectos</TabsTrigger>
        <TabsTrigger value="categorias">Categorías</TabsTrigger>
        <TabsTrigger value="cotizacion">Cotización</TabsTrigger>
        <TabsTrigger value="tracks">Tracks</TabsTrigger>
        <TabsTrigger value="suscripciones">Suscripciones</TabsTrigger>
        <TabsTrigger value="respaldo">Respaldo</TabsTrigger>
      </TabsList>

      <TabsContent value="proyectos">
        <ProyectosPanel />
      </TabsContent>

      <TabsContent value="categorias">
        <CategoriasPanel />
      </TabsContent>

      <TabsContent value="cotizacion">
        <CotizacionPanel ultimaTasa={ultimaTasa} />
      </TabsContent>

      <TabsContent value="tracks">
        <TracksPanel tracks={tracks} />
      </TabsContent>

      <TabsContent value="suscripciones">
        <SuscripcionesPanel dias={diasInactividadZombie} />
      </TabsContent>

      <TabsContent value="respaldo">
        <RespaldoPanel />
      </TabsContent>
    </Tabs>
  );
}
