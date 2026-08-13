import "server-only";

import { z } from "zod";

import { leerFecha, partirFechaFinal } from "@/lib/agentes/fechas";
import { parseAmount } from "@/lib/format";
import {
  MODELO_CHICO,
  completarJSON,
  hayModeloConfigurado,
  type PromptDeclarado,
} from "@/lib/llm";
import type { Moneda, TipoMovimiento } from "@/lib/supabase/database.types";

/**
 * Lee un movimiento dictado en una línea.
 *
 * **Saca datos y nada más: monto, moneda, descripción, fecha y —cuando el
 * signo lo dice— si es ingreso o egreso. NO clasifica.** El tipo y la
 * categoría los decide `lib/clasificacion.ts`, que mira primero el
 * histórico de Beno y recién después un modelo (regla 6.c). Si el mismo
 * modelo que extrae además clasificara, las decisiones que Beno ya tomó
 * dejarían de ganar y "Claude Pro" se clasificaría de cero cada vez.
 *
 * ## Dos caminos, y el primero no usa modelo
 *
 * Medido pidiéndole a Beno frases reales, escribe **telegráfico y sin
 * verbo**:
 *
 *     -20usd Claude Code 06/08
 *     +50000ARS Venta Proder
 *     -20 usd claude code 06/08
 *     -15000 hosting
 *     +200000 ARS venta
 *
 * Eso no necesita un modelo: el signo de adelante es una señal
 * determinística (`-` egreso, `+` ingreso), la moneda va pegada al número y
 * la fecha al final. Resolverlo con `leerTelegrafico()` es más rápido, es
 * gratis, **no se puede equivocar** y —lo que importa de verdad— sigue
 * andando con Groq caído, que es la regla 7: cargar un gasto nunca puede
 * depender de que un modelo conteste.
 *
 * El modelo entra **solo** cuando la frase no tiene esa forma ("pagué 20
 * dólares de Claude Code", "me cobraron 15 lucas el hosting el martes").
 *
 * ## Lo que no está, no está
 *
 * Todos los campos son nullables y ninguno se inventa. Beno lo pidió con
 * todas las letras: *"acá me olvido de la fecha, me la tiene que preguntar,
 * aplica también por si me olvido la cantidad de dinero, el motivo y
 * cualquier otro dato relevante para clasificar"*. Asumir "hoy" cuando no
 * dijo nada es el error que no se ve: el formulario se abre igual que
 * siempre y el gasto queda con la fecha equivocada.
 */

/** De dónde salió un campo. Se le muestra a Beno campo por campo. */
export type FuenteCampo =
  /** Lo escribió él, y lo leyó un regex. */
  | "frase"
  /** Lo escribió él, y lo recortó el modelo. */
  | "modelo"
  /** El signo `+` / `-` de adelante. */
  | "signo"
  /** Lo puso la app porque no lo dijo (la moneda, el tipo). */
  | "defecto";

export interface MovimientoLeido {
  monto: number | null;
  moneda: Moneda | null;
  descripcion: string | null;
  /** "YYYY-MM-DD". `null` si la frase no dijo ninguna. */
  fecha: string | null;
  /** Cómo la nombró él ("ayer", "06/08"), para poder repetírselo. */
  etiquetaFecha: string | null;
  /** Solo sale del signo de adelante. El resto lo decide la clasificación. */
  tipo: TipoMovimiento | null;
  fuentes: Partial<Record<keyof MovimientoLeido, FuenteCampo>>;
  /** Lo resolvió el regex, sin gastar una llamada. */
  sinModelo: boolean;
  /**
   * Hubo que llamar al modelo y falló. Lo que hay salió de un regex de
   * emergencia sobre la frase suelta, así que quien llama lo aclara en vez
   * de hacer pasar media lectura por una lectura entera.
   */
  degradado: boolean;
}

/** `-` es egreso y `+` es ingreso. No hay nada que interpretar acá. */
const TIPO_POR_SIGNO: Readonly<Record<string, TipoMovimiento>> = {
  "-": "egreso",
  "+": "ingreso",
};

/**
 * Cómo se nombra la plata, con su multiplicador.
 *
 * "lucas" y "palos" no son moneda: son cantidad ("15 lucas" son quince mil
 * pesos). Van acá igual porque ocupan el mismo lugar en la frase y porque
 * resolverlos con una tabla es determinístico — pedírselo al modelo sería
 * darle la oportunidad de equivocarse en un factor de mil.
 */
const MONEDAS: { patron: RegExp; moneda: Moneda; factor: number }[] = [
  { patron: /^(usd|u\$s|us\$|u\$d|dolares|dolar|verdes|verde)$/, moneda: "USD", factor: 1 },
  { patron: /^(ars|\$|pesos|peso|mangos|mango)$/, moneda: "ARS", factor: 1 },
  { patron: /^(lucas|luca)$/, moneda: "ARS", factor: 1_000 },
  { patron: /^(palos|palo)$/, moneda: "ARS", factor: 1_000_000 },
];

/** Techo de cordura: más que esto es un error de tipeo, no un movimiento. */
const MONTO_MAXIMO = 1e12;

const vacio: MovimientoLeido = {
  monto: null,
  moneda: null,
  descripcion: null,
  fecha: null,
  etiquetaFecha: null,
  tipo: null,
  fuentes: {},
  sinModelo: true,
  degradado: false,
};

/**
 * El camino rápido: el estilo telegráfico, sin modelo y sin red.
 *
 * La forma es **signo opcional + número + moneda opcional + descripción +
 * fecha opcional**, y lo que la distingue de una frase normal es que
 * arranca con el número: "pagué 20 dólares" empieza con una letra y no cae
 * acá. Ejemplos que resuelve enteros:
 *
 * | Frase                        | Sale                                              |
 * |------------------------------|---------------------------------------------------|
 * | `-20usd Claude Code 06/08`   | 20 USD, "Claude Code", 06/08, egreso              |
 * | `+50000ARS Venta Proder`     | 50000 ARS, "Venta Proder", **sin fecha**, ingreso |
 * | `-20 usd claude code 06/08`  | 20 USD, "claude code", 06/08, egreso              |
 * | `-15000 hosting`             | 15000, **sin moneda**, "hosting", egreso          |
 * | `+200000 ARS venta`          | 200000 ARS, "venta", ingreso                      |
 *
 * Devuelve `null` si la frase no tiene esta forma, y ahí entra el modelo.
 */
export function leerTelegrafico(
  frase: string,
  hoy: string,
): MovimientoLeido | null {
  let resto = frase.trim();

  // 1. El signo, si está. Es la única señal de tipo que no necesita a nadie.
  const signo = resto.match(/^([+-])\s*/);
  if (signo) resto = resto.slice(signo[0].length);

  // 2. El número. Sin esto acá adelante, la frase no es telegráfica.
  const numero = resto.match(/^(\d[\d.,]*)/);
  if (!numero) return null;
  resto = resto.slice(numero[0].length);

  const crudo = parseAmount(numero[1]!);
  if (crudo === null || crudo <= 0 || crudo > MONTO_MAXIMO) return null;

  // 3. La moneda, si la primera palabra que sigue lo es. Si no lo es, no se
  //    consume: es el principio de la descripción ("-15000 hosting").
  let monto = crudo;
  let moneda: Moneda | null = null;

  const palabra = resto.match(/^\s*(\S+)/);
  if (palabra) {
    const token = normalizarToken(palabra[1]!);
    const encontrada = MONEDAS.find((m) => m.patron.test(token));
    if (encontrada) {
      moneda = encontrada.moneda;
      monto = crudo * encontrada.factor;
      resto = resto.slice(palabra[0].length);
    }
  }

  // 4. La fecha va al final, y lo que queda antes es la descripción entera.
  const partida = partirFechaFinal(resto, hoy);
  const descripcion = partida.texto.trim();

  return {
    monto,
    moneda,
    descripcion: descripcion || null,
    fecha: partida.fecha?.fecha ?? null,
    etiquetaFecha: partida.fecha?.etiqueta ?? null,
    tipo: signo ? (TIPO_POR_SIGNO[signo[1]!] ?? null) : null,
    fuentes: {
      monto: "frase",
      ...(moneda ? { moneda: "frase" as const } : {}),
      ...(descripcion ? { descripcion: "frase" as const } : {}),
      ...(partida.fecha ? { fecha: "frase" as const } : {}),
      ...(signo ? { tipo: "signo" as const } : {}),
    },
    sinModelo: true,
    degradado: false,
  };
}

/**
 * Lo que devuelve el modelo. Los cuatro campos son nullables porque la
 * frase puede no traerlos, y **null es una respuesta correcta**: es lo que
 * dispara la pregunta en vez de la invención.
 *
 * `monto` acepta también string porque algunos modelos devuelven "20.00"
 * aunque el prompt pida un número, y perder la llamada entera por eso sería
 * caro: se normaliza abajo con `parseAmount`.
 */
const respuestaSchema = z.object({
  monto: z.union([z.number(), z.string()]).nullable(),
  moneda: z.enum(["ARS", "USD"]).nullable(),
  descripcion: z.string().trim().max(200).nullable(),
  fecha_texto: z.string().trim().max(60).nullable(),
});

const SISTEMA = `Sos el que lee una frase donde Beno cuenta que entró o salió plata, y saca los datos que hay. Nada más.

NO clasificás: no decís si es ingreso o egreso, ni la categoría, ni el proyecto. Eso lo decide otra parte del sistema mirando lo que Beno ya cargó antes. Vos solo leés.

Sacás cuatro cosas:

"descripcion": de qué era la plata. **COPIALA ENTERA**, desde donde empieza y hasta donde termina, sin sacarle palabras del medio. No la resumas, no la acortes, no la reformules, no la traduzcas y no le cambies las mayúsculas.
- "cobré 50000 por la Venta Proder a cliente nuevo" -> "Venta Proder a cliente nuevo". NO "Venta".
- "pagué 20 dólares de Claude Code" -> "Claude Code".
- "me cobraron 15 lucas el hosting el martes" -> "el hosting".
Sacale solo el verbo del principio ("pagué", "cobré", "me cobraron", "me salió"), el monto y la expresión de fecha.

"monto": el número, sin símbolos ni separadores de miles y sin signo. "20 dólares" -> 20. "50 mil" -> 50000. "15 lucas" -> 15000 (una luca es mil pesos). "2 palos" -> 2000000.

"moneda": "USD" si dice dólares, usd, u$s o verdes. "ARS" si dice pesos, ars, mangos, lucas o palos. null si la frase no lo dice.

"fecha_texto": la expresión de fecha **copiada tal cual de la frase**: "ayer", "el martes", "el 6 de agosto", "06/08", "hace dos semanas". NO la calcules, NO la conviertas a números y NO la pases a otro formato: la cuenta la hacemos nosotros. Si la frase no menciona ninguna, null.

Si un dato no está en la frase, poné null. **Nunca lo inventes ni lo adivines**: que falte un dato no es un problema, se lo vamos a preguntar. Un monto inventado, en cambio, se guarda sin que nadie lo note.

Respondé SOLO un objeto JSON:
{"monto": number|null, "moneda": "ARS"|"USD"|null, "descripcion": string|null, "fecha_texto": string|null}`;

/**
 * El prompt del extractor, declarado para que el arnés mida **este** (ver
 * `PromptDeclarado`).
 *
 * Lo que su juez cobra es el **COPIALA ENTERA** de arriba: la descripción
 * que devuelve tiene que ser una subcadena de la frase. Es una regla que
 * hoy solo vive como mayúsculas dentro del prompt, y su modo de fallar
 * está medido y es silencioso — con un prompt más largo, `"Venta Proder a
 * cliente nuevo"` volvía como `"Venta"` y el histórico, de donde sale la
 * clasificación de todo lo que venga después, quedaba sucio.
 */
export const PROMPT_MOVIMIENTO: PromptDeclarado<
  z.infer<typeof respuestaSchema>
> = {
  modelo: MODELO_CHICO,
  sistema: SISTEMA,
  esquema: respuestaSchema,
  etiqueta: "extraccion-movimiento",
  // Leer, no redactar: la misma frase tiene que dar siempre lo mismo.
  temperatura: 0,
  // Cuatro campos cortos. De sobra, y el techo del modelo chico es de
  // 6000 tokens por minuto.
  maxTokens: 200,
  // Un solo reintento: hay alguien mirando la caja. Si no sale rápido, el
  // regex de emergencia y a mano.
  reintentos: 1,
  timeoutMs: 15_000,
};

/**
 * El camino con modelo, solo para las frases que no son telegráficas.
 *
 * **Nunca lanza.** Si Groq está caído, sin cuota o contesta cualquier cosa,
 * cae a `leerDeEmergencia()` y devuelve lo que un regex suelto pueda sacar
 * (regla 7, y está en la tabla de modo degradado del spec: *"se intenta un
 * regex para monto y moneda; si sale, el formulario se abre con eso"*).
 */
async function leerConModelo(
  frase: string,
  hoy: string,
): Promise<MovimientoLeido> {
  if (!hayModeloConfigurado()) return leerDeEmergencia(frase, hoy);

  try {
    const { datos } = await completarJSON({
      ...PROMPT_MOVIMIENTO,
      usuario: frase,
    });

    const monto = normalizarMonto(datos.monto);
    const descripcion = datos.descripcion?.trim() || null;

    // La fecha la calcula `fechas.ts` con la expresión que copió el modelo.
    // `explicita` es lo que distingue "no dijo fecha" de "dijo hoy", y esa
    // diferencia es justo la que Beno pidió que no se asuma.
    const leida = datos.fecha_texto ? leerFecha(datos.fecha_texto, hoy) : null;
    const fecha = leida?.explicita ? leida : null;

    return {
      monto,
      moneda: datos.moneda,
      descripcion,
      fecha: fecha?.fecha ?? null,
      etiquetaFecha: fecha?.etiqueta ?? null,
      // El modelo tiene prohibido decidir el tipo: sale del signo (que acá
      // no hay) o de la clasificación contra el histórico.
      tipo: null,
      fuentes: {
        ...(monto !== null ? { monto: "modelo" as const } : {}),
        ...(datos.moneda ? { moneda: "modelo" as const } : {}),
        ...(descripcion ? { descripcion: "modelo" as const } : {}),
        ...(fecha ? { fecha: "modelo" as const } : {}),
      },
      sinModelo: false,
      degradado: false,
    };
  } catch (error: unknown) {
    console.error("[agentes] no pude extraer el movimiento:", error);
    return { ...leerDeEmergencia(frase, hoy), degradado: true };
  }
}

/**
 * Sin modelo: se busca un número y una moneda en cualquier parte de la
 * frase y se deja el resto en blanco.
 *
 * La descripción **no** se adivina recortando la frase: quedaría con el
 * verbo adentro ("pagué de Claude Code") y eso ensucia el histórico, que es
 * de donde sale la clasificación de todos los movimientos que vengan
 * después. Preguntarla cuesta una línea; arreglar el histórico, no.
 */
function leerDeEmergencia(frase: string, hoy: string): MovimientoLeido {
  const numero = frase.match(/(\d[\d.,]*)/);
  const crudo = numero ? parseAmount(numero[1]!) : null;

  if (crudo === null || crudo <= 0 || crudo > MONTO_MAXIMO) {
    return { ...vacio, sinModelo: false, ...leerFechaSuelta(frase, hoy) };
  }

  // La palabra que sigue al número, si es una moneda o una cantidad.
  const despues = frase.slice((numero?.index ?? 0) + numero![0]!.length);
  const palabra = despues.match(/^\s*(\S+)/);
  const encontrada = palabra
    ? MONEDAS.find((m) => m.patron.test(normalizarToken(palabra[1]!)))
    : undefined;

  const suelta = leerFechaSuelta(frase, hoy);

  return {
    ...vacio,
    monto: crudo * (encontrada?.factor ?? 1),
    moneda: encontrada?.moneda ?? null,
    ...suelta,
    fuentes: {
      monto: "frase",
      ...(encontrada ? { moneda: "frase" as const } : {}),
      ...(suelta.fecha ? { fecha: "frase" as const } : {}),
    },
    sinModelo: false,
  };
}

/** La fecha que aparezca en cualquier parte de la frase, o nada. */
function leerFechaSuelta(frase: string, hoy: string) {
  const leida = leerFecha(frase, hoy);
  return leida.explicita
    ? { fecha: leida.fecha, etiquetaFecha: leida.etiqueta }
    : { fecha: null, etiquetaFecha: null };
}

/**
 * Lee lo que Beno dictó: primero el regex, y el modelo solo si hizo falta.
 *
 * `hoy` es parámetro para poder verificarlo sin depender del día en que se
 * corre.
 */
export async function leerMovimiento(
  frase: string,
  hoy: string,
): Promise<MovimientoLeido> {
  const rapido = leerTelegrafico(frase, hoy);
  if (rapido) return rapido;

  return leerConModelo(frase, hoy);
}

/** Minúsculas, sin tildes y sin la puntuación que queda pegada al final. */
function normalizarToken(token: string): string {
  return token
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,;:!?]+$/, "");
}

function normalizarMonto(valor: number | string | null): number | null {
  if (valor === null) return null;

  const numero = typeof valor === "number" ? valor : parseAmount(valor);
  if (numero === null || !Number.isFinite(numero)) return null;

  // El signo lo decide el tipo del movimiento, nunca el monto: `movements`
  // guarda importes positivos y un `tipo` aparte.
  const positivo = Math.abs(numero);
  return positivo > 0 && positivo <= MONTO_MAXIMO ? positivo : null;
}
