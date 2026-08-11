import type { Project } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@/lib/supabase/server";

/**
 * Bitácora: dónde cae una entrada y cómo se escribe.
 *
 * Hay dos caminos que terminan en la misma fila: el formulario de la
 * sección Bitácora (la Server Action `crearEntradaBitacora`) y el agente
 * que anota desde la caja. Las dos reglas que comparten —**a qué proyecto
 * va cuando la frase no nombra ninguno** y **cómo se inserta**— son de
 * dominio y viven acá, en un solo lugar. Es el mismo movimiento que
 * `lib/sesiones.ts` hizo con el alta de sesiones: si cada camino escribiera
 * su propio insert, alcanzaría con que uno se olvidara del `track_id` o
 * cayera en otro proyecto por defecto para que la misma acción diera dos
 * resultados distintos según desde dónde se pidió.
 *
 * Por qué acá y no adentro de la action: las actions arman su propio
 * cliente desde las cookies (`requireSession`) y el despacho de los agentes
 * lo recibe ya construido. Con la regla en un módulo que toma el cliente
 * por parámetro la usan los dos, y también un script —que es lo único que
 * permite probar la escritura sin una sesión de browser—. La action quedó
 * como cáscara: valida, llama a esto y revalida.
 *
 * **No lleva `import "server-only"`, y es a propósito.** El criterio del
 * proyecto por defecto lo necesita también el formulario, que es un
 * componente cliente; si el módulo fuera solo de servidor, esa regla
 * tendría que estar escrita dos veces y el día que cambie va a cambiar en
 * una sola. Acá no hay ningún secreto: el cliente de Supabase llega por
 * parámetro.
 */

/**
 * El proyecto donde va el estudio.
 *
 * Es el que el formulario deja precargado, y por lo tanto donde caen las
 * entradas cuando nadie dice lo contrario. No está hardcodeado en la
 * escritura: `project_id` siempre llega resuelto por parámetro y la base lo
 * valida contra RLS.
 */
export const SLUG_PROYECTO_BITACORA = "gentius";

/**
 * A qué proyecto va una entrada cuando no se eligió ninguno.
 *
 * El de estudio primero, **esté abierto o cerrado**, y recién si no
 * existe, el primero de la lista (que llega ordenada por nombre).
 * Devuelve `null` solo si no hay ningún proyecto, caso en el que no hay
 * nada que elegir y quien llama tiene que decirlo:
 * `daily_log.project_id` es NOT NULL.
 *
 * ⚠ **No filtres por la ventana de vida acá** (ni con `estaVivo()`, ni
 * con `fecha_fin`). Es tentador y está mal: la ventana decide **entre
 * quiénes se reparte cada gasto compartido** (regla 2), no sobre cuáles
 * se puede escribir. Un proyecto que se cerró en julio se sigue
 * estudiando y se sigue anotando en agosto — se cerró para dejar de
 * llevarse gastos, no para dejar de existir.
 *
 * Filtrando, las anotaciones de estudio caen en el primer proyecto de
 * finanzas que aparezca por orden alfabético, en silencio.
 *
 * Pasó: al extraer esta función del formulario se agregó el filtro y el
 * selector dejó de arrancar en Gentius sin que nada lo avisara.
 */
export function proyectoPorDefectoDeBitacora(
  proyectos: Project[],
): Project | null {
  return (
    proyectos.find((p) => p.slug === SLUG_PROYECTO_BITACORA) ??
    proyectos[0] ??
    null
  );
}

export interface EntradaNueva {
  /** El texto, tal cual lo escribió Beno. Nadie lo reformula. */
  contenido: string;
  /** "YYYY-MM-DD". Ya resuelta por quien llama. */
  fecha: string;
  projectId: string;
  trackId?: string | null;
}

/**
 * Inserta la entrada y devuelve la fila.
 *
 * No revalida ni redirige: eso es trabajo del borde que la llama. Tampoco
 * valida el contenido —de eso se ocupan el esquema de la action y el check
 * `length(trim(contenido)) > 0` de la tabla—, así que quien llama tiene que
 * llegar con el texto ya no vacío.
 */
export async function crearEntradaDeBitacora(
  supabase: SupabaseClient,
  userId: string,
  entrada: EntradaNueva,
) {
  return await supabase
    .from("daily_log")
    .insert({
      user_id: userId,
      project_id: entrada.projectId,
      track_id: entrada.trackId ?? null,
      fecha: entrada.fecha,
      contenido: entrada.contenido,
    })
    .select()
    .single();
}
