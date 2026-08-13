import type { Afirmacion } from "@/lib/deriva/afirmaciones";
import type { Hechos } from "@/lib/deriva/hechos";

/**
 * Cruza las afirmaciones de la documentación contra los hechos del código.
 *
 * **Puro**: recibe el texto de cada documento ya leído, así que el criterio
 * se puede probar sin tocar el filesystem y sin depender de lo que hoy
 * digan los archivos de verdad. Es el mismo motivo por el que
 * `veredicto.ts` vive separado del corredor del recepcionista.
 */
export interface Desvio {
  doc: string;
  /** 1-indexada, para poder abrirla. `null` si no matcheó en ninguna. */
  linea: number | null;
  clase: "sin-match" | "numero-viejo";
  /** Lo que dice el documento. `null` cuando no hay nada que decir. */
  dice: string | null;
  deberiaDecir: number;
  porque: string;
}

export function verificar(
  afirmaciones: readonly Afirmacion[],
  hechos: Hechos,
  docs: Map<string, string>,
): Desvio[] {
  const desvios: Desvio[] = [];

  for (const a of afirmaciones) {
    const texto = docs.get(a.doc);
    if (texto === undefined) {
      throw new Error(`Falta el contenido de ${a.doc}.`);
    }

    const esperado = hechos[a.hecho];
    const encontrado = texto.match(a.patron);

    if (!encontrado) {
      desvios.push({
        doc: a.doc,
        linea: null,
        clase: "sin-match",
        dice: null,
        deberiaDecir: esperado,
        porque: a.porque,
      });
      continue;
    }

    const crudo = encontrado[1]!;
    const valor = a.comoTexto?.[crudo.toLowerCase()] ?? Number(crudo);

    if (valor !== esperado) {
      desvios.push({
        doc: a.doc,
        linea: texto.slice(0, encontrado.index!).split("\n").length,
        clase: "numero-viejo",
        dice: crudo,
        deberiaDecir: esperado,
        porque: a.porque,
      });
    }
  }

  return desvios;
}

/** El desvío en una línea, con el archivo:línea que se puede abrir. */
export function describir(d: Desvio): string {
  const donde = d.linea === null ? d.doc : `${d.doc}:${d.linea}`;

  return d.clase === "sin-match"
    ? `${donde} — la frase que afirmaba esto ya no está. Volvé a escribirla ` +
        `(hoy el valor es ${d.deberiaDecir}) o borrá el chequeo a propósito. ` +
        d.porque
    : `${donde} — dice "${d.dice}" y son ${d.deberiaDecir}. ${d.porque}`;
}
