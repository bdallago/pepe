import { montoEnMoneda, round2 } from "@/lib/fx";
import { todayISO } from "@/lib/dates";
import type { Moneda, Movement, Project } from "@/lib/supabase/database.types";

/**
 * Prorrateo de gastos compartidos.
 *
 * Un movimiento con project_id = null es compartido: sirve a todos los
 * proyectos (Claude Pro, Cursor, etc.). En las vistas por proyecto se
 * reparte entre los proyectos ACTIVOS, ponderado por peso_prorrateo.
 *
 * El reparto se calcula al vuelo. Nunca se guardan filas duplicadas en la
 * base: eso rompería el balance general, que suma el compartido una sola vez.
 */

/** Proyecto que participa del reparto, con su peso ya normalizado. */
export interface ParticipacionProyecto {
  projectId: string;
  /** Fracción del total que le toca. Todas suman 1. */
  fraccion: number;
  /** Posición dentro del reparto, para la etiqueta "Compartido (1/3)". */
  indice: number;
  /** Cantidad de proyectos que participan. */
  total: number;
}

/**
 * Calcula qué fracción del gasto compartido le toca a cada proyecto activo.
 *
 * Si no hay proyectos activos devuelve un mapa vacío: el gasto compartido
 * sigue existiendo en el balance general, simplemente no se reparte.
 */
export function calcularParticipaciones(
  projects: Pick<Project, "id" | "activo" | "peso_prorrateo">[],
): Map<string, ParticipacionProyecto> {
  const activos = projects.filter((p) => p.activo);
  const pesoTotal = activos.reduce(
    (sum, p) => sum + Number(p.peso_prorrateo),
    0,
  );

  const map = new Map<string, ParticipacionProyecto>();
  if (activos.length === 0 || pesoTotal <= 0) return map;

  activos.forEach((project, indice) => {
    map.set(project.id, {
      projectId: project.id,
      fraccion: Number(project.peso_prorrateo) / pesoTotal,
      indice: indice + 1,
      total: activos.length,
    });
  });

  return map;
}

/** Lo mínimo que hace falta para saber si un proyecto entra a un reparto. */
export type ProyectoParaReparto = Pick<
  Project,
  "id" | "fecha_inicio" | "fecha_fin" | "peso_prorrateo"
>;

/**
 * ¿El proyecto estaba vivo en esta fecha?
 *
 * Es lo que antes decía la columna `activo`, pero preguntado contra una
 * fecha en vez de contra el presente. Las dos puntas abiertas tienen
 * significado y no son un caso degenerado: `fecha_inicio` nula es "desde
 * siempre" y `fecha_fin` nula es "sigue abierto". Un proyecto sin ninguna
 * de las dos participa de todo, que es exactamente el comportamiento
 * anterior a este cambio — y por eso la migración de datos puede ser
 * incremental sin romper nada en el medio.
 *
 * Las dos comparaciones son inclusivas: el día que abrís y el día que
 * cerrás el proyecto está vivo.
 */
export function estaVivo(
  proyecto: Pick<Project, "fecha_inicio" | "fecha_fin">,
  fecha: string = todayISO(),
): boolean {
  if (proyecto.fecha_inicio && fecha < proyecto.fecha_inicio) return false;
  if (proyecto.fecha_fin && fecha > proyecto.fecha_fin) return false;
  return true;
}

/**
 * Qué fracción del gasto compartido **de esa fecha** le toca a cada
 * proyecto.
 *
 * ⚠ **La fecha no tiene default, y es a propósito.** Un default a hoy
 * dejaría compilar cualquier call site que se olvide de pasarla,
 * exactamente con el bug que este cambio viene a arreglar. Sin default,
 * el compilador obliga a mirar los ocho.
 *
 * Si no hay ningún proyecto vivo esa fecha devuelve un mapa vacío: el
 * gasto sigue contando en el balance general, simplemente no se reparte.
 * Quien llama tiene que decirlo, no esconderlo.
 */
export function participacionesEnFecha(
  projects: ProyectoParaReparto[],
  fecha: string,
): Map<string, ParticipacionProyecto> {
  const vivos = projects.filter((p) => estaVivo(p, fecha));
  const pesoTotal = vivos.reduce((sum, p) => sum + Number(p.peso_prorrateo), 0);

  const map = new Map<string, ParticipacionProyecto>();
  if (vivos.length === 0 || pesoTotal <= 0) return map;

  vivos.forEach((project, indice) => {
    map.set(project.id, {
      projectId: project.id,
      fraccion: Number(project.peso_prorrateo) / pesoTotal,
      indice: indice + 1,
      total: vivos.length,
    });
  });

  return map;
}

/**
 * Un lector de participaciones que se acuerda de las fechas que ya
 * calculó.
 *
 * Los gastos compartidos caen en muchas menos fechas distintas que
 * movimientos, así que recalcular el mapa por movimiento sería trabajo
 * repetido sin ninguna ganancia. Vive acá y no en cada call site porque
 * hasta hace un rato el mismo closure estaba escrito tres veces.
 */
export function memoParticipaciones(
  projects: ProyectoParaReparto[],
): (fecha: string) => Map<string, ParticipacionProyecto> {
  const cache = new Map<string, Map<string, ParticipacionProyecto>>();
  return (fecha: string) => {
    let p = cache.get(fecha);
    if (!p) {
      p = participacionesEnFecha(projects, fecha);
      cache.set(fecha, p);
    }
    return p;
  };
}

/**
 * Etiqueta del reparto. Con pesos iguales muestra "Compartido (1/3)";
 * con pesos distintos el porcentaje real, que es lo informativo.
 */
export function etiquetaProrrateo(
  participacion: ParticipacionProyecto,
  pesosUniformes: boolean,
): string {
  if (pesosUniformes) {
    return `Compartido (1/${participacion.total})`;
  }
  const pct = new Intl.NumberFormat("es-AR", {
    maximumFractionDigits: 1,
  }).format(participacion.fraccion * 100);
  return `Compartido (${pct}%)`;
}

export function pesosSonUniformes(
  projects: ProyectoParaReparto[],
  fecha: string,
): boolean {
  const vivos = projects.filter((p) => estaVivo(p, fecha));
  if (vivos.length === 0) return true;
  const primero = Number(vivos[0].peso_prorrateo);
  return vivos.every((p) => Number(p.peso_prorrateo) === primero);
}

/**
 * Un movimiento tal como se ve dentro de un proyecto: puede ser directo
 * (el monto completo) o la porción prorrateada de un gasto compartido.
 */
export interface MovimientoImputado {
  movement: Movement;
  /** Monto que le corresponde a este proyecto, en la moneda pedida. */
  monto: number;
  /** true si viene de un gasto compartido. */
  compartido: boolean;
  /** Solo presente cuando `compartido` es true. */
  participacion?: ParticipacionProyecto;
}

/**
 * Imputa los movimientos a un proyecto: los directos enteros, más la
 * porción que le toca de cada gasto compartido.
 *
 * Recibe los proyectos y no un mapa ya calculado porque el reparto
 * depende de **la fecha de cada movimiento**: un compartido de marzo se
 * reparte entre los que estaban vivos en marzo, y uno de agosto entre
 * los de agosto. Un mapa único no puede representar eso.
 */
export function imputarAProyecto(
  movements: Movement[],
  projectId: string,
  projects: ProyectoParaReparto[],
  moneda: Moneda,
): MovimientoImputado[] {
  const participacionesDe = memoParticipaciones(projects);

  const resultado: MovimientoImputado[] = [];

  for (const movement of movements) {
    if (movement.project_id === projectId) {
      resultado.push({
        movement,
        monto: montoEnMoneda(movement, moneda),
        compartido: false,
      });
      continue;
    }

    if (movement.project_id !== null) continue;

    const participacion = participacionesDe(movement.fecha).get(projectId);
    if (!participacion) continue;

    resultado.push({
      movement,
      monto: round2(montoEnMoneda(movement, moneda) * participacion.fraccion),
      compartido: true,
      participacion,
    });
  }

  return resultado;
}
