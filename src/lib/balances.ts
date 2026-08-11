import { monthKey, monthRange, todayISO } from "@/lib/dates";
import { montoEnMoneda, round2 } from "@/lib/fx";
import {
  estaVivo,
  memoParticipaciones,
  type ParticipacionProyecto,
  type ProyectoParaReparto,
} from "@/lib/prorrateo";
import type {
  Category,
  Moneda,
  Movement,
  Project,
} from "@/lib/supabase/database.types";

/**
 * Motor de balances.
 *
 * Invariante que sostiene toda la app:
 *
 *   suma(balance de cada proyecto) === balance general
 *
 * Redondear la porción de cada proyecto por separado lo rompe por
 * centavos. Por eso el reparto de gastos compartidos se hace por resto
 * mayor sobre centavos enteros: las partes suman exactamente el total.
 *
 * Única excepción, y es real: si la fecha del gasto no cae en la ventana
 * de vigencia de ningún proyecto no hay entre quiénes repartir. El gasto
 * compartido sigue contando en el balance general.
 * `Balances.compartidoSinRepartir` lo expone para que la UI pueda avisar
 * en vez de mostrar números que no cierran.
 */

export type FiltroEstado = "efectuado" | "planificado" | "ambos";

export interface FiltrosBalance {
  desde?: string;
  hasta?: string;
  estado: FiltroEstado;
}

export interface Totales {
  ingresos: number;
  egresos: number;
  /** ingresos - egresos */
  balance: number;
}

export interface PuntoMensual {
  mes: string;
  label: string;
  ingresos: number;
  egresos: number;
  balance: number;
  /** Balance acumulado desde el primer mes del rango. */
  acumulado: number;
}

export interface TotalPorCategoria {
  categoryId: string;
  nombre: string;
  total: number;
}

export interface TotalPorProyecto {
  projectId: string;
  nombre: string;
  color: string;
  /** Vivo HOY (`estaVivo`), para atenuarlo en la lista. El reparto de
   *  cada movimiento, en cambio, se resuelve contra su propia fecha. */
  activo: boolean;
  ingresos: number;
  egresos: number;
  balance: number;
}

export interface Balances {
  /** Solo movimientos efectuados. */
  efectuado: Totales;
  /** Efectuados + planificados. */
  proyectado: Totales;
  porMes: PuntoMensual[];
  egresosPorCategoria: TotalPorCategoria[];
  ingresosPorCategoria: TotalPorCategoria[];
  porProyecto: TotalPorProyecto[];
  /**
   * Neto de los egresos compartidos que no se pudieron repartir porque su
   * fecha no cae en la ventana de ningún proyecto. Si es distinto de 0,
   * la suma por proyecto no llega al general.
   */
  compartidoSinRepartir: number;
  /**
   * Cuáles fueron. Antes este caso era todo o nada y alcanzaba con el
   * monto; ahora es por movimiento, y un aviso que dice "hay $27.000 sin
   * repartir" sin decir de qué no se puede accionar.
   */
  movimientosSinRepartir: Movement[];
  cantidadMovimientos: number;
}

/** Filtra por rango de fechas y estado. */
export function filtrarMovimientos(
  movements: Movement[],
  filtros: FiltrosBalance,
): Movement[] {
  return movements.filter((m) => {
    if (filtros.desde && m.fecha < filtros.desde) return false;
    if (filtros.hasta && m.fecha > filtros.hasta) return false;
    if (filtros.estado !== "ambos" && m.estado !== filtros.estado) return false;
    return true;
  });
}

function sumarTotales(movements: Movement[], moneda: Moneda): Totales {
  let ingresos = 0;
  let egresos = 0;

  for (const m of movements) {
    const monto = montoEnMoneda(m, moneda);
    if (m.tipo === "ingreso") ingresos += monto;
    else egresos += monto;
  }

  ingresos = round2(ingresos);
  egresos = round2(egresos);
  return { ingresos, egresos, balance: round2(ingresos - egresos) };
}

/**
 * Reparte un monto entre participantes por resto mayor.
 *
 * Trabaja en centavos enteros para que las partes sumen exactamente el
 * total, sin la deriva que produce redondear cada fracción por separado.
 */
export function repartirPorRestoMayor(
  monto: number,
  fracciones: number[],
): number[] {
  if (fracciones.length === 0) return [];

  const totalCentavos = Math.round(monto * 100);
  const crudos = fracciones.map((f) => totalCentavos * f);
  const pisos = crudos.map((v) => Math.floor(v));

  let restante = totalCentavos - pisos.reduce((a, b) => a + b, 0);

  // Los centavos sobrantes van a los que tienen mayor parte fraccionaria.
  const orden = crudos
    .map((valor, indice) => ({ indice, resto: valor - Math.floor(valor) }))
    .sort((a, b) => b.resto - a.resto);

  const resultado = [...pisos];
  let cursor = 0;
  while (restante > 0 && orden.length > 0) {
    resultado[orden[cursor % orden.length].indice] += 1;
    restante -= 1;
    cursor += 1;
  }

  return resultado.map((centavos) => centavos / 100);
}

/**
 * Reparte un monto entre los participantes de una fecha y devuelve, por
 * proyecto, lo que le tocó.
 *
 * Es el **único** lugar donde se emparejan proyecto y parte, y por eso
 * existe: `repartirPorRestoMayor()` devuelve un array posicional que hay
 * que mantener alineado con el de ids, y desalinearlo es la única forma
 * de que la plata termine en el proyecto equivocado. Devolviendo un mapa,
 * ningún call site puede desalinearlo — ni el de la vista general ni el
 * de la vista por proyecto.
 */
function repartirEntreParticipantes(
  participaciones: Map<string, ParticipacionProyecto>,
  monto: number,
): Map<string, number> {
  const ids = [...participaciones.keys()];
  const fracciones = ids.map((id) => participaciones.get(id)!.fraccion);
  const partes = repartirPorRestoMayor(monto, fracciones);
  return new Map(ids.map((id, i) => [id, partes[i]]));
}

/**
 * Reparte los movimientos compartidos y devuelve, por proyecto, lo que le
 * tocó — más los que no encontraron a nadie.
 *
 * El conjunto de participantes se calcula **por fecha**, no una vez para
 * todos: es el punto entero de este módulo. Se memoiza porque los 15
 * compartidos de hoy caen en muchas menos fechas distintas, y recalcular
 * el mapa por movimiento sería trabajo repetido sin ninguna ganancia.
 *
 * Un movimiento cuya fecha no cae en la ventana de ningún proyecto sale
 * por `sinRepartir` en vez de desaparecer. Antes ese caso era global —o
 * había proyectos activos o no los había—; ahora es por movimiento, así
 * que la UI puede decir **cuáles** y no solo cuánto.
 */
function repartirCompartidos(
  compartidos: Movement[],
  projects: ProyectoParaReparto[],
  moneda: Moneda,
): {
  porProyecto: Map<string, { ingresos: number; egresos: number }>;
  sinRepartir: Movement[];
} {
  const porProyecto = new Map<string, { ingresos: number; egresos: number }>();
  const sinRepartir: Movement[] = [];

  const participacionesDe = memoParticipaciones(projects);

  for (const movement of compartidos) {
    const participaciones = participacionesDe(movement.fecha);

    if (participaciones.size === 0) {
      sinRepartir.push(movement);
      continue;
    }

    const partes = repartirEntreParticipantes(
      participaciones,
      montoEnMoneda(movement, moneda),
    );

    for (const [id, parte] of partes) {
      const acc = porProyecto.get(id) ?? { ingresos: 0, egresos: 0 };
      if (movement.tipo === "ingreso") acc.ingresos += parte;
      else acc.egresos += parte;
      porProyecto.set(id, acc);
    }
  }

  for (const acc of porProyecto.values()) {
    acc.ingresos = round2(acc.ingresos);
    acc.egresos = round2(acc.egresos);
  }

  return { porProyecto, sinRepartir };
}

function agruparPorCategoria(
  movements: Movement[],
  categories: Category[],
  tipo: "ingreso" | "egreso",
  moneda: Moneda,
): TotalPorCategoria[] {
  const nombres = new Map(categories.map((c) => [c.id, c.nombre]));
  const totales = new Map<string, number>();

  for (const m of movements) {
    if (m.tipo !== tipo) continue;
    const actual = totales.get(m.category_id) ?? 0;
    totales.set(m.category_id, actual + montoEnMoneda(m, moneda));
  }

  return [...totales.entries()]
    .map(([categoryId, total]) => ({
      categoryId,
      nombre: nombres.get(categoryId) ?? "Sin categoría",
      total: round2(total),
    }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);
}

function agruparPorMes(movements: Movement[], moneda: Moneda): PuntoMensual[] {
  if (movements.length === 0) return [];

  const fechas = movements.map((m) => m.fecha).sort();
  const meses = monthRange(fechas[0], fechas[fechas.length - 1]);

  const acc = new Map<string, { ingresos: number; egresos: number }>();
  for (const mes of meses) acc.set(mes, { ingresos: 0, egresos: 0 });

  for (const m of movements) {
    const key = monthKey(m.fecha);
    const bucket = acc.get(key);
    if (!bucket) continue;
    const monto = montoEnMoneda(m, moneda);
    if (m.tipo === "ingreso") bucket.ingresos += monto;
    else bucket.egresos += monto;
  }

  let acumulado = 0;
  return meses.map((mes) => {
    const bucket = acc.get(mes)!;
    const ingresos = round2(bucket.ingresos);
    const egresos = round2(bucket.egresos);
    const balance = round2(ingresos - egresos);
    acumulado = round2(acumulado + balance);

    return {
      mes,
      label: formatMes(mes),
      ingresos,
      egresos,
      balance,
      acumulado,
    };
  });
}

function formatMes(mes: string): string {
  const [year, month] = mes.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", { month: "short", year: "2-digit" })
    .format(new Date(year, month - 1, 15, 12))
    .replace(".", "");
}

/**
 * Calcula todos los balances del dashboard general.
 *
 * `porProyecto` incluye la porción prorrateada de los gastos compartidos,
 * de modo que sus balances suman el balance general (salvo el caso de
 * `compartidoSinRepartir`).
 */
export function calcularBalances(
  movements: Movement[],
  projects: Project[],
  categories: Category[],
  moneda: Moneda,
  filtros: FiltrosBalance,
): Balances {
  const filtrados = filtrarMovimientos(movements, filtros);

  const efectuados = filtrados.filter((m) => m.estado === "efectuado");

  const compartidos = filtrados.filter((m) => m.project_id === null);
  const reparto = repartirCompartidos(compartidos, projects, moneda);

  const directosPorProyecto = new Map<
    string,
    { ingresos: number; egresos: number }
  >();
  for (const project of projects) {
    directosPorProyecto.set(project.id, { ingresos: 0, egresos: 0 });
  }

  for (const m of filtrados) {
    if (m.project_id === null) continue;
    const bucket = directosPorProyecto.get(m.project_id);
    if (!bucket) continue;
    const monto = montoEnMoneda(m, moneda);
    if (m.tipo === "ingreso") bucket.ingresos += monto;
    else bucket.egresos += monto;
  }

  const porProyecto: TotalPorProyecto[] = projects.map((project) => {
    const directo = directosPorProyecto.get(project.id) ?? {
      ingresos: 0,
      egresos: 0,
    };
    const compartido = reparto.porProyecto.get(project.id) ?? {
      ingresos: 0,
      egresos: 0,
    };

    const ingresos = round2(directo.ingresos + compartido.ingresos);
    const egresos = round2(directo.egresos + compartido.egresos);

    return {
      projectId: project.id,
      nombre: project.nombre,
      color: project.color,
      activo: estaVivo(project),
      ingresos,
      egresos,
      balance: round2(ingresos - egresos),
    };
  });

  // Los que no encontraron dueño, netos: los egresos suman y los ingresos
  // restan, igual que en un balance.
  const compartidoSinRepartir = round2(
    reparto.sinRepartir.reduce((sum, m) => {
      const monto = montoEnMoneda(m, moneda);
      return sum + (m.tipo === "ingreso" ? -monto : monto);
    }, 0),
  );

  return {
    efectuado: sumarTotales(efectuados, moneda),
    proyectado: sumarTotales(filtrados, moneda),
    porMes: agruparPorMes(filtrados, moneda),
    egresosPorCategoria: agruparPorCategoria(
      filtrados,
      categories,
      "egreso",
      moneda,
    ),
    ingresosPorCategoria: agruparPorCategoria(
      filtrados,
      categories,
      "ingreso",
      moneda,
    ),
    porProyecto: porProyecto.sort((a, b) => b.balance - a.balance),
    compartidoSinRepartir,
    movimientosSinRepartir: reparto.sinRepartir,
    cantidadMovimientos: filtrados.length,
  };
}

/**
 * Balances acotados a un proyecto, incluyendo su porción prorrateada.
 * Es la vista por proyecto del spec.
 *
 * Reparte los compartidos **por resto mayor, igual que la vista general**,
 * y eso no es un detalle de implementación: es lo que hace que las dos
 * pantallas digan el mismo número. Acá se escalaba cada movimiento con
 * `round2(monto * fraccion)` —el redondeo por fracción que el docstring
 * del módulo señala como el que rompe el invariante— y la grilla de
 * Proyectos terminaba diciendo US$ 330,96 donde la pantalla del proyecto
 * decía US$ 330,91. Dos caminos de cálculo distintos para el mismo número
 * se despegan; el reparto tiene que ser el mismo en los dos.
 */
export function calcularBalancesProyecto(
  movements: Movement[],
  projects: Project[],
  categories: Category[],
  projectId: string,
  moneda: Moneda,
  filtros: FiltrosBalance,
): Balances & {
  participacion: ParticipacionProyecto | undefined;
  incluyeCompartidos: boolean;
} {
  const filtrados = filtrarMovimientos(movements, filtros);

  const participacionesDe = memoParticipaciones(projects);

  // La participación de HOY, para la etiqueta "Compartido (1/3)" del
  // encabezado. Ojo: con reparto por fecha, dos movimientos de la misma
  // pantalla pueden haberse repartido entre conjuntos distintos, así que
  // esta etiqueta describe el presente y no cada fila. Para saber si los
  // totales llevan algo de compartidos, `incluyeCompartidos`.
  const participacion = participacionesDe(todayISO()).get(projectId);

  // Se materializan los movimientos imputados al proyecto: los directos
  // enteros y los compartidos por la parte que les tocó del reparto. Son
  // objetos efímeros para el cálculo, nunca se persisten.
  const imputados: Movement[] = [];

  // ¿Alguno de los números que se van a mostrar lleva adentro la parte de
  // un gasto compartido? Es la pregunta que hay que contestar antes de
  // decir "no participa del reparto", y **no** es la misma que
  // `participacion`: esa mira solo hoy, y con reparto por fecha un
  // proyecto cerrado puede llevarse el 94 % de sus egresos en compartidos
  // de cuando estaba abierto. Se decide durante el recorrido porque
  // depende del rango filtrado, no solo de las ventanas.
  let incluyeCompartidos = false;

  for (const m of filtrados) {
    if (m.project_id === projectId) {
      imputados.push(m);
      continue;
    }
    if (m.project_id !== null) continue;

    const participaciones = participacionesDe(m.fecha);
    if (!participaciones.has(projectId)) continue;

    incluyeCompartidos = true;

    // Las dos monedas se reparten por separado, cada una por resto mayor.
    // No se deriva una de la otra por regla de tres: eso le devolvería a
    // la moneda derivada el redondeo por fracción que acabamos de sacar
    // y, con una tasa de por medio, además recalcularía un monto
    // congelado. `monto_ars` y `monto_usd` vienen los dos de la base.
    imputados.push({
      ...m,
      monto_ars: repartirEntreParticipantes(
        participaciones,
        Number(m.monto_ars),
      ).get(projectId)!,
      monto_usd: repartirEntreParticipantes(
        participaciones,
        Number(m.monto_usd),
      ).get(projectId)!,
    });
  }

  const efectuados = imputados.filter((m) => m.estado === "efectuado");

  return {
    efectuado: sumarTotales(efectuados, moneda),
    proyectado: sumarTotales(imputados, moneda),
    porMes: agruparPorMes(imputados, moneda),
    egresosPorCategoria: agruparPorCategoria(
      imputados,
      categories,
      "egreso",
      moneda,
    ),
    ingresosPorCategoria: agruparPorCategoria(
      imputados,
      categories,
      "ingreso",
      moneda,
    ),
    porProyecto: [],
    compartidoSinRepartir: 0,
    movimientosSinRepartir: [],
    cantidadMovimientos: imputados.length,
    participacion,
    incluyeCompartidos,
  };
}
