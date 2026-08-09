"use client";

import { useEffect, useState } from "react";

import { CajaAgente } from "@/components/agentes/caja-agente";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Abre la caja desde cualquier pantalla con Ctrl/Cmd + J.
 *
 * No invasivo a propósito: no ocupa lugar hasta que lo pedís, `esc` lo
 * cierra y la pantalla de atrás queda visible.
 *
 * **J y no K.** `Ctrl+K` ya es la carga rápida de movimientos
 * (`QuickAddDialog`, montado por `AppShell` en las pantallas de Finanzas,
 * y con su `<kbd>Ctrl K</kbd>` a la vista en el botón "Cargar"). Con las
 * dos en la misma tecla, en esas cuatro pantallas se abrían los dos
 * diálogos apilados.
 *
 * La otra salida era montar esto solo fuera de Finanzas, pero eso hace
 * que la misma tecla haga cosas distintas según dónde estés parado. Una
 * tecla propia mantiene el atajo verdaderamente global, que es lo que se
 * pidió, y deja intacta la costumbre ya formada con `Ctrl+K`.
 */
export function AtajoGlobal() {
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "j" && (e.metaKey || e.ctrlKey)) {
        // Sin esto, con el foco dentro de un campo de texto el atajo
        // escribe una "j" además de abrir el diálogo.
        e.preventDefault();
        setAbierto((v) => !v);
      }
    }

    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, []);

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>¿Qué querés hacer?</DialogTitle>
        </DialogHeader>
        <CajaAgente autoFocus onCerrar={() => setAbierto(false)} />
      </DialogContent>
    </Dialog>
  );
}
