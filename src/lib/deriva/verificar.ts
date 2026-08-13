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

/**
 * El texto con los espacios colapsados, y de dónde salió cada carácter.
 *
 * ⚠ **Sin esto el linter da falsos "sin-match" cada vez que un párrafo se
 * re-envuelve**, y pasó en la primera corrida: toda la documentación de
 * este repo está cortada a mano a ~72 columnas, así que
 * `"El piso son 11 frases"` puede tener un salto de línea en cualquiera de
 * sus espacios. Pedirle a quien escribe una afirmación que ponga `\s+` en
 * cada espacio es una trampa que se olvida una vez y desactiva el chequeo.
 *
 * El mapa de posiciones es lo que permite seguir informando la línea del
 * documento original después de haber matcheado contra el texto plano.
 */
function aplanar(texto: string): { plano: string; posiciones: number[] } {
  let plano = "";
  const posiciones: number[] = [];

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!;
    if (/\s/.test(c)) {
      if (plano.endsWith(" ")) continue;
      plano += " ";
    } else {
      plano += c;
    }
    posiciones.push(i);
  }

  return { plano, posiciones };
}

export function verificar(
  afirmaciones: readonly Afirmacion[],
  hechos: Hechos,
  docs: Map<string, string>,
): Desvio[] {
  const desvios: Desvio[] = [];
  const aplanados = new Map<string, ReturnType<typeof aplanar>>();

  for (const a of afirmaciones) {
    const texto = docs.get(a.doc);
    if (texto === undefined) {
      throw new Error(`Falta el contenido de ${a.doc}.`);
    }

    if (!aplanados.has(a.doc)) aplanados.set(a.doc, aplanar(texto));
    const { plano, posiciones } = aplanados.get(a.doc)!;

    const esperado = hechos[a.hecho];
    const encontrado = plano.match(a.patron);

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
      const enOriginal = posiciones[encontrado.index!] ?? 0;
      desvios.push({
        doc: a.doc,
        linea: texto.slice(0, enOriginal).split("\n").length,
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
