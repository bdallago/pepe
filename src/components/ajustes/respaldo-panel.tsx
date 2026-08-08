"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Respaldo completo (spec 8): un botón, un archivo.
 *
 * El tier gratuito de Supabase no tiene backups automáticos, así que
 * este archivo es la única red. La pantalla lo dice sin rodeos: no es un
 * "exportar datos" decorativo, es lo que separa un incidente de una
 * pérdida.
 *
 * La descarga se arma acá con un blob en vez de un `<a href>` directo
 * para poder mostrar el error: con un enlace a pelo, si el endpoint
 * falla el browser baja un archivo con el JSON del error adentro y uno
 * se entera meses después, cuando lo necesita.
 */
export function RespaldoPanel() {
  const [bajando, setBajando] = useState(false);

  async function descargar() {
    setBajando(true);
    try {
      const respuesta = await fetch("/api/respaldo");

      if (!respuesta.ok) {
        const detalle = await respuesta.json().catch(() => null);
        toast.error(detalle?.error ?? "No se pudo generar el respaldo.");
        return;
      }

      const texto = await respuesta.text();
      const datos = JSON.parse(texto) as { conteos: Record<string, number> };

      const url = URL.createObjectURL(
        new Blob([texto], { type: "application/json" }),
      );
      const enlace = document.createElement("a");
      enlace.href = url;
      enlace.download =
        respuesta.headers
          .get("content-disposition")
          ?.match(/filename="(.+)"/)?.[1] ?? "pepe-respaldo.json";
      document.body.appendChild(enlace);
      enlace.click();
      document.body.removeChild(enlace);
      URL.revokeObjectURL(url);

      const total = Object.values(datos.conteos).reduce((a, b) => a + b, 0);
      toast.success(`Respaldo descargado: ${total} filas.`);
    } catch {
      toast.error("No se pudo generar el respaldo.");
    } finally {
      setBajando(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Respaldo</CardTitle>
        <CardDescription>
          Todo lo que hay en la app, en un archivo: proyectos, movimientos,
          lecciones, tracks, sesiones, artefactos, bitácora, retros y
          cotizaciones.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <Button onClick={descargar} disabled={bajando}>
          {bajando ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="size-4" aria-hidden="true" />
          )}
          {bajando ? "Armando el archivo…" : "Descargar respaldo"}
        </Button>

        <div className="text-muted-foreground space-y-2 text-xs">
          <p>
            <strong>
              El plan gratuito de Supabase no hace backups automáticos.
            </strong>{" "}
            Este archivo es la única copia que vas a tener si algo se pierde.
            Bajalo cada tanto y guardalo fuera de la máquina.
          </p>
          <p>
            Incluye <strong>lo archivado</strong>: es lo único de la app que no
            filtra por lo que está a la vista. Un respaldo incompleto no es un
            respaldo.
          </p>
          <p>
            No incluye los embeddings de las lecciones, que se regeneran solos y
            multiplicarían por diez el peso del archivo. Tampoco los
            comprobantes, que viven en el storage de Supabase.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
