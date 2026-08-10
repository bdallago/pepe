import { addDays, formatDate, parseISODate, todayISO, weekday } from "@/lib/dates";

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
 * Mismo criterio que `rango.ts`: "ayer" es aritmética de calendario, y un
 * modelo que devuelve fechas se equivoca de mes, de año o de zona horaria
 * sin que se note. Determinístico se puede verificar; una fecha inventada
 * por un modelo, no. Todo pasa por los helpers de `lib/dates.ts`, que
 * trabajan a mediodía local: `new Date(iso)` a secas parsea en UTC y en
 * Argentina devuelve el día anterior.
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
  armar: (m: RegExpMatchArray, hoy: string) => { fecha: string; etiqueta: string } | null;
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
 * Ninguna regla devuelve una fecha futura. La bitácora registra lo que
 * pasó; una fecha sin año que caiga adelante es del año pasado, y el resto
 * se recorta a hoy en `resolverFecha()`.
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
    armar: (m, hoy) => {
      const anio = m[3]
        ? Number(m[3].length === 2 ? `20${m[3]}` : m[3])
        : Number(hoy.slice(0, 4));
      const fecha = armarISO(anio, Number(m[2]), Number(m[1]));
      if (!fecha) return null;
      // Sin año escrito, una fecha que cae adelante es del año pasado:
      // el 3 de enero, "el 28/12" es diciembre del año que se fue.
      const ajustada =
        !m[3] && fecha > hoy ? armarISO(anio - 1, Number(m[2]), Number(m[1])) : fecha;
      return ajustada ? { fecha: ajustada, etiqueta: formatDate(ajustada) } : null;
    },
  },

  // "el 5 de agosto", "5 de agosto de 2026"
  {
    patron: new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${NOMBRE_DE_MES})(?:\\s+de\\s+(\\d{4}))?\\b`),
    armar: (m, hoy) => {
      const mes = MESES[m[2]!]!;
      const anio = m[3] ? Number(m[3]) : Number(hoy.slice(0, 4));
      const fecha = armarISO(anio, mes, Number(m[1]));
      if (!fecha) return null;
      const ajustada =
        !m[3] && fecha > hoy ? armarISO(anio - 1, mes, Number(m[1])) : fecha;
      return ajustada ? { fecha: ajustada, etiqueta: formatDate(ajustada) } : null;
    },
  },

  // "anteayer", "antes de ayer"
  {
    patron: /\banteayer\b|\bantes\s+de\s+ayer\b/,
    armar: (_m, hoy) => ({ fecha: addDays(hoy, -2), etiqueta: "anteayer" }),
  },

  { patron: /\bayer\b/, armar: (_m, hoy) => ({ fecha: addDays(hoy, -1), etiqueta: "ayer" }) },

  // "hace 3 días", "hace una semana"
  {
    patron: /\bhace\s+(\d{1,3}|un|una|dos|tres|cuatro|cinco|seis)\s+(dias?|semanas?)\b/,
    armar: (m, hoy) => {
      const n = /^\d+$/.test(m[1]!)
        ? Number(m[1])
        : ({ un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 }[m[1]!] ?? 0);
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
    incluido. La bitácora mira para atrás, así que "el martes" dicho un
    lunes es el martes de la semana pasada, no el de mañana.
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
  const { fecha, etiqueta, explicita } = resolverFecha(contenido, hoy);

  return {
    contenido,
    fecha,
    etiquetaFecha: etiqueta,
    fechaExplicita: explicita,
  };
}

function resolverFecha(texto: string, hoy: string) {
  const normalizado = normalizar(texto);

  for (const regla of REGLAS) {
    const coincidencia = normalizado.match(regla.patron);
    if (!coincidencia) continue;

    const armado = regla.armar(coincidencia, hoy);
    if (!armado) continue;

    return {
      // Una entrada de bitácora no puede ser de mañana: registra lo que
      // pasó. Si el texto trae una fecha futura se usa hoy, y la respuesta
      // dice qué fecha quedó, así que se ve.
      fecha: armado.fecha > hoy ? hoy : armado.fecha,
      etiqueta: armado.fecha > hoy ? "hoy" : armado.etiqueta,
      explicita: true,
    };
  }

  return { fecha: hoy, etiqueta: "hoy", explicita: false };
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
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
