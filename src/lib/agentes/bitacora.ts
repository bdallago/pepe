import { leerFecha } from "@/lib/agentes/fechas";
import { todayISO } from "@/lib/dates";

/**
 * Lo que se anota y en qué fecha, leído de la frase **sin tocar el texto**.
 *
 * ## Por qué esta rama escribe directo y no pasa por la bandeja
 *
 * Porque el agente de bitácora **transcribe literal**: no reformula, no
 * resume, no corrige y no mejora. Eso lo saca del alcance de la regla 6 de
 * `AGENTS.md`, y **no por excepción**: lo que la regla protege es que no se
 * guarde **producción de un modelo** sin que Beno la confirme —una lección
 * redactada por el razonador, el texto de una retro, una propuesta de
 * zombie—. Acá no hay producción de modelo: el texto es de Beno, palabra
 * por palabra. Lo único que un modelo toca es **recortar de la frase qué
 * parte es la anotación** (el recepcionista, que tiene prohibido
 * reformular el argumento), y la fecha cuando la frase la menciona. Pedirle
 * que confirme lo que acaba de tipear sería fricción sin nada del otro
 * lado. Está decidido así en el spec (`docs/superpowers/specs/
 * 2026-08-09-agentes-design.md`, ola 3) y es el mismo razonamiento que
 * habilita a `tema_estudio`.
 *
 * ⚠ **Si alguna vez alguien le mete al prompt una instrucción de mejorar,
 * resumir, corregir o "redactar mejor" el texto, el razonamiento de arriba
 * deja de valer y esta rama pasa a necesitar la bandeja.** No es una
 * preferencia de estilo: es la única condición bajo la cual escribir sin
 * confirmación no contradice la regla 6. El spec lo dice con todas las
 * letras: *"apenas reformule, deja de valer el razonamiento de arriba y
 * pasa a necesitar la bandeja"*.
 *
 * El riesgo que sí queda es la derivación equivocada —un mensaje que iba a
 * otro lado termina como entrada del día—, y se cubre por afuera: la
 * respuesta muestra exactamente qué se escribió, en qué fecha y en qué
 * proyecto, y borrar es archivar (regla 4), así que nada se pierde.
 *
 * ## Y por qué la fecha se resuelve en código
 *
 * Mismo criterio que `rango.ts`, y el desarrollo completo está en
 * `agentes/fechas.ts`, que es de donde sale `leerFecha()`: un modelo que
 * devuelve fechas se equivoca de mes, de año o de zona horaria sin que se
 * note. Esas reglas viven en un módulo aparte porque el agente de
 * movimientos necesita exactamente las mismas.
 */

export interface Anotacion {
  /** El texto a guardar, tal cual. Vacío si la frase no traía nada. */
  contenido: string;
  /** "YYYY-MM-DD". */
  fecha: string;
  /** Cómo la nombró él ("ayer", "el martes") o la fecha formateada. */
  etiquetaFecha: string;
  /** La frase mencionaba una fecha. Si no, `fecha` es hoy por defecto. */
  fechaExplicita: boolean;
}

/**
 * Los verbos con los que Beno pide que se anote algo.
 *
 * Se sacan del **principio** de la frase y nada más: son la instrucción,
 * no la anotación. Todo lo que viene después se guarda intacto, incluida
 * la expresión de fecha ("ayer peleé con el deploy" se guarda entero y
 * además se fecha en ayer).
 *
 * Es un recorte determinístico y sobre un prefijo, no una reescritura: la
 * distinción es la que sostiene todo el comentario de arriba. El
 * recepcionista normalmente ya devuelve el argumento limpio; esto es la
 * red por si deja el "anotá que" adelante.
 */
const PEDIDO =
  /^\s*(?:y\s+)?(?:que\s+)?(?:me\s+|te\s+)?(?:lo\s+)?(?:anot[áa]|apunt[áa]|registr[áa]|guard[áa]|escrib[íi]|pon[ée]|sum[áa]|agreg[áa])(?:me|lo|melo)?\s*(?:esto\s+)?(?:en\s+(?:la\s+|mi\s+)?(?:bit[áa]cora|nota|notas|diario)\s*)?(?:que\s+|:\s*|,\s*)?/i;

/**
 * Lee la anotación de lo que devolvió el recepcionista.
 *
 * `hoy` es parámetro para poder verificarlo sin depender del día en que se
 * corre; por defecto sale de `todayISO()`, que trabaja en hora argentina.
 */
export function leerAnotacion(
  argumento: string | null,
  hoy: string = todayISO(),
): Anotacion {
  const contenido = (argumento ?? "").trim().replace(PEDIDO, "").trim();
  const { fecha, etiqueta, explicita } = leerFecha(contenido, hoy);

  return {
    contenido,
    fecha,
    etiquetaFecha: etiqueta,
    fechaExplicita: explicita,
  };
}
