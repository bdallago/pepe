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
 * Abre la caja desde cualquier pantalla con Ctrl/Cmd + K.
 *
 * No invasivo a propósito: no ocupa lugar hasta que lo pedís, `esc` lo
 * cierra y la pantalla de atrás queda visible.
 */
export function AtajoGlobal() {
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        // Sin esto, con el foco dentro de un campo de texto el atajo
        // escribe una "k" además de abrir el diálogo.
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
