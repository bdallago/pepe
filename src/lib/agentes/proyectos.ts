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
const LETRA_O_NUMERO = "[\\p{L}\\p{N}]";
const B_INICIO = `(?<!${LETRA_O_NUMERO})`;
const B_FIN = `(?!${LETRA_O_NUMERO})`;

/** Arma una regex con fronteras Unicode-seguras alrededor de la alternativa. */
function conFrontera(alternativas: string): RegExp {
  return new RegExp(`${B_INICIO}(?:${alternativas})${B_FIN}`, "iu");
}

/**
 * Los verbos de cada operación. Léxicos, como todo lo determinístico acá.
 *
 * Sin flag `g`, a propósito: alcanza con la primera ocurrencia, porque el
 * recepcionista ya partió la frase multi-acción antes de que esto la vea
 * — dos verbos de proyecto en el mismo argumento no es un caso real. Es
 * distinto de `EXPRESIONES_DE_FECHA` y `ANDAMIAJE`, que sí llevan `g`
 * porque una sola frase puede traer varias fechas ("apertura … y cierre
 * …") o varios tramos de andamiaje ("el proyecto … las fechas de …").
 */
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
 * quedarme con el nombre.
 *
 * No se arma de ninguna lista compartida: es una copia a mano de las
 * expresiones de `REGLAS`, en `fechas.ts`, porque esas reglas son
 * funciones (`armar()`) y no texto del que se pueda derivar una regex.
 * Si allá aparece un formato nuevo, hay que traerlo acá también — si no,
 * ese formato deja de borrarse y aparece pegado al nombre resuelto.
 */
const EXPRESIONES_DE_FECHA =
  /\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|(?:el\s+)?\d{1,2}\s+de\s+[a-záéíóú]+(?:\s+de\s+\d{4})?|anteayer|antes\s+de\s+ayer|ayer|hoy|hace\s+\S+\s+(?:d[íi]as?|semanas?)|(?:la\s+)?semana\s+pasada)\b/gi;

/**
 * Lo que se saca antes del nombre, y **solo cuando cuelga de algo**.
 *
 * La primera versión (`RELLENO`) era una lista genérica de artículos y
 * preposiciones, sueltos, en cualquier posición del texto — y se comía
 * pedazos de nombres reales: `"cerrá El Prode"` devolvía `"Prode"`, que
 * matchea parcial contra **dos** proyectos de esta base (`El Prode de
 * Beno` y `Proder`) y termina en una pregunta que no hacía falta. Medido
 * el 2026-08-11.
 *
 * Acá se saca solo lo que es andamiaje de la frase y no puede ser parte
 * de un nombre: "el proyecto", "las fechas de", "del proyecto". El
 * artículo va **pegado** a "proyecto" o a "fechas de" — nunca suelto — así
 * que "El Prode" no se toca: no hay ningún "proyecto" ni "fechas de" al
 * lado de "El" que lo justifique.
 */
const ANDAMIAJE =
  /(?<![\p{L}\p{N}])(?:(?:el|la|los|las|un|una|del?)\s+)?(?:las?\s+fechas?\s+de|proyectos?)(?:\s+de)?(?![\p{L}\p{N}])/giu;

/**
 * Conectores que quedan colgando en las **puntas** después de sacar el
 * verbo, las fechas y el andamiaje ("Proder apertura … y cierre …" deja
 * un "y" pegado al final). En el medio no se tocan: ahí pueden ser parte
 * del nombre, como el "de" de "Agente de RRHH".
 *
 * ⚠ **La punta inicial no lleva artículos, y es a propósito.** Un nombre
 * puede empezar con uno — "El Prode" es un proyecto real de esta base —,
 * así que agregar `el|la|…` acá deshace el arreglo del punto 2 y vuelve
 * a dar "Prode". Que un nombre *termine* en artículo es mucho menos
 * probable, y por eso la punta final sí los incluye.
 */
const CONECTOR_INICIAL = /^(?:y|que|para|con|su)\s+/iu;

/**
 * A diferencia de `CONECTOR_INICIAL`, esta **sí** repite (`+` sobre el
 * grupo) y **sí** incluye artículos. Los dos son necesarios juntos:
 * "creá el proyecto Agente de RRHH que arranca el 01/09/26" deja **dos**
 * conectores pegados al final —"que" y "el"— una vez que se van "arranca"
 * y la fecha. Con un recorte simple, de uno solo, el proyecto se creaba
 * llamándose "Agente de RRHH que el" — y `crear` es la operación que
 * escribe ese nombre directo en la base, sin bandeja. Medido el
 * 2026-08-11.
 */
const CONECTOR_FINAL =
  /(?:\s+(?:y|que|para|con|su|el|la|los|las|un|una|de|del))+$/giu;

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
  //
  // ⚠ El " a " se busca **después del verbo**, no en el texto entero. Una
  // de las tres formas que soporta `RENOMBRAR` es "pasá a llamarse Y", que
  // ya trae su propio " a " adentro del verbo; buscar desde el principio
  // encontraba ese "a" —el de "llamarse"— y partía mal: nombre "pasá",
  // nuevo "llamarse Gentius". Medido el 2026-08-11.
  let nuevoNombre: string | null = null;
  let paraElNombre = texto;

  if (operacion === "renombrar") {
    const verbo = texto.match(RENOMBRAR)!;
    const desdeVerbo = verbo.index! + verbo[0].length;
    const resto = texto.slice(desdeVerbo);
    const corteRelativo = resto.search(/\s+a\s+/i);

    if (corteRelativo === -1) {
      // No hay un segundo " a " después del verbo: "pasá a llamarse X" no
      // tiene nombre viejo que extraer, todo lo que sigue al verbo es el
      // nuevo nombre.
      nuevoNombre = limpiarNombre(resto, { relleno: false });
      paraElNombre = texto.slice(0, desdeVerbo);
    } else {
      // `slice(corte + 3)` asumía un separador de exactamente 3
      // caracteres (" a "); con espacios de más ("HRKit   a   Gentius")
      // dejaba colgando el resto. El replace saca **todo** el separador,
      // lo ancho que sea.
      const corte = desdeVerbo + corteRelativo;
      nuevoNombre = limpiarNombre(
        texto.slice(corte).replace(/^\s+a\s+/i, ""),
        { relleno: false },
      );
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

  const laDe = (trozo: string) => {
    const f = leerFecha(trozo, hoy, { futuro: true });
    return f.explicita ? f.fecha : null;
  };

  // Sin ninguna marca, una sola fecha suelta: es de lo que diga el verbo.
  if (iCierre === -1 && iApertura === -1) {
    const sola = leerFecha(texto, hoy, { futuro: true });
    if (!sola.explicita) return { apertura: null, cierre: null };
    return CERRAR.test(texto)
      ? { apertura: null, cierre: sola.fecha }
      : { apertura: sola.fecha, cierre: null };
  }

  // Con una sola marca no hay nada que partir: la fecha es de esa marca y
  // la otra punta queda abierta. Sin este atajo, `iApertura > iCierre` es
  // siempre verdadero con `iCierre === -1` y la apertura terminaba
  // escribiéndose en el cierre — o sea, un proyecto que arranca el mes que
  // viene nacía ya cerrado, en silencio. Medido el 2026-08-11.
  if (iApertura === -1) return { apertura: null, cierre: laDe(texto) };
  if (iCierre === -1) return { apertura: laDe(texto), cierre: null };

  const corte = iApertura > iCierre ? iApertura : iCierre;
  const primero = texto.slice(0, corte);
  const segundo = texto.slice(corte);

  return iApertura > iCierre
    ? { apertura: laDe(segundo), cierre: laDe(primero) }
    : { apertura: laDe(primero), cierre: laDe(segundo) };
}

/** Saca verbos, fechas y andamiaje; lo que queda es el nombre. */
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

  if (relleno) limpio = limpio.replace(ANDAMIAJE, " ");

  // Colapsar espacios **antes** de recortar los conectores de punta: sin
  // esto, "Proder apertura … y cierre …" le llega a `CONECTOR_FINAL` como
  // "Proder    y   " —con espacios de sobra después de la "y" que sacaron
  // las fechas— y `$` nunca cae justo después de la palabra.
  limpio = limpio.replace(/[.,;:]/g, " ").replace(/\s+/g, " ").trim();

  if (relleno) {
    limpio = limpio.replace(CONECTOR_INICIAL, "").replace(CONECTOR_FINAL, "");
  }

  return limpio.trim();
}
