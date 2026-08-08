import type { Metadata } from "next";

import { LeccionesView } from "@/components/aprendizaje/lecciones-view";
import { hayModeloConfigurado } from "@/lib/llm";
import { createClient } from "@/lib/supabase/server";
import type { Lesson } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "Lecciones" };

/**
 * Las archivadas se filtran acá: la lista normal muestra solo lo vigente.
 * La búsqueda, en cambio, sí las trae (lo resuelve el endpoint), así que un
 * proyecto cerrado no ensucia la pantalla pero su conocimiento sigue
 * apareciendo cuando lo buscás.
 */
async function getLecciones(): Promise<Lesson[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("lessons")
    .select("*")
    .is("archivado_en", null)
    .order("fecha", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1000);

  return data ?? [];
}

export default async function LeccionesPage() {
  const lecciones = await getLecciones();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Lecciones</h1>
        <p className="text-muted-foreground text-sm">
          Lo que te dejó cada proyecto. Preguntá en tus palabras y la búsqueda
          trae lo parecido, incluso lo archivado.
        </p>
      </div>

      <LeccionesView lecciones={lecciones} hayModelo={hayModeloConfigurado()} />
    </div>
  );
}
