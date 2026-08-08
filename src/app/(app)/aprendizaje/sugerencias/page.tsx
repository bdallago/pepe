import type { Metadata } from "next";

import { SugerenciasView } from "@/components/aprendizaje/sugerencias-view";
import { hayModeloConfigurado } from "@/lib/llm";
import { getTracks } from "@/lib/queries";

export const metadata: Metadata = { title: "Sugerencias" };

export default async function SugerenciasPage() {
  const tracks = await getTracks();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sugerencias</h1>
        <p className="text-muted-foreground text-sm">
          Qué te conviene estudiar según lo que venís trabajando. Cada
          sugerencia viene con el dato tuyo que la justifica.
        </p>
      </div>

      <SugerenciasView tracks={tracks} hayModelo={hayModeloConfigurado()} />
    </div>
  );
}
