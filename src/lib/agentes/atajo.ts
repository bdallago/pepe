import { esAmbigua, TECHO_AMBIGUA } from "@/lib/agentes/ambiguedad";
import type { Decision } from "@/lib/agentes/tipos";

/**
 * Frases que no necesitan al modelo.
 *
 * AGENTS.md §9 lo pide con todas las letras: *"si algo se puede resolver
 * sin modelo, se resuelve sin modelo"*. Lo que hace este archivo es
 * cobrar esa regla en el único lugar donde todavía no se cobraba: hoy una
 * frase telegráfica **paga una llamada a Groq entera** solo para que el
 * modelo conteste `"movimientos"` — y después `agentes/movimientos.ts` la
 * parsea igual con una expresión regular, sin modelo.
 *
 * Lo que compra: estabilidad perfecta (una regexp no oscila entre
 * corridas), latencia cero donde más se nota —medido el 2026-08-11, tres
 * frases seguidas esperaron ~59 s cada una al limitador— y cupo liberado.
 *
 * ## Solo entran dos casos, y no se agregan más
 *
 * Cada atajo es una regla que puede equivocarse en silencio, y el modelo
 * es mejor que una regexp en todo lo que no sea estrictamente mecánico.
 *
 * ⚠ **Un atajo no puede tener la última palabra sobre algo que escriba
 * directo.** Los dos elegidos cumplen: `movimientos` termina en un
 * formulario que Beno confirma, y la frase ambigua termina en una
 * pregunta. Si alguna vez se quiere atajar `bitacora` —que escribe
 * directo—, la respuesta es que no.
 */
export interface Atajo {
  decisiones: Decision[];
  /** Para el log: por qué no se llamó al modelo. */
  motivo: "telegrafico" | "ambigua";
}

/**
 * Signo, monto, moneda opcional, descripción y fecha opcional. Es la
 * forma de las cinco frases telegráficas reales de Beno, medidas el
 * 2026-08-10: las cinco fueron a `movimientos` con confianza 1 y el
 * argumento volvió idéntico a la frase.
 */
const TELEGRAFICO =
  /^[+-]\s?\d[\d.,]*\s*(usd|ars|u\$s|\$|dolares|dólares|pesos)?\s+\S+/i;

/** Menos que esto no alcanza para adivinar qué quiere. */
const MAX_PALABRAS_AMBIGUA = 2;

export function atajar(frase: string): Atajo | null {
  const limpia = frase.trim();
  if (!limpia) return null;

  if (TELEGRAFICO.test(limpia)) {
    return {
      motivo: "telegrafico",
      decisiones: [
        {
          destino: "movimientos",
          // La frase ENTERA, no un recorte: sin el número no hay gasto
          // que cargar, y es el modo de fallar que ya mordió una vez.
          argumento: limpia,
          confianza: 1,
        },
      ],
    };
  }

  const palabras = limpia.split(/\s+/).filter(Boolean).length;
  if (esAmbigua(limpia) && palabras <= MAX_PALABRAS_AMBIGUA) {
    return {
      motivo: "ambigua",
      decisiones: [
        {
          // El destino da igual: con esta confianza la cadena pregunta
          // antes de despachar. La pantalla ofrece las cuatro opciones
          // con el argumento intacto.
          destino: "desconocido",
          argumento: limpia,
          confianza: TECHO_AMBIGUA,
        },
      ],
    };
  }

  return null;
}
