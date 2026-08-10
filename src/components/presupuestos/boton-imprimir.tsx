"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * "Guardar como PDF" es Ctrl+P.
 *
 * Todo el PDF de la app es `window.print()` más la hoja de impresión de
 * `globals.css`; no hay ninguna dependencia de PDF en el proyecto y la
 * decisión está explicada en `presupuesto-documento.tsx`.
 *
 * Lleva `no-imprimir` porque el botón no puede salir en el papel.
 *
 * `titulo` fija el `<title>` del documento, que es de dónde saca el
 * navegador el nombre del archivo sugerido. No es cosmética: sin eso el
 * PDF se guarda con el nombre de la ruta.
 */
export function BotonImprimir({
  titulo,
  children = "Guardar como PDF",
}: {
  titulo?: string;
  children?: React.ReactNode;
}) {
  function imprimir() {
    const anterior = document.title;
    if (titulo) document.title = titulo;

    window.print();

    // Se restaura después del diálogo. En Chrome `print()` es bloqueante,
    // así que alcanza con ponerlo acá; el `setTimeout` es para los que no
    // lo son y devuelven antes de que el diálogo se cierre.
    if (titulo) window.setTimeout(() => (document.title = anterior), 0);
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={imprimir}
      className="no-imprimir"
    >
      <Printer className="size-4" />
      {children}
    </Button>
  );
}
