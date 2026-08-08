"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { guardarSettings } from "@/lib/actions/settings";

/**
 * El umbral del escaneo de zombies (spec 6.2).
 *
 * Es el único parámetro configurable de la app, y está acá porque el
 * spec lo pide explícitamente: "el umbral lo definís vos y me lo dejás
 * configurable". Vive en la base y no en una variable de entorno para
 * que cambiarlo no requiera redesplegar.
 */
export function SuscripcionesPanel({ dias }: { dias: number }) {
  const router = useRouter();
  const [valor, setValor] = useState(String(dias));
  const [guardando, setGuardando] = useState(false);

  const numero = Number(valor);
  const valido = Number.isInteger(numero) && numero >= 15 && numero <= 730;
  const cambio = numero !== dias;

  async function guardar() {
    setGuardando(true);
    const resultado = await guardarSettings({ diasInactividadZombie: numero });
    setGuardando(false);

    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }

    toast.success("Umbral guardado.");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Suscripciones sin uso</CardTitle>
        <CardDescription>
          Todos los días se revisa si algún gasto que se repite todos los meses
          sigue corriendo sobre algo que ya no tocás. Lo que encuentre va a la
          bandeja; nada se da de baja solo.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="dias-zombie">Días sin actividad para avisar</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="dias-zombie"
              type="number"
              min={15}
              max={730}
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              className="cifra w-28"
            />
            <Button onClick={guardar} disabled={!valido || !cambio || guardando}>
              {guardando ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="size-4" aria-hidden="true" />
              )}
              Guardar
            </Button>
          </div>
          {!valido && (
            <p className="text-destructive text-xs">
              Poné un número entero entre 15 y 730.
            </p>
          )}
        </div>

        <div className="text-muted-foreground space-y-2 text-xs">
          <p>
            Cuenta como actividad un movimiento, una lección o una entrada de
            bitácora. <strong>El propio cargo de la suscripción no cuenta</strong>
            : si contara, toda suscripción se mantendría viva sola y no se
            detectaría ninguna.
          </p>
          <p>
            Los gastos compartidos, que no cuelgan de ningún proyecto, se miden
            contra la actividad de toda la app.
          </p>
          <p>
            Noventa días son tres ciclos de una suscripción mensual. Con menos,
            un proyecto que descansa un par de meses empieza a dar falsos
            positivos.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
