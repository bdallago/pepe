"use client";

import { useState } from "react";
import { Archive, Sparkles } from "lucide-react";

import {
  BuscadorLecciones,
  type Resultado,
} from "@/components/aprendizaje/buscador-lecciones";
import { GenerarLecciones } from "@/components/aprendizaje/generar-lecciones";
import { useAppData } from "@/components/providers/app-data-provider";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/dates";
import type { CategoriaLeccion, Lesson } from "@/lib/supabase/database.types";

/**
 * Lecciones aprendidas, con buscador semántico arriba.
 *
 * Dos reglas del spec se ven en pantalla:
 *
 * - Las **archivadas** no salen en la lista normal (la page ya las filtra)
 *   pero **sí** pueden salir en los resultados de búsqueda: un proyecto
 *   cerrado no ensucia las pantallas, pero lo que se aprendió ahí no se
 *   pierde. Cuando aparecen, van marcadas.
 * - Las de origen `generada` son **hipótesis propuestas por un modelo**, no
 *   experiencia vivida. Se distinguen siempre: borde punteado, marca propia
 *   y la aclaración escrita.
 */

const CATEGORIA_LABEL: Record<CategoriaLeccion, string> = {
  tecnica: "Técnica",
  producto: "Producto",
  comercial: "Comercial",
  proceso: "Proceso",
  personal: "Personal",
};

/** Lo mínimo que necesita la tarjeta: sirve para una fila o un resultado. */
type LeccionMostrable = Pick<
  Lesson,
  | "id"
  | "project_id"
  | "fecha"
  | "titulo"
  | "contenido"
  | "categoria"
  | "origen"
  | "archivado_en"
>;

function TarjetaLeccion({
  leccion,
  nombreProyecto,
  similitud,
}: {
  leccion: LeccionMostrable;
  nombreProyecto: string;
  /** Solo en resultados de búsqueda; null si vino solo por texto. */
  similitud?: number | null;
}) {
  const generada = leccion.origen === "generada";
  const archivada = leccion.archivado_en !== null;

  return (
    <li
      className={
        generada
          ? "bg-card space-y-2 rounded-lg border border-dashed border-border p-4"
          : "bg-card space-y-2 rounded-lg border border-border p-4"
      }
    >
      <div className="flex flex-wrap items-start gap-2">
        <p className="min-w-0 flex-1 text-sm font-semibold">{leccion.titulo}</p>

        {generada && (
          <Badge variant="outline" className="text-muted-foreground">
            <Sparkles aria-hidden="true" />
            Hipótesis generada
          </Badge>
        )}
        {archivada && (
          <Badge variant="ghost" className="text-muted-foreground">
            <Archive aria-hidden="true" />
            Archivada
          </Badge>
        )}
        <Badge variant="secondary">{CATEGORIA_LABEL[leccion.categoria]}</Badge>
      </div>

      <p className="text-sm whitespace-pre-line">{leccion.contenido}</p>

      {generada && (
        <p className="text-muted-foreground text-xs">
          Propuesta por un modelo a partir de tus datos. No es experiencia
          vivida: revisala antes de darla por buena.
        </p>
      )}

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span>{nombreProyecto}</span>
        <span className="cifra">{formatDate(leccion.fecha)}</span>
        {typeof similitud === "number" && (
          <span className="cifra">{Math.round(similitud * 100)}% parecido</span>
        )}
      </div>
    </li>
  );
}

export function LeccionesView({
  lecciones,
  hayModelo,
}: {
  lecciones: Lesson[];
  hayModelo: boolean;
}) {
  const { projects } = useAppData();
  const [resultados, setResultados] = useState<Resultado[] | null>(null);
  const [consulta, setConsulta] = useState("");

  const nombrePorProyecto = new Map(projects.map((p) => [p.id, p.nombre]));
  const nombreDe = (id: string) =>
    nombrePorProyecto.get(id) ?? "Proyecto archivado";

  return (
    <div className="space-y-6">
      <BuscadorLecciones
        onResultados={(nuevos, texto) => {
          setResultados(nuevos);
          setConsulta(texto);
        }}
      />

      {hayModelo && (
        <div className="flex justify-end">
          <GenerarLecciones />
        </div>
      )}

      {resultados !== null ? (
        resultados.length === 0 ? (
          <p className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
            Ninguna lección coincide con «{consulta}». Probá con otras palabras:
            la búsqueda entiende el sentido, no hace falta acertar el término
            exacto.
          </p>
        ) : (
          <section className="space-y-3">
            <h2 className="text-muted-foreground text-xs">
              <span className="cifra">{resultados.length}</span>{" "}
              {resultados.length === 1 ? "lección" : "lecciones"} para «
              {consulta}». Incluye archivadas.
            </h2>
            <ul className="space-y-3">
              {resultados.map((r) => (
                <TarjetaLeccion
                  key={r.id}
                  leccion={r}
                  nombreProyecto={nombreDe(r.project_id)}
                  similitud={r.similitud}
                />
              ))}
            </ul>
          </section>
        )
      ) : lecciones.length === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
          Todavía no hay lecciones. Una lección es lo que te dejó un proyecto y
          querés tener a mano la próxima vez: qué salió mal, qué cobrar
          distinto, qué no volver a prometer.
        </p>
      ) : (
        <ul className="space-y-3">
          {lecciones.map((leccion) => (
            <TarjetaLeccion
              key={leccion.id}
              leccion={leccion}
              nombreProyecto={nombreDe(leccion.project_id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
