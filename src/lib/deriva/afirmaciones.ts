import type { Hechos } from "@/lib/deriva/hechos";

/**
 * Qué documento afirma qué número, y de qué hecho tiene que salir.
 *
 * ⚠ **Esto son DATOS, no lógica.** La comparación vive en `verificar.ts` y
 * la medición en `hechos.ts`. Si aparece un `if` acá, está en el archivo
 * equivocado — es el mismo corte que `banco.ts` / `veredicto.ts`.
 *
 * ## Solo los documentos vivos
 *
 * AGENTS.md y los manuales dicen lo que es cierto **hoy**. Los specs, los
 * planes y `docs/registro-correcciones.md` dicen lo que era cierto el día
 * que se escribieron: lintearlos obligaría a reescribir el pasado, que es
 * exactamente lo contrario de para qué existen. Un spec que dice "el
 * prompt son 2613 tokens" no está viejo, está fechado.
 *
 * ## Que la regex no matchee es TAMBIÉN una falla
 *
 * Es la propiedad que sostiene todo lo demás. Un chequeo que deja de
 * encontrar su línea —porque alguien reescribió el párrafo— se apagaría
 * solo y en silencio, o sea que se convertiría en el problema que vino a
 * resolver. Sin match, esto grita y pide que la frase se vuelva a escribir
 * o que el chequeo se borre a propósito.
 */
export interface Afirmacion {
  /** Ruta relativa a la raíz del repo. */
  doc: string;
  /** Tiene que capturar el número en el grupo 1. */
  patron: RegExp;
  hecho: keyof Hechos;
  /** Qué se rompe si esto queda viejo. Se imprime cuando falla. */
  porque: string;
  /** Para los números escritos con palabras ("once tools"). */
  comoTexto?: Record<string, number>;
}

/**
 * Los números que la doc escribe con letras.
 *
 * No es un capricho de estilo: "el conector tiene once tools" se lee mejor
 * que "11 tools" y así está escrito. Traducir acá cuesta una tabla y
 * evita tener que elegir entre prosa legible y prosa chequeable.
 */
const EN_LETRAS: Record<string, number> = {
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  dieciséis: 16,
};

export const AFIRMACIONES: readonly Afirmacion[] = [
  {
    doc: "AGENTS.md",
    patron: /`server-only`\*\* — son (\d+), entre ellos `queries\.ts`/,
    hecho: "modulosServerOnly",
    porque:
      "Es la lista de lo que el MCP NO puede importar, y el MCP no corre " +
      "dentro de Next. Con el número viejo alguien importa uno y lo " +
      "descubre en runtime.",
  },
  {
    doc: "AGENTS.md",
    patron: /el conector remoto tiene (\w+) tools/,
    hecho: "toolsConector",
    porque:
      "La tabla de abajo reparte esas tools por quién escribe, que es el " +
      "corte de la regla 8.",
    comoTexto: EN_LETRAS,
  },
  {
    doc: "AGENTS.md",
    patron: /\*\*(\d+) prompts\*\* en la app/,
    hecho: "promptsDeSistema",
    porque:
      "Es el denominador de cuántos tienen arnés. Si crece y la doc no, " +
      "un prompt nuevo entra sin red y nadie lo nota.",
  },
  {
    doc: "AGENTS.md",
    patron: /`VERSION_RESPALDO` vale hoy \*\*(\d+)\*\*/,
    hecho: "versionRespaldo",
    porque:
      "El workflow de respaldos lo usa de puerta: con un número menor al " +
      "que espera avisa y saltea el paso en vez de fallar.",
  },
  {
    doc: "AGENTS.md",
    patron: /por debajo de (0\.\d)\)/,
    hecho: "umbralConfianza",
    porque:
      "Es el umbral con el que `cadena.ts` decide preguntar en vez de " +
      "despachar. El prompt le enseña ese mismo número al modelo.",
  },
  {
    doc: "docs/dev/manual-agentico.md",
    patron: /`tipos\.ts` \((\d+) destinos\)/,
    hecho: "destinos",
    porque: "Es el roster del recepcionista.",
  },
  {
    doc: "docs/dev/manual-agentico.md",
    patron: /`tipo_bandeja` tiene \*\*(\d+)\*\* valores/,
    hecho: "tiposBandeja",
    porque:
      "Cada valor nuevo necesita su camino de aceptación. Uno sin camino " +
      "queda en la bandeja sin botón.",
  },
  {
    doc: "docs/dev/manual-agentico.md",
    patron: /`estado_bandeja`, (\d+)\./,
    hecho: "estadosBandeja",
    porque: "`pospuesto` y `error` son los dos que se olvidan.",
  },
  {
    doc: "docs/dev/manual-agentico.md",
    patron: /El piso son (\d+) frases de un banco de \d+/,
    hecho: "frasesPiso",
    porque:
      "Es lo que se corre antes y después de tocar el prompt del " +
      "recepcionista.",
  },
  {
    doc: "docs/dev/manual-agentico.md",
    patron: /El piso son \d+ frases de un banco de (\d+)/,
    hecho: "frasesBanco",
    porque: "El corpus completo del recepcionista.",
  },
];
