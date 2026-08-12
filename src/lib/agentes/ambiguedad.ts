import { UMBRAL_CONFIANZA, type Decision } from "@/lib/agentes/tipos";

/**
 * ¿La frase es un sustantivo o un nombre suelto, sin verbo ni pregunta?
 *
 * ## Por qué está en código y no en el prompt
 *
 * Estas 24 líneas **vivían en el prompt del recepcionista**, y eran las
 * que más se rompieron: cuatro incidentes medidos, dos de ellos por
 * cambios que **ni siquiera nombraban** lo que rompieron. El propio
 * prompt las presentaba como *"una comprobación mecánica sobre la frase,
 * sin pensar en el tema"* — o sea, un test sobre un string viviendo en un
 * prompt.
 *
 * Es la misma regla que ya aplicaron `textoDelMovimiento()`,
 * `pareceAnotacion()` y `normalizarClavesDecision()`: si se puede
 * resolver con un test sobre un string, se hace ahí.
 *
 * ## Por qué en código funciona algo que en el prompt no funcionaba
 *
 * No es una intuición, está medido y escrito en `recepcionista.ts`:
 * pedirle al modelo esta comprobación como regla abstracta **dejó
 * `"Claude Code"` en confianza 1**. Lo único que la bajaba eran cuatro
 * ejemplos concretos, y el comentario avisaba: *"si sacás los ejemplos,
 * 'Claude Code' vuelve a 1"*. O sea que el modelo no aplicaba la regla:
 * la imitaba. Acá se aplica siempre, y por eso los ejemplos también
 * pudieron salir del prompt.
 *
 * ## La asimetría que la hace segura
 *
 * Un **falso positivo** (dice ambigua y no lo era) cuesta una pregunta de
 * más. Un **falso negativo** (no la detecta) no acota nada y deja el
 * comportamiento exactamente como estaba antes de que este archivo
 * existiera: no hay regresión posible, solo mejora que no llegó.
 *
 * Por eso, ante la duda, esta función **no** declara ambigüedad.
 */

/** `qué`, `cuánto`, `cómo`… con o sin tilde. */
const PALABRAS_PREGUNTA =
  /\b(qu[eé]|cu[aá]nto?s?|cu[aá]ntas?|c[oó]mo|cu[aá]l(es)?|d[oó]nde|cu[aá]ndo|qui[eé]n(es)?|por\s?qu[eé])\b/i;

/**
 * En rioplatense el imperativo y el pretérito caen en vocal acentuada
 * final: `cerrá`, `anotá`, `sacá`, `poné`, `hacé`, `reabrí`, `pagué`,
 * `cobré`, `salió`. Sola, esta señal resuelve casi todo.
 */
const VOCAL_ACENTUADA_FINAL = /[áéíóú]$/;

/** Voseo de segunda persona: `sugerís`, `tenés`, `querés`, `hacés`. */
const VOSEO = /[áéíóú]s$/;

/**
 * Conjugaciones que NO caen en vocal acentuada final: imperfecto
 * (`tenía`, `estábamos`), primera del plural (`agreguemos`, `sumemos`) y
 * gerundio (`pagando`, `viendo`).
 *
 * ⚠ **No incluye `-an` ni `-en`, a propósito.** Matchean demasiados
 * sustantivos —`orden`, `imagen`, `margen`, `joven`— y cada uno sería una
 * frase ambigua que deja de detectarse.
 */
const TERMINACIONES_VERBALES =
  /(aba|abas|ábamos|aban|ía|ías|íamos|ían|amos|emos|imos|ando|iendo)$/;

/**
 * Los conjugados que no caen en ningún patrón. Lista **cerrada y corta**
 * a propósito.
 *
 * ⚠ **No hay regla general de enclíticos.** El prototipo tenía una
 * (`^[a-zñ]{3,}(lo|la|le|…)$`, para `activalo`) y **rompió
 * `"Google Ads"`**: `"google"` termina en `le`. Fue el único fallo de la
 * corrida final y se resolvió borrándola, no ajustándola. Los enclíticos
 * que Beno usa de verdad están acá abajo.
 */
const VERBOS_SIN_PATRON = new Set([
  "estoy", "esta", "está", "viene", "toca", "tengo", "hay", "sigue", "voy",
  "quiero", "necesito", "pague", "cobre", "gaste", "salio", "vino", "fue",
  "es", "son", "dame", "mostrame", "decime", "busca", "busco", "anda",
  "puedo", "debo", "falta", "queda",
  "activalo", "activala", "cerralo", "cerrala", "abrilo", "borralo", "hacelo",
]);

function tieneVerboConjugado(frase: string): boolean {
  return frase
    .trim()
    .split(/\s+/)
    .some((palabra) => {
      const limpia = palabra.replace(/[.,;:!?¿¡"'()]/g, "").toLowerCase();
      if (!limpia) return false;
      if (VOCAL_ACENTUADA_FINAL.test(limpia)) return true;
      if (VOSEO.test(limpia)) return true;
      if (TERMINACIONES_VERBALES.test(limpia)) return true;
      return VERBOS_SIN_PATRON.has(limpia);
    });
}

export function esAmbigua(frase: string): boolean {
  const limpia = frase.trim();
  if (!limpia) return true;
  if (PALABRAS_PREGUNTA.test(limpia)) return false;
  if (/\d/.test(limpia)) return false;
  return !tieneVerboConjugado(limpia);
}

/**
 * El techo que se le pone a una frase ambigua.
 *
 * Tiene que quedar **por debajo de `UMBRAL_CONFIANZA`** o no dispara la
 * pregunta, que es todo el punto. El test lo verifica.
 */
export const TECHO_AMBIGUA = 0.4;

/**
 * Acota la confianza hacia abajo. **Nunca la sube.**
 *
 * Esa dirección es lo que hace que este cambio no pueda causar el daño
 * que la app teme: el código solo puede volver más prudente al sistema,
 * nunca más audaz. El peor caso de un error acá es una pregunta de más
 * —el error barato, según AGENTS.md §9: *"una pregunta de más molesta,
 * una derivación equivocada muda hace lo que nadie pidió"*—.
 *
 * El **destino no se toca**: lo sigue eligiendo el modelo.
 */
export function acotarConfianza<T extends Pick<Decision, "confianza">>(
  decision: T,
): T {
  return { ...decision, confianza: Math.min(decision.confianza, TECHO_AMBIGUA) };
}

// Si alguien sube el umbral por encima del techo, esto deja de servir.
if (TECHO_AMBIGUA >= UMBRAL_CONFIANZA) {
  throw new Error(
    `TECHO_AMBIGUA (${TECHO_AMBIGUA}) tiene que ser menor que UMBRAL_CONFIANZA (${UMBRAL_CONFIANZA}).`,
  );
}
