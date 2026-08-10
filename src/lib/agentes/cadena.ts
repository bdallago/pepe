import "server-only";

import { despachar } from "@/lib/agentes/despacho";
import {
  MAX_ACCIONES,
  UMBRAL_CONFIANZA,
  type Decision,
  type RespuestaAgente,
  type RespuestaSimple,
} from "@/lib/agentes/tipos";
import { mensajeDeErrorLLM } from "@/lib/llm";
import type { SupabaseClient } from "@/lib/supabase/server";

/**
 * Ejecuta en orden las acciones que sacó el recepcionista de una frase.
 *
 * Vive en su propio módulo y no adentro de `despacho.ts` a propósito:
 * `despachar()` es un switch de cáscaras sobre funciones de dominio y su
 * regla escrita es que no se le meten reglas de negocio. Lo de acá **es**
 * una regla —qué pasa cuando una acción falla, cuándo se frena, qué se
 * le dice a Beno de lo que quedó a medias— y no tiene nada que ver con
 * ningún especialista en particular. Separado, `despachar()` sigue siendo
 * una función de una decisión que se puede probar sola, y esta se lee de
 * arriba abajo en una pantalla.
 *
 * ## Por qué esto no necesita transacción ni rollback
 *
 * Porque en Pepe **nada se escribe sin confirmación** (regla 6 de
 * AGENTS.md): lo que produce un modelo termina en `inbox` con estado
 * `pendiente`, y lo demás termina en un formulario. Una frase con tres
 * pedidos deja tres propuestas esperando; si la segunda falla, quedan
 * dos. No hay estado inconsistente que deshacer —nada entró al dominio—
 * así que seguir con las que siguen es siempre mejor que abortar, y es
 * además lo que pide la regla 7: que una feature de modelo que se rompe
 * no se lleve puesto el resto. Toda la simplicidad de este archivo sale
 * de ahí.
 *
 * ## La excepción
 *
 * `tema_estudio` **sí escribe directo** en `sessions`, y con razón: lo
 * que guarda es el texto que Beno tipeó, no producción de un modelo (el
 * porqué largo está en su rama de `despacho.ts`). Si esa acción va en el
 * medio de una cadena y una posterior falla, la sesión **queda creada**.
 * No se deshace: archivarla sola sería peor —borrarle algo que pidió
 * porque falló otra cosa—, y acá borrar es archivar igual (regla 4). Lo
 * que sí se hace es **decirlo**: cada paso muestra su propia respuesta,
 * la de `tema_estudio` dice exactamente qué creó y dónde, y el título de
 * la cadena dice cuántas salieron y cuántas no. Que quede escrito no es
 * el problema; que quede escrito en silencio, sí.
 */
export async function ejecutarCadena(
  supabase: SupabaseClient,
  userId: string,
  frase: string,
  decisiones: Decision[],
): Promise<RespuestaAgente> {
  const acciones = decisiones.slice(0, MAX_ACCIONES);

  if (acciones.length === 0) {
    return {
      clase: "aviso",
      titulo: "No entendí qué necesitás",
      cuerpo:
        "Probá con algo como “cómo viene Proder”, “qué me toca hoy” o “qué estoy pagando que no uso”.",
    };
  }

  const pasos: { destino: Decision["destino"]; respuesta: RespuestaSimple }[] =
    [];
  let pendientes: Decision[] = [];
  let fallaron = 0;

  for (const [indice, decision] of acciones.entries()) {
    /*
      Se ejecuta **una por vez, en orden**, y no en paralelo. Dos motivos,
      los dos concretos: comparten el limitador de Groq —que serializa
      igual, así que el paralelismo solo desordenaría la salida sin
      ganar tiempo— y el orden es el que Beno escribió, que es como va a
      leer la respuesta.
    */
    const { respuesta, fallo } = await ejecutarUna(
      supabase,
      userId,
      decision,
      acciones.length === 1 ? frase : (decision.argumento ?? frase),
    );

    // El "falló" lo dice quien la ejecutó y no un `includes` sobre el
    // título: un aviso puede ser una respuesta perfecta ("no encontré
    // suscripciones sin uso") y no hay forma de distinguirlo mirándolo.
    if (fallo) fallaron++;

    pasos.push({ destino: decision.destino, respuesta });

    /*
      Una pregunta corta la cadena. No se pueden hacer tres preguntas a la
      vez en una caja de una línea: quedaría un montón de botones sin
      saber cuál contesta qué.

      **Lo que quedó pendiente se descarta**, y se muestra. Cuando Beno
      aprieta una opción, la caja manda ese destino solo y el handler no
      vuelve a pasar por el recepcionista: no hay dónde guardar el resto
      sin inventar estado del lado del servidor para una app que no lo
      tiene en ninguna otra parte. La alternativa —seguir de largo con
      las siguientes y contestar la pregunta al final— rompe el orden que
      él escribió y le contesta cosas que quizá dependían de la respuesta
      que todavía no dio. Así que se frena, se dice qué falta, y si lo
      quiere lo vuelve a pedir en una frase.
    */
    if (respuesta.clase === "pregunta") {
      pendientes = acciones.slice(indice + 1);
      break;
    }
  }

  // Con una sola acción no hay cadena que mostrar: la respuesta va pelada
  // y la pantalla se ve igual que siempre. Es el caso normal, y de lejos.
  if (acciones.length === 1) return pasos[0]!.respuesta;

  return {
    clase: "cadena",
    titulo: tituloDeCadena(acciones.length, pasos.length, fallaron),
    pasos,
    pendientes: pendientes.map((d) => ({
      destino: d.destino,
      argumento: d.argumento,
    })),
  };
}

/**
 * Una acción: la pregunta por confianza baja, o el despacho.
 *
 * Nunca lanza. Que una acción se rompa no puede tumbar a las otras
 * (regla 7), así que el error se convierte en un paso más de la
 * respuesta, visible y en su lugar de la lista.
 */
async function ejecutarUna(
  supabase: SupabaseClient,
  userId: string,
  decision: Decision,
  /**
   * Lo que se le muestra a Beno cuando hay que preguntarle. Con una sola
   * acción es la frase entera; con varias, el argumento es lo único que
   * identifica a cuál de los pedidos le está preguntando.
   */
  fragmento: string,
): Promise<{ respuesta: RespuestaSimple; fallo: boolean }> {
  if (decision.confianza < UMBRAL_CONFIANZA) {
    return {
      fallo: false,
      respuesta: {
        clase: "pregunta",
        titulo: `No estoy seguro de qué querés hacer con “${fragmento}”`,
        opciones: [
          {
            etiqueta: "Anotar un gasto",
            destino: "movimientos",
            argumento: fragmento,
          },
          {
            etiqueta: "Buscar algo que anoté",
            destino: "buscador",
            argumento: fragmento,
          },
          { etiqueta: "Ver números", destino: "consultas", argumento: fragmento },
        ],
      },
    };
  }

  try {
    return { respuesta: await despachar(supabase, userId, decision), fallo: false };
  } catch (error: unknown) {
    console.error("[agentes] falló una acción de la cadena:", error);
    return {
      fallo: true,
      respuesta: {
        clase: "aviso",
        titulo: "Esto no me salió",
        cuerpo: mensajeDeErrorLLM(error),
      },
    };
  }
}

/** Dice de entrada qué quedó hecho y qué no, sin que haya que contar. */
function tituloDeCadena(
  pedidas: number,
  ejecutadas: number,
  fallaron: number,
): string {
  const salieron = ejecutadas - fallaron;

  if (ejecutadas < pedidas) {
    return `Hice ${salieron} de ${pedidas} y frené para preguntarte`;
  }
  if (fallaron > 0) {
    return `Hice ${salieron} de ${pedidas}; el resto no me salió`;
  }
  return `Hice las ${pedidas} cosas que pediste`;
}
