"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Lesson } from "@/lib/supabase/database.types";

/**
 * Buscador semántico de lecciones.
 *
 * Escribís en lenguaje natural ("qué aprendí sobre cobrarle a clientes
 * chicos") y el backend devuelve las lecciones más parecidas. Dos cosas del
 * contrato con `POST /api/lecciones/buscar` mandan sobre esta UI:
 *
 * 1. **La primera búsqueda es lenta.** El servidor carga un modelo de
 *    embeddings de 266 MB en frío. Por eso el estado de carga cambia de
 *    texto a los pocos segundos: si dijera siempre "Buscando…" parecería
 *    colgado, y no lo está.
 * 2. **Si el modelo falla, igual hay resultados**, pero solo por texto y
 *    con `similitud` en null. Eso **no** es un error: la búsqueda funcionó.
 *    Se avisa en gris, sin `toast.error`, para que se entienda por qué el
 *    orden puede ser más literal de lo esperado.
 */

/** Una fila de `lessons` más los puntajes que agrega la búsqueda. */
export type Resultado = Pick<
  Lesson,
  | "id"
  | "project_id"
  | "fecha"
  | "titulo"
  | "contenido"
  | "categoria"
  | "origen"
  | "archivado_en"
> & {
  puntaje: number;
  /** Null cuando el modelo de embeddings no estuvo disponible. */
  similitud: number | null;
  rank_texto: number | null;
};

/** A partir de acá el estado de carga admite que puede demorar. */
const MS_HASTA_AVISO = 2500;

/** Forma de `ActionResult<Resultado[]>` tal como llega por HTTP. */
type RespuestaBusqueda =
  | { ok: true; data: Resultado[] }
  | { ok: false; error: string };

function esRespuesta(valor: unknown): valor is RespuestaBusqueda {
  if (typeof valor !== "object" || valor === null) return false;
  const { ok, data, error } = valor as Record<string, unknown>;
  if (ok === true) return Array.isArray(data);
  if (ok === false) return typeof error === "string";
  return false;
}

export function BuscadorLecciones({
  onResultados,
}: {
  /** null = no hay búsqueda activa y se muestra la lista normal. */
  onResultados: (resultados: Resultado[] | null, consulta: string) => void;
}) {
  const [consulta, setConsulta] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [demorado, setDemorado] = useState(false);
  const [soloTexto, setSoloTexto] = useState(false);
  const [busquedaActiva, setBusquedaActiva] = useState(false);

  // El aviso de demora se arma con un timer, así que hay que limpiarlo si
  // el componente se va antes de que dispare.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function limpiar() {
    setConsulta("");
    setSoloTexto(false);
    setBusquedaActiva(false);
    onResultados(null, "");
  }

  async function buscar(evento: React.FormEvent) {
    evento.preventDefault();
    const texto = consulta.trim();
    if (!texto) {
      toast.error("Escribí qué estás buscando.");
      return;
    }

    setBuscando(true);
    setDemorado(false);
    setSoloTexto(false);
    timer.current = setTimeout(() => setDemorado(true), MS_HASTA_AVISO);

    try {
      const respuesta = await fetch("/api/lecciones/buscar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consulta: texto }),
      });

      const cuerpo: unknown = await respuesta.json();
      if (!esRespuesta(cuerpo)) {
        toast.error("La búsqueda devolvió una respuesta inesperada.");
        return;
      }
      if (!cuerpo.ok) {
        toast.error(cuerpo.error);
        return;
      }

      // Sin similitud en ninguna fila: el modelo no estuvo y el ranking
      // salió solo del texto. Con la lista vacía no se puede saber, así
      // que en ese caso no se afirma nada.
      setSoloTexto(
        cuerpo.data.length > 0 && cuerpo.data.every((r) => r.similitud === null),
      );
      setBusquedaActiva(true);
      onResultados(cuerpo.data, texto);
    } catch {
      toast.error("No se pudo consultar la búsqueda. Probá de nuevo.");
    } finally {
      if (timer.current) clearTimeout(timer.current);
      setBuscando(false);
      setDemorado(false);
    }
  }

  return (
    <div className="space-y-2">
      <form onSubmit={buscar} className="flex flex-wrap gap-2">
        <div className="min-w-56 flex-1">
          <label htmlFor="buscador-lecciones" className="sr-only">
            Buscar en las lecciones
          </label>
          <Input
            id="buscador-lecciones"
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            maxLength={300}
            placeholder="Qué aprendí sobre cobrarle a clientes chicos"
            autoComplete="off"
          />
        </div>

        <Button type="submit" disabled={buscando}>
          {buscando ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="size-4" aria-hidden="true" />
          )}
          Buscar
        </Button>

        {busquedaActiva && !buscando && (
          <Button type="button" variant="ghost" onClick={limpiar}>
            <X className="size-4" aria-hidden="true" />
            Limpiar
          </Button>
        )}
      </form>

      <p className="text-muted-foreground min-h-4 text-xs" aria-live="polite">
        {buscando
          ? demorado
            ? "Buscando… la primera búsqueda carga el modelo de lenguaje y puede tardar unos segundos. Las siguientes son inmediatas."
            : "Buscando…"
          : soloTexto
            ? "Ordenado solo por coincidencia de texto: el modelo de lenguaje no estuvo disponible."
            : ""}
      </p>
    </div>
  );
}
