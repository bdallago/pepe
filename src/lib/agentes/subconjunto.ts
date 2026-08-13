import { normalizar, type Nombrado } from "@/lib/agentes/nombres";

/**
 * Parte la cola `"… compartido entre A y B"` de un movimiento dictado.
 *
 * Beno lo pidió así: *"este gasto es un compartido entre y, z y u
 * proyecto"*. Hasta hoy el subconjunto explícito (AGENTS.md §2.b) solo se
 * podía elegir tildando casillas en el formulario.
 *
 * ## Por qué esto es código y no una línea en el prompt
 *
 * §9: *si algo se puede resolver sin modelo, se resuelve sin modelo*. Una
 * preposición fija y dos nombres que se buscan en tres filas es el caso
 * más claro que hay. Y el prompt del recepcionista es de vidrio —cuatro
 * incidentes medidos donde agregarle texto rompió casos que ni nombraba—,
 * así que la alternativa costaba medir el piso antes y después, once
 * minutos cada vez, para algo que resuelve una expresión regular.
 *
 * ⚠ **Esto NO es un tercer atajo de `atajo.ts`**, aunque se parezca. Un
 * atajo decide **el destino** sin llamar al modelo, y §9 dice que hay dos y
 * no se agregan más. Esto no decide ningún destino —la frase sigue yendo a
 * `movimientos`—: parte un argumento, como `partirArgumento()` y
 * `textoDelMovimiento()`.
 *
 * ## Lo que arregla, que no es "falta una feature"
 *
 * Medido el 2026-08-13, antes de que esto existiera:
 * `"-15000 hosting compartido entre Proder y Gentius"` dejaba
 * `descripcion: "hosting compartido entre Proder y Gentius"`. Esa columna
 * alimenta `descripcion_normalizada` y con ella toda la sugerencia de
 * categoría por histórico (regla 6.c), así que dictar el reparto **ensuciaba
 * el histórico para siempre**. El daño no era no tener la feature.
 *
 * ## Las dos condiciones que hacen segura la regla
 *
 * 1. ⚠ **Si no resuelven TODOS los nombres, no se toca nada**: ni el texto
 *    ni los ids. El peor caso de un error acá es que la feature no se
 *    active —Beno ve el formulario sin tildes y los pone a mano—, nunca una
 *    descripción rota ni un gasto repartido entre proyectos que no nombró.
 *    Es la misma asimetría con la que se eligió `esAmbigua()`.
 * 2. ⚠ **Mínimo dos**, igual que el formulario y el schema: "compartido
 *    entre X" con uno solo es "es de X", y eso ya se escribe con
 *    `project_id`. Dos formas de guardar lo mismo es la que después
 *    contesta distinto según por dónde la leas.
 */

export interface Subconjunto {
  /** El texto sin la cola. **Idéntico al de entrada si no se activó.** */
  texto: string;
  /** Los ids, en el orden en que se nombraron. Vacío si no se activó. */
  ids: string[];
}

/**
 * `compartido|repartido|dividido entre …` al final del texto.
 *
 * ⚠ **El participio es obligatorio, y `"entre A y B"` suelto NO alcanza.**
 * Con la condición de que todos los nombres resuelvan, aceptarlo sería casi
 * seguro; el caso que lo desaconseja es real y no hipotético:
 * `"traslado entre Proder y Gentius"` es una descripción —un viaje entre
 * dos lugares— y no una declaración de reparto. Con el participio, esa
 * frase queda intacta.
 */
const COLA =
  /\s*[,;]?\s*\b(?:compartido|repartido|dividido)s?\s+entre\s+(.+)$/i;

/** Cuántos caracteres tiene que tener un tramo para intentar el match parcial. */
const MINIMO_PARA_PARCIAL = 3;

/**
 * Una fecha en números al final, del estilo telegráfico de Beno.
 *
 * ⚠ **Existe porque la cola se puede escribir DESPUÉS de la fecha**, y las
 * cinco frases telegráficas reales tienen la fecha al final:
 * `"-15000 hosting compartido entre Proder y Gentius 13/08"`. Sin esto, el
 * último tramo sería `"Gentius 13/08"`, no resolvería a ningún proyecto y
 * —por la condición de todo-o-nada— **no se activaría nada**: el reparto se
 * perdería y la fecha se quedaría adentro de la descripción, que es
 * justamente el daño que este archivo viene a evitar.
 *
 * Solo el formato en números. Un `"…y Gentius ayer"` no se rescata, y está
 * bien que no: `"ayer"` es una palabra y podría ser parte de un nombre.
 */
const FECHA_AL_FINAL = /\s+(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s*$/;

export function partirSubconjunto(
  texto: string,
  proyectos: readonly (Nombrado & { id: string })[],
): Subconjunto {
  const sinCambios: Subconjunto = { texto, ids: [] };

  const encontrado = texto.match(COLA);
  if (!encontrado) return sinCambios;

  const antes = texto.slice(0, encontrado.index!).trim();
  const cola = encontrado[1]!;

  const directo = resolverLista(cola, proyectos);
  if (directo !== null && directo.length >= 2) {
    return { texto: antes, ids: directo };
  }

  // Segundo intento: la fecha se colgó del último proyecto. Se la saca de la
  // cola y se la devuelve al final del texto, donde `leerTelegrafico()` la
  // busca.
  const conFecha = cola.match(FECHA_AL_FINAL);
  if (!conFecha) return sinCambios;

  const ids = resolverLista(cola.slice(0, conFecha.index!), proyectos);
  if (ids === null || ids.length < 2) return sinCambios;

  return { texto: `${antes} ${conFecha[1]}`.trim(), ids };
}

/**
 * Parte la lista y resuelve cada nombre. `null` si alguno no existe o es
 * ambiguo.
 */
function resolverLista(
  lista: string,
  proyectos: readonly (Nombrado & { id: string })[],
): string[] | null {
  const tramos = partirNombres(lista, proyectos);
  if (tramos === null) return null;

  const ids: string[] = [];
  for (const tramo of tramos) {
    const proyecto = resolverUno(tramo, proyectos);
    if (!proyecto) return null;
    // El mismo proyecto nombrado dos veces no cuenta doble. Si queda uno
    // solo, arriba no se activa, que es lo correcto.
    if (!ids.includes(proyecto.id)) ids.push(proyecto.id);
  }

  return ids;
}

/**
 * Un tramo → un proyecto.
 *
 * ⚠ **No usa `resolverProyecto()` de `agentes/resolver.ts`, y no es por
 * duplicar.** Dos razones concretas:
 *
 * 1. Ese módulo es `server-only` y este no puede serlo: se prueba con
 *    `npm test`, que corre sin `--conditions=react-server` a propósito (ver
 *    el comentario de `agentes/nombres.ts`, que existe exactamente por este
 *    problema y del que sí se comparte `normalizar()`).
 * 2. Su match parcial tiene **un brazo de más para este caso**:
 *    `aguja.includes(nombre)`, o sea que un tramo largo que *contenga* el
 *    nombre de un proyecto resuelve a ese proyecto. Ahí eso es lo correcto
 *    —está buscando el proyecto mencionado en una frase entera—; acá el
 *    tramo ya viene recortado, y ese brazo haría que `"el equipo y la
 *    infra de Proder"` cuente como Proder.
 *
 * Lo que sí se conserva es el criterio que importa: **exacto antes que
 * parcial, y la ambigüedad no se resuelve, se abandona.** Es el mismo que
 * `resolverNombrado()`.
 */
function resolverUno<T extends Nombrado>(
  tramo: string,
  proyectos: readonly T[],
): T | null {
  const aguja = normalizar(tramo);
  if (aguja.length === 0) return null;

  const exactos = proyectos.filter(
    (p) => normalizar(p.nombre) === aguja || normalizar(p.slug) === aguja,
  );
  if (exactos.length === 1) return exactos[0]!;
  if (exactos.length > 1) return null;

  if (aguja.length < MINIMO_PARA_PARCIAL) return null;

  const parciales = proyectos.filter(
    (p) =>
      normalizar(p.nombre).includes(aguja) || normalizar(p.slug).includes(aguja),
  );
  return parciales.length === 1 ? parciales[0]! : null;
}

/**
 * Devuelve los tramos de la lista, o `null` si no se puede partir de forma
 * que todos resuelvan.
 *
 * ⚠ **Prueba el tramo entero ANTES de cortar por `" y "`**, y ese orden es
 * lo único que hace funcionar a `"El Prode de Beno y Proder"`. Con el corte
 * primero, cualquier nombre con un `y` o un `de` adentro se partía al
 * medio: es el mismo modo de fallar que ya mordió una vez, cuando la lista
 * de palabras vacías convirtió `"El Prode"` en `"Prode"`.
 */
function partirNombres(
  lista: string,
  proyectos: readonly (Nombrado & { id: string })[],
): string[] | null {
  const conocido = (s: string) => resolverUno(s, proyectos) !== null;

  const tramos: string[] = [];

  for (const porComa of lista.split(/\s*[,;]\s*/)) {
    const limpio = porComa.trim();
    if (limpio.length === 0) continue;

    if (conocido(limpio)) {
      tramos.push(limpio);
      continue;
    }

    const partido = partirPorY(limpio, conocido);
    if (partido === null) return null;
    tramos.push(...partido);
  }

  return tramos.length > 0 ? tramos : null;
}

/**
 * Corta por `" y "` probando cada separador, de izquierda a derecha, y
 * sigue recursivamente por la derecha.
 *
 * Probar **todos** los separadores y no el primero es lo que resuelve
 * `"El Prode de Beno y Proder"` cuando algún día exista un proyecto con un
 * `y` en el nombre: se queda con el corte que deja las dos mitades
 * reconocibles.
 */
function partirPorY(
  texto: string,
  conocido: (s: string) => boolean,
): string[] | null {
  for (const separador of texto.matchAll(/\s+y\s+/gi)) {
    const izquierda = texto.slice(0, separador.index).trim();
    const derecha = texto.slice(separador.index + separador[0].length).trim();

    if (!conocido(izquierda)) continue;
    if (conocido(derecha)) return [izquierda, derecha];

    const resto = partirPorY(derecha, conocido);
    if (resto) return [izquierda, ...resto];
  }

  return null;
}
