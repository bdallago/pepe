import "server-only";

import { z } from "zod";

import { ErrorLLM, MODELO_CHICO, completarJSON } from "@/lib/llm";
import type { SupabaseClient } from "@/lib/supabase/server";
import type { CategoriaLeccion } from "@/lib/supabase/database.types";

/**
 * Pase de extracción de lecciones desde la bitácora (spec 3.1).
 *
 * La bitácora mezcla dos cosas: registro operativo ("hice la sesión de
 * SQL, todo bien") y aprendizaje real ("me trabé con X, la causa era Y").
 * Este pase recorre las entradas y le pide al modelo que separe una de la
 * otra y reescriba la segunda como lección autocontenida.
 *
 * **Nada se escribe en `lessons`.** Todo va a `inbox` con estado
 * `pendiente` y espera que Beno apriete un botón. Esa es la regla número
 * uno del proyecto y este módulo es el primero que la ejerce.
 *
 * Diseño para poder retomarlo:
 *
 * - Cada entrada ya mirada deja una fila en `inbox` con
 *   `entidad_tabla = 'daily_log'` y `entidad_id = <id de la entrada>`.
 *   El pase arranca leyendo ese conjunto y saltea lo que ya tiene fila,
 *   sin importar en qué estado quedó.
 * - `clave_dedupe = 'leccion_extraida:<id>'` es la red de seguridad: si
 *   dos corridas se pisan, la segunda choca contra el índice único en vez
 *   de duplicar la propuesta.
 * - Si el modelo se cae a mitad de camino, el pase corta y devuelve lo
 *   hecho. La próxima corrida sigue donde quedó.
 */

/** Cliente de Supabase con la sesión del usuario (RLS activo). */
type Cliente = SupabaseClient;

/** Cuántas entradas mira una corrida, para no pasarse del `maxDuration`. */
export const LOTE_POR_CORRIDA = 25;

/** Techo de tiempo del pase completo, con margen contra el de la función. */
const PRESUPUESTO_MS = 240_000;

const CATEGORIAS = [
  "tecnica",
  "producto",
  "comercial",
  "proceso",
  "personal",
] as const satisfies readonly CategoriaLeccion[];

/**
 * Lo que se le pide al modelo.
 *
 * `tiene_leccion` primero y a propósito: hay entradas que son puro
 * registro operativo ("hoy avancé con el roadmap") y forzar un título
 * sobre eso produce obviedades.
 *
 * Pero **la vara acá es baja, y eso es deliberado.** Este pase no juzga
 * la producción de un modelo: reescribe lo que Beno vivió y escribió.
 * Los dos errores no cuestan lo mismo — un falso positivo se descarta
 * con una tecla en la bandeja, un falso negativo es una lección suya que
 * no ve nunca.
 *
 * La calibración anterior era la contraria ("ante la duda, no hay
 * lección") y descartó sola 2 de las 6 entradas reales, por "describir
 * un concepto" y por "ser una tarea operativa". Al revisarlas, Beno se
 * quedó con las cuatro que sí habían pasado **y con las dos
 * descartadas**: "más allá de que sean imperfectas, son mis lecciones".
 * De ahí este cambio.
 */
const respuestaSchema = z.object({
  tiene_leccion: z.boolean(),
  titulo: z.string().trim().max(120).optional().nullable(),
  contenido: z.string().trim().max(2000).optional().nullable(),
  categoria: z.enum(CATEGORIAS).optional().nullable(),
  motivo: z.string().trim().max(300).optional().nullable(),
});

const SISTEMA = `Sos un asistente que lee la bitácora diaria de trabajo de una persona y rescata lo que aprendió, para que no se pierda.

Una LECCIÓN es cualquier cosa que esa persona entendió, notó o decidió y que le va a servir volver a leer: una causa raíz que costó encontrar, una decisión y su porqué, una regla que conviene recordar, algo que resultó distinto de lo esperado, una distinción conceptual que le llevó tiempo agarrar, una duda que se respondió a sí misma leyendo.

Lo ÚNICO que NO es una lección es el registro puramente operativo, sin ninguna idea adentro: "hice la sesión de SQL", "avancé con el roadmap", "terminé el diseño".

**Ante la duda, PROPONELA.** No sos vos quien decide qué se guarda: la persona revisa cada propuesta y descarta la que no le sirve, y eso le cuesta una tecla. En cambio, lo que vos descartes no lo va a ver nunca. Errar de más es barato; errar de menos le borra algo suyo.

Tampoco es tu trabajo que la lección suene inteligente ni que sea una afirmación filosa. Si lo que entendió fue algo básico o de manual, rescatalo igual: era nuevo para esa persona ese día, y eso es lo que la hace suya.

Respetá SU formulación y su punto de vista. No la corrijas, no la mejores, no le agregues consejos que no dio. Tu trabajo es hacer que se entienda sola dentro de un año —sin leer la entrada original ni saber en qué andaba esa semana—, no reescribir lo que pensó.

Categorías posibles:
- "tecnica": código, arquitectura, herramientas, infraestructura.
- "producto": qué construir, alcance, usuarios, prioridades.
- "comercial": precios, clientes, ventas, cobranza.
- "proceso": cómo trabajar, método, organización, estimaciones.
- "personal": energía, foco, hábitos, cómo trabaja uno mismo.

Escribí en español rioplatense, en segunda persona o impersonal, sin emojis y sin muletillas de asistente.

Respondé SOLO un objeto JSON con esta forma exacta:
{
  "tiene_leccion": boolean,
  "titulo": string (máx 80 caracteres, afirmativo y concreto; null si no hay lección),
  "contenido": string (2 a 5 oraciones; null si no hay lección),
  "categoria": una de "tecnica" | "producto" | "comercial" | "proceso" | "personal" (null si no hay lección),
  "motivo": string breve explicando por qué no hay lección (null si sí la hay)
}`;

/** Lo que queda guardado en `inbox.payload` para una propuesta. */
export interface PayloadLeccionExtraida {
  titulo: string;
  contenido: string;
  categoria: CategoriaLeccion;
  /** Fecha y proyecto de la entrada de origen: la lección los hereda. */
  fecha: string;
  project_id: string;
  modelo: string;
}

export interface ReporteExtraccion {
  /** Entradas miradas en esta corrida. */
  procesadas: number;
  /** Propuestas nuevas que quedaron pendientes de revisión. */
  propuestas: number;
  /** Entradas que el modelo consideró puro registro operativo. */
  sinLeccion: number;
  /** Salidas que no validaron contra el esquema: quedan en la bandeja. */
  errores: number;
  /** Entradas que todavía no se miraron (por lote o por corte). */
  restantes: number;
  /** Por qué se cortó antes de terminar, si se cortó. */
  interrumpidoPor?: string;
}

/**
 * Corre el pase sobre las entradas de bitácora que todavía no se miraron.
 *
 * No lanza por culpa del modelo: si Groq se cae, corta y lo cuenta en
 * `interrumpidoPor`. Lo que ya se propuso queda en la bandeja.
 */
export async function extraerLeccionesPendientes(
  supabase: Cliente,
  userId: string,
): Promise<ReporteExtraccion> {
  const arranque = Date.now();

  // Las archivadas entran igual: archivar saca la entrada de las listas,
  // no la borra del histórico, y una entrada vieja puede dejar la mejor
  // lección de todas.
  const { data: entradas, error: errorEntradas } = await supabase
    .from("daily_log")
    .select("id, fecha, contenido, project_id")
    .order("fecha", { ascending: true })
    .limit(1000);

  if (errorEntradas) throw new Error(errorEntradas.message);

  // Todo lo que ya tiene fila en la bandeja, en cualquier estado: lo
  // aceptado, lo rechazado, lo pendiente y lo que dio error. Nada de eso
  // se vuelve a mandar al modelo.
  const { data: yaVistas, error: errorVistas } = await supabase
    .from("inbox")
    .select("entidad_id")
    .eq("tipo", "leccion_extraida")
    .eq("entidad_tabla", "daily_log")
    .limit(5000);

  if (errorVistas) throw new Error(errorVistas.message);

  const vistas = new Set((yaVistas ?? []).map((f) => f.entidad_id));
  const pendientes = (entradas ?? []).filter((e) => !vistas.has(e.id));

  const reporte: ReporteExtraccion = {
    procesadas: 0,
    propuestas: 0,
    sinLeccion: 0,
    errores: 0,
    restantes: pendientes.length,
  };

  for (const entrada of pendientes.slice(0, LOTE_POR_CORRIDA)) {
    if (Date.now() - arranque > PRESUPUESTO_MS) {
      reporte.interrumpidoPor = "Se acabó el tiempo de la corrida.";
      break;
    }

    const clave = `leccion_extraida:${entrada.id}`;

    try {
      const { datos, uso } = await completarJSON({
        modelo: MODELO_CHICO,
        sistema: SISTEMA,
        usuario: `Fecha de la entrada: ${entrada.fecha}\n\nEntrada:\n${entrada.contenido}`,
        esquema: respuestaSchema,
        etiqueta: "extraccion-lecciones",
        maxTokens: 700,
      });

      const completa =
        datos.tiene_leccion && datos.titulo && datos.contenido && datos.categoria;

      if (!completa) {
        // Fila resuelta como rechazada, no pendiente: no tiene nada que
        // revisar. Existe para que la próxima corrida sepa que esta
        // entrada ya se miró y no la vuelva a mandar al modelo.
        await supabase.from("inbox").insert({
          user_id: userId,
          tipo: "leccion_extraida",
          estado: "rechazado",
          entidad_tabla: "daily_log",
          entidad_id: entrada.id,
          resuelto_en: new Date().toISOString(),
          payload: {
            sin_leccion: true,
            motivo: datos.motivo ?? "El modelo no encontró una lección.",
            modelo: uso.modelo,
          },
        });
        reporte.sinLeccion++;
      } else {
        const payload: PayloadLeccionExtraida = {
          titulo: datos.titulo!,
          contenido: datos.contenido!,
          categoria: datos.categoria!,
          fecha: entrada.fecha,
          project_id: entrada.project_id,
          modelo: uso.modelo,
        };

        const { error } = await supabase.from("inbox").insert({
          user_id: userId,
          tipo: "leccion_extraida",
          estado: "pendiente",
          entidad_tabla: "daily_log",
          entidad_id: entrada.id,
          clave_dedupe: clave,
          payload: { ...payload },
        });

        // 23505 = choque contra el índice de dedupe: otra corrida ya la
        // propuso. No es un error, es el mecanismo funcionando.
        if (error && error.code !== "23505") throw new Error(error.message);
        if (!error) reporte.propuestas++;
      }

      reporte.procesadas++;
      reporte.restantes--;
    } catch (error: unknown) {
      if (error instanceof ErrorLLM && error.tipo === "esquema") {
        // El spec pide esto explícitamente: una salida que no valida se
        // ve en la bandeja marcada como error, no se descarta callada.
        await supabase.from("inbox").insert({
          user_id: userId,
          tipo: "leccion_extraida",
          estado: "error",
          entidad_tabla: "daily_log",
          entidad_id: entrada.id,
          resuelto_en: new Date().toISOString(),
          error_detalle: error.message,
          payload: { crudo: error.crudo ?? null, fecha: entrada.fecha },
        });
        reporte.errores++;
        reporte.procesadas++;
        reporte.restantes--;
        continue;
      }

      // Cuota agotada, timeout, red: cortar. Insistir con las 20
      // entradas que siguen solo gasta tiempo. Lo que falta queda para
      // la próxima corrida.
      reporte.interrumpidoPor =
        error instanceof Error ? error.message : "Falló el modelo.";
      break;
    }
  }

  return reporte;
}
