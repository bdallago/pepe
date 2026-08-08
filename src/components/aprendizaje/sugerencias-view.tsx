"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Compass, Loader2, Plus, Quote } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { crearSesionDesdeSugerencia } from "@/lib/actions/study";
import type { Track } from "@/lib/supabase/database.types";

/**
 * Sugerencias de qué estudiar (spec 6.4).
 *
 * Es la única pantalla de la app donde la salida de un modelo se muestra
 * directamente, sin pasar por la bandeja. Se puede porque **no escribe
 * nada**: son sugerencias para leer y descartar. Lo único que toca la
 * base es el botón de convertir una en sesión, que aprieta Beno.
 *
 * El "ancla" va en pantalla al lado de cada sugerencia, y eso es
 * requisito del spec, no adorno. La regla es que cada sugerencia esté
 * apoyada en un dato concreto; mostrando el dato, una sugerencia genérica
 * se delata sola y se descarta de un vistazo. Escondiéndolo, habría que
 * creerle al modelo.
 *
 * Las sugerencias **no se guardan**: al recargar la pantalla no están.
 * Es a propósito. Lo que valga la pena se convierte en sesión; lo demás
 * era ruido y no tiene por qué acumularse.
 */

export interface Sugerencia {
  titulo: string;
  motivo: string;
  ancla: string;
  consigna: string;
}

export function SugerenciasView({
  tracks,
  hayModelo,
}: {
  tracks: Track[];
  hayModelo: boolean;
}) {
  const router = useRouter();
  const [sugerencias, setSugerencias] = useState<Sugerencia[] | null>(null);
  const [pensando, setPensando] = useState(false);
  const [trackElegido, setTrackElegido] = useState(tracks[0]?.id ?? "");
  const [convirtiendo, setConvirtiendo] = useState<number | null>(null);
  const [convertidas, setConvertidas] = useState<Set<number>>(new Set());

  async function pedir() {
    setPensando(true);
    setSugerencias(null);
    try {
      const respuesta = await fetch("/api/aprendizaje/sugerir", {
        method: "POST",
      });
      const resultado = await respuesta.json();

      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }

      setSugerencias(resultado.data);
      setConvertidas(new Set());
    } catch {
      toast.error("No pude hablar con el modelo. Probá de nuevo.");
    } finally {
      setPensando(false);
    }
  }

  async function convertir(indice: number, sugerencia: Sugerencia) {
    if (!trackElegido) {
      toast.error("Elegí a qué track agregarla.");
      return;
    }

    setConvirtiendo(indice);
    const resultado = await crearSesionDesdeSugerencia(trackElegido, {
      titulo: sugerencia.titulo,
      consigna: sugerencia.consigna,
      teoriaTexto: sugerencia.motivo,
    });
    setConvirtiendo(null);

    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }

    setConvertidas((previas) => new Set(previas).add(indice));
    toast.success("Quedó como última sesión del track.");
    router.refresh();
  }

  if (!hayModelo) {
    return (
      <p className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
        No hay modelo configurado, así que esta pantalla no tiene nada que
        proponer. Todo el resto de Aprendizaje anda igual.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={pedir} disabled={pensando}>
          {pensando ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Compass className="size-4" aria-hidden="true" />
          )}
          {pensando ? "Mirando tus datos…" : "Sugerime qué estudiar"}
        </Button>

        {tracks.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">Agregar a</span>
            <Select value={trackElegido} onValueChange={setTrackElegido}>
              <SelectTrigger className="w-48" aria-label="Track de destino">
                <SelectValue placeholder="Elegí un track" />
              </SelectTrigger>
              <SelectContent>
                {tracks.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {pensando && (
        <p className="text-muted-foreground text-sm" aria-live="polite">
          Está leyendo tus proyectos con actividad, en qué se te fue la plata,
          tus últimas lecciones y cómo vienen los tracks. Tarda un rato.
        </p>
      )}

      {sugerencias !== null && sugerencias.length === 0 && (
        <p className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
          No encontró nada que apoyar en tus datos. Es la respuesta correcta
          cuando no hay actividad reciente: una sugerencia sin un dato atrás
          serviría para cualquiera y por eso no te sirve a vos.
        </p>
      )}

      {sugerencias !== null && sugerencias.length > 0 && (
        <ul className="space-y-4">
          {sugerencias.map((s, i) => (
            <li key={i} className="bg-card space-y-3 rounded-lg border p-4">
              <p className="text-sm font-semibold">{s.titulo}</p>
              <p className="text-sm whitespace-pre-line">{s.motivo}</p>

              {/* El dato que la justifica, separado y a la vista. */}
              <p className="text-muted-foreground border-l-2 pl-3 text-xs">
                <Quote
                  className="mr-1 inline size-3 align-[-1px]"
                  aria-hidden="true"
                />
                {s.ancla}
              </p>

              <div className="space-y-1">
                <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  Para aplicarlo
                </p>
                <p className="text-sm">{s.consigna}</p>
              </div>

              {tracks.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => convertir(i, s)}
                  disabled={convirtiendo !== null || convertidas.has(i)}
                >
                  {convirtiendo === i ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus className="size-4" aria-hidden="true" />
                  )}
                  {convertidas.has(i) ? "Ya es una sesión" : "Convertir en sesión"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {sugerencias === null && !pensando && (
        <p className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
          Nada todavía. Cuando le pidas, mira lo que venís haciendo —proyectos
          con movimiento, dónde se te va la plata, tus últimas lecciones y cómo
          vienen los tracks— y propone qué estudiar, con el dato que lo
          justifica al lado.
        </p>
      )}
    </div>
  );
}
