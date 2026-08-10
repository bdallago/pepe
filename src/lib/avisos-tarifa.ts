import { parseISODate } from "@/lib/dates";
import { round2 } from "@/lib/fx";
import type { Multiplicadores, TipoCliente } from "@/lib/presupuestos";
import type { Database, Moneda } from "@/lib/supabase/database.types";

/**
 * El aviso de tarifa desfasada.
 *
 * Cálculo puro sobre `rate_references` + `settings`, **sin modelo y sin
 * base**: es una línea en Ajustes y una línea discreta en la pantalla de
 * presupuestos.
 *
 * ⚠ **Avisa, no ajusta.** Lo dijo Beno con todas las letras y es la
 * diferencia entre esto y un "optimizador de precios": la app pone las
 * tres columnas al lado de las suyas y él decide. No hay ningún camino
 * por el que este archivo escriba `settings.tarifa_hora`.
 *
 * Tres reglas que salen del spec y que no son cosméticas:
 *
 *   1. **Se compara contra el mismo segmento, nunca contra un promedio.**
 *      Comparar su tarifa contra "el mercado" a secas es justo el error
 *      que lo tiene cobrándole a la empresa el precio del particular.
 *   2. **Se muestra el número, no un consejo.** Nada de "deberías subir".
 *   3. **Los avisos se apagan solos.** Si hace más de 21 días (tres
 *      ciclos del cron semanal) que una fuente no corre bien, esa fuente
 *      queda **vencida**: el aviso desaparece y en su lugar la pantalla
 *      dice desde cuándo no se está comparando contra nada. Un aviso
 *      calculado contra números de hace tres meses se lee igual de
 *      convincente que uno bueno, y esa es exactamente la forma en que
 *      un dato viejo hace daño.
 */

export type RateReference =
  Database["public"]["Tables"]["rate_references"]["Row"];

/**
 * De relación de dependencia a autónomo.
 *
 * El rango convencional es 1,8–2,5 (aguinaldo, obra social, vacaciones,
 * monotributo y horas no facturables). Va **fijo en código y escrito en
 * el texto del aviso**: un número que transforma un dato no puede ser
 * invisible, y tampoco puede ser una perilla que nadie sabe mover.
 */
export const FACTOR_AUTONOMO = 2;

/** Lo que separa una desviación de ruido. */
export const UMBRAL_DESVIO = 0.15;

/** Tres ciclos del cron semanal: dos corridas fallidas todavía no apagan nada. */
export const DIAS_VENCIMIENTO = 21;

/** Con qué se pasa un sueldo mensual a precio por hora. */
export const HORAS_POR_MES = 160;

const SEGMENTOS: TipoCliente[] = ["particular", "pyme", "empresa"];

/** La última corrida `ok` o `sin_cambios` de una fuente. */
export interface CorridaVigente {
  fuente: string;
  fecha: string;
}

export interface EntradaAviso {
  tarifa_hora: number | null;
  tarifa_moneda: Moneda;
  multiplicadores: Multiplicadores;
  /** `settings.servicio_referencia`, la clave de flamahaus a comparar. */
  servicio_referencia: string;
  /** `settings.seniority_referencia`: 'junior', 'semi-senior', 'senior'… */
  seniority_referencia: string;
  /** Todas las referencias conocidas; acá se elige la última vigente. */
  referencias: RateReference[];
  corridas: CorridaVigente[];
  hoy: string;
  /**
   * ARS por dólar, para el caso en que la tarifa esté en USD. Las
   * referencias están todas en pesos (`monto_ars`), así que sin
   * cotización no hay comparación posible y se dice, en vez de comparar
   * un número contra otro de otra moneda.
   */
  tasa?: number | null;
}

export interface ComparacionSegmento {
  segmento: TipoCliente;
  /** Tarifa × multiplicador: lo que cobra por hora a **este** cliente. */
  tuyo_ars: number;
  referencia_ars: number | null;
  /** (tuyo − referencia) / referencia. Null si no hay contra qué. */
  desvio: number | null;
  desfasado: boolean;
}

export interface AvisoFlamahaus {
  clave: string;
  /** La fecha de la corrida que trajo estos números. */
  fecha: string;
  segmentos: ComparacionSegmento[];
}

export interface AvisoSalancy {
  clave: string;
  fecha: string;
  bruto_mensual: number;
  por_hora: number;
  /** El por hora ya multiplicado por el factor autónomo. */
  autonomo_hora: number;
  desvio: number | null;
  desfasado: boolean;
}

export interface FuenteVencida {
  fuente: string;
  /** Última corrida buena, o null si nunca corrió. */
  desde: string | null;
}

export interface AvisoTarifa {
  tarifa_hora: number | null;
  tarifa_moneda: Moneda;
  /** Lo que cobra por hora a cada tipo de cliente, en ARS. */
  tuyos: Record<TipoCliente, number>;
  flamahaus: AvisoFlamahaus | null;
  salancy: AvisoSalancy | null;
  vencidas: FuenteVencida[];
  /** Algún segmento se fue del ±15 %. Es lo que enciende el aviso. */
  hay_desfasaje: boolean;
  /**
   * Por qué no hay comparación, cuando no la hay. Se muestra tal cual:
   * el silencio de un aviso tiene que ser ruidoso.
   */
  sin_comparacion: string | null;
}

function diasEntre(desde: string, hasta: string): number {
  const ms = parseISODate(hasta).getTime() - parseISODate(desde).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * La referencia vigente para una fecha es **la última fila con
 * `fecha <= X`**, exactamente el criterio de `fx_rate_for_date`. Por eso
 * una corrida `sin_cambios` no escribe filas: el histórico útil es la
 * serie de cambios, no la serie de corridas.
 */
function referenciaVigente(
  referencias: RateReference[],
  clave: string,
  segmento: TipoCliente | null,
  hoy: string,
): RateReference | null {
  let elegida: RateReference | null = null;

  for (const fila of referencias) {
    if (fila.clave !== clave) continue;
    if ((fila.segmento ?? null) !== segmento) continue;
    if (fila.fecha > hoy) continue;
    if (!elegida || fila.fecha > elegida.fecha) elegida = fila;
  }

  return elegida;
}

function estaVencida(
  corridas: CorridaVigente[],
  fuente: string,
  hoy: string,
): FuenteVencida | null {
  const corrida = corridas.find((c) => c.fuente === fuente) ?? null;
  if (!corrida) return { fuente, desde: null };
  if (diasEntre(corrida.fecha, hoy) > DIAS_VENCIMIENTO) {
    return { fuente, desde: corrida.fecha };
  }
  return null;
}

function desvioDe(tuyo: number, referencia: number | null): number | null {
  if (referencia === null || referencia <= 0) return null;
  return round2((tuyo - referencia) / referencia);
}

/**
 * El aviso entero, en una función y sin efectos. **No lanza**: sin tarifa
 * cargada o sin referencias devuelve el objeto con los huecos en null y
 * `sin_comparacion` explicando por qué, que es lo que la pantalla muestra.
 */
export function calcularAvisoTarifa(entrada: EntradaAviso): AvisoTarifa {
  const {
    tarifa_hora,
    tarifa_moneda,
    multiplicadores,
    servicio_referencia,
    seniority_referencia,
    referencias,
    corridas,
    hoy,
    tasa,
  } = entrada;

  const vencidas = ["flamahaus", "salancy"]
    .map((fuente) => estaVencida(corridas, fuente, hoy))
    .filter((v): v is FuenteVencida => v !== null);

  const tuyosBase: Record<TipoCliente, number> = {
    particular: 0,
    pyme: 0,
    empresa: 0,
  };

  if (!tarifa_hora || tarifa_hora <= 0) {
    return {
      tarifa_hora: null,
      tarifa_moneda,
      tuyos: tuyosBase,
      flamahaus: null,
      salancy: null,
      vencidas,
      hay_desfasaje: false,
      sin_comparacion:
        "Todavía no cargaste tu tarifa hora, así que no hay contra qué comparar.",
    };
  }

  // Las referencias están todas en pesos. Con la tarifa en dólares hace
  // falta la cotización; sin ella no se compara, y se dice.
  const factorAPesos =
    tarifa_moneda === "ARS" ? 1 : tasa && tasa > 0 ? tasa : null;

  const tuyos: Record<TipoCliente, number> = {
    particular: 0,
    pyme: 0,
    empresa: 0,
  };
  for (const segmento of SEGMENTOS) {
    const multiplicador = multiplicadores[segmento];
    const valor = tarifa_hora * (multiplicador > 0 ? multiplicador : 1);
    tuyos[segmento] = round2(valor * (factorAPesos ?? 1));
  }

  if (factorAPesos === null) {
    return {
      tarifa_hora,
      tarifa_moneda,
      tuyos,
      flamahaus: null,
      salancy: null,
      vencidas,
      hay_desfasaje: false,
      sin_comparacion:
        "Tu tarifa está en dólares y las referencias están en pesos, y no hay cotización cargada para pasarlas a la misma moneda.",
    };
  }

  const flamahausVencida = vencidas.some((v) => v.fuente === "flamahaus");
  const salancyVencida = vencidas.some((v) => v.fuente === "salancy");

  // ── flamahaus: un segmento contra su propio segmento ──────────────
  let flamahaus: AvisoFlamahaus | null = null;

  if (!flamahausVencida) {
    const segmentos: ComparacionSegmento[] = SEGMENTOS.map((segmento) => {
      const fila = referenciaVigente(
        referencias,
        servicio_referencia,
        segmento,
        hoy,
      );
      const referencia_ars = fila ? Number(fila.monto_ars) : null;
      const desvio = desvioDe(tuyos[segmento], referencia_ars);

      return {
        segmento,
        tuyo_ars: tuyos[segmento],
        referencia_ars,
        desvio,
        desfasado: desvio !== null && Math.abs(desvio) >= UMBRAL_DESVIO,
      };
    });

    const conDato = segmentos.find((s) => s.referencia_ars !== null);
    if (conDato) {
      const fila = referenciaVigente(
        referencias,
        servicio_referencia,
        conDato.segmento,
        hoy,
      );
      flamahaus = {
        clave: servicio_referencia,
        fecha: fila?.fecha ?? hoy,
        segmentos,
      };
    }
  }

  // ── salancy: relación de dependencia × factor autónomo ────────────
  let salancy: AvisoSalancy | null = null;

  if (!salancyVencida) {
    const clave = `salario-${seniority_referencia}`;
    const fila = referenciaVigente(referencias, clave, null, hoy);

    if (fila) {
      const bruto = Number(fila.monto_ars);
      const porHora = round2(bruto / HORAS_POR_MES);
      const autonomo = round2(porHora * FACTOR_AUTONOMO);
      // Contra el particular: es el escalón con el que se cruzó la
      // referencia de flamahaus (22.800 contra 20.992, 9 % por dos
      // métodos independientes) y el que corresponde a un ×1.
      const desvio = desvioDe(tuyos.particular, autonomo);

      salancy = {
        clave,
        fecha: fila.fecha,
        bruto_mensual: bruto,
        por_hora: porHora,
        autonomo_hora: autonomo,
        desvio,
        desfasado: desvio !== null && Math.abs(desvio) >= UMBRAL_DESVIO,
      };
    }
  }

  const hay_desfasaje =
    (flamahaus?.segmentos.some((s) => s.desfasado) ?? false) ||
    (salancy?.desfasado ?? false);

  const sin_comparacion =
    flamahaus === null && salancy === null
      ? vencidas.length > 0
        ? "Las referencias están vencidas: no se está comparando contra nada."
        : "Todavía no hay referencias de mercado cargadas. Las trae el cron de tarifas, los lunes."
      : null;

  return {
    tarifa_hora,
    tarifa_moneda,
    tuyos,
    flamahaus,
    salancy,
    vencidas,
    hay_desfasaje,
    sin_comparacion,
  };
}

/** "particular" → "Particular / emprendedor", para pantalla y documento. */
export const ETIQUETA_SEGMENTO: Record<TipoCliente, string> = {
  particular: "Particular / emprendedor",
  pyme: "Pyme",
  empresa: "Empresa",
};
