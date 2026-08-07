"use client";

import { CategoriasPanel } from "@/components/ajustes/categorias-panel";
import { CotizacionPanel } from "@/components/ajustes/cotizacion-panel";
import { ProyectosPanel } from "@/components/ajustes/proyectos-panel";
import { TracksPanel } from "@/components/ajustes/tracks-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { FxRate, Track } from "@/lib/supabase/database.types";

export function AjustesView({
  ultimaTasa,
  tracks,
}: {
  ultimaTasa: FxRate | null;
  tracks: Track[];
}) {
  return (
    <Tabs defaultValue="proyectos" className="space-y-4">
      <TabsList>
        <TabsTrigger value="proyectos">Proyectos</TabsTrigger>
        <TabsTrigger value="categorias">Categorías</TabsTrigger>
        <TabsTrigger value="cotizacion">Cotización</TabsTrigger>
        <TabsTrigger value="tracks">Tracks</TabsTrigger>
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
    </Tabs>
  );
}
