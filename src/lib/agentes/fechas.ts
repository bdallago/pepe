import { addDays, formatDate, parseISODate, weekday } from "@/lib/dates";

/**
 * Cómo se lee una fecha escrita a mano, en criollo.
 *
 * Vive acá y no adentro de `bitacora.ts` porque la usan **dos** agentes que
 * escriben cosas distintas y necesitan exactamente el mismo criterio: el de
 * bitácora ("ayer peleé con el deploy") y el de movimientos ("-20usd Claude
 * Code 06/08"). Duplicar ciento cincuenta líneas de reglas de calendario en
 * los dos era garantizar que se separaran a la primera corrección.
 *
 * ## Por qué esto no lo hace el modelo
 *
 * Mismo criterio que `rango.ts`: "ayer" es aritmética de calendario, y un
 * modelo que devuelve fechas se equivoca de mes, de año o de zona horaria
 * sin que se note. Determinístico se puede verificar; una fecha inventada
 * por un modelo, no. Por eso el extractor de movimientos le pide al modelo
 * **la expresión tal cual la escribió Beno** ("el martes") y no una fecha:
 * la cuenta la hace esto.
 *
 * Todo pasa por los helpers de `lib/dates.ts`, que trabajan a mediodía
 * local: `new Date(iso)` a secas parsea en UTC y en Argentina devuelve el
 * día anterior.
 *
 * ## Nada cae en el futuro, y es a propósito
 *
 * Las dos cosas que usan esto **registran lo que ya pasó**: una entrada de
 * bitácora no es de mañana y un gasto dictado ya se pagó. Así que:
 *
 * - Una fecha **sin año** que caiga adelante es del año pasado. El 3 de
 *   enero, "el 28/12" es diciembre del año que se fue, no del que viene.
 * - Cualquier otra cosa que caiga adelante se recorta a hoy, y la etiqueta
 *   pasa a decir "hoy" para que se vea en la respuesta.
 * - "el martes" es **el último** martes, hoy incluido, y no el que viene.
 *
 * Lo que no cubre esto es cargar un movimiento *planificado* a futuro. Eso
 * se hace desde el formulario, que es donde está el selector de estado.
 *
 * Esto es el default, no una ley: `agentes/proyectos.ts` necesita lo
 * contrario —una ventana se puede abrir el mes que viene— y por eso las
 * dos reglas de acá son apagables con `{ futuro: true }`. Ver `OpcionesFecha`.
 */

export interface FechaLeida {
  /** "YYYY-MM-DD". */
  fecha: string;
  /** Cómo la nombró él ("ayer", "el martes") o la fecha formateada. */
  etiqueta: string;
  /** El texto mencionaba una fecha. Si no, `fecha` es hoy por defecto. */
  explicita: boolean;
}

/**
 * Opciones de lectura.
 *
 * `futuro` apaga las **dos** reglas de "nada cae adelante": la del año
 * implícito (sin año escrito, una fecha adelante es del año pasado) y el
 * recorte a hoy. Las dos existen porque lo que usa esto hoy —bitácora y
 * movimientos— registra lo que ya pasó.
 *
 * ⚠ **Un proyecto no.** Un proyecto se puede abrir el mes que viene, y
 * `alternarProyectoActivo()` ya contempla ese caso. Sin esta opción,
 * "cerrá X el 30/12" escribiría **2025**-12-30 y "abrí X el 2027-01-15"
 * escribiría hoy, las dos cosas en silencio y contra el check
 * `projects_fechas_coherentes`. Medido el 2026-08-11.
 */
export interface OpcionesFecha {
  futuro?: boolean;
}

/** Los meses escritos con letra, como los escribe cualquiera. */
const MESES: Readonly<Record<string, number>> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

/** Lunes = 1 … domingo = 7, igual que `weekday()` de `lib/dates.ts`. */
const DIAS_SEMANA: Readonly<Record<string, number>> = {
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  domingo: 7,
};

const NOMBRE_DE_MES = Object.keys(MESES).join("|");
const NOMBRE_DE_DIA = Object.keys(DIAS_SEMANA).join("|");

interface ReglaFecha {
  patron: RegExp;
  armar: (
    m: RegExpMatchArray,
    hoy: string,
    futuro: boolean,
  ) => { fecha: string; etiqueta: string } | null;
}

/**
 * Las reglas, **en orden**: gana la primera que matchea, así que las más
 * específicas van arriba ("anteayer" antes que "ayer").
 *
 * Corren sobre el texto en minúsculas y sin tildes, pero **conservando los
 * separadores de fecha** (`/` y `-`): normalizarlos a espacio, como hace
 * `rango.ts`, dejaría "5/8" convertido en "5 8" y ninguna fecha escrita en
 * números se podría leer.
 *
 * `06/08` es **día/mes**, que es como se escribe acá. No hay heurística que
 * lo desambigüe del formato americano y no hace falta: la app es de una
 * sola persona y esa persona escribe en argentino.
 */
const REGLAS: ReglaFecha[] = [
  // "2026-08-05"
  {
    patron: /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/,
    armar: (m) => {
      const fecha = armarISO(Number(m[1]), Number(m[2]), Number(m[3]));
      return fecha ? { fecha, etiqueta: formatDate(fecha) } : null;
    },
  },

  // "5/8", "05/08/2026"
  {
    patron: /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/,
    armar: (m, hoy, futuro) => {
      const anio = m[3]
        ? Number(m[3].length === 2 ? `20${m[3]}` : m[3])
        : Number(hoy.slice(0, 4));
      const fecha = armarISO(anio, Number(m[2]), Number(m[1]));
      if (!fecha) return null;
      // Sin año escrito, una fecha que cae adelante es del año pasado:
      // el 3 de enero, "el 28/12" es diciembre del año que se fue. Salvo
      // que quien llama diga que el futuro vale.
      const ajustada =
        !futuro && !m[3] && fecha > hoy
          ? armarISO(anio - 1, Number(m[2]), Number(m[1]))
          : fecha;
      return ajustada
        ? { fecha: ajustada, etiqueta: formatDate(ajustada) }
        : null;
    },
  },

  // "el 5 de agosto", "5 de agosto de 2026"
  {
    patron: new RegExp(
      `\\b(\\d{1,2})\\s+de\\s+(${NOMBRE_DE_MES})(?:\\s+de\\s+(\\d{4}))?\\b`,
    ),
    armar: (m, hoy, futuro) => {
      const mes = MESES[m[2]!]!;
      const anio = m[3] ? Number(m[3]) : Number(hoy.slice(0, 4));
      const fecha = armarISO(anio, mes, Number(m[1]));
      if (!fecha) return null;
      const ajustada =
        !futuro && !m[3] && fecha > hoy
          ? armarISO(anio - 1, mes, Number(m[1]))
          : fecha;
      return ajustada
        ? { fecha: ajustada, etiqueta: formatDate(ajustada) }
        : null;
    },
  },

  // "anteayer", "antes de ayer"
  {
    patron: /\banteayer\b|\bantes\s+de\s+ayer\b/,
    armar: (_m, hoy) => ({ fecha: addDays(hoy, -2), etiqueta: "anteayer" }),
  },

  {
    patron: /\bayer\b/,
    armar: (_m, hoy) => ({ fecha: addDays(hoy, -1), etiqueta: "ayer" }),
  },

  // "hace 3 días", "hace una semana"
  {
    patron: /\bhace\s+(\d{1,3}|un|una|dos|tres|cuatro|cinco|seis)\s+(dias?|semanas?)\b/,
    armar: (m, hoy) => {
      const n = /^\d+$/.test(m[1]!)
        ? Number(m[1])
        : ({ un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 }[
            m[1]!
          ] ?? 0);
      if (n <= 0 || n > 365) return null;
      const dias = m[2]!.startsWith("semana") ? n * 7 : n;
      return { fecha: addDays(hoy, -dias), etiqueta: `hace ${m[1]} ${m[2]}` };
    },
  },

  // "la semana pasada": el mismo día de la semana anterior.
  {
    patron: /\b(?:la\s+)?semana\s+pasada\b/,
    armar: (_m, hoy) => ({ fecha: addDays(hoy, -7), etiqueta: "la semana pasada" }),
  },

  /*
    "el martes", "el lunes pasado": la última vez que fue ese día, hoy
    incluido. Las dos cosas que usan esto miran para atrás, así que "el
    martes" dicho un lunes es el martes de la semana pasada, no el de
    mañana.
  */
  {
    patron: new RegExp(`\\b(?:el\\s+)?(${NOMBRE_DE_DIA})(?:\\s+pasado)?\\b`),
    armar: (m, hoy) => {
      const objetivo = DIAS_SEMANA[m[1]!]!;
      const atras = (weekday(hoy) - objetivo + 7) % 7;
      return { fecha: addDays(hoy, -atras), etiqueta: `el ${m[1]}` };
    },
  },

  { patron: /\bhoy\b/, armar: (_m, hoy) => ({ fecha: hoy, etiqueta: "hoy" }) },
];

/**
 * Busca una fecha en un texto. Si no hay ninguna, devuelve hoy con
 * `explicita: false`, y quien llama decide si eso alcanza o si hay que
 * preguntar.
 */
export function leerFecha(
  texto: string,
  hoy: string,
  opciones: OpcionesFecha = {},
): FechaLeida {
  const futuro = opciones.futuro === true;
  const normalizado = normalizarConservandoFechas(texto);

  for (const regla of REGLAS) {
    const coincidencia = normalizado.match(regla.patron);
    if (!coincidencia) continue;

    const armado = regla.armar(coincidencia, hoy, futuro);
    if (!armado) continue;

    const adelante = armado.fecha > hoy;

    return {
      // Nada de esto puede ser de mañana, salvo que quien llama pida lo
      // contrario: las dos cosas que lo usaban al principio —bitácora y
      // movimientos— registran lo que ya pasó. Si el texto trae una fecha
      // futura y `futuro` no está, se usa hoy, y la respuesta dice qué
      // fecha quedó, así que se ve.
      fecha: !futuro && adelante ? hoy : armado.fecha,
      etiqueta: !futuro && adelante ? "hoy" : armado.etiqueta,
      explicita: true,
    };
  }

  return { fecha: hoy, etiqueta: "hoy", explicita: false };
}

/**
 * Cuántas palabras del final se prueban como fecha. Seis es lo que ocupa
 * la expresión más larga que reconocen las reglas: "el 5 de agosto de 2026".
 */
const MAX_PALABRAS_DE_FECHA = 6;

/**
 * Las expresiones que `REGLAS` sabe leer, como alternativas sueltas.
 *
 * Se arman de las mismas listas de meses y días que las reglas, así que
 * no se pueden separar de ellas. Es la razón de que esto exista como
 * constante en vez de estar escrito dos veces: `agentes/proyectos.ts`
 * llegó a tener su propia copia a mano, y la copia se separó en dos
 * sentidos — nació **sin** la regla de días de la semana ("cerrá Proder
 * el martes" no se detectaba), y nació **más ancha** que esta, con
 * `\d{1,2}\s+de\s+[a-záéíóú]+` aceptando cualquier palabra después de
 * "de" en vez de solo un mes real de `NOMBRE_DE_MES`. Medido el
 * 2026-08-11.
 */
const ALTERNATIVAS_DE_FECHA = [
  "\\d{4}-\\d{1,2}-\\d{1,2}",
  "\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?",
  `(?:el\\s+)?\\d{1,2}\\s+de\\s+(?:${NOMBRE_DE_MES})(?:\\s+de\\s+\\d{4})?`,
  `(?:el\\s+)?(?:${NOMBRE_DE_DIA})(?:\\s+pasado)?`,
  "anteayer",
  "antes\\s+de\\s+ayer",
  "ayer",
  "hoy",
  "hace\\s+(?:\\d{1,3}|un|una|dos|tres|cuatro|cinco|seis)\\s+(?:dias?|semanas?)",
  "(?:la\\s+)?semana\\s+pasada",
];

/**
 * Las mismas expresiones de arriba, pero **ancladas**: matchean solo si el
 * texto es una fecha y nada más.
 */
const SOLO_FECHA = new RegExp("^(?:" + ALTERNATIVAS_DE_FECHA.join("|") + ")$");

/**
 * Lo mismo que `SOLO_FECHA`, pero **sin anclar y global**, para poder
 * sacarle las fechas a un texto libre y quedarse con el resto. La usa
 * `agentes/proyectos.ts` para separar el nombre de un proyecto de su
 * ventana ("cerrá Proder el martes" → el nombre es "Proder", "el martes"
 * es la fecha).
 *
 * Las fronteras son `(?<![\p{L}\p{N}])`/`(?![\p{L}\p{N}])` y no `\b`, por
 * la misma razón que `agentes/proyectos.ts` las usa para sus verbos: `\b`
 * no cuenta una vocal acentuada como letra, y "el 5 de agosto" seguido de
 * una palabra acentuada rompería el corte. Acá ninguna de las expresiones
 * termina en acentuada, pero mantenerlas iguales evita tener que
 * recordar la excepción.
 */
export const EXPRESIONES_DE_FECHA = new RegExp(
  "(?<![\\p{L}\\p{N}])(?:" + ALTERNATIVAS_DE_FECHA.join("|") + ")(?![\\p{L}\\p{N}])",
  "giu",
);

/**
 * Parte un texto que **termina** en una fecha: devuelve lo que queda y la
 * fecha leída.
 *
 * Es lo que necesita el estilo telegráfico de Beno, donde la fecha va
 * pegada al final y el resto es la descripción del gasto:
 * `-20usd Claude Code 06/08` → `"Claude Code"` + el 6 de agosto.
 *
 * Se prueba **de la cola más larga a la más corta** y cada candidata tiene
 * que matchear la expresión anclada: así "Claude Code 06/08" no se lleva
 * puesto "Code" y una descripción que simplemente termina en una palabra
 * cualquiera no se confunde con una fecha. Si no hay ninguna, devuelve el
 * texto entero y `null` — que es distinto de devolver hoy: quien llama
 * necesita saber que Beno **no dijo** la fecha para poder preguntársela.
 *
 * Se compara por palabras y no con índices sobre el texto crudo a
 * propósito: sacarle las tildes cambia el largo del string y cualquier
 * `slice()` calculado sobre el normalizado cortaría corrido en
 * "el miércoles".
 */
export function partirFechaFinal(
  texto: string,
  hoy: string,
): { texto: string; fecha: FechaLeida | null } {
  const palabras = texto.trim().split(/\s+/).filter(Boolean);

  for (
    let n = Math.min(MAX_PALABRAS_DE_FECHA, palabras.length);
    n >= 1;
    n--
  ) {
    const cola = palabras.slice(palabras.length - n).join(" ");
    if (!SOLO_FECHA.test(normalizarConservandoFechas(cola))) continue;

    const leida = leerFecha(cola, hoy);
    // Una cola que matchea la forma pero no arma una fecha válida —"31/02"—
    // no es una fecha: vuelve a ser parte de la descripción.
    if (!leida.explicita) continue;

    return {
      texto: palabras.slice(0, palabras.length - n).join(" "),
      fecha: leida,
    };
  }

  return { texto: texto.trim(), fecha: null };
}

/** Arma "YYYY-MM-DD" validando que el día exista de verdad (nada de 31/02). */
function armarISO(anio: number, mes: number, dia: number): string | null {
  if (anio < 2000 || anio > 2100) return null;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;

  const iso = `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  const control = parseISODate(iso);

  return control.getMonth() + 1 === mes && control.getDate() === dia ? iso : null;
}

/**
 * Minúsculas y sin tildes, **conservando `/` y `-`**.
 *
 * Es la única diferencia con el `normalizar()` de `rango.ts` y `resolver.ts`,
 * y es la que permite leer "5/8" o "2026-08-05": esos dos convierten toda
 * la puntuación en espacios porque comparan nombres, no fechas.
 */
function normalizarConservandoFechas(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
