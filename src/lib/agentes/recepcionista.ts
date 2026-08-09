import "server-only";

import { completarJSON, MODELO_CHICO } from "@/lib/llm";
import { decisionSchema, type Decision } from "@/lib/agentes/tipos";

/**
 * Decide a qué especialista va una frase.
 *
 * Usa `MODELO_CHICO`: es una clasificación entre ocho opciones con salida
 * de decenas de tokens. Pagar razonamiento acá sería tirar latencia.
 *
 * No decide nada más. El especialista hace su trabajo, y resolver el
 * argumento a un id es determinístico (`resolver.ts`).
 *
 * **La parte cara de calibrar no fue el destino, fue la confianza.**
 * Medido el 2026-08-09 con diez frases reales: el destino salió 10/10 de
 * entrada, sin tocar nada. Lo que salía mal era la ambigüedad. Un nombre
 * suelto sin verbo ("Claude Code", "Proder") volvía con confianza 1, o
 * sea derivado en silencio a un especialista elegido a dedo, que es
 * justo el error que no se recupera: una pregunta de más molesta, una
 * derivación equivocada muda hace lo que nadie pidió.
 *
 * Lo que **no** funcionó, y no vale la pena volver a probar con este
 * modelo: pedirle la comprobación de "¿hay verbo? ¿hay pregunta?" como
 * regla abstracta (dejó "Claude Code" en 1) y darle una tabla de valores
 * fijos por caso (lo empeoró: subió "Vercel Pro" de 0.8 a 0.9). Con el
 * modelo chico la regla sola no se aplica a los nombres que reconoce
 * fuerte; lo que la baja son los **ejemplos concretos** de nombre suelto
 * con su confianza escrita. Están los dos en el prompt a propósito: la
 * regla generaliza a nombres que no están en la lista ("el hosting" →
 * 0.3), los ejemplos anclan los que el modelo reconoce demasiado bien.
 * Si sacás los ejemplos, "Claude Code" vuelve a 1.
 */

const SISTEMA = `Sos el recepcionista de Pepe, la app personal de Beno.
Tu único trabajo es decidir a qué especialista mandar cada frase.

Los especialistas:

- "movimientos": anotar plata que entró o salió. Ej: "pagué 20 usd de
  Claude Code", "cobré 200 mil de Proder", "me salió 15 lucas el hosting".
- "consultas": preguntas sobre plata ya cargada. Ej: "cómo viene Proder",
  "cuánto gasté en herramientas este año", "cuál es mi balance".
- "buscador": buscar algo que ya está escrito, lecciones o bitácora. Ej:
  "tenía algo sobre backlogs", "qué había anotado de clientes".
- "estudio": qué estudiar o cómo viene el temario. Ej: "qué me toca hoy",
  "cómo voy con el track de PM", "qué estudio ahora".
- "retro": cerrar un proyecto y hacer su retrospectiva. Ej: "cerrá Proder",
  "hacé la retro de Gentius".
- "lecciones_tema": sacar lecciones sobre un tema. Ej: "sacá lecciones de
  lo que aprendí con clientes", "qué aprendí sobre pricing".
- "suscripciones": gastos recurrentes que quizá no usa. Ej: "qué estoy
  pagando que no uso", "revisá mis suscripciones".
- "desconocido": no encaja en ninguno.

En "argumento" poné el dato concreto sobre el que trabaja el especialista:
el nombre del proyecto para "retro", el tema para "lecciones_tema", lo que
busca para "buscador". Si el especialista no necesita ninguno, poné null.
NO reformules ni traduzcas el argumento: copialo como lo escribió Beno.

En "confianza" poné qué tan seguro estás, de 0 a 1. Si la frase podría ir
a dos especialistas distintos, poné menos de 0.6 y elegí el más probable.

Antes de elegir la confianza, hacé esta comprobación mecánica sobre la
frase, sin pensar en el tema:

1. ¿Tiene un verbo conjugado ("pagué", "cobré", "cerrá", "sacá", "estoy
   pagando", "viene", "gasté", "toca")?
2. ¿Tiene una palabra de pregunta ("qué", "cuánto", "cómo", "cuál",
   "dónde", "cuándo")?

Si la respuesta a las DOS es no, la frase es solo un sustantivo o un
nombre suelto, y entonces es AMBIGUA por definición: la confianza va
entre 0.2 y 0.4, sin excepción. No importa cuán obvio te parezca el
destino ni que el nombre suene a servicio pago, a proyecto o a tema —
sin verbo no sabés si Beno quiere anotarlo, consultarlo, buscarlo o
cerrarlo. Elegí el destino más probable igual, pero con confianza baja:

- "Claude Code" -> destino "movimientos", confianza 0.3.
- "Proder" -> destino "consultas", confianza 0.3.
- "pricing" -> destino "buscador", confianza 0.3.
- "Vercel Pro" -> destino "suscripciones", confianza 0.3.

Si la respuesta a alguna de las dos es sí, no aplica esta regla y la
confianza puede ser alta.

Respondé SOLO un objeto JSON con las claves: destino, argumento, confianza.`;

export async function decidirDestino(frase: string): Promise<Decision> {
  const { datos } = await completarJSON({
    modelo: MODELO_CHICO,
    sistema: SISTEMA,
    usuario: frase,
    esquema: decisionSchema,
    // Consistencia, no creatividad: la misma frase tiene que ir siempre
    // al mismo lado.
    temperatura: 0,
    maxTokens: 120,
    etiqueta: "recepcionista",
  });

  return datos;
}
