import type { Destino } from "@/lib/agentes/tipos";

/**
 * El corpus con el que se mide el recepcionista.
 *
 * ## Por qué existe
 *
 * Hasta el 2026-08-12 el piso de regresión era **prosa dentro del bloque
 * de comentarios de `recepcionista.ts`**: seis tandas de mediciones a
 * mano, escritas en castellano y sin nada que se pudiera correr. Nadie
 * podía verificar un cambio sin volver a armar el arnés desde cero, y por
 * eso —medido— el prompt se rompió cuatro veces.
 *
 * ⚠ **Esto son DATOS, no lógica.** La comparación vive en
 * `veredicto.ts` y el disparo en `scripts/medir-recepcionista.ts`. Si
 * alguna vez aparece un `if` acá, está en el archivo equivocado.
 *
 * ⚠ **Ninguna frase se inventa.** Todas salen de los comentarios de
 * `recepcionista.ts` o de AGENTS.md §9. `origen: "real"` marca las que
 * Beno tipeó de verdad: esas son las que no se negocian.
 *
 * ⚠ **`espera` es lo que está DOCUMENTADO, no lo que da hoy.** Si la
 * primera corrida contradice a un comentario, eso es un hallazgo y se
 * anota; no se ajusta el banco para que dé verde. Es justo la deriva
 * silenciosa que este banco viene a hacer visible.
 */
export interface CasoDelBanco {
  frase: string;
  /** De dónde salió. `"real"` = Beno la tipeó. */
  origen: "real" | "sintetica";
  /**
   * Si entra en el piso de regresión: las 11 que se corren siempre,
   * porque son las que históricamente se rompieron.
   */
  piso: boolean;
  /** Por qué está en el banco. Se imprime cuando falla. */
  porque: string;
  espera: {
    /** Aceptables. Varios cuando el comentario documenta oscilación. */
    destinos: Destino[];
    /** Cuántas acciones tiene que devolver la frase. */
    acciones: number;
    /** Banda inclusiva de confianza. */
    confianza: [number, number];
    /**
     * `"literal"`: idéntico a la frase.
     * `"contiene"`: tiene que traer los fragmentos de `contiene`.
     * `"null"`: el especialista no necesita argumento.
     * Sin definir: no se chequea.
     */
    argumento?: "literal" | "contiene" | "null";
    contiene?: string[];
  };
}

const ALTA: [number, number] = [0.6, 1];
const AMBIGUA: [number, number] = [0, 0.4];

export const BANCO: readonly CasoDelBanco[] = [
  // ── Las cuatro anclas ambiguas ──────────────────────────────
  // Se rompieron las cuatro veces. Un nombre suelto sin verbo no dice si
  // Beno quiere anotarlo, consultarlo, buscarlo o cerrarlo.
  //
  // ⚠ **Las cuatro dan ROJO desde el 2026-08-12, y el rojo se deja.**
  // Medido: las tres corridas devuelven `desconocido` con confianza 0.4,
  // porque `atajo.ts` las resuelve sin llamar al modelo y ahí el destino
  // no se elige — con esa confianza la cadena pregunta antes de despachar,
  // así que cuál sea da igual.
  //
  // El `espera` de acá abajo dice `movimientos`, `consultas`, `buscador` y
  // `suscripciones` porque eso es lo que documentan los comentarios de
  // `recepcionista.ts`, y **el banco escribe lo documentado, no lo que da
  // hoy** (ver el ⚠ de arriba). Ajustarlo a `desconocido` para ver verde
  // sería borrar la única marca de que estas cuatro frases cambiaron de
  // camino: es la deriva silenciosa que este archivo viene a hacer
  // visible. Se corrige recién cuando alguien decida —con Beno— que el
  // atajo es el comportamiento definitivo para las anclas.
  //
  // Lo que el rojo NO dice es que haya una regresión: la confianza sigue
  // ≤ 0.4 en las tres corridas, que era la propiedad que el piso protegía.
  {
    frase: "Claude Code",
    origen: "sintetica",
    piso: true,
    porque: "Ancla. Con los ejemplos fuera del prompt vuelve a confianza 1.",
    espera: { destinos: ["movimientos"], acciones: 1, confianza: AMBIGUA },
  },
  {
    frase: "Proder",
    origen: "sintetica",
    piso: true,
    porque: "Ancla. Subió de 0.3 a 0.8 con un párrafo que ni la nombraba.",
    espera: { destinos: ["consultas"], acciones: 1, confianza: AMBIGUA },
  },
  {
    frase: "pricing",
    origen: "sintetica",
    piso: true,
    porque: "Ancla. Subió a 0.8 al usarse como ejemplo de tema.",
    espera: { destinos: ["buscador"], acciones: 1, confianza: AMBIGUA },
  },
  {
    frase: "Vercel Pro",
    origen: "sintetica",
    piso: true,
    porque: "Ancla. La tabla de valores fijos la empeoró de 0.8 a 0.9.",
    espera: { destinos: ["suscripciones"], acciones: 1, confianza: AMBIGUA },
  },
  {
    frase: "el hosting de Vercel Pro",
    origen: "sintetica",
    piso: true,
    porque:
      "La única ambigua que SÍ llega al modelo: tiene más de dos palabras, " +
      "así que el atajo de `atajo.ts` no la toca. Las cuatro anclas clásicas " +
      "quedaron cortocircuitadas por el atajo —que es su punto— y sin esta " +
      "frase el banco perdería toda señal sobre qué hace el prompt con la " +
      "ambigüedad. La Tarea B3 la necesita para comparar antes y después.",
    espera: {
      destinos: ["suscripciones", "consultas", "movimientos", "buscador"],
      acciones: 1,
      confianza: AMBIGUA,
    },
  },

  // ── Las seis simples: una sola acción cada una ──────────────
  {
    frase: "cómo viene Proder",
    origen: "real",
    piso: true,
    porque: "Simple. Consulta de plata con verbo y palabra de pregunta.",
    espera: { destinos: ["consultas"], acciones: 1, confianza: ALTA },
  },
  {
    frase: "qué me toca hoy",
    origen: "real",
    piso: true,
    porque: "Simple. Tiene que ser roadmap y no estudio: LEE el plan.",
    espera: { destinos: ["roadmap"], acciones: 1, confianza: ALTA },
  },
  {
    frase: "qué estoy pagando que no uso",
    origen: "real",
    piso: true,
    porque: "Simple. El gancho de suscripciones.",
    espera: { destinos: ["suscripciones"], acciones: 1, confianza: ALTA },
  },
  {
    frase: "hacé la retro de Gentius",
    origen: "real",
    piso: true,
    porque: "Simple. No tiene que irse a proyecto: escribe un documento.",
    espera: {
      destinos: ["retro"],
      acciones: 1,
      confianza: ALTA,
      argumento: "contiene",
      contiene: ["Gentius"],
    },
  },
  {
    frase: "qué anotaciones tengo sobre gestión de presupuestos",
    origen: "real",
    piso: true,
    porque:
      "Simple y el choque escrito adentro del prompt: el tema es de plata " +
      "pero pregunta por lo que ESCRIBIÓ. Se fue a consultas con 0.8 una vez.",
    espera: { destinos: ["buscador"], acciones: 1, confianza: ALTA },
  },
  {
    frase: "quiero aprender sobre eso",
    origen: "real",
    piso: true,
    porque: "Simple. Separa tema_estudio de estudio por VERBO.",
    espera: { destinos: ["tema_estudio"], acciones: 1, confianza: ALTA },
  },

  // ── Las cinco telegráficas: el argumento vuelve literal ─────
  // Medidas el 2026-08-10: las cinco a movimientos con confianza 1 y el
  // argumento idéntico a la frase. Sin el número no hay gasto que cargar.
  {
    frase: "-20usd Claude Code 06/08",
    origen: "real",
    piso: false,
    porque: "Telegráfica. Volvió reescrita y SIN LA FECHA con un prompt largo.",
    espera: {
      destinos: ["movimientos"],
      acciones: 1,
      confianza: ALTA,
      argumento: "literal",
    },
  },
  {
    frase: "+50000ARS Venta Proder",
    origen: "real",
    piso: false,
    porque: "Telegráfica, ingreso.",
    espera: {
      destinos: ["movimientos"],
      acciones: 1,
      confianza: ALTA,
      argumento: "literal",
    },
  },
  {
    frase: "-20 usd claude code 06/08",
    origen: "real",
    piso: false,
    porque: "Telegráfica en minúsculas y con espacios.",
    espera: {
      destinos: ["movimientos"],
      acciones: 1,
      confianza: ALTA,
      argumento: "literal",
    },
  },
  {
    frase: "-15000 hosting",
    origen: "real",
    piso: false,
    porque: "Telegráfica sin moneda ni fecha.",
    espera: {
      destinos: ["movimientos"],
      acciones: 1,
      confianza: ALTA,
      argumento: "literal",
    },
  },
  {
    frase: "+200000 ARS venta",
    origen: "real",
    piso: false,
    porque: "Telegráfica sin proyecto.",
    espera: {
      destinos: ["movimientos"],
      acciones: 1,
      confianza: ALTA,
      argumento: "literal",
    },
  },

  // ── Fronteras que costaron una medición cada una ────────────
  {
    frase: "cerrá Proder",
    origen: "real",
    piso: false,
    porque:
      "El bullet de retro decía textual 'Ej: cerrá Proder'. Al agregarse " +
      "el destino proyecto hubo que reescribirlo. Es la colisión que " +
      "estaba ESCRITA.",
    espera: { destinos: ["proyecto"], acciones: 1, confianza: ALTA },
  },
  {
    frase: "agreguemos lecciones sobre pricing",
    origen: "real",
    piso: false,
    porque:
      "OSCILABA entre tema_estudio y lecciones_tema entre corridas. Es la " +
      "frase que prueba que el modelo no es determinístico con temp 0.",
    espera: { destinos: ["tema_estudio"], acciones: 1, confianza: ALTA },
  },
  {
    frase: "sacá lecciones de lo que aprendí con clientes",
    origen: "real",
    piso: false,
    porque: "El contraste con la de arriba: SACAR es mirar lo ya vivido.",
    espera: { destinos: ["lecciones_tema"], acciones: 1, confianza: ALTA },
  },
  {
    frase: "qué lecciones hicimos de scrum",
    origen: "real",
    piso: false,
    porque:
      "Cuarto error silencioso del 2026-08-10: se iba a lecciones_tema " +
      "con 0.8, o sea generaba lecciones nuevas en vez de traer las escritas.",
    espera: { destinos: ["buscador"], acciones: 1, confianza: ALTA },
  },
  {
    frase: "qué lecciones sugerís hoy",
    origen: "real",
    piso: false,
    porque:
      "Se iba a lecciones_tema con 0.8. Una sugerencia sin tema es estudio.",
    espera: { destinos: ["estudio"], acciones: 1, confianza: ALTA },
  },
  {
    frase: "según toda la actividad que vengo haciendo, qué sugerís hoy",
    origen: "real",
    piso: false,
    porque: "Se iba a buscador con 0.8.",
    espera: { destinos: ["estudio"], acciones: 1, confianza: ALTA },
  },
  {
    frase: "tengo algún gasto recurrente próximo a vencer",
    origen: "real",
    piso: false,
    porque: "El gancho de vencimientos, que comparte tema con suscripciones.",
    espera: { destinos: ["vencimientos"], acciones: 1, confianza: ALTA },
  },
  {
    frase:
      "me armás un presupuesto para un cliente que quiere una landing con " +
      "formulario de contacto",
    origen: "real",
    piso: false,
    porque: "ARMAR uno es el verbo opuesto a buscar lo que anotó sobre ellos.",
    espera: { destinos: ["presupuesto"], acciones: 1, confianza: ALTA },
  },

  // ── Material que el modelo no puede abrir ───────────────────
  {
    frase:
      "mirá, te paso capturas para que veas esto que me contestó un cliente",
    origen: "real",
    piso: false,
    porque:
      "Devolvía TRES acciones con confianza 1 y los argumentos eran los " +
      "ejemplos del propio prompt copiados. Sin nada real que enganchar, " +
      "el modelo repite lo que tiene a mano.",
    espera: { destinos: ["desconocido"], acciones: 1, confianza: AMBIGUA },
  },
  {
    frase: "Me haces un presupuesto para x proyecto? aca esta el spec",
    origen: "real",
    piso: false,
    porque:
      "Le GANA a la regla de 'material que no podés abrir', y está bien: " +
      "no lee el spec, lleva a la pantalla de alta con el texto pegado.",
    espera: { destinos: ["presupuesto"], acciones: 1, confianza: ALTA },
  },

  // ── Multi-acción: el riesgo es que parta las simples ────────
  {
    frase:
      "Anota las fechas de apertura y cierre de Proder y El Prode de Beno " +
      "01/04/26 apertura y 31/07/26 para las dos",
    origen: "real",
    piso: false,
    porque:
      "Fallo 1 del 2026-08-10. Daba TRES acciones equivocadas: dos de " +
      "bitácora con argumentos 'Proder' y 'El Prode', más una retro que " +
      "nadie pidió. Las fechas desaparecían enteras.",
    espera: {
      destinos: ["proyecto"],
      acciones: 2,
      confianza: ALTA,
      argumento: "contiene",
      contiene: ["01/04", "31/07"],
    },
  },
  {
    frase:
      "hoy el cliente x me dijo y cosa sobre Gentius, quiero que lo anotes " +
      "en la bitácora y que me generes lecciones sobre eso",
    origen: "real",
    piso: false,
    porque:
      "El argumento de bitácora volvía recortado a 'cosa sobre Gentius': " +
      "la entrada de Beno con tres cuartas partes borradas, en silencio.",
    espera: {
      destinos: ["bitacora", "lecciones_tema"],
      acciones: 2,
      confianza: ALTA,
      argumento: "contiene",
      contiene: ["el cliente x me dijo"],
    },
  },
  {
    frase: "anotá que hoy peleé con el deploy toda la tarde",
    origen: "sintetica",
    piso: false,
    porque: "Bitácora simple: NO se parte en dos.",
    espera: {
      destinos: ["bitacora"],
      acciones: 1,
      confianza: ALTA,
      argumento: "contiene",
      contiene: ["peleé con el deploy toda la tarde"],
    },
  },
];

/**
 * Las 11 que se corren siempre.
 *
 * Cuatro de ellas —las anclas de una y dos palabras— las resuelve
 * `atajo.ts` sin llamar al modelo, así que el costo real son **21
 * llamadas: unos 11 minutos** a 2 llamadas por minuto.
 */
export function casosDelPiso(): readonly CasoDelBanco[] {
  return BANCO.filter((c) => c.piso);
}
