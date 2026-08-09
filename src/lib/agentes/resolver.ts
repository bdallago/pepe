import "server-only";

import type { Project } from "@/lib/supabase/database.types";

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
  if (!argumento) return null;

  const aguja = normalizar(argumento);
  if (aguja.length === 0) return null;

  const exactos = proyectos.filter(
    (p) => normalizar(p.nombre) === aguja || normalizar(p.slug) === aguja,
  );
  if (exactos.length === 1) return exactos[0]!;
  if (exactos.length > 1) return "ambiguo";

  const parciales = proyectos.filter(
    (p) => normalizar(p.nombre).includes(aguja) || aguja.includes(normalizar(p.nombre)),
  );
  if (parciales.length === 1) return parciales[0]!;
  if (parciales.length > 1) return "ambiguo";

  return null;
}

/** Minúsculas, sin tildes y sin puntuación, para comparar nombres escritos a mano. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
