"use client";

import { useState } from "react";
import { Loader2, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

/**
 * Salir y volver a la misma pantalla de autorización.
 *
 * Existe por un caso concreto y molesto: el browser ya tenía sesión con
 * otra cuenta de Google, así que `/authorize` ni siquiera pregunta —usa
 * la que hay— y rebota. Sin esta salida, la única forma de probar con la
 * cuenta correcta sería ir a la app, buscar el menú de usuario y salir
 * desde ahí, perdiendo el flujo de OAuth en el camino.
 *
 * Después de cerrar la sesión recarga **esta misma URL**, con todos los
 * parámetros de OAuth intactos: la página ve que no hay usuario y manda
 * al login, que vuelve acá.
 */
export function CambiarDeCuenta() {
  const [saliendo, setSaliendo] = useState(false);

  async function salir() {
    setSaliendo(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.reload();
  }

  return (
    <Button
      onClick={salir}
      disabled={saliendo}
      variant="outline"
      size="sm"
      className="w-full"
    >
      {saliendo ? <Loader2 className="size-4 animate-spin" /> : <LogOut />}
      Salir y probar con otra cuenta
    </Button>
  );
}
