import "server-only";

import { z } from "zod";

import {
  MODELO_RAZONADOR,
  completarJSON,
  type PromptDeclarado,
} from "@/lib/llm";
import { todayISO } from "@/lib/dates";
import type { SupabaseClient } from "@/lib/supabase/server";
import type { CategoriaLeccion } from "@/lib/supabase/database.types";

/**
 * Generar lecciones sobre un tema (spec 6.3).
 *
 * Beno escribe algo como *"agregame lecciones sobre pricing de SaaS
 * aplicado a Gentius"* y el modelo devuelve una lista de lecciones
 * propuestas. Van a `inbox` como `leccion_sugerida` y de ahí salen con
 * `origen = 'generada'`.
 *
 * Tres cosas que distinguen esto de la extracción desde la bitácora
 * (`lib/extraccion.ts`), y que no son detalles:
 *
 * 1. **Modelo grande.** La extracción reescribe algo que ya está escrito;
 *    acá el modelo tiene que producir contenido con criterio sobre un
 *    tema. El chico devuelve lugares comunes de manual.
 * 2. **Se le pasan las lecciones que ya hay de ese proyecto**, para que
 *    no repita. Es un pedido explícito del spec y es lo que hace que
 *    pedir el mismo tema dos veces no llene la bandeja de lo mismo.
 * 3. **Son hipótesis, no experiencia.** Salen marcadas distinto en la
 *    lista de Lecciones (borde punteado, "Hipótesis generada") y ese
 *    marcado es requisito del spec: Beno quiere poder distinguir siempre
 *    lo que vivió de lo que un modelo le propuso.
 *
 * Una sola llamada al modelo por pedido, así que no hay pase retomable
 * ni lotes: o sale entera o no sale.
 */

type Cliente = SupabaseClient;

/** Cuántas lecciones se le piden al modelo por vez. */
const CUANTAS = 5;

/** Cuántas lecciones previas del proyecto entran al prompt. */
const CONTEXTO_MAXIMO = 30;

const CATEGORIAS = [
  "tecnica",
  "producto",
  "comercial",
  "proceso",
  "personal",
] as const satisfies readonly CategoriaLeccion[];

const respuestaSchema = z.object({
  lecciones: z
    .array(
      z.object({
        titulo: z.string().trim().min(1).max(120),
        contenido: z.string().trim().min(1).max(2000),
        categoria: z.enum(CATEGORIAS),
      }),
    )
    .max(CUANTAS),
});

const SISTEMA = `Sos un asesor que le propone lecciones aprendidas a alguien que trabaja solo en sus propios proyectos.

Te dan un TEMA, el PROYECTO al que se aplica y las lecciones que esa persona YA tiene de ese proyecto. Devolvés hasta ${CUANTAS} lecciones nuevas sobre ese tema.

Reglas que mandan sobre todo lo demás:

1. NO REPITAS lo que ya está en la lista de lecciones existentes, ni con otras palabras. Si el tema ya está cubierto, devolvé menos lecciones, o ninguna. Una lista corta y nueva vale más que una larga y repetida.
2. **El título tiene que ser una AFIRMACIÓN DISCUTIBLE, no un rótulo ni una orden genérica.** Si el título podría estar en la tapa de cualquier libro de negocios, está mal. Tiene que decir algo con lo que alguien podría no estar de acuerdo.
3. Cada lección lleva la CONDICIÓN en la que aplica y QUÉ PASA si la ignorás. Sin eso es un consejo, no una lección. Escribilo como prosa corrida: no pongas las palabras "Condición:" ni "Consecuencia:" en el texto.
4. Escribí como si se lo contaras a alguien que va a tener que decidir algo la semana que viene, no como un artículo.
5. Ajustá cada lección al proyecto y al tema que te dan.

Ejemplos de títulos MAL (rótulos vacíos, rechazalos si se te ocurren):
- "Documentá todo"
- "Capacitá al cliente"
- "Revisá y ajustá"
- "Optimizá tus procesos"
- "Escuchá a tus clientes"

Ejemplos de títulos BIEN (afirmaciones con filo):
- "Al cliente chico cobrale la implementación aparte o te la come el soporte"
- "El primer mes gratis atrae justo a los que nunca van a pagar"
- "Un precio por hora te castiga cada vez que mejorás la herramienta"

Estas lecciones son HIPÓTESIS, no experiencia vivida, y la persona lo sabe. No inventes datos, cifras ni hechos sobre el proyecto que no te hayan dado.

Categorías posibles:
- "tecnica": código, arquitectura, herramientas, infraestructura.
- "producto": qué construir, alcance, usuarios, prioridades.
- "comercial": precios, clientes, ventas, cobranza.
- "proceso": cómo trabajar, método, organización, estimaciones.
- "personal": energía, foco, hábitos, cómo trabaja uno mismo.

Escribí en español rioplatense, sin emojis y sin muletillas de asistente.

Respondé SOLO un objeto JSON con esta forma exacta:
{
  "lecciones": [
    {
      "titulo": string (máx 80 caracteres, afirmativo y concreto),
      "contenido": string (2 a 5 oraciones),
      "categoria": una de "tecnica" | "producto" | "comercial" | "proceso" | "personal"
    }
  ]
}

Si no tenés nada nuevo que aportar, devolvé {"lecciones": []}.`;

/**
 * El prompt de 6.3, declarado.
 *
 * Es la familia donde la vara del título nació: con
 * `llama-3.3-70b-versatile` devolvía rótulos —"Establecer límites de
 * soporte", "Priorizar la documentación", "Revisar contratos"— y
 * **agregarle ejemplos en contraste al prompt no movió la aguja: el techo
 * era el modelo**. Su juez es `pareceRotulo()`, con esos tres casos reales
 * adentro.
 */
export const PROMPT_GENERACION: PromptDeclarado<
  z.infer<typeof respuestaSchema>
> = {
  modelo: MODELO_RAZONADOR,
  sistema: SISTEMA,
  esquema: respuestaSchema,
  etiqueta: "generacion-lecciones",
  // Un poco más alta que el resto: acá se quiere que proponga, no que
  // repita la formulación más probable.
  temperatura: 0.5,
  esfuerzo: "medium",
  // Holgado porque los tokens de razonamiento se descuentan de acá:
  // medido, la parte que piensa se lleva unos 2000 y con 1800 en total la
  // lista volvía truncada a una sola lección.
  maxTokens: 3500,
};

/** Lo que queda en `inbox.payload` para una lección generada. */
export interface PayloadLeccionSugerida {
  titulo: string;
  contenido: string;
  categoria: CategoriaLeccion;
  fecha: string;
  project_id: string;
  /** El pedido original. Sirve para juzgar la propuesta en la bandeja. */
  tema: string;
  modelo: string;
}

export interface ReporteGeneracion {
  /** Lecciones que quedaron pendientes de revisión en la bandeja. */
  propuestas: number;
  /** Las que el modelo devolvió pero ya estaban propuestas (dedupe). */
  repetidas: number;
  /** El modelo consideró que el tema ya estaba cubierto. */
  sinNovedad: boolean;
}

/**
 * Le pide al modelo lecciones sobre un tema y las deja en la bandeja.
 *
 * Lanza `ErrorLLM` si el modelo falla: quien llama lo traduce a un aviso
 * discreto. Escribir lecciones a mano sigue andando igual.
 */
export async function generarLecciones(
  supabase: Cliente,
  userId: string,
  { tema, projectId }: { tema: string; projectId: string },
): Promise<ReporteGeneracion> {
  const { data: proyecto, error: errorProyecto } = await supabase
    .from("projects")
    .select("id, nombre")
    .eq("id", projectId)
    .maybeSingle();

  if (errorProyecto) throw new Error(errorProyecto.message);
  if (!proyecto) throw new Error("No encontré ese proyecto.");

  // Las archivadas entran igual: para "no repitas" lo que importa es qué
  // se sabe, no qué está a la vista.
  const { data: existentes, error: errorLecciones } = await supabase
    .from("lessons")
    .select("titulo, contenido, categoria")
    .eq("project_id", projectId)
    .order("fecha", { ascending: false })
    .limit(CONTEXTO_MAXIMO);

  if (errorLecciones) throw new Error(errorLecciones.message);

  // También las que están esperando en la bandeja: si no, pedir el mismo
  // tema dos veces seguidas propone lo mismo dos veces.
  const { data: enBandeja } = await supabase
    .from("inbox")
    .select("payload")
    .eq("tipo", "leccion_sugerida")
    .is("resuelto_en", null)
    .limit(200);

  const titulosPropuestos = (enBandeja ?? [])
    .map((f) => {
      const p = f.payload as Record<string, unknown> | null;
      return typeof p?.titulo === "string" ? p.titulo : null;
    })
    .filter((t): t is string => t !== null);

  const yaSe = [
    ...(existentes ?? []).map((l) => `- [${l.categoria}] ${l.titulo}: ${l.contenido}`),
    ...titulosPropuestos.map((t) => `- (ya propuesta) ${t}`),
  ];

  const usuario = [
    `Tema: ${tema}`,
    `Proyecto: ${proyecto.nombre}`,
    "",
    yaSe.length > 0
      ? `Lecciones que ya tiene de este proyecto (NO las repitas):\n${yaSe.join("\n")}`
      : "Todavía no tiene ninguna lección de este proyecto.",
  ].join("\n");

  const { datos, uso } = await completarJSON({ ...PROMPT_GENERACION, usuario });

  const reporte: ReporteGeneracion = {
    propuestas: 0,
    repetidas: 0,
    sinNovedad: datos.lecciones.length === 0,
  };

  const fecha = todayISO();

  for (const leccion of datos.lecciones) {
    const payload: PayloadLeccionSugerida = {
      titulo: leccion.titulo,
      contenido: leccion.contenido,
      categoria: leccion.categoria,
      fecha,
      project_id: projectId,
      tema,
      modelo: uso.modelo,
    };

    const { error } = await supabase.from("inbox").insert({
      user_id: userId,
      tipo: "leccion_sugerida",
      estado: "pendiente",
      entidad_tabla: "projects",
      entidad_id: projectId,
      clave_dedupe: claveDedupe(projectId, leccion.titulo),
      payload: { ...payload },
    });

    // 23505 = ya hay una propuesta viva con ese título para ese proyecto.
    // Es el dedupe funcionando, no un error.
    if (error && error.code !== "23505") throw new Error(error.message);
    if (error) reporte.repetidas++;
    else reporte.propuestas++;
  }

  return reporte;
}

/**
 * Clave de deduplicación por proyecto y título normalizado.
 *
 * El índice único de `inbox` solo cubre lo no resuelto, así que una
 * propuesta rechazada no bloquea para siempre: si más adelante el modelo
 * vuelve a proponer lo mismo, entra. Lo que evita es tener dos veces la
 * misma lección esperando en la cola.
 */
function claveDedupe(projectId: string, titulo: string): string {
  const normalizado = titulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return `leccion_sugerida:${projectId}:${normalizado}`;
}
