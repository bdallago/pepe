import { leerFecha } from "@/lib/agentes/fechas";

/**
 * Qué se le pide a un proyecto, leído de la frase **sin modelo**.
 *
 * Es el mismo criterio que `fechas.ts` y `rango.ts`: si algo se puede
 * resolver sin modelo, se resuelve sin modelo. El recepcionista devuelve
 * texto libre ("Proder apertura 01/04/26 y cierre 31/07/26") y pasar eso a
 * una operación con dos fechas es un puñado de expresiones regulares.
 *
 * ## Por qué esto habilita a la rama a escribir directo
 *
 * Igual que `agentes/bitacora.ts`: **no hay producción de un modelo**. Las
 * fechas las dice Beno, leerlas es aritmética de calendario y el nombre del
 * proyecto se resuelve contra tres filas. No hay nada que confirmar que no
 * haya escrito él.
 *
 * ⚠ **Si alguna vez el prompt de este destino pasa a pedirle al modelo que
 * interprete, complete o infiera fechas, ese razonamiento se cae y esto
 * pasa a necesitar la bandeja.** El recepcionista tiene prohibido tocar el
 * argumento; lo único que hace es recortar de la frase qué parte le toca a
 * este destino.
 */

export type OperacionDeProyecto =
  /** Crear uno nuevo. */
  | "crear"
  /** Poner o mover `fecha_inicio` / `fecha_fin`. */
  | "ventana"
  /** Cerrar: `fecha_fin` en la fecha dicha, o en hoy. */
  | "cerrar"
  /** Reabrir: `fecha_fin` a null. */
  | "reabrir"
  /** Cambiarle el nombre. */
  | "renombrar";

export interface PedidoDeProyecto {
  operacion: OperacionDeProyecto;
  /**
   * El texto con el que hay que encontrar el proyecto, ya sin los verbos
   * ni las fechas. Puede quedar vacío ("activalo"), y ahí quien llama
   * pregunta cuál.
   */
  nombre: string;
  /** Solo en `renombrar`. */
  nuevoNombre: string | null;
  apertura: string | null;
  cierre: string | null;
}

/**
 * Frontera de palabra que entiende los acentos.
 *
 * `\b` de JS se define contra `\w` (`[A-Za-z0-9_]`), que **no incluye
 * vocales acentuadas**. Contra "cerrá Proder", `\b` al final de `cerr[áa]`
 * no matchea cuando el grupo eligió "á": los dos lados de esa posición
 * —la "á" y el espacio que sigue— son "no palabra" para `\w`, y `\b`
 * exige que un lado sea palabra y el otro no. Medido el 2026-08-11: con
 * `\b` normal, "cerrá Proder", "reabrí Proder", "creá…" y "renombrá…"
 * quedaban **todos** sin detectar y caían al default `"ventana"`. Con
 * `\p{L}` (cualquier letra Unicode, con el flag `u`) la acentuada cuenta
 * como palabra y el corte contra el espacio funciona como se espera.
 */
const NI_LETRA_NI_NUMERO = "[\\p{L}\\p{N}]";
const B_INICIO = `(?<!${NI_LETRA_NI_NUMERO})`;
const B_FIN = `(?!${NI_LETRA_NI_NUMERO})`;

/** Arma una regex con fronteras Unicode-seguras alrededor de la alternativa. */
function conFrontera(alternativas: string): RegExp {
  return new RegExp(`${B_INICIO}(?:${alternativas})${B_FIN}`, "iu");
}

/** Los verbos de cada operación. Léxicos, como todo lo determinístico acá. */
const CREAR = conFrontera("cre[áa]|cre[áa]me|arm[áa]|nuevo\\s+proyecto|proyecto\\s+nuevo");
const CERRAR = conFrontera("cerr[áa]|cerr[áa]me|dar?\\s+de\\s+baja|termin[áa]|finaliz[áa]");
const REABRIR = conFrontera(
  "reabr[íi]|volv[ée]\\s+a\\s+abrir|activ[áa](?:lo|la)?|reactiv[áa](?:lo|la)?|abr[íi]\\s+de\\s+nuevo",
);
const RENOMBRAR = conFrontera(
  "renombr[áa]|cambi[áa]le\\s+el\\s+nombre|pas[áa]\\s+a\\s+llamarse",
);

/** Dónde parte el texto entre lo de apertura y lo de cierre. */
const MARCA_APERTURA = conFrontera(
  "apertura|inicio|arranc[óa]|arranca|empez[óa]|desde|abri[óo]",
);
const MARCA_CIERRE = conFrontera("cierre|fin(?:aliz[óa])?|termin[óa]|hasta|cerr[óo]");

/**
 * Todo lo que `fechas.ts` sabe leer, para poder **sacarlo** del texto y
 * quedarme con el nombre. Se arma de la misma lista para que no se separe
 * de las reglas: si allá aparece un formato nuevo, acá deja de borrarse y
 * se ve enseguida en el nombre resuelto.
 */
const EXPRESIONES_DE_FECHA =
  /\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|(?:el\s+)?\d{1,2}\s+de\s+[a-záéíóú]+(?:\s+de\s+\d{4})?|anteayer|antes\s+de\s+ayer|ayer|hoy|hace\s+\S+\s+(?:d[íi]as?|semanas?)|(?:la\s+)?semana\s+pasada)\b/gi;

/**
 * Palabras de relleno que quedan pegadas al nombre después de sacar los
 * verbos y las fechas ("el proyecto Proder").
 *
 * ⚠ **"de" no está en la lista, a propósito.** Es filler en "las fechas de
 * Proder", pero también es parte legítima de un nombre real: "Agente de
 * RRHH" perdía el "de" del medio y quedaba "Agente RRHH". Entre limpiar un
 * caso que no se prueba y romper uno que sí, gana el nombre real —el
 * mismo criterio que en el resto del plan: mejor cubrir menos que adivinar
 * mal.
 */
const RELLENO =
  /\b(?:el|la|los|las|un|una|del|para|las?\s+fechas?|proyecto|proyectos|y|con|que|su)\b/gi;

export function leerPedidoDeProyecto(
  argumento: string | null,
  hoy: string,
): PedidoDeProyecto {
  const texto = (argumento ?? "").trim();

  const operacion: OperacionDeProyecto = RENOMBRAR.test(texto)
    ? "renombrar"
    : REABRIR.test(texto)
      ? "reabrir"
      : CREAR.test(texto)
        ? "crear"
        : CERRAR.test(texto) && !MARCA_APERTURA.test(texto)
          ? "cerrar"
          : "ventana";

  const { apertura, cierre } = leerLasDosFechas(texto, hoy);

  // "renombrá X a Y": el nombre nuevo es lo que viene después del " a ".
  let nuevoNombre: string | null = null;
  let paraElNombre = texto;

  if (operacion === "renombrar") {
    const corte = texto.search(/\s+a\s+/i);
    if (corte !== -1) {
      nuevoNombre = limpiarNombre(texto.slice(corte + 3), { relleno: false });
      paraElNombre = texto.slice(0, corte);
    }
  }

  return {
    operacion,
    nombre: limpiarNombre(paraElNombre, { relleno: true }),
    nuevoNombre,
    apertura,
    cierre,
  };
}

/**
 * Las dos fechas de una ventana, leídas por separado.
 *
 * `leerFecha()` devuelve **solo la primera** que encuentra, así que el
 * texto se parte antes por las marcas de apertura y cierre. Sin partir,
 * "apertura 01/04/26 y cierre 31/07/26" devolvía 01/04 para las dos cosas.
 *
 * ⚠ **Las dos van con `{ futuro: true }`.** Es lo único que hace que "cerrá
 * X el 30/12" escriba diciembre de este año y no del pasado.
 */
function leerLasDosFechas(
  texto: string,
  hoy: string,
): { apertura: string | null; cierre: string | null } {
  const iCierre = texto.search(MARCA_CIERRE);
  const iApertura = texto.search(MARCA_APERTURA);

  // Sin ninguna marca, una sola fecha suelta: es de lo que diga el verbo.
  if (iCierre === -1 && iApertura === -1) {
    const sola = leerFecha(texto, hoy, { futuro: true });
    if (!sola.explicita) return { apertura: null, cierre: null };
    return CERRAR.test(texto)
      ? { apertura: null, cierre: sola.fecha }
      : { apertura: sola.fecha, cierre: null };
  }

  const corte =
    iCierre === -1 ? texto.length : iApertura > iCierre ? iApertura : iCierre;

  const primero = texto.slice(0, corte);
  const segundo = texto.slice(corte);

  const laDe = (trozo: string) => {
    const f = leerFecha(trozo, hoy, { futuro: true });
    return f.explicita ? f.fecha : null;
  };

  return iApertura > iCierre
    ? { apertura: laDe(segundo), cierre: laDe(primero) }
    : { apertura: laDe(primero), cierre: laDe(segundo) };
}

/** Saca verbos, fechas y relleno; lo que queda es el nombre. */
function limpiarNombre(
  texto: string,
  { relleno }: { relleno: boolean },
): string {
  let limpio = texto
    .replace(CREAR, " ")
    .replace(CERRAR, " ")
    .replace(REABRIR, " ")
    .replace(RENOMBRAR, " ")
    .replace(MARCA_APERTURA, " ")
    .replace(MARCA_CIERRE, " ")
    .replace(EXPRESIONES_DE_FECHA, " ");

  if (relleno) limpio = limpio.replace(RELLENO, " ");

  return limpio.replace(/[.,;:]/g, " ").replace(/\s+/g, " ").trim();
}
