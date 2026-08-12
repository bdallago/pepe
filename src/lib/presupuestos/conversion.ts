import { diasEntre } from "@/lib/dates";
import type { TipoCliente } from "@/lib/presupuestos";
import type { Database, Moneda } from "@/lib/supabase/database.types";

/**
 * La tabla de conversión: qué pasó con lo que cotizaste.
 *
 * Es la última pieza de la etapa 3 del spec de presupuestos, y es **todo
 * aritmética sobre filas que ya existen: cero tokens, cero llamadas a un
 * modelo**. El spec lo dice con todas las letras: con "unos pocos por
 * año", el primer año esto es *una tabla que se mira, no un modelo que
 * opina*. La retro comercial hecha por un razonador queda fuera hasta
 * que haya ≥ 10 resueltos, que a ese ritmo son unos tres años.
 *
 * El módulo es **puro** —sin `import "server-only"`— por el mismo motivo
 * que `presupuestos.ts`: así lo puede usar un componente cliente, un
 * route handler o el día de mañana una tool del MCP, y todos contestan
 * exactamente lo mismo.
 *
 * ── Tres decisiones que no se ven leyendo las firmas ──────────────────
 *
 * **1. Acá sí entran los archivados.** Es la excepción a la regla 4, y
 * es la misma que ya vale para el buscador: archivar saca algo de las
 * listas de la interfaz, no del histórico. Un presupuesto descartado y
 * después archivado sigue enseñando exactamente lo mismo sobre por qué
 * se cayó; excluirlo haría que la tasa de aceptación **suba sola** cada
 * vez que Beno ordena la pantalla, que es la peor forma posible de
 * mentir: hacia el lado que uno quiere escuchar.
 *
 * **2. Las monedas no se mezclan nunca.** Un presupuesto en USD cuya
 * tarifa también era en USD no tiene `tasa_usada` —no hubo conversión
 * que congelar—, así que llevarlo a pesos hoy exigiría cotizarlo con la
 * tasa de hoy. Eso es justo lo que prohíbe la regla 1. Antes que
 * inventar un número plausible, el techo se calcula **por moneda** y la
 * pantalla muestra una sección por cada una.
 *
 * **3. El "techo" no son rangos de monto, es un corchete.** El spec pide
 * "tasa de aceptación por rango de monto: dónde está el techo real". Con
 * cuatro filas, cortar en rangos fijos reparte una fila por balde y cada
 * balde da 0 % o 100 %: ruido con cara de estadística. El par
 * **aceptado más caro / descartado más barato** contesta la misma
 * pregunta sin inventar precisión, y además dice algo que los baldes
 * esconden: si los dos números se cruzan, el precio no es lo que
 * decide, y conviene saberlo antes de bajar la tarifa.
 */

export type EstadoPresupuesto =
  Database["public"]["Enums"]["estado_presupuesto"];
export type MotivoDescarte = Database["public"]["Enums"]["motivo_descarte"];

/**
 * Lo mínimo que hace falta de un presupuesto para leerlo. Es un `Pick`
 * y no la fila entera para que se note que esto no toca ni el pedido, ni
 * los ítems, ni el texto: solo el desenlace.
 */
export interface QuoteParaConversion {
  id: string;
  estado: EstadoPresupuesto;
  cliente_tipo: TipoCliente;
  moneda: Moneda;
  total_origen: number | string;
  enviado_en: string | null;
  resuelto_en: string | null;
  motivo_descarte: MotivoDescarte | null;
  reemplaza_a: string | null;
}

/**
 * A partir de acá los números empiezan a querer decir algo.
 *
 * Es el mismo 10 con el que el spec habilita la retro comercial hecha
 * por un modelo, reusado a propósito: si diez resueltos son pocos para
 * que opine un razonador, son pocos para que opine una tabla. Por debajo
 * los números **se muestran igual** —esconderlos sería peor— pero la
 * pantalla avisa que todavía no significan nada.
 */
export const UMBRAL_LECTURA = 10;

export interface TasaPorTipo {
  tipo: TipoCliente;
  resueltos: number;
  aceptados: number;
  /** `null` cuando no hay ningún resuelto de ese tipo: 0/0 no es 0 %. */
  tasa: number | null;
}

export interface TechoPorMoneda {
  moneda: Moneda;
  /** El presupuesto más caro que te aceptaron. */
  aceptadoMasCaro: number | null;
  /** El más barato que se cayó. */
  descartadoMasBarato: number | null;
  /**
   * El descartado más barato está **por debajo** del aceptado más caro.
   * Significa que el precio no es lo que está decidiendo, y es la
   * conclusión más accionable de todo el panel.
   */
  seCruzan: boolean;
}

export interface MotivoContado {
  motivo: MotivoDescarte;
  n: number;
}

export interface DemoraResolucion {
  /** Cuántos resueltos tienen las dos fechas para poder medir. */
  n: number;
  /** Mediana de días entre `enviado_en` y `resuelto_en`. */
  mediana: number | null;
  /**
   * La mediana solo de los `quedo_desactualizado`. El spec la separa:
   * un presupuesto que quedó viejo con muchos días adentro no es culpa
   * del cliente.
   */
  medianaDesactualizados: number | null;
  nDesactualizados: number;
}

export interface Conversion {
  /** Todos, incluidos los archivados y los que siguen vivos. */
  total: number;
  resueltos: number;
  aceptados: number;
  descartados: number;
  /** Borradores y enviados sin respuesta. No entran en ninguna tasa. */
  sinResolver: number;
  /** `null` mientras no haya un solo resuelto. */
  tasaGlobal: number | null;
  porTipo: TasaPorTipo[];
  techos: TechoPorMoneda[];
  motivos: MotivoContado[];
  demora: DemoraResolucion;
  /** Cuántos presupuestos nacieron para reemplazar a otro. */
  rehechos: number;
  /** El rehecho más veces: 1 = se hizo una sola vez y no se tocó. */
  cadenaMasLarga: number;
  /** ¿Los números ya dicen algo? Ver `UMBRAL_LECTURA`. */
  suficiente: boolean;
}

const TIPOS: TipoCliente[] = ["particular", "pyme", "empresa"];

const MOTIVOS: MotivoDescarte[] = [
  "no_era_lo_que_queria",
  "quedo_desactualizado",
  "no_prospero",
  "otro",
];

/**
 * Mediana y no promedio, y no es cosmética: con cinco filas, un
 * presupuesto que tardó ocho meses en resolverse se lleva el promedio a
 * un número que no describe a ninguno de los cinco.
 */
function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 === 1
    ? orden[medio]
    : Math.round((orden[medio - 1] + orden[medio]) / 2);
}

/** Largo de la cadena de `reemplaza_a` que termina en `id`. */
function largoDeCadena(
  id: string,
  reemplazaA: Map<string, string | null>,
): number {
  // El check de la base impide `reemplaza_a = id`, pero no un ciclo de
  // dos filas apuntándose entre sí. Un `Set` de visitados es más barato
  // que confiar en que eso no pase.
  const visto = new Set<string>();
  let largo = 1;
  let actual: string | null | undefined = reemplazaA.get(id);
  while (actual && !visto.has(actual)) {
    visto.add(actual);
    largo += 1;
    actual = reemplazaA.get(actual);
  }
  return largo;
}

export function calcularConversion(
  quotes: readonly QuoteParaConversion[],
): Conversion {
  const resueltos = quotes.filter(
    (q) => q.estado === "aceptado" || q.estado === "descartado",
  );
  const aceptados = resueltos.filter((q) => q.estado === "aceptado");
  const descartados = resueltos.filter((q) => q.estado === "descartado");

  const porTipo: TasaPorTipo[] = TIPOS.map((tipo) => {
    const delTipo = resueltos.filter((q) => q.cliente_tipo === tipo);
    const aceptadosDelTipo = delTipo.filter((q) => q.estado === "aceptado");
    return {
      tipo,
      resueltos: delTipo.length,
      aceptados: aceptadosDelTipo.length,
      tasa:
        delTipo.length === 0
          ? null
          : aceptadosDelTipo.length / delTipo.length,
    };
  });

  // Una sección por moneda que efectivamente aparece, en el orden en que
  // aparece. Nada de listar las dos siempre: una fila "USD: sin datos"
  // ocupa lugar para no decir nada.
  const monedas: Moneda[] = [];
  for (const q of resueltos) {
    if (!monedas.includes(q.moneda)) monedas.push(q.moneda);
  }

  const techos: TechoPorMoneda[] = monedas.map((moneda) => {
    const montos = (lista: QuoteParaConversion[]) =>
      lista.filter((q) => q.moneda === moneda).map((q) => Number(q.total_origen));

    const deAceptados = montos(aceptados);
    const deDescartados = montos(descartados);

    const aceptadoMasCaro =
      deAceptados.length > 0 ? Math.max(...deAceptados) : null;
    const descartadoMasBarato =
      deDescartados.length > 0 ? Math.min(...deDescartados) : null;

    return {
      moneda,
      aceptadoMasCaro,
      descartadoMasBarato,
      seCruzan:
        aceptadoMasCaro !== null &&
        descartadoMasBarato !== null &&
        descartadoMasBarato < aceptadoMasCaro,
    };
  });

  const motivos: MotivoContado[] = MOTIVOS.map((motivo) => ({
    motivo,
    n: descartados.filter((q) => q.motivo_descarte === motivo).length,
  })).filter((m) => m.n > 0);

  // Solo los que tienen las dos fechas. `enviado_en` no es obligatorio a
  // propósito —un presupuesto se puede descartar sin haberlo mandado—,
  // así que medir esos como cero días diría que se resolvieron el mismo
  // día, que es falso.
  const conAmbas = resueltos.filter((q) => q.enviado_en && q.resuelto_en);
  const dias = conAmbas.map((q) => diasEntre(q.enviado_en!, q.resuelto_en!));
  const desactualizados = conAmbas.filter(
    (q) => q.motivo_descarte === "quedo_desactualizado",
  );

  const reemplazaA = new Map<string, string | null>(
    quotes.map((q) => [q.id, q.reemplaza_a]),
  );

  return {
    total: quotes.length,
    resueltos: resueltos.length,
    aceptados: aceptados.length,
    descartados: descartados.length,
    sinResolver: quotes.length - resueltos.length,
    tasaGlobal:
      resueltos.length === 0 ? null : aceptados.length / resueltos.length,
    porTipo,
    techos,
    motivos,
    demora: {
      n: conAmbas.length,
      mediana: mediana(dias),
      nDesactualizados: desactualizados.length,
      medianaDesactualizados: mediana(
        desactualizados.map((q) => diasEntre(q.enviado_en!, q.resuelto_en!)),
      ),
    },
    rehechos: quotes.filter((q) => q.reemplaza_a !== null).length,
    cadenaMasLarga: quotes.reduce(
      (max, q) => Math.max(max, largoDeCadena(q.id, reemplazaA)),
      quotes.length === 0 ? 0 : 1,
    ),
    suficiente: resueltos.length >= UMBRAL_LECTURA,
  };
}
