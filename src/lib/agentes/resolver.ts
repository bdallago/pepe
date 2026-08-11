import "server-only";

import { normalizar, type Nombrado } from "@/lib/agentes/nombres";
import type { Project, Track } from "@/lib/supabase/database.types";

/**
 * Encuentra el proyecto que menciona una frase.
 *
 * Determinístico a propósito. El recepcionista devuelve texto libre
 * ("Proder", "el prode"); pasarlo a un id es comparar contra tres filas,
 * y una llamada al modelo para eso sería gastar latencia en algo que un
 * `includes` resuelve mejor.
 *
 * Devuelve `null` si no encontró nada y `"ambiguo"` si más de uno
 * matchea: quien llama pregunta en vez de elegir por su cuenta.
 */
export function resolverProyecto(
  argumento: string | null,
  proyectos: Project[],
): Project | null | "ambiguo" {
  return resolverNombrado(argumento, proyectos);
}

/**
 * Lo mismo, para los tracks del plan de estudio.
 *
 * Es hermana de `resolverProyecto` y no una variante: el criterio de
 * "exacto antes que parcial" es el mismo y tiene que quedar en un solo
 * lugar. Lo que cambia es a qué se le pregunta, y lo que hace quien
 * llama con el `null` — meter una sesión en el track equivocado ensucia
 * el plan, así que ahí `null` y `"ambiguo"` terminan los dos en una
 * pregunta.
 */
export function resolverTrack(
  argumento: string | null,
  tracks: Track[],
): Track | null | "ambiguo" {
  return resolverNombrado(argumento, tracks);
}

function resolverNombrado<T extends Nombrado>(
  argumento: string | null,
  filas: T[],
): T | null | "ambiguo" {
  if (!argumento) return null;

  const aguja = normalizar(argumento);
  if (aguja.length === 0) return null;

  const exactos = filas.filter(
    (f) => normalizar(f.nombre) === aguja || normalizar(f.slug) === aguja,
  );
  if (exactos.length === 1) return exactos[0]!;
  if (exactos.length > 1) return "ambiguo";

  const parciales = filas.filter(
    (f) => normalizar(f.nombre).includes(aguja) || aguja.includes(normalizar(f.nombre)),
  );
  if (parciales.length === 1) return parciales[0]!;
  if (parciales.length > 1) return "ambiguo";

  return null;
}
