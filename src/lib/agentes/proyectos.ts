import { EXPRESIONES_DE_FECHA, leerFecha } from "@/lib/agentes/fechas";

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
 *
 * ## El diagnóstico de fondo, para el que venga a tocar esto
 *
 * Este archivo hace **tres pasadas independientes** sobre el mismo string
 * crudo — una para decidir la operación, una para las fechas, una para el
 * nombre — y varias regex sirven para dos propósitos opuestos a la vez:
 * una marca de apertura/cierre sirve para *partir* el texto en
 * `leerLasDosFechas()` y para *borrarse* del nombre en `limpiarNombre()`;
 * un verbo sirve para *decidir* la operación en `leerPedidoDeProyecto()` y
 * para *borrarse* del nombre en el mismo `limpiarNombre()`. De ahí sale
 * casi todo lo que se fue encontrando en las cuatro vueltas de revisión de
 * este módulo. La salida de fondo sería tokenizar el texto **una sola
 * vez** y que las tres respuestas (operación, fechas, nombre) salgan del
 * mismo mapa de tokens, en vez de cada una re-escaneando el string crudo
 * con su propio criterio. No se hizo: es un rediseño, no un arreglo, y por
 * ahora alcanza con cerrar los casos que se disparan con entradas
 * plausibles. Ver "Lo que este lector no cubre" al final del archivo para
 * los que quedaron afuera a propósito.
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
 * Sin flag `g`, a propósito para `CERRAR`/`REABRIR`/`RENOMBRAR`: alcanza
 * con la primera ocurrencia, porque el recepcionista ya partió la frase
 * multi-acción antes de que esto la vea — dos verbos de proyecto en el
 * mismo argumento no es un caso real.
 *
 * ⚠ **Para `CREAR` esa justificación es incompleta.** Sus alternativas
 * incluyen frases nominales ("nuevo proyecto", "proyecto nuevo") que
 * pueden **co-ocurrir** con el verbo imperativo en la misma frase — "creá
 * un nuevo proyecto Gentius" dispara "creá" y también contiene "nuevo
 * proyecto" — y sin `g`, `limpiarNombre()` solo saca la primera que
 * encuentra. Eso no se arregla poniéndole `g`: sacar **ambas** ocurrencias
 * con la misma regex de verbo dejaría "un  Gentius", todavía con el "un"
 * colgando. La solución fue otra: `ANDAMIAJE` (más abajo) absorbe la
 * frase nominal completa ("un nuevo proyecto", "el proyecto nuevo") como
 * una unidad, y así `CREAR` solo necesita encargarse del verbo suelto —
 * las alternativas nominales quedan para detectar la operación en frases
 * que **no** llevan un verbo imperativo ("nuevo proyecto Gentius", sin
 * "creá").
 */
const CREAR = conFrontera("cre[áa]|cre[áa]me|arm[áa]|nuevo\\s+proyecto|proyecto\\s+nuevo");

/**
 * ⚠ **Lleva `(?:lo|la)?`, igual que `REABRIR`.** Sin eso, "cerralo" y
 * "cerrala" —la forma simétrica del "activalo" que usa el docstring de
 * `PedidoDeProyecto` como ejemplo— no disparaban ninguna operación y caían
 * al default `"ventana"`. "Activalo de paso" es una frase real de Beno;
 * "cerralo" es la misma construcción con el otro verbo. Medido el
 * 2026-08-11.
 */
const CERRAR = conFrontera(
  "cerr[áa](?:lo|la)?|cerr[áa]me|dar?\\s+de\\s+baja|termin[áa]|finaliz[áa]",
);
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
 *
 * ⚠ **También absorbe el andamiaje de creación como una sola unidad**:
 * "un nuevo proyecto", "el proyecto nuevo", "un proyecto llamado", "un
 * proyecto que se llame". Antes esas frases nominales vivían en `CREAR`
 * (ver su comentario), y como `CREAR` no lleva `g`, solo se sacaba "creá"
 * y la frase nominal completa quedaba pegada al nombre: "creá un nuevo
 * proyecto Gentius" daba "un nuevo Gentius". Juntando "nuevo"/"nueva" y
 * "llamado"/"que se llame" en esta misma alternancia, se sacan como un
 * solo bloque y no dependen de que `CREAR` también los reconozca.
 */
const ANDAMIAJE =
  /(?<![\p{L}\p{N}])(?:(?:el|la|los|las|un|una|del?)\s+)?(?:las?\s+fechas?\s+de|(?:nuevos?\s+|nuevas?\s+)?proyectos?(?:\s+nuevos?|\s+nuevas?)?(?:\s+(?:llamado|llamada|que\s+se\s+llame))?)(?:\s+de)?(?![\p{L}\p{N}])/giu;

/**
 * Conectores que quedan colgando en las **puntas** después de sacar el
 * verbo, las fechas y el andamiaje ("Proder apertura … y cierre …" deja
 * un "y" pegado al final). En el medio no se tocan: ahí pueden ser parte
 * del nombre, como el "de" de "Agente de RRHH".
 *
 * ⚠ **La punta inicial no lleva artículos, y es a propósito.** Un nombre
 * puede empezar con uno — "El Prode" es un proyecto real de esta base —,
 * así que agregar `el|la|…` acá deshace el arreglo de `ANDAMIAJE` y
 * vuelve a dar "Prode". Que un nombre *termine* en artículo es mucho
 * menos probable, y por eso la punta final sí los incluye.
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
 *
 * ⚠ **Se aplica siempre, tenga o no `relleno`.** La primera versión solo
 * la aplicaba con `relleno: true`, y `nuevoNombre` —que se computa con
 * `relleno: false`— se quedaba con el mismo problema: "renombrá Proder a
 * Gentius que arranca el 01/09/26" escribía `nuevoNombre = "Gentius que
 * el"`, literal, en `projects.nombre`. Lo que distingue los dos modos es
 * `ANDAMIAJE` (que sí depende de `relleno`), no el recorte de conectores.
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
  //
  // ⚠ **Salvo para `crear`.** "creá el proyecto 5 de Mayo" no tiene
  // ninguna marca ("apertura"/"desde"/"cierre"/"hasta"), y sin esta
  // excepción `leerFecha()` encontraba "5 de mayo" —un mes real— dentro
  // del propio nombre y lo leía como la apertura, dejando el proyecto sin
  // nombre. `cerrar`/`reabrir`/`ventana` sí aceptan la fecha suelta sin
  // marca: es la forma natural de decir "cerrá Proder el 30/12". `crear`
  // no tiene ese uso natural — si Beno quiere una apertura al crear, la
  // dice con una marca ("que arranca el…", "desde el…") — así que una
  // fecha suelta ahí es casi siempre parte del nombre, no una fecha.
  // Medido el 2026-08-11.
  if (iCierre === -1 && iApertura === -1) {
    if (CREAR.test(texto)) return { apertura: null, cierre: null };

    /*
      ⚠ **Dos fechas sueltas y ninguna marca: la primera abre y la segunda
      cierra.** Sin esto se leía solo la primera y la segunda se perdía en
      silencio — y el caso no es hipotético, es el fallo 1 entero. Beno
      escribió "…01/04/26 apertura y 31/07/26 para las dos", que tiene las
      dos marcas, pero **el recepcionista reformatea el argumento** y lo
      devuelve como `"Proder 01/04/26 - 31/07/26"`, sin ninguna. Medido
      contra la app el 2026-08-11: el cierre no se movía y la respuesta
      igual decía "Cambié la ventana".

      Las fechas se buscan con `EXPRESIONES_DE_FECHA`, que es la misma
      lista de la que salen las `REGLAS` de `leerFecha()`: no hay una
      segunda definición de qué parece una fecha.
    */
    const sueltas = [...texto.matchAll(EXPRESIONES_DE_FECHA)].map((m) => m[0]);

    if (sueltas.length >= 2) {
      const abre = leerFecha(sueltas[0]!, hoy, { futuro: true });
      const cierra = leerFecha(sueltas[1]!, hoy, { futuro: true });
      if (abre.explicita && cierra.explicita) {
        return { apertura: abre.fecha, cierre: cierra.fecha };
      }
    }

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
  //
  // ⚠ **Se busca la fecha desde la marca en adelante, no en el texto
  // entero.** "creá el proyecto Soporte 24/7 que arranca el 01/09/26"
  // tiene un número con barra —"24/7"— **antes** de la marca "arranca",
  // que es parte del nombre, no una fecha. `leerFecha()` recorre sus
  // reglas en orden y devuelve la primera coincidencia de cada una, así
  // que sobre el texto entero "24/7" le ganaba a "01/09/26" por aparecer
  // primero: la apertura salía 24 de julio en vez de 1 de septiembre.
  // Recortando desde la marca, "24/7" queda afuera de lo que se lee.
  // Medido el 2026-08-11.
  if (iApertura === -1) return { apertura: null, cierre: laDe(texto.slice(iCierre)) };
  if (iCierre === -1) return { apertura: laDe(texto.slice(iApertura)), cierre: null };

  const corte = iApertura > iCierre ? iApertura : iCierre;
  const primero = texto.slice(0, corte);
  const segundo = texto.slice(corte);

  return iApertura > iCierre
    ? { apertura: laDe(segundo), cierre: laDe(primero) }
    : { apertura: laDe(primero), cierre: laDe(segundo) };
}

/**
 * Saca verbos, la cláusula de ventana, andamiaje y conectores; lo que
 * queda es el nombre.
 *
 * ⚠ **La cláusula de ventana se descarta entera, marca y fecha juntas —no
 * se le saca solo la fecha con `EXPRESIONES_DE_FECHA`.** Es lo que
 * mantiene "24/7" en "Soporte 24/7 que arranca el 01/09/26": si en vez de
 * recortar en la marca se le sacara la fecha a todo el texto con
 * `EXPRESIONES_DE_FECHA`, "24/7" —que matchea la misma regla de "D/M" que
 * "01/09/26"— se borraría igual que la fecha real, y el nombre quedaba en
 * "Soporte" en vez de "Soporte 24/7". Ver el comentario de
 * `leerLasDosFechas()` para la mitad de este mismo defecto que le tocaba
 * a la apertura.
 *
 * ⚠ **`EXPRESIONES_DE_FECHA` solo se aplica para `crear` cuando ya no
 * queda nada que decida `leerLasDosFechas()` — y ahí, directamente no se
 * aplica.** `crear` nunca lee una fecha suelta sin marca (ver el
 * comentario de `leerLasDosFechas()`), así que tampoco tiene sentido que
 * el nombre se la borre: sin este freno, "creá el proyecto 5 de Mayo"
 * perdía el "5 de Mayo" del nombre aunque la apertura ya daba `null`, y
 * el proyecto se quedaba sin nombre **y** sin fecha.
 */
function limpiarNombre(
  texto: string,
  { relleno }: { relleno: boolean },
): string {
  // Se mide sobre el texto de entrada, antes de sacar nada: `CREAR` busca
  // "creá"/"creáme"/"armá", que siguen ahí en este punto.
  const sinFecha = CREAR.test(texto);

  let limpio = texto
    .replace(CREAR, " ")
    .replace(CERRAR, " ")
    .replace(REABRIR, " ")
    .replace(RENOMBRAR, " ");

  const iApertura = limpio.search(MARCA_APERTURA);
  const iCierre = limpio.search(MARCA_CIERRE);
  const primeraMarca =
    iApertura === -1 ? iCierre : iCierre === -1 ? iApertura : Math.min(iApertura, iCierre);
  if (primeraMarca !== -1) limpio = limpio.slice(0, primeraMarca);

  if (relleno) limpio = limpio.replace(ANDAMIAJE, " ");

  if (!sinFecha) limpio = limpio.replace(EXPRESIONES_DE_FECHA, " ");

  // Colapsar espacios **antes** de recortar los conectores de punta: sin
  // esto, "Proder apertura … y cierre …" le llega a `CONECTOR_FINAL` como
  // "Proder    y   " —con espacios de sobra después de la "y" que sacaron
  // las fechas— y `$` nunca cae justo después de la palabra.
  limpio = limpio.replace(/[.,;:]/g, " ").replace(/\s+/g, " ").trim();

  limpio = limpio.replace(CONECTOR_INICIAL, "").replace(CONECTOR_FINAL, "");

  return limpio.trim();
}

/**
 * Lo que este lector no cubre
 * ============================
 *
 * El diagnóstico de fondo está en el comentario de arriba de todo el
 * archivo: tres pasadas independientes sobre el mismo string crudo, con
 * regex que sirven a la vez para decidir y para borrarse. La salida buena
 * es tokenizar una sola vez y que las tres respuestas salgan del mismo
 * mapa; no se hizo porque es un rediseño, no un arreglo. Lo que sigue son
 * los bordes que quedaron, cerrados por entradas plausibles pero no por
 * todas:
 *
 * 1. **Un nombre de proyecto que contenga una palabra que también es
 *    marca de fecha o marca de ventana** ("Cierre de Año", "Desde Cero",
 *    "Fin de Semana") se muerde, y puede hasta cambiar qué operación se
 *    detecta. Ninguno de los tres proyectos de esta base se llama así.
 * 2. **La precedencia entre operaciones tiene bordes.** "Gestión Activa"
 *    dispara `reabrir` por el adjetivo ("activa"); "cerrá el proyecto
 *    nuevo" dispara `crear` por la frase nominal.
 * 3. **`renombrar` sin `" a "`** ("renombrá Proder") invierte los campos:
 *    deja `nombre` vacío y `nuevoNombre = "Proder"`. Se salva porque con
 *    `nombre` vacío la Tarea 4 pregunta cuál proyecto, en vez de
 *    renombrar el que no corresponde.
 * 4. **`apertura > cierre` no se detecta acá, y está bien así.** Lo ataja
 *    `projectSchema` con su propio `refine`, que ya devuelve el mensaje
 *    en castellano ("El cierre no puede ser anterior al inicio."). No
 *    duplicar esa validación acá.
 * 5. **Al crear, una fecha suelta al final se queda pegada al nombre.**
 *    "creá el proyecto Voltio 01/09/26" da el nombre "Voltio 01/09/26" y
 *    ninguna fecha; con una marca de por medio ("…Voltio desde el
 *    01/09/26") sale bien. Es el precio de `sinFecha`: al crear **no** se
 *    borran las expresiones de fecha del nombre, porque un proyecto se
 *    puede llamar "5 de Mayo" y borrarlas lo dejaría sin nombre.
 *
 *    Las dos frases son genuinamente ambiguas sin saber la intención, y
 *    se eligió el lado menos malo: equivocarse deja **un nombre con la
 *    fecha pegada**, que se ve en la respuesta y se corrige desde
 *    Ajustes, en vez de **un proyecto sin nombre**, que no se puede ni
 *    nombrar para arreglarlo. `partirFechaFinal()` de `fechas.ts` no
 *    desempata: contra "5 de Mayo" también lee una fecha al final.
 */
