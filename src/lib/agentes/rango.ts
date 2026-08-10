import {
  addDays,
  addMonths,
  endOfMonth,
  formatDate,
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
 * 1. **Los meses son meses de calendario, no ventanas de 30 días.**
 *    "Los últimos 6 meses" arranca el día 1 del sexto mes para atrás,
 *    contando el mes en curso. Así los cortes coinciden con los buckets
 *    de `Balances.porMes` y con lo que Beno ve en los gráficos; una
 *    ventana móvil partiría meses al medio y ningún total cerraría con la
 *    pantalla.
 * 2. **"El último mes" es el mes en curso**, que es el último de esos
 *    buckets. Es la lectura que hace coherente la frase real de Beno
 *    ("analizame los últimos 6 meses… y si hacemos foco en el último
 *    mes"): el foco cae sobre el último tramo de lo que acaba de mirar,
 *    no sobre el mes anterior. Como el mes en curso está incompleto, la
 *    respuesta muestra siempre las fechas exactas y la interpretación
 *    queda a la vista.
 *
 * **Si no se reconoce nada devuelve `null`, y eso no es un error**: la
 * consulta sigue siendo sobre todo el histórico, como fue siempre, y la
 * respuesta lo dice. Adivinar un rango sería peor que no tener ninguno:
 * los números cambiarían sin que nada lo avise.
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

  // "el último mes" (sin número): el mes en curso. Ver el bloque de arriba.
  {
    patron: /\b(?:el\s+)?ultimo\s+mes\b/,
    armar: (_m, hoy) => ({
      desde: startOfMonth(hoy),
      hasta: hoy,
      etiqueta: "el último mes, el que está en curso",
    }),
  },

  // "este mes", "el mes actual", "lo que va del mes"
  {
    patron: /\b(?:este\s+mes|el\s+mes\s+actual|mes\s+en\s+curso|lo\s+que\s+va\s+del\s+mes)\b/,
    armar: (_m, hoy) => ({
      desde: startOfMonth(hoy),
      hasta: hoy,
      etiqueta: "este mes",
    }),
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
