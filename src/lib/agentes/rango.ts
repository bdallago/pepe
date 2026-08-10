import {
  addDays,
  addMonths,
  endOfMonth,
  formatDate,
  monthKey,
  parseISODate,
  startOfMonth,
  todayISO,
} from "@/lib/dates";

/**
 * El rango temporal de una consulta de plata, resuelto **en código**.
 *
 * El recepcionista sigue mandando texto libre y acá se lo lee. No lo
 * decide un modelo, y no es por ahorrar tokens: "los últimos 6 meses" es
 * aritmética de calendario, y un modelo que devuelve fechas se equivoca
 * de mes, de año o de zona horaria sin que se note. Determinístico se
 * puede verificar; una fecha inventada por un modelo, no.
 *
 * Dos decisiones que no se ven leyendo una regex suelta:
 *
 * 1. **"Los últimos N meses" son meses de calendario.** Arranca el día 1
 *    del enésimo mes para atrás, contando el mes en curso. Así los cortes
 *    coinciden con los buckets de `Balances.porMes` y con lo que Beno ve
 *    en los gráficos; una ventana móvil partiría meses al medio y ningún
 *    total cerraría con la pantalla.
 * 2. **"El último mes" (sin número) es una ventana móvil de 30 días.**
 *    Decisión de Beno del 2026-08-09: para analizar plata, "el último
 *    mes" es lo que pasó en los últimos 30 días, no lo que va del mes en
 *    curso. El 2 de agosto, el mes calendario son dos días de datos y la
 *    respuesta no dice nada; 30 días para atrás siempre dicen lo mismo.
 *    Como la ventana se corre, **suele cruzar dos meses de calendario, y
 *    cuando lo hace la etiqueta lo dice**: "a caballo entre julio y
 *    agosto". Si no lo dijera, el mismo texto significaría cosas
 *    distintas según el día en que se preguntó.
 *
 *    **"Este mes" no cambió**: ese sigue siendo el mes de calendario en
 *    curso, y "el mes pasado", el de calendario anterior completo. Son
 *    tres frases distintas porque son tres preguntas distintas.
 *
 * **Si no se reconoce nada devuelve `null`, y eso no es un error**: la
 * consulta sigue siendo sobre todo el histórico, como fue siempre, y la
 * respuesta lo dice. Adivinar un rango sería peor que no tener ninguno:
 * los números cambiarían sin que nada lo avise.
 *
 * Al final del archivo vive `resolverMesDeVencimientos()`, que interpreta
 * las mismas palabras con **otro criterio** —mes de calendario— porque
 * responde otra pregunta. Están juntas a propósito: la diferencia se ve
 * leyendo un solo archivo.
 */

export interface RangoResuelto {
  /** "YYYY-MM-DD", inclusive. */
  desde: string;
  /** "YYYY-MM-DD", inclusive. Nunca posterior a hoy. */
  hasta: string;
  /** Cómo nombrarlo en castellano, sin las fechas. */
  etiqueta: string;
  /**
   * Lo que quedó de la frase sacándole la expresión temporal, normalizado.
   *
   * Sirve para que "cómo viene Proder estos últimos 6 meses" resuelva el
   * proyecto contra "como viene proder" y no contra la frase entera. Y,
   * sobre todo, para que un argumento que es **solo** un rango
   * ("últimos 6 meses") quede vacío y no matchee un proyecto de casualidad
   * por el `includes` de `resolverProyecto`.
   */
  restante: string;
}

/** Los números escritos con letra que aparecen en un pedido de este tipo. */
const NUMEROS: Readonly<Record<string, number>> = {
  uno: 1,
  un: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
};

/** Alternativa de regex con los números en letra, los largos primero. */
const EN_LETRA = Object.keys(NUMEROS)
  .sort((a, b) => b.length - a.length)
  .join("|");

function aNumero(texto: string): number | null {
  if (/^\d+$/.test(texto)) {
    const n = Number(texto);
    return n > 0 ? n : null;
  }
  return NUMEROS[texto] ?? null;
}

/**
 * Cuántos días para atrás llega "el último mes".
 *
 * Treinta, y el borde queda en `hoy - 30`: el 10 de agosto la ventana
 * arranca el 11 de julio, que es como lo escribió Beno. Es un día más
 * ancha que la regla de "los últimos N días", que cuenta hoy adentro de
 * los N; esa no se tocó porque ahí el número lo pone él y significa lo que
 * dice.
 */
const DIAS_DE_UN_MES = 30;

interface Regla {
  patron: RegExp;
  armar: (
    coincidencia: RegExpMatchArray,
    hoy: string,
  ) => { desde: string; hasta: string; etiqueta: string } | null;
}

/**
 * Las reglas, **en orden**. Gana la primera que matchea, así que las más
 * específicas van arriba: "el mes pasado" antes que "el mes", y cualquier
 * cosa antes que el año suelto de cuatro dígitos.
 *
 * Los patrones se aplican sobre el texto ya normalizado (minúsculas y sin
 * tildes), por eso dicen "ultimos" y "ano" sin acento ni eñe.
 */
const REGLAS: Regla[] = [
  // "los últimos 6 meses", "estos últimos seis meses"
  {
    patron: new RegExp(
      `\\b(?:los|las|estos|estas)?\\s*ultimos?\\s+(\\d{1,3}|${EN_LETRA})\\s+meses\\b`,
    ),
    armar: (m, hoy) => {
      const n = aNumero(m[1]!);
      if (!n || n > 120) return null;
      return {
        desde: startOfMonth(addMonths(hoy, -(n - 1))),
        hasta: hoy,
        etiqueta: n === 1 ? "el último mes" : `los últimos ${n} meses`,
      };
    },
  },

  // "los últimos 30 días"
  {
    patron: new RegExp(
      `\\b(?:los|las|estos|estas)?\\s*ultimos?\\s+(\\d{1,4}|${EN_LETRA})\\s+dias\\b`,
    ),
    armar: (m, hoy) => {
      const n = aNumero(m[1]!);
      if (!n || n > 3650) return null;
      return {
        // Inclusive de las dos puntas: "los últimos 30 días" son 30 días
        // contando hoy, no 31.
        desde: addDays(hoy, -(n - 1)),
        hasta: hoy,
        etiqueta: n === 1 ? "hoy" : `los últimos ${n} días`,
      };
    },
  },

  // "el mes pasado", "el mes anterior"
  {
    patron: /\b(?:el\s+)?mes\s+(?:pasado|anterior)\b/,
    armar: (_m, hoy) => {
      const enElMesPasado = addMonths(startOfMonth(hoy), -1);
      return {
        desde: enElMesPasado,
        hasta: endOfMonth(enElMesPasado),
        etiqueta: "el mes pasado",
      };
    },
  },

  /*
    "este mes", "el mes actual", "lo que va del mes": el mes de calendario
    en curso.

    Va **arriba** de la regla de "el último mes", y el orden importa desde
    que esa regla también matchea "el mes" a secas: sin este orden, "el mes
    actual" caería en la ventana de 30 días. Gana la primera que matchea,
    así que la frase más específica va primero.
  */
  {
    patron: /\b(?:este\s+mes|el\s+mes\s+actual|mes\s+en\s+curso|lo\s+que\s+va\s+del\s+mes)\b/,
    armar: (_m, hoy) => ({
      desde: startOfMonth(hoy),
      hasta: hoy,
      etiqueta: "este mes",
    }),
  },

  /*
    "el último mes", "último mes", "el mes": los últimos 30 días.

    Ventana móvil, no mes de calendario (ver el bloque de arriba). El borde
    es `hoy - 30 días`, que es como lo dijo Beno: el 10 de agosto la
    ventana arranca el 11 de julio.

    El lookahead saca "el mes que viene" y sus variantes: eso mira para
    adelante y acá se contestan preguntas sobre plata ya gastada. Sin él,
    "cuánto gasto el mes que viene" contestaría con los últimos 30 días,
    que es exactamente al revés. Lo que sí mira para adelante son los
    vencimientos, y esos tienen su propio resolvedor abajo.
  */
  {
    patron:
      /\b(?:el\s+)?ultimo\s+mes\b|\bel\s+mes\b(?!\s+(?:que\s+viene|proximo|entrante|siguiente))/,
    armar: (_m, hoy) => {
      const desde = addDays(hoy, -DIAS_DE_UN_MES);
      return { desde, hasta: hoy, etiqueta: etiquetaDeUltimoMes(desde, hoy) };
    },
  },

  // "el año pasado"
  {
    patron: /\b(?:el\s+)?ano\s+(?:pasado|anterior)\b/,
    armar: (_m, hoy) => {
      const anterior = Number(hoy.slice(0, 4)) - 1;
      return {
        desde: `${anterior}-01-01`,
        hasta: `${anterior}-12-31`,
        etiqueta: `el año pasado (${anterior})`,
      };
    },
  },

  // "este año", "lo que va del año"
  {
    patron: /\b(?:este\s+ano|el\s+ano\s+actual|ano\s+en\s+curso|lo\s+que\s+va\s+del\s+ano)\b/,
    armar: (_m, hoy) => ({
      desde: `${hoy.slice(0, 4)}-01-01`,
      hasta: hoy,
      etiqueta: "este año",
    }),
  },

  /*
    Un año suelto: "2026", "gasté esto en 2025".

    Va última a propósito, porque es la más golosa de todas: cualquier
    número de cuatro cifras que arranque con 20 le sirve. En esta rama el
    riesgo es chico —acá Beno pregunta por números, no los carga; escribir
    montos es la rama "movimientos"— y además la respuesta dice siempre
    qué rango usó, así que un "2025" leído como año se ve en pantalla en
    vez de recortar los totales en silencio.
  */
  {
    patron: /\b(20[0-3]\d)\b/,
    armar: (m) => ({
      desde: `${m[1]}-01-01`,
      hasta: `${m[1]}-12-31`,
      etiqueta: `el año ${m[1]}`,
    }),
  },
];

/**
 * Lee el rango temporal que menciona un texto libre.
 *
 * `hoy` es parámetro para poder verificarlo sin depender del día en que se
 * corre. Por defecto sale de `todayISO()`, que trabaja en hora argentina:
 * `new Date(iso)` a secas parsea en UTC y acá devuelve el día anterior.
 */
export function resolverRango(
  texto: string | null,
  hoy: string = todayISO(),
): RangoResuelto | null {
  const normalizado = normalizar(texto ?? "");
  if (normalizado.length === 0) return null;

  for (const regla of REGLAS) {
    const coincidencia = normalizado.match(regla.patron);
    if (!coincidencia) continue;

    const armado = regla.armar(coincidencia, hoy);
    if (!armado) continue;

    return {
      desde: armado.desde,
      // Un rango no puede terminar en el futuro: "2026" pedido en agosto
      // llegaría hasta diciembre. Con solo movimientos efectuados no
      // cambiaría ningún total, pero la respuesta muestra las fechas y
      // decir "hasta el 31/12" sería mentir sobre lo que se miró.
      hasta: armado.hasta > hoy ? hoy : armado.hasta,
      etiqueta: armado.etiqueta,
      restante: normalizado.replace(coincidencia[0], " ").replace(/\s+/g, " ").trim(),
    };
  }

  return null;
}

/**
 * La línea que dice qué rango se usó. Va **siempre**, con rango o sin él:
 * si Beno pidió seis meses y el agente entendió otra cosa, tiene que poder
 * darse cuenta leyendo la respuesta.
 */
export function describirRango(rango: RangoResuelto | null): string {
  if (!rango) return "Rango: todo el histórico.";

  return `Rango: ${rango.etiqueta} (del ${formatDate(rango.desde)} al ${formatDate(rango.hasta)}).`;
}

const FORMATO_DE_MES = new Intl.DateTimeFormat("es-AR", { month: "long" });

/** "2026-08-10" → "agosto". En minúscula, para meterlo adentro de una frase. */
export function nombreDeMes(iso: string): string {
  // `parseISODate` arma el Date al mediodía local: `new Date(iso)` a secas
  // parsea en UTC y en Argentina puede devolver el mes anterior el día 1.
  return FORMATO_DE_MES.format(parseISODate(iso));
}

/**
 * Cómo se nombra la ventana de 30 días.
 *
 * Los últimos 30 días caen dentro de un mes o cruzan dos —nunca tres, que
 * necesitaría 32 días— y la etiqueta dice cuál de los dos casos es. Sin
 * eso, "el último mes" pedido el 10 de agosto se leería como "agosto"
 * cuando en realidad son tres semanas de julio y una de agosto.
 */
function etiquetaDeUltimoMes(desde: string, hasta: string): string {
  const base = "el último mes: los últimos 30 días";

  return monthKey(desde) === monthKey(hasta)
    ? `${base}, todos dentro de ${nombreDeMes(hasta)}`
    : `${base}, a caballo entre ${nombreDeMes(desde)} y ${nombreDeMes(hasta)}`;
}

/** El mes de calendario que mira el agente de vencimientos. */
export interface MesDeVencimientos {
  /** "YYYY-MM-DD", inclusive. */
  desde: string;
  /** "YYYY-MM-DD", inclusive. */
  hasta: string;
  /** Cómo se llama el mes: "agosto". */
  mes: string;
  /** El mes ya terminó: la lista mira para atrás y se nombra en pasado. */
  pasado: boolean;
  /** Es el mes en curso, así que arranca hoy: es lo que **queda** del mes. */
  enCurso: boolean;
}

/**
 * El mes que mira el agente de vencimientos.
 *
 * Acá el criterio es el **mes de calendario**, al revés que `resolverRango`
 * — y es a propósito, no una inconsistencia. Son dos preguntas distintas:
 * para analizar plata, una ventana móvil de 30 días dice más (siempre mide
 * lo mismo, no importa el día del mes); para lo que se viene a cobrar, el
 * mes de calendario es literalmente como funciona la facturación. Una
 * suscripción que vence el 3 no "vence dentro de 30 días": vence en
 * septiembre.
 *
 * Sin frase reconocida devuelve el **mes en curso desde hoy**: lo que
 * queda por pagar este mes, que es lo que se pregunta cuando se pregunta
 * sin aclarar nada.
 *
 * **"El mes pasado" se contesta mirando para atrás, no con un error.**
 * Es tentador decir "un vencimiento pasado ya venció, esto es para lo que
 * viene", pero la pregunta tiene una respuesta real y a mano: qué cargos
 * cayeron el mes pasado según lo declarado en `recurrences`. Negarse sería
 * tirar información que está a un `proximoVencimiento` de distancia. Lo
 * único que no se puede hacer es contestarla **como si fuera futuro**: por
 * eso viaja `pasado` y quien llama titula en pasado ("Lo que te venció en
 * julio"). Ojo con lo que NO dice esa lista: son los vencimientos
 * declarados, no los pagos hechos; que algo venciera no prueba que se haya
 * pagado, y eso vive en `movements`.
 */
export function resolverMesDeVencimientos(
  texto: string | null,
  hoy: string = todayISO(),
): MesDeVencimientos {
  const normalizado = normalizar(texto ?? "");

  // El que viene se pregunta antes que el pasado, y los dos antes que el
  // default: "el mes que viene" contiene "el mes", que es la frase más
  // general de las tres.
  if (/\b(?:mes\s+que\s+viene|proximo\s+mes|mes\s+proximo|mes\s+entrante|mes\s+siguiente)\b/.test(normalizado)) {
    const siguiente = addMonths(startOfMonth(hoy), 1);
    return {
      desde: siguiente,
      hasta: endOfMonth(siguiente),
      mes: nombreDeMes(siguiente),
      pasado: false,
      // El mes que viene se mira entero: no hay parte de él que ya pasó.
      enCurso: false,
    };
  }

  if (/\b(?:mes\s+pasado|mes\s+anterior|ultimo\s+mes)\b/.test(normalizado)) {
    const anterior = addMonths(startOfMonth(hoy), -1);
    return {
      desde: anterior,
      hasta: endOfMonth(anterior),
      mes: nombreDeMes(anterior),
      pasado: true,
      enCurso: false,
    };
  }

  return {
    // Desde hoy y no desde el 1: lo que ya venció este mes no es "lo que
    // se te viene". Un vencimiento que cae hoy sí entra.
    desde: hoy,
    hasta: endOfMonth(hoy),
    mes: nombreDeMes(hoy),
    pasado: false,
    enCurso: true,
  };
}

/** Minúsculas, sin tildes y sin puntuación. Mismo criterio que `resolver.ts`. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    // El rango de diacríticos que suelta NFD (U+0300 a U+036F). "año"
    // queda "ano", que es como lo esperan los patrones de arriba.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
