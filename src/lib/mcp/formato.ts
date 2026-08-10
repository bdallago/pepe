import "server-only";

/**
 * Lo que comparten todas las tools del conector: cómo se pagina y cómo
 * se contesta.
 *
 * ## El límite que manda sobre todo esto
 *
 * El resultado de una tool en Claude.ai se corta a **~150.000
 * caracteres**, y el timeout es de 300 segundos. Con los datos de Beno
 * hoy sobra de lejos; la paginación está desde el principio para no
 * tener que agregarla el día que moleste, que es el día en que ya
 * devolvió algo cortado sin avisar.
 *
 * ## Por qué texto y no JSON
 *
 * Del otro lado hay un modelo leyendo, no un parser. Una línea como
 * `- 06/08 · Claude Code · -20,00 USD · Infraestructura` se entiende sin
 * esquema, ocupa menos y se puede mostrar tal cual en una respuesta.
 * JSON gastaría la mitad del presupuesto en llaves y nombres de campo.
 */

/** Cuántas filas entran en una página. Ver el límite de arriba. */
export const POR_PAGINA = 25;

/**
 * Las anotaciones de una tool que solo lee.
 *
 * `openWorldHint: false` en las dos familias no es descuido: el conector
 * habla con la base de Pepe y con nada más. Ni siquiera las que llaman a
 * un modelo salen a un mundo abierto desde el punto de vista del
 * cliente — lo que devuelven no es una consulta a internet.
 */
export const SOLO_LECTURA = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/**
 * Las anotaciones de una tool que **propone**: deja una fila en `inbox` y
 * nada más.
 *
 * `destructiveHint: false` porque no pisa nada, e `idempotentHint: false`
 * porque llamarla dos veces deja dos propuestas. No lleva `clave_dedupe`
 * a propósito: si Beno pide dos veces lo mismo puede ser que quiera
 * cargarlo dos veces, y una propuesta de más se descarta con una tecla.
 */
export const PROPONE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

/**
 * Las anotaciones de la única tool que **escribe directo**.
 *
 * Ver `escribirBitacora()` en `mcp/datos.ts` para por qué puede.
 */
export const ESCRIBE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

/** La forma de una respuesta de PostgREST, sin atarse a su tipo exacto. */
interface ResultadoConsulta<T> {
  data: T[] | null;
  count: number | null;
  error: { code?: string; message: string } | null;
}

export interface Pagina<T> {
  filas: T[];
  /** Cuántas hay en total, no cuántas trae esta página. */
  total: number;
  hayMas: boolean;
  /** Índice de la primera fila de esta página, base 0. */
  desde: number;
}

/**
 * Corre una consulta paginada y deja el resultado listo para redactar.
 *
 * ⚠ **Pedir una página más allá del final no es un error**, pero
 * PostgREST contesta 416 `PGRST103` igual. Que el modelo reciba
 * "Requested range not satisfiable" cuando lo único que pasó es que se
 * pasó de página lo manda a reintentar o a inventarse una explicación;
 * devolverle una página vacía y el total lo deja seguir solo.
 *
 * `contar` se llama **solo en esa rama**: la respuesta de error no trae
 * el conteo y hay que pedirlo aparte. En el camino normal el listado ya
 * vino con él y no se gasta un segundo viaje.
 */
export async function leerPagina<T>(
  que: string,
  pagina: number,
  consultar: (desde: number, hasta: number) => PromiseLike<ResultadoConsulta<T>>,
  contar: () => PromiseLike<{ count: number | null }>,
  porPagina: number = POR_PAGINA,
): Promise<Pagina<T>> {
  const desde = (pagina - 1) * porPagina;

  const { data, count, error } = await consultar(desde, desde + porPagina - 1);

  const seFueDeRango = error?.code === "PGRST103";
  if (error && !seFueDeRango) {
    throw new Error(`No se pudieron leer ${que}: ${error.message}`);
  }

  const filas = seFueDeRango ? [] : (data ?? []);
  const total = seFueDeRango
    ? ((await contar()).count ?? 0)
    : (count ?? filas.length);

  return { filas, total, hayMas: desde + filas.length < total, desde };
}

/**
 * El encabezado de un listado: cuántos hay y si falta pedir más.
 *
 * Decir "pedí la 2" y no solo "hay más" es la diferencia entre que el
 * modelo siga solo o que te pregunte a vos cómo se hace.
 */
export function encabezado(
  pagina: Pick<Pagina<unknown>, "total" | "hayMas">,
  numero: number,
  singular: string,
  plural: string,
): string {
  const cuantos = `${pagina.total} ${pagina.total === 1 ? singular : plural}`;
  if (!pagina.hayMas && numero === 1) return `${cuantos}:`;
  return `${cuantos} (página ${numero}${
    pagina.hayMas ? `, pedí la ${numero + 1} para el resto` : ""
  }):`;
}

/**
 * Qué contestar cuando la página pedida no tiene nada.
 *
 * Distingue "no hay nada cargado" de "te pasaste de página", que para
 * quien lee son dos situaciones muy distintas y una sola de las dos se
 * arregla pidiendo otra cosa.
 */
export function paginaVacia(
  pagina: number,
  total: number,
  nada: string,
  porPagina: number = POR_PAGINA,
): string {
  if (total === 0) return nada;
  return `La página ${pagina} está vacía: hay ${total} en total y entran ${porPagina} por página.`;
}

/** Envuelve texto en la forma que espera el protocolo. */
export function respuesta(texto: string) {
  return { content: [{ type: "text" as const, text: texto }] };
}

/**
 * Recorta un texto largo sin cortar una palabra al medio.
 *
 * Lo usa la búsqueda de lecciones: devolver el contenido entero de cada
 * una llenaría el presupuesto con las que no interesan. El que quiere
 * una completa la pide por título.
 */
export function recortar(texto: string, maximo: number): string {
  const limpio = texto.trim();
  if (limpio.length <= maximo) return limpio;

  const cortado = limpio.slice(0, maximo);
  const ultimoEspacio = cortado.lastIndexOf(" ");
  return `${(ultimoEspacio > maximo * 0.6 ? cortado.slice(0, ultimoEspacio) : cortado).trimEnd()}…`;
}
