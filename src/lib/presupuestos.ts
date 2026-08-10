import { convertir, round2, round4, type TasaAplicable } from "@/lib/fx";
import type { Database, Moneda } from "@/lib/supabase/database.types";

/**
 * El precio de un presupuesto.
 *
 *   precio  = horas × tarifa_hora × multiplicador(tipo de cliente)
 *   semanas = horas / horas_por_semana
 *
 * **Sin modelo y sin base.** El modelo devuelve horas; la aritmética es
 * aritmética. Y las semanas también son aritmética: cuántas semanas son
 * 60 horas depende de cuántas horas por semana le dedique Beno, que el
 * modelo no sabe y la app sí.
 *
 * El módulo es puro a propósito —sin `import "server-only"`— porque lo
 * usan el formulario (componente cliente, recalculando con cada tecla) y
 * el servidor al guardar, y tienen que dar exactamente lo mismo. El día
 * que haya un MCP propio, la regla ya está en un solo lugar.
 *
 * ── Regla 1: la cotización se congela ────────────────────────────────
 *
 * Si el presupuesto va en una moneda distinta a la de la tarifa, se
 * resuelve la tasa de **la fecha del presupuesto** (la de esa fecha o la
 * última anterior, `fx_rate_for_date` / `resolverTasa`) y se guardan
 * `tasa_usada` y `tasa_fecha` en la fila, con los mismos nombres de
 * columna que `movements`.
 *
 * **Al releer un presupuesto no se recalcula nada**: ni el total, ni la
 * conversión, ni el precio por hora. Un presupuesto de marzo dice lo que
 * decía en marzo. La única "recotización" posible es explícita y crea una
 * fila nueva: se descarta el viejo como `quedo_desactualizado` y el nuevo
 * apunta al anterior con `reemplaza_a`. No hay un botón que actualice un
 * documento que el cliente ya tiene en la mano.
 */

export type TipoCliente = Database["public"]["Enums"]["tipo_cliente"];

export interface Multiplicadores {
  particular: number;
  pyme: number;
  empresa: number;
}

/**
 * ×1 particular, ×2 pyme, ×3 empresa.
 *
 * No es un número redondo elegido a ojo: es la escalera del tarifario de
 * flamahaus, verificada en **93 de 93 filas** (`A = 3×C`, `B = 2×C`, con
 * tolerancia de un peso). Son valores por defecto, no constantes: viven
 * en `settings` para que Beno los pueda mover sin redesplegar.
 */
export const MULTIPLICADORES_POR_DEFECTO: Multiplicadores = {
  particular: 1,
  pyme: 2,
  empresa: 3,
};

/**
 * Default conservador: Beno tiene tres proyectos vivos y trabaja solo. Un
 * default de 40 promete plazos que no se cumplen, y un plazo incumplido
 * en un presupuesto cuesta más que uno holgado.
 */
export const HORAS_POR_SEMANA_POR_DEFECTO = 20;

export function multiplicadorDe(
  tipo: TipoCliente,
  multiplicadores: Multiplicadores = MULTIPLICADORES_POR_DEFECTO,
): number {
  const valor = multiplicadores[tipo];
  return Number.isFinite(valor) && valor > 0 ? valor : 1;
}

/**
 * Redondeo por moneda, el mismo criterio de `src/lib/format.ts`: ARS sin
 * decimales, USD con dos. Un presupuesto en pesos con centavos no se
 * manda.
 */
export function redondearMoneda(monto: number, moneda: Moneda): number {
  if (!Number.isFinite(monto)) return 0;
  return moneda === "ARS" ? Math.round(monto) : round2(monto);
}

/** Lo mínimo que necesita saber el cálculo de un entregable. */
export interface ItemConHoras {
  horas: number;
}

/** Suma de horas de los entregables, tolerante a inputs a medio escribir. */
export function sumarHoras(items: readonly ItemConHoras[]): number {
  const total = items.reduce(
    (acumulado, item) =>
      acumulado + (Number.isFinite(item.horas) ? Math.max(item.horas, 0) : 0),
    0,
  );
  return round2(total);
}

export interface EntradaPresupuesto {
  /** Suma de las horas de los entregables. */
  horas: number;
  /** La tarifa de Beno en el momento de armar el presupuesto. */
  tarifa_hora: number;
  /** En qué moneda está esa tarifa (`settings.tarifa_moneda`). */
  tarifa_moneda: Moneda;
  cliente_tipo: TipoCliente;
  /** La moneda del presupuesto, elegida por presupuesto. */
  moneda: Moneda;
  multiplicadores?: Multiplicadores;
  horas_por_semana?: number;
  /**
   * La cotización aplicable a la fecha del presupuesto, resuelta con
   * `resolverTasa`. `null` cuando no hay ninguna cargada: no se inventa
   * una, se hace el presupuesto en la moneda de la tarifa y se dice.
   */
  tasa?: TasaAplicable | null;
}

export interface PresupuestoCalculado {
  horas: number;
  multiplicador: number;
  /** Tarifa × multiplicador: lo que sale la hora para **este** cliente. */
  precio_hora: number;
  /** El total en la moneda de la tarifa, antes de convertir. */
  total_tarifa: number;
  /** El total en la moneda en la que se manda. Es el precio del documento. */
  total_origen: number;
  /**
   * La moneda del total. Puede no ser la pedida: sin cotización se cae a
   * la de la tarifa, y `sin_cotizacion` lo marca para que la pantalla lo
   * diga en vez de mostrar un número convertido con nada.
   */
  moneda: Moneda;
  semanas: number;
  horas_por_semana: number;
  /** Congelada. `null` cuando no hubo conversión. */
  tasa_usada: number | null;
  /** Congelada. `null` cuando no hubo conversión. */
  tasa_fecha: string | null;
  sin_cotizacion: boolean;
}

/**
 * El cálculo entero, en una función y sin efectos.
 *
 * **No lanza.** Corre en cada tecla del formulario, y tirar por un input
 * a medio escribir dejaría la pantalla en blanco; los valores imposibles
 * se llevan a cero, que es lo que el formulario ya muestra igual. Los
 * checks duros (`tarifa_hora > 0`, `multiplicador > 0`, `total >= 0`)
 * están en la base, que es donde tienen que estar.
 */
export function calcularPresupuesto(
  entrada: EntradaPresupuesto,
): PresupuestoCalculado {
  const horas = Number.isFinite(entrada.horas) ? Math.max(entrada.horas, 0) : 0;

  const tarifa =
    Number.isFinite(entrada.tarifa_hora) && entrada.tarifa_hora > 0
      ? entrada.tarifa_hora
      : 0;

  const multiplicador = multiplicadorDe(
    entrada.cliente_tipo,
    entrada.multiplicadores,
  );

  const horasPorSemana =
    Number.isFinite(entrada.horas_por_semana) &&
    (entrada.horas_por_semana ?? 0) > 0
      ? (entrada.horas_por_semana as number)
      : HORAS_POR_SEMANA_POR_DEFECTO;

  // El bruto se calcula exacto y se redondea una sola vez por moneda:
  // redondear en la moneda de la tarifa y después convertir arrastraría
  // el redondeo al total que se manda.
  const bruto = horas * tarifa * multiplicador;

  const hayConversion = entrada.moneda !== entrada.tarifa_moneda;
  const tasa = entrada.tasa ?? null;
  const convierte =
    hayConversion && tasa !== null && tasa.valor > 0 ? tasa : null;
  const sinCotizacion = hayConversion && convierte === null;

  // Sin cotización no se inventa ninguna: el presupuesto se hace en la
  // moneda de la tarifa y la pantalla lo avisa.
  const moneda = sinCotizacion ? entrada.tarifa_moneda : entrada.moneda;

  const total = convierte
    ? convertir(bruto, entrada.tarifa_moneda, entrada.moneda, convierte.valor)
    : bruto;

  return {
    horas: round2(horas),
    multiplicador,
    precio_hora: redondearMoneda(tarifa * multiplicador, entrada.tarifa_moneda),
    total_tarifa: redondearMoneda(bruto, entrada.tarifa_moneda),
    total_origen: redondearMoneda(total, moneda),
    moneda,
    semanas: round2(horas / horasPorSemana),
    horas_por_semana: horasPorSemana,
    // Se congelan con el mismo formato que `movements`: cuatro decimales
    // en el valor y la fecha real de la que salió la cotización, que
    // puede ser anterior a la del presupuesto.
    tasa_usada: convierte ? round4(convierte.valor) : null,
    tasa_fecha: convierte ? convierte.fecha : null,
    sin_cotizacion: sinCotizacion,
  };
}
