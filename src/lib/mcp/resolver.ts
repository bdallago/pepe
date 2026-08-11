import "server-only";

import type { DatosDelUsuario } from "@/lib/mcp/datos";
import type { Category, Project } from "@/lib/supabase/database.types";

/**
 * Cómo se convierte lo que escribió un modelo en una fila de la base.
 *
 * Mismo criterio que `agentes/resolver.ts`, que hace esto para la caja:
 * **si algo se puede resolver sin modelo, se resuelve sin modelo**. Un
 * proyecto se busca en tres filas; no hace falta pedirle a nadie que
 * adivine cuál quiso decir.
 *
 * La diferencia con la caja es de dónde viene el texto. Allá lo escribe
 * Beno; acá lo manda Claude, que ya vio `listar_proyectos` y debería
 * estar mandando un slug. Por eso el fallback no es "elegí el más
 * parecido" sino **decir cuáles hay**: una respuesta que enumera las
 * opciones se corrige en el turno siguiente, una que elige mal se
 * convierte en un movimiento imputado al proyecto equivocado.
 */

/** Lo que se escribe en `proyecto` para decir "gasto compartido". */
export const COMPARTIDO = "compartido";

export type ProyectoResuelto =
  | { tipo: "proyecto"; proyecto: Project }
  /** `project_id = null`: el gasto se reparte entre los proyectos que
   *  estaban abiertos en su fecha, no entre los de hoy. */
  | { tipo: "compartido" }
  | { tipo: "no-encontrado"; disponibles: Project[] };

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Encuentra un proyecto por slug o por nombre.
 *
 * ⚠ **El literal `compartido` se prueba último, no primero.** Si algún
 * día existe un proyecto con ese slug, gana el proyecto: es lo menos
 * sorprendente y lo único que deja seguir usándolo. Al revés, un
 * proyecto real se volvería inalcanzable y el síntoma sería un
 * movimiento que aparece en el balance general y en ningún proyecto.
 */
export async function resolverProyecto(
  datos: DatosDelUsuario,
  referencia: string,
): Promise<ProyectoResuelto> {
  const { data, error } = await datos.de("projects").order("nombre");

  if (error) {
    throw new Error(`No se pudieron leer los proyectos: ${error.message}`);
  }

  const proyectos = data ?? [];
  const buscado = normalizar(referencia);

  const encontrado =
    proyectos.find((p) => normalizar(p.slug) === buscado) ??
    proyectos.find((p) => normalizar(p.nombre) === buscado);

  if (encontrado) return { tipo: "proyecto", proyecto: encontrado };
  if (buscado === COMPARTIDO) return { tipo: "compartido" };

  return { tipo: "no-encontrado", disponibles: proyectos };
}

/** El texto que se le devuelve al modelo cuando el proyecto no existe. */
export function avisoProyectoDesconocido(
  referencia: string,
  disponibles: Project[],
): string {
  if (disponibles.length === 0) {
    return `No encontré el proyecto "${referencia}", y todavía no hay ninguno cargado en Pepe.`;
  }

  return [
    `No encontré ningún proyecto que se llame "${referencia}". Los que hay son:`,
    ...disponibles.map((p) => `- ${p.nombre} (slug: ${p.slug})`),
    `Para un gasto compartido entre todos, poné "${COMPARTIDO}".`,
  ].join("\n");
}

/**
 * Encuentra una categoría por nombre, dentro de un tipo si se sabe.
 *
 * Devuelve `null` en vez de inventar: una categoría que no existe **no
 * se crea desde el conector**. Sin categoría la propuesta igual entra a
 * la bandeja y la tarjeta la pide antes de dejar aceptar, que es lo
 * mismo que ya hace con el proyecto de un archivo pegado.
 */
export async function resolverCategoria(
  datos: DatosDelUsuario,
  nombre: string,
  tipo?: Category["tipo"],
): Promise<Category | null> {
  const { data } = await datos.de("categories");
  const buscado = normalizar(nombre);

  const candidatas = (data ?? []).filter(
    (c) => !c.archivada && (tipo ? c.tipo === tipo : true),
  );

  return candidatas.find((c) => normalizar(c.nombre) === buscado) ?? null;
}
