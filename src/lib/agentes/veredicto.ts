import type { CasoDelBanco } from "@/lib/agentes/banco";
import type { Destino } from "@/lib/agentes/tipos";

/**
 * Compara N corridas de una frase contra lo que el banco espera.
 *
 * ## Por qué es puro y vive separado del corredor
 *
 * Para poder probar el criterio **sin gastar un solo token**. El corredor
 * (`scripts/medir-recepcionista.ts`) hace red y persistencia; esto decide
 * si algo pasó o falló, que es la parte con reglas.
 *
 * ## Por qué oscilar es fallar
 *
 * Es el agujero de las seis mediciones anteriores. El comentario de
 * `recepcionista.ts` dice que `"agreguemos lecciones"` *"oscilaba entre
 * los dos destinos entre corridas"*: **el modelo no es determinístico ni
 * con `temperatura: 0`**. Con una corrida por frase, una respuesta
 * correcta 2 de 3 veces se lee idéntica a una correcta siempre — y son
 * cosas distintas. Acá una frase que no da lo mismo las tres veces
 * **no pasa**, aunque la moda sea la correcta.
 */
export interface AccionCruda {
  destino: Destino;
  argumento: string | null;
  confianza: number;
}

/** Una corrida: o devolvió acciones, o falló. */
export type Corrida =
  | { acciones: AccionCruda[]; error?: undefined }
  | { acciones?: undefined; error: string };

export interface Veredicto {
  frase: string;
  ok: boolean;
  /** No devolvió lo mismo todas las veces. Por sí solo ya es fallar. */
  oscilo: boolean;
  /** Los destinos de la primera acción de cada corrida, en orden. */
  destinos: (Destino | "ERROR")[];
  confianzas: number[];
  problemas: string[];
}

/**
 * ⚠ El chequeo es `!== undefined` y no `if (corrida.error)`, que es lo
 * intuitivo. TypeScript solo discrimina la unión por un tipo unitario, y
 * `string` no lo es: con la comparación por verdad, `acciones` sigue
 * siendo `AccionCruda[] | undefined` en la otra rama y no compila.
 */
function firma(corrida: Corrida): string {
  if (corrida.error !== undefined) return `ERROR:${corrida.error}`;
  return corrida.acciones.map((a) => a.destino).join(",");
}

export function juzgar(caso: CasoDelBanco, corridas: Corrida[]): Veredicto {
  const problemas: string[] = [];
  const { espera } = caso;

  const firmas = new Set(corridas.map(firma));
  const oscilo = firmas.size > 1;
  if (oscilo) {
    problemas.push(`osciló entre corridas: ${[...firmas].join(" | ")}`);
  }

  const destinos: (Destino | "ERROR")[] = [];
  const confianzas: number[] = [];

  for (const [i, corrida] of corridas.entries()) {
    if (corrida.error !== undefined) {
      destinos.push("ERROR");
      problemas.push(`corrida ${i + 1}: ${corrida.error}`);
      continue;
    }

    const { acciones } = corrida;
    destinos.push(acciones[0]?.destino ?? "ERROR");

    if (acciones.length !== espera.acciones) {
      problemas.push(
        `corrida ${i + 1}: ${acciones.length} acciones, se esperaban ${espera.acciones}`,
      );
    }

    for (const accion of acciones) {
      if (!espera.destinos.includes(accion.destino)) {
        problemas.push(
          `corrida ${i + 1}: destino "${accion.destino}", se esperaba ${espera.destinos.join(" o ")}`,
        );
      }

      confianzas.push(accion.confianza);
      const [min, max] = espera.confianza;
      if (accion.confianza < min || accion.confianza > max) {
        problemas.push(
          `corrida ${i + 1}: confianza ${accion.confianza} fuera de [${min}, ${max}]`,
        );
      }
    }

    problemas.push(...revisarArgumento(caso, acciones, i + 1));
  }

  return {
    frase: caso.frase,
    ok: problemas.length === 0,
    oscilo,
    destinos,
    confianzas,
    problemas,
  };
}

/**
 * El argumento importa distinto según el destino, y hay dos casos donde
 * un recorte silencioso es el peor daño posible: en `bitacora` sale el
 * texto que se guarda **literal**, y en `movimientos` sin el número no
 * hay gasto que cargar. Por eso se chequea por fragmentos y no "se
 * parece".
 */
function revisarArgumento(
  caso: CasoDelBanco,
  acciones: AccionCruda[],
  numero: number,
): string[] {
  const { espera } = caso;
  if (!espera.argumento) return [];

  const problemas: string[] = [];
  const normal = (s: string) => s.trim().toLowerCase();

  if (espera.argumento === "null") {
    for (const a of acciones) {
      if (a.argumento !== null) {
        problemas.push(
          `corrida ${numero}: se esperaba argumento null y vino "${a.argumento}"`,
        );
      }
    }
    return problemas;
  }

  if (espera.argumento === "literal") {
    const alguna = acciones.some(
      (a) => a.argumento !== null && normal(a.argumento) === normal(caso.frase),
    );
    if (!alguna) {
      problemas.push(
        `corrida ${numero}: el argumento no volvió literal (vino "${acciones[0]?.argumento}")`,
      );
    }
    return problemas;
  }

  // "contiene"
  const juntos = normal(acciones.map((a) => a.argumento ?? "").join(" "));
  for (const fragmento of espera.contiene ?? []) {
    if (!juntos.includes(normal(fragmento))) {
      problemas.push(`corrida ${numero}: al argumento le falta "${fragmento}"`);
    }
  }
  return problemas;
}
