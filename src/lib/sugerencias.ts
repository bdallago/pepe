import "server-only";

import { z } from "zod";

import { addDays, todayISO } from "@/lib/dates";
import { MODELO_RAZONADOR, completarJSON } from "@/lib/llm";
import type { SupabaseClient } from "@/lib/supabase/server";

/**
 * Sugerencia de qué estudiar (spec 6.4).
 *
 * Beno pide *"sugerime qué estudiar según lo que vengo trabajando"* y el
 * modelo contesta en pantalla. **Esto no pasa por la bandeja**: no
 * escribe nada en las tablas de dominio, así que no hay nada que
 * confirmar. Lo que sí escribe —convertir una sugerencia en sesión de un
 * track— es un botón aparte que aprieta Beno.
 *
 * La regla dura del spec es "cada sugerencia anclada a algo específico de
 * mis datos, nada de consejos genéricos". Eso no se consigue pidiéndolo
 * en el prompt: se consigue **armando el contexto** y obligando al modelo
 * a devolver el ancla como campo separado. Si el ancla sale vaga, se ve
 * en pantalla al lado de la sugerencia y Beno la descarta de un vistazo.
 *
 * De ahí que el contexto sea todo cuantitativo y reciente:
 *
 * - Proyectos con actividad en la ventana, y de qué tipo.
 * - En qué categorías de egreso se fue la plata, con montos.
 * - Las últimas lecciones, con su categoría.
 * - El estado de cada track: cuánto avanzó y qué sesión sigue.
 */

type Cliente = SupabaseClient;

/** Ventana de "lo que vengo trabajando". */
const DIAS_DE_ACTIVIDAD = 90;

/** Cuántas sugerencias se piden. Pocas y buenas. */
const CUANTAS = 4;

const LECCIONES_EN_CONTEXTO = 15;
const CATEGORIAS_EN_CONTEXTO = 8;

const respuestaSchema = z.object({
  sugerencias: z
    .array(
      z.object({
        titulo: z.string().trim().min(1).max(120),
        motivo: z.string().trim().min(1).max(600),
        ancla: z.string().trim().min(1).max(300),
        consigna: z.string().trim().min(1).max(600),
      }),
    )
    .max(CUANTAS),
});

export type Sugerencia = z.infer<typeof respuestaSchema>["sugerencias"][number];

const SISTEMA = `Sos un asesor que le dice a alguien que trabaja solo en sus propios proyectos QUÉ LE CONVIENE ESTUDIAR AHORA, mirando lo que viene haciendo.

Te dan datos reales de los últimos meses: proyectos con actividad, en qué categorías se le fue la plata, las últimas lecciones que anotó y el estado de sus tracks de estudio.

Devolvés hasta ${CUANTAS} sugerencias. Regla número uno, y la única que importa de verdad:

**CADA SUGERENCIA TIENE QUE ESTAR ANCLADA A UN DATO CONCRETO DE LOS QUE TE DIERON.** El campo "ancla" cita el dato: el nombre del proyecto, el monto de la categoría, el título de la lección, el track y su avance. Si para una sugerencia no encontrás un dato que la justifique, NO LA DEVUELVAS.

Nada de "aprendé a delegar", "mejorá tu productividad" ni "estudiá marketing". Eso vale para cualquiera y por eso no sirve para nadie. Una lista de dos sugerencias ancladas vale más que cuatro genéricas.

Tampoco sugieras lo que ya está cubierto por un track en curso, salvo que el dato muestre que no está avanzando.

El "titulo" dice QUÉ ESTUDIAR con nombre y apellido, no un rótulo de categoría. "Optimización de infraestructura" no es una sugerencia, es un título de carpeta. "Cómo bajar la cuenta de Vercel sin cambiar de proveedor" sí.

Cada sugerencia lleva además una "consigna": qué hacer concretamente para aplicarlo, en una o dos oraciones. Tiene que ser algo que se pueda hacer en una o dos horas y que termine en algo verificable, no "leer sobre el tema".

Escribí en español rioplatense, sin emojis y sin muletillas de asistente.

Respondé SOLO un objeto JSON con esta forma exacta:
{
  "sugerencias": [
    {
      "titulo": string (máx 80 caracteres, qué estudiar),
      "motivo": string (2 a 4 oraciones, por qué ahora),
      "ancla": string (el dato concreto que la justifica),
      "consigna": string (qué hacer para aplicarlo)
    }
  ]
}

Si los datos no alcanzan para anclar ninguna, devolvé {"sugerencias": []}.`;

/**
 * Pide sugerencias de estudio. No escribe nada.
 *
 * Lanza `ErrorLLM` si el modelo falla: la pantalla lo muestra discreto y
 * todo lo demás del módulo de aprendizaje sigue andando.
 */
export async function sugerirQueEstudiar(
  supabase: Cliente,
): Promise<Sugerencia[]> {
  const contexto = await armarContexto(supabase);

  if (!contexto) {
    // Sin datos no hay ancla posible, y una sugerencia sin ancla es
    // exactamente lo que el spec no quiere. Mejor no gastar la llamada.
    return [];
  }

  const { datos } = await completarJSON({
    modelo: MODELO_RAZONADOR,
    sistema: SISTEMA,
    usuario: contexto,
    esquema: respuestaSchema,
    etiqueta: "sugerencias-estudio",
    temperatura: 0.4,
    // Acá el enemigo es el consejo genérico, igual que en 6.3, y el
    // razonamiento es lo que hace que el modelo cruce dos datos en vez
    // de leer una fila y opinar sobre ella.
    esfuerzo: "medium",
    maxTokens: 3500,
  });

  return datos.sugerencias;
}

/**
 * Arma el contexto en texto plano. Devuelve `null` si no hay con qué.
 *
 * Todo lo de acá pasa por RLS, así que se lee solo lo del usuario.
 */
async function armarContexto(supabase: Cliente): Promise<string | null> {
  const hoy = todayISO();
  const desde = addDays(hoy, -DIAS_DE_ACTIVIDAD);

  const [proyectos, movimientos, categorias, lecciones, tracks, sesiones, bitacora] =
    await Promise.all([
      // Solo `id` y `nombre`: es un mapa de id → nombre y nada más. Pedir
      // una columna de más acá no lo nota nadie —este call site ignora
      // `.error` y usa `data ?? []`—, así que una columna que no existe
      // no rompe la pantalla: la deja sin nombres, con el contexto
      // diciendo "Proyecto archivado" para todos.
      supabase.from("projects").select("id, nombre").is("archivado_en", null),
      supabase
        .from("movements")
        .select("project_id, category_id, tipo, monto_ars, fecha")
        .gte("fecha", desde)
        .limit(5000),
      supabase.from("categories").select("id, nombre"),
      supabase
        .from("lessons")
        .select("titulo, categoria, fecha, project_id")
        .is("archivado_en", null)
        .order("fecha", { ascending: false })
        .limit(LECCIONES_EN_CONTEXTO),
      supabase
        .from("tracks")
        .select("id, nombre, activo")
        .is("archivado_en", null)
        .order("orden"),
      supabase
        .from("sessions")
        .select("track_id, titulo, teoria_hecha, aplicacion_hecha, orden")
        .is("archivado_en", null)
        .order("orden"),
      supabase
        .from("daily_log")
        .select("project_id, fecha")
        .gte("fecha", desde)
        .limit(500),
    ]);

  const nombreProyecto = new Map(
    (proyectos.data ?? []).map((p) => [p.id, p.nombre]),
  );
  const nombreCategoria = new Map(
    (categorias.data ?? []).map((c) => [c.id, c.nombre]),
  );

  const partes: string[] = [`Hoy es ${hoy}. Ventana mirada: últimos ${DIAS_DE_ACTIVIDAD} días.`];

  // --- Proyectos con actividad ---------------------------------
  const actividad = new Map<string, { movimientos: number; entradas: number }>();

  for (const m of movimientos.data ?? []) {
    if (!m.project_id) continue;
    const a = actividad.get(m.project_id) ?? { movimientos: 0, entradas: 0 };
    a.movimientos++;
    actividad.set(m.project_id, a);
  }
  for (const e of bitacora.data ?? []) {
    const a = actividad.get(e.project_id) ?? { movimientos: 0, entradas: 0 };
    a.entradas++;
    actividad.set(e.project_id, a);
  }

  if (actividad.size > 0) {
    const filas = [...actividad.entries()]
      .sort((a, b) => b[1].movimientos + b[1].entradas - (a[1].movimientos + a[1].entradas))
      .map(
        ([id, a]) =>
          `- ${nombreProyecto.get(id) ?? "Proyecto archivado"}: ${a.movimientos} movimientos, ${a.entradas} entradas de bitácora`,
      );
    partes.push(`Proyectos con actividad reciente:\n${filas.join("\n")}`);
  }

  // --- Dónde se fue la plata -----------------------------------
  const porCategoria = new Map<string, number>();
  for (const m of movimientos.data ?? []) {
    if (m.tipo !== "egreso" || !m.category_id) continue;
    porCategoria.set(
      m.category_id,
      (porCategoria.get(m.category_id) ?? 0) + Number(m.monto_ars),
    );
  }

  if (porCategoria.size > 0) {
    const filas = [...porCategoria.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, CATEGORIAS_EN_CONTEXTO)
      .map(
        ([id, total]) =>
          `- ${nombreCategoria.get(id) ?? "Sin categoría"}: ${Math.round(total).toLocaleString("es-AR")} ARS`,
      );
    partes.push(`Egresos por categoría en la ventana:\n${filas.join("\n")}`);
  }

  // --- Lo último que aprendió ----------------------------------
  if ((lecciones.data ?? []).length > 0) {
    const filas = (lecciones.data ?? []).map(
      (l) =>
        `- [${l.categoria}] ${l.titulo} (${nombreProyecto.get(l.project_id) ?? "proyecto archivado"}, ${l.fecha})`,
    );
    partes.push(`Últimas lecciones anotadas:\n${filas.join("\n")}`);
  }

  // --- Estado de los tracks ------------------------------------
  if ((tracks.data ?? []).length > 0) {
    const filas = (tracks.data ?? []).map((t) => {
      const propias = (sesiones.data ?? []).filter((s) => s.track_id === t.id);
      const hechas = propias.filter(
        (s) => s.teoria_hecha && s.aplicacion_hecha,
      ).length;
      const siguiente = propias.find(
        (s) => !s.teoria_hecha || !s.aplicacion_hecha,
      );

      return (
        `- ${t.nombre}${t.activo ? "" : " (inactivo)"}: ${hechas} de ${propias.length} sesiones completas` +
        (siguiente ? `. La que sigue: "${siguiente.titulo}"` : ". Terminado")
      );
    });
    partes.push(`Tracks de estudio:\n${filas.join("\n")}`);
  }

  // Solo el encabezado de fecha: no hay ni un dato con qué anclar.
  return partes.length > 1 ? partes.join("\n\n") : null;
}
