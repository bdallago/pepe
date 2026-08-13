/**
 * Las varas de los prompts, mecanizadas.
 *
 * ## Por qué esto es la mitad que importa
 *
 * Correr un prompt contra Groq cuesta minutos de reloj y cupo diario: el
 * razonador entra **una vez por minuto** y tiene un techo de 200 000
 * tokens por día. Juzgar una salida ya guardada es gratis y corre dentro
 * de `npm test`. Todo lo que se pueda mover de allá para acá se mueve — es
 * la regla de AGENTS.md §9, *si algo se puede resolver sin modelo, se
 * resuelve sin modelo*, aplicada a la verificación en vez de al despacho.
 *
 * ⚠ **Ninguno juzga si la respuesta es BUENA.** Juzgan que cumpla lo que
 * su prompt promete. "Esta retro es floja" no es mecanizable y no se
 * intenta: un juez que pretenda eso da falsos rojos, y un arnés con rojos
 * permanentes entrena a ignorar el rojo.
 *
 * ⚠ **Y ninguno se afloja para que una corrida dé verde.** Si un prompt
 * falla su propia vara, eso es el hallazgo. Es la misma regla que ya tiene
 * escrita el banco del recepcionista.
 */

/**
 * Arranques de rótulo: cómo empieza una frase de manual de negocios.
 *
 * La vara está escrita **tres veces** en AGENTS.md —en 6.3, en la retro y
 * en los adjuntos— y nunca se verificó ni una: *"el título tiene que ser
 * una afirmación discutible, no un rótulo. Si podría estar en la tapa de
 * cualquier libro de negocios, está mal"*.
 *
 * La lista sale de rótulos **reales**: los tres primeros son los que
 * devolvió `llama-3.3-70b-versatile` el 2026-08-08 ("Establecer límites de
 * soporte", "Priorizar la documentación", "Revisar contratos") y los dos
 * de la regla de la retro ("Invertir en herramientas de calidad",
 * "Diversificar los ingresos"). No se inventó ninguno.
 */
const ARRANQUES_DE_ROTULO: readonly RegExp[] = [
  // Infinitivo de consejo. Es la forma que tienen los cinco rótulos
  // medidos, y la que ningún título con un dato adentro necesita.
  /^(establecer|priorizar|revisar|mejorar|optimizar|implementar|definir|mantener|invertir|diversificar|gestionar|planificar|documentar|evaluar|fomentar|asegurar|garantizar|aprovechar|automatizar|centralizar|estandarizar|monitorear|reducir|aumentar|delegar)\b/i,
  // Fórmulas de manual.
  /^(la importancia de|es importante|hay que|conviene|siempre conviene|nunca hay que|se recomienda)\b/i,
];

/**
 * ¿El título es un rótulo en vez de una afirmación discutible?
 *
 * Dos condiciones, y las dos tienen que darse: **arranca como consejo** y
 * **no trae ningún dato concreto**. La segunda es la que evita el falso
 * positivo obvio: "Invertir 3 meses en el importador costó más que
 * escribirlo" arranca con un infinitivo y es perfectamente discutible.
 *
 * ⚠ La asimetría está a favor, igual que en `esAmbigua()`: un falso
 * positivo hace que el arnés marque en rojo un título que estaba bien —se
 * mira y se decide— y un falso negativo deja pasar un rótulo, que es el
 * comportamiento de hoy. No hay regresión posible.
 */
export function pareceRotulo(titulo: string): boolean {
  const t = titulo.trim();
  if (!ARRANQUES_DE_ROTULO.some((r) => r.test(t))) return false;

  return !tieneDatoConcreto(t);
}

/**
 * Un número, o un nombre propio que no sea la primera palabra.
 *
 * El "que no sea la primera" importa: todo título arranca con mayúscula,
 * así que contarla haría que cualquier rótulo pase.
 */
function tieneDatoConcreto(texto: string): boolean {
  if (/\d/.test(texto)) return true;
  return /\s[A-ZÁÉÍÓÚÑ][\wáéíóúñ]{2,}/.test(texto);
}

/**
 * Los números de la salida que no aparecen en la entrada.
 *
 * Es el juez que ataca lo único que está **medido** de la retro: el
 * razonamiento confabula más, y su primera corrida inventó un plazo
 * previsto que no existía, procesos que supuestamente faltaron y
 * consecuencias que nadie registró. Un número que el modelo no recibió y
 * escribe igual es una invención, y en un documento que se relee dentro de
 * un año es la peor de todas.
 *
 * ⚠ **Los años y los números de una o dos cifras se ignoran**, con una
 * excepción. Se ignoran porque "dos clientes", "tres veces" o "el 80 %"
 * salen de **contar o calcular** lo que se le dio, no de inventar, y
 * exigir que estén literales en la entrada daría un rojo en casi toda
 * oración — y un arnés con rojos permanentes entrena a ignorar el rojo.
 * Lo que se persigue son las cifras específicas: montos, cantidades,
 * porcentajes con decimales.
 *
 * ⚠ **La excepción son las duraciones**, y sale del fallo medido: la
 * primera corrida de la retro inventó *"un plazo previsto"*. `"90 días"`
 * tiene dos cifras y se colaba por el piso. Una duración **nunca es
 * derivable** del contexto que se le pasa —el prompt de la retro se lo
 * dice con todas las letras: *"no te di ningún plan ni ninguna fecha
 * objetivo… no podés saber si algo llegó tarde o temprano"*— así que
 * cualquier número pegado a una unidad de tiempo se chequea igual.
 *
 * ⚠ **Y lo que este juez NO puede ver**: un recorte. Una descripción que
 * volvió a la mitad no trae ningún número nuevo. Eso lo detecta el banco
 * comparando contra lo que espera, no esto.
 */
const UNIDAD_DE_TIEMPO =
  /^\s*(d[ií]as?|semanas?|meses|mes|a[ñn]os?|horas?|jornadas?)\b/i;

export function numerosSinRespaldo(salida: string, entrada: string): string[] {
  const enEntrada = new Set(
    (entrada.match(/\d[\d.,]*/g) ?? []).map(normalizarNumero),
  );

  const sospechosos: string[] = [];

  for (const encontrado of salida.matchAll(/\d[\d.,]*/g)) {
    const crudo = encontrado[0];
    const n = normalizarNumero(crudo);

    if (enEntrada.has(n)) continue;
    if (/^(19|20)\d\d$/.test(n)) continue;

    const loQueSigue = salida.slice(encontrado.index + crudo.length);
    const esDuracion = UNIDAD_DE_TIEMPO.test(loQueSigue);

    if (n.length <= 2 && !esDuracion) continue;

    sospechosos.push(crudo);
  }

  return sospechosos;
}

/** Sin separadores de miles ni decimales: `"150.000"` y `"150000"` son el mismo. */
function normalizarNumero(s: string): string {
  return s.replaceAll(".", "").replaceAll(",", "");
}

/**
 * ¿Está el texto contenido en la fuente, ignorando tildes y mayúsculas?
 *
 * Mecaniza dos reglas distintas que piden lo mismo: el **COPIALA ENTERA**
 * del extractor de movimientos y el `ancla` que tiene que ser *"cita
 * literal del pedido"* en la estimación de presupuestos.
 *
 * El modo de fallar del primero está medido y es silencioso: con un prompt
 * más largo, `"Venta Proder a cliente nuevo"` volvía como `"Venta"` y el
 * histórico —de donde sale la clasificación de todo lo que venga después—
 * quedaba sucio.
 */
export function estaContenido(texto: string, fuente: string): boolean {
  return normalizarTexto(fuente).includes(normalizarTexto(texto));
}

function normalizarTexto(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Emojis y muletillas de asistente.
 *
 * Seis de los trece prompts terminan con *"sin emojis y sin muletillas de
 * asistente"*, y ninguno lo verificaba. Devuelve las muletillas
 * encontradas para poder nombrarlas en el reporte.
 */
const MULETILLAS: readonly [RegExp, string][] = [
  [/\b(¡?claro!?|por supuesto|desde ya|con gusto)\b/i, "cortesía de chatbot"],
  [/\bespero que (te sirva|esto ayude|haya)\b/i, "cierre de asistente"],
  [/\bno dudes en\b/i, '"no dudes en"'],
  [/\bes importante (recordar|tener en cuenta|destacar)\b/i, "relleno"],
  [/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, "emoji"],
];

export function tonoDeAsistente(texto: string): string[] {
  return MULETILLAS.filter(([r]) => r.test(texto)).map(([, nombre]) => nombre);
}
