import "server-only";

import { z } from "zod";

import { ErrorLLM, MODELO_CHICO, completarJSON, hayModeloConfigurado } from "@/lib/llm";
import type { SupabaseClient } from "@/lib/supabase/server";
import type { Moneda } from "@/lib/supabase/database.types";

/**
 * Escaneo de suscripciones zombie (spec 6.2 y 7).
 *
 * **La detección es SQL puro**: la hace `detectar_zombies` en la base y
 * acá no se decide nada. El modelo solo redacta el aviso, y si no está
 * disponible se escribe uno armado en código: el spec dice explícitamente
 * que ni siquiera es imprescindible.
 *
 * Idempotencia, que el spec pide por escrito: el detector es una consulta
 * sobre todo el histórico, no un delta contra la última corrida. Si el
 * job no corre por una semana, la corrida siguiente ve exactamente lo
 * mismo que habría visto cada día — no hay período que "recuperar"
 * porque nunca se asume que corrió ayer. Lo único que evita duplicar
 * propuestas es `clave_dedupe`.
 *
 * Los falsos positivos son para siempre: cuando Beno rechaza un zombie,
 * su fila conserva la `clave_dedupe` (a diferencia del resto de la
 * bandeja, que la libera) y este pase saltea ese núcleo en todas las
 * corridas futuras. "Y no me lo vuelve a mostrar" es textual del spec.
 */

type Cliente = SupabaseClient;

export interface Candidato {
  nucleo: string;
  descripcion_ultima: string;
  project_id: string | null;
  meses_con_cargo: number;
  primer_cargo: string;
  ultimo_cargo: string;
  monto_origen: number;
  moneda_origen: Moneda;
  ultima_actividad: string;
  dias_sin_actividad: number;
  recurrence_id: string | null;
}

/** Lo que queda en `inbox.payload` para un zombie. */
export interface PayloadZombie {
  nucleo: string;
  descripcion: string;
  monto_origen: number;
  moneda_origen: Moneda;
  project_id: string | null;
  meses_con_cargo: number;
  ultimo_cargo: string;
  ultima_actividad: string;
  dias_sin_actividad: number;
  /** La recurrencia declarada, si existe: lo único dable de baja. */
  recurrence_id: string | null;
  /** El texto que se lee en la bandeja. */
  aviso: string;
  /** Null si lo redactó el código porque no había modelo. */
  modelo: string | null;
}

export interface ReporteZombies {
  /** Candidatos que devolvió el SQL. */
  detectados: number;
  /** Propuestas nuevas en la bandeja. */
  propuestos: number;
  /** Ya estaban esperando, o marcados como falso positivo. */
  omitidos: number;
  /** El modelo no pudo redactar y se usó el aviso de código. */
  sinModelo: number;
}

const avisoSchema = z.object({
  aviso: z.string().trim().min(1).max(400),
});

const SISTEMA = `Redactás un aviso corto sobre un gasto recurrente que puede haber quedado sin uso.

Te dan: qué se paga, cuánto, cada cuánto, y hace cuánto que no hay actividad en lo que ese gasto sostiene.

Escribí UNA o DOS oraciones que le sirvan a la persona para decidir si lo da de baja. Decí el dato concreto (el monto, hace cuánto que no hay actividad). No inventes nada que no te hayan pasado y no supongas para qué se usa el servicio.

No es una acusación ni una alarma: puede ser un falso positivo perfectamente razonable. Escribilo como una observación, no como un reto. Nada de signos de exclamación.

Español rioplatense, sin emojis y sin muletillas de asistente.

Respondé SOLO un objeto JSON: {"aviso": string}`;

/**
 * Corre el escaneo para un usuario y deja los candidatos en la bandeja.
 *
 * No lanza por culpa del modelo: si no puede redactar, usa el aviso de
 * código y sigue. Sí lanza si falla la base, que es un error de verdad.
 */
export async function escanearZombies(
  supabase: Cliente,
  userId: string,
): Promise<ReporteZombies> {
  const { data, error } = await supabase.rpc("detectar_zombies", {
    p_user_id: userId,
  });

  if (error) throw new Error(error.message);

  const candidatos = (data ?? []) as Candidato[];

  const reporte: ReporteZombies = {
    detectados: candidatos.length,
    propuestos: 0,
    omitidos: 0,
    sinModelo: 0,
  };

  if (candidatos.length === 0) return reporte;

  // Lo que Beno ya resolvió sobre estos gastos. `clave_dedupe` sobrevive
  // a la resolución solo para los zombies, justamente para esto: la
  // detección es una consulta sobre todo el histórico, así que el gasto
  // va a seguir apareciendo en cada corrida y lo único que puede
  // acordarse de que ya lo miró es esta fila.
  const { data: resueltos } = await supabase
    .from("inbox")
    .select("clave_dedupe, estado, resuelto_en")
    .eq("tipo", "zombie")
    .in("estado", ["aceptado", "rechazado"])
    .not("clave_dedupe", "is", null);

  const yaResuelto = new Map(
    (resueltos ?? []).map((f) => [f.clave_dedupe as string, f]),
  );

  for (const c of candidatos) {
    const clave = claveDe(c.nucleo);
    const resuelto = yaResuelto.get(clave);

    if (resuelto && silenciado(resuelto, c.ultimo_cargo)) {
      reporte.omitidos++;
      continue;
    }

    let aviso = avisoDeCodigo(c);
    let modelo: string | null = null;

    if (hayModeloConfigurado()) {
      try {
        const { datos, uso } = await completarJSON({
          modelo: MODELO_CHICO,
          sistema: SISTEMA,
          usuario: contextoDe(c),
          esquema: avisoSchema,
          etiqueta: "aviso-zombie",
          maxTokens: 250,
        });
        aviso = datos.aviso;
        modelo = uso.modelo;
      } catch (error: unknown) {
        // El spec es explícito: el modelo acá "ni siquiera es
        // imprescindible". Se avisa igual con el texto de código.
        reporte.sinModelo++;
        console.warn(
          `[zombies] sin aviso del modelo para "${c.nucleo}":`,
          error instanceof ErrorLLM ? error.message : error,
        );
      }
    } else {
      reporte.sinModelo++;
    }

    const payload: PayloadZombie = {
      nucleo: c.nucleo,
      descripcion: c.descripcion_ultima,
      monto_origen: Number(c.monto_origen),
      moneda_origen: c.moneda_origen,
      project_id: c.project_id,
      meses_con_cargo: Number(c.meses_con_cargo),
      ultimo_cargo: c.ultimo_cargo,
      ultima_actividad: c.ultima_actividad,
      dias_sin_actividad: c.dias_sin_actividad,
      recurrence_id: c.recurrence_id,
      aviso,
      modelo,
    };

    const { error: errorInsert } = await supabase.from("inbox").insert({
      user_id: userId,
      tipo: "zombie",
      estado: "pendiente",
      // Apunta a la recurrencia declarada si existe; si no, no hay
      // entidad que señalar: el "gasto recurrente" es un patrón de
      // movimientos, no una fila.
      entidad_tabla: c.recurrence_id ? "recurrences" : null,
      entidad_id: c.recurrence_id,
      clave_dedupe: clave,
      payload: { ...payload },
    });

    // 23505 = ya hay una propuesta viva para ese núcleo. Es el dedupe
    // haciendo su trabajo, no un error.
    if (errorInsert && errorInsert.code !== "23505") {
      throw new Error(errorInsert.message);
    }
    if (errorInsert) reporte.omitidos++;
    else reporte.propuestos++;
  }

  return reporte;
}

export function claveDe(nucleo: string): string {
  return `zombie:${nucleo}`;
}

/**
 * ¿Este gasto ya está resuelto y hay que callarse?
 *
 * Los dos estados se comportan distinto, y la diferencia importa:
 *
 * - **Rechazado es falso positivo, y es para siempre.** Beno dijo "la
 *   sigo usando". Volver a preguntarle cada día es exactamente lo que
 *   el spec prohíbe con "y no me lo vuelve a mostrar".
 * - **Aceptado es "la di de baja", y vale hasta que aparezca un cargo
 *   nuevo.** Mientras los cargos que ve el detector sean los de antes de
 *   la baja, no hay nada que avisar. Pero si vuelve a aparecer uno
 *   después —se resuscribió, o la baja no se hizo efectiva— eso es
 *   información nueva y merece un aviso nuevo.
 *
 * Silenciar el aceptado para siempre sería cómodo y estaría mal: el
 * caso en que más te sirve el aviso es justo ese, seguir pagando algo
 * que creías dado de baja.
 */
function silenciado(
  resuelto: { estado: string; resuelto_en: string | null },
  ultimoCargo: string,
): boolean {
  if (resuelto.estado === "rechazado") return true;
  if (!resuelto.resuelto_en) return true;

  // `resuelto_en` es timestamptz y `ultimo_cargo` es una fecha: se
  // comparan como 'YYYY-MM-DD', que es como se manejan las fechas en
  // todo el repo.
  return ultimoCargo <= resuelto.resuelto_en.slice(0, 10);
}

function contextoDe(c: Candidato): string {
  return [
    `Gasto: ${c.descripcion_ultima}`,
    `Es un cargo MENSUAL de ${c.monto_origen} ${c.moneda_origen}. Se cobra una vez por mes.`,
    // Se dice "meses con cargo" y no "N meses" a secas porque el modelo
    // lo leía como periodicidad: con "3 meses" escribía "cada 3 meses",
    // que es falso. La periodicidad va aparte y explícita, arriba.
    `Cantidad de meses en los que ya se cobró: ${c.meses_con_cargo}. El primero fue el ${c.primer_cargo} y el último el ${c.ultimo_cargo}.`,
    c.project_id
      ? `Está imputado a un proyecto, y ese proyecto no tiene actividad desde el ${c.ultima_actividad} (${c.dias_sin_actividad} días).`
      : `Es un gasto compartido entre todos los proyectos, y no hay actividad en ninguno desde el ${c.ultima_actividad} (${c.dias_sin_actividad} días).`,
  ].join("\n");
}

/**
 * El aviso cuando no hay modelo. Dice lo mismo, con menos vueltas.
 *
 * Que exista no es una degradación aceptada a regañadientes: es lo que
 * hace que la feature entera funcione sin Groq.
 */
function avisoDeCodigo(c: Candidato): string {
  const monto = `${c.monto_origen} ${c.moneda_origen}`;
  const donde = c.project_id
    ? "el proyecto al que está imputado"
    : "ningún proyecto";

  return (
    `Venís pagando ${monto} por mes desde el ${c.primer_cargo}, y ${donde} ` +
    `registra actividad desde hace ${c.dias_sin_actividad} días. ` +
    `El último cargo fue el ${c.ultimo_cargo}.`
  );
}
