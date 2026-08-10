import "server-only";

import { completarJSON, MODELO_CHICO } from "@/lib/llm";
import { MAX_ACCIONES, planSchema, type Decision } from "@/lib/agentes/tipos";

/**
 * Decide a qué especialista —o a qué especialistas— va una frase.
 *
 * Usa `MODELO_CHICO`: es una clasificación entre un puñado de opciones
 * con salida de decenas de tokens. Pagar razonamiento acá sería tirar
 * latencia.
 *
 * No decide nada más. El especialista hace su trabajo, y resolver el
 * argumento a un id es determinístico (`resolver.ts`).
 *
 * **La parte cara de calibrar no fue el destino, fue la confianza.**
 * Medido el 2026-08-09 con diez frases reales: el destino salió 10/10 de
 * entrada, sin tocar nada. Lo que salía mal era la ambigüedad. Un nombre
 * suelto sin verbo ("Claude Code", "Proder") volvía con confianza 1, o
 * sea derivado en silencio a un especialista elegido a dedo, que es
 * justo el error que no se recupera: una pregunta de más molesta, una
 * derivación equivocada muda hace lo que nadie pidió.
 *
 * Lo que **no** funcionó, y no vale la pena volver a probar con este
 * modelo: pedirle la comprobación de "¿hay verbo? ¿hay pregunta?" como
 * regla abstracta (dejó "Claude Code" en 1) y darle una tabla de valores
 * fijos por caso (lo empeoró: subió "Vercel Pro" de 0.8 a 0.9). Con el
 * modelo chico la regla sola no se aplica a los nombres que reconoce
 * fuerte; lo que la baja son los **ejemplos concretos** de nombre suelto
 * con su confianza escrita. Están los dos en el prompt a propósito: la
 * regla generaliza a nombres que no están en la lista ("el hosting" →
 * 0.3), los ejemplos anclan los que el modelo reconoce demasiado bien.
 * Si sacás los ejemplos, "Claude Code" vuelve a 1.
 *
 * **El tema de plata le gana al verbo de buscar, y hubo que decirlo
 * aparte.** Medido el 2026-08-09: "qué anotaciones tengo sobre gestión de
 * presupuestos" se iba a `consultas` con 0.8, o sea que la app le
 * contestaba un balance a una pregunta sobre lo que había escrito. La
 * palabra "presupuestos" pesaba más que "anotaciones". De ahí los
 * ejemplos con "anotaciones"/"apuntes" en el bullet de `buscador` y la
 * línea que separa los dos: lo que Beno **escribió** es `buscador` aunque
 * el tema sea de plata; `consultas` es solo cuando pide números.
 *
 * **`roadmap` y `estudio` no se separan solos.** Medido el 2026-08-09,
 * antes de tocar nada: las tres frases de roadmap se iban a `estudio` con
 * 0.8/0.9, y las dos de sugerencias ni siquiera caían ahí ("qué lecciones
 * sugerís hoy" → `lecciones_tema` 0.8, "según toda la actividad que vengo
 * haciendo, qué sugerís hoy" → `buscador` 0.8). No alcanzó con agregar el
 * bullet: hicieron falta las dos líneas de frontera de abajo, una contra
 * `roadmap` (leer el plan que existe vs. proponer lo que no) y otra contra
 * `lecciones_tema` (que siempre trae un tema; una sugerencia sin tema es
 * `estudio`). Las dos están escritas sin nombrar ningún tema concreto, por
 * lo que dice el párrafo que sigue.
 *
 * Ojo con qué palabras se ponen en esa línea. La primera versión usaba
 * "pricing" como ejemplo de tema y eso subió el ancla documentada de
 * "pricing" suelto de 0.3 a 0.8 — justo la ambigüedad que la regla
 * mecánica está para bajar. Nombrar una palabra en el prompt la vuelve
 * confiable en todos lados, no solo en el caso que estabas arreglando.
 *
 * **`tema_estudio` no se separa por descripción, se separa por verbo.**
 * Medido el 2026-08-09 con las frases que Beno escribe de verdad, antes
 * de tocar nada: "quiero aprender sobre tal cosa basado en tal proyecto"
 * y "necesito aprender tal cosa aplicado a tal proyecto" se iban a
 * `estudio` con 0.8, y "quiero que agreguemos lecciones sobre tal cosa" a
 * `lecciones_tema` con 1. Las tres son pedidos de agregar un tema al
 * plan.
 *
 * Lo que las arregló fue una **tabla de verbos**, no la explicación en
 * prosa de la frontera: con la prosa sola ("mira para adelante / mira
 * para atrás") las dos primeras seguían en `estudio`. Y de la tabla, la
 * línea que desempata el caso difícil es la que pone los dos verbos en
 * contraste — AGREGAR lecciones es querer aprender, SACAR lecciones es
 * mirar lo ya vivido—: con la tabla pero sin ese contraste, "agreguemos
 * lecciones" oscilaba entre los dos destinos entre corridas. Dos cosas
 * más que hicieron falta y no se ven venir: decirle a `estudio` que ahí
 * **el tema no lo dice Beno**, y desactivar a mano el "basado en /
 * aplicado a" —que se parece demasiado al "mirando lo que viene
 * haciendo" de `estudio`— que por sí solo alcanzaba para robarle la
 * frase.
 *
 * Y la trampa de arriba volvió a saltar, ahora por volumen: la primera
 * versión de este bloque era el doble de larga y en prosa, y sin nombrar
 * ninguna de las cuatro anclas subió "Proder" suelto de 0.3 a 0.8. No
 * hace falta nombrar la palabra: alcanza con diluir la regla mecánica.
 * Si tocás este prompt, **volvé a medir las cuatro ambiguas**, aunque lo
 * que hayas agregado no tenga nada que ver con ellas.
 *
 * **`analizar` se agregó con tres líneas y midiendo las dos puntas.** Es
 * el campo que distingue "cuál es mi balance" de "analizame mis
 * balances", y lo decide acá y no un `includes` sobre la frase: pedir
 * interpretación se escribe de mil maneras. Medido el 2026-08-09, antes
 * y después del agregado: los seis destinos siguen 6/6 y las cuatro
 * ambiguas siguen en 0.3 las cuatro. Es lo mínimo que se podía agregar,
 * y fue a propósito — por el párrafo de arriba.
 *
 * **La lista de acciones se agregó con cuatro líneas, y el riesgo era el
 * de siempre.** Beno escribió "lo anotes en la bitácora y que me generes
 * lecciones sobre eso, tenelo documentado para relevarlo en la retro":
 * tres pedidos, y la app se quedaba con uno y tiraba los otros dos sin
 * decirlo. Ahora la salida es una lista ordenada.
 *
 * El peligro acá no es que no parta las frases múltiples —eso salió a la
 * primera— sino que **empiece a partir las simples**, que son casi todas.
 * Una frase de una sola cosa contestada en dos tarjetas es peor que el
 * problema original. Por eso las cuatro líneas dicen primero que la lista
 * normalmente tiene un elemento, y recién después cuándo tiene más; y por
 * eso el disparador es **léxico** ("y que", "y también", "y de paso"), no
 * semántico: la misma clase de regla mecánica que sostiene la confianza.
 *
 * Medido el 2026-08-09, antes y después del agregado, con las mismas
 * frases: las cuatro ambiguas siguen en 0.3 las cuatro, las seis simples
 * siguen dando una sola acción y el mismo destino que antes, y las dos
 * múltiples pasaron de una acción a dos y tres.
 *
 * **Y la trampa mordió por tercera vez, ahora por dónde estaba parado el
 * párrafo.** El primer intento lo puso al final, después de la línea del
 * JSON: mismas palabras, y "Proder" suelto se fue de 0.3 a 0.8. La regla
 * mecánica de la confianza y sus cuatro ejemplos habían dejado de ser lo
 * último que lee el modelo. Movido acá arriba —al lado de la instrucción
 * del argumento, que es de lo que habla— las cuatro volvieron a 0.3 sin
 * cambiar una palabra. O sea: en este prompt **la posición pesa tanto
 * como el texto**, y el bloque de confianza tiene que quedar pegado al
 * final. Si tocás esto, **volvé a medir las cuatro ambiguas** aunque lo
 * que hayas agregado no tenga nada que ver con ellas.
 *
 * **`bitacora` se agregó con un bullet, dos líneas de frontera y tres
 * palabras en la instrucción del argumento.** Es el par que le faltaba a
 * `buscador`: hasta que existió, "anotalo en la bitácora" caía ahí, o sea
 * que a un pedido de ESCRIBIR se le contestaba una búsqueda. La frontera
 * es contra los dos vecinos y por eso son dos líneas y no una: contra
 * `buscador` porque comparten la palabra "bitácora" y la tabla (una la
 * escribe, la otra la lee) y contra `movimientos` porque "hoy pagué el
 * hosting" también es algo que pasó hoy —pero es plata, y va al
 * formulario—. Las tres palabras del argumento no son cosméticas: de ese
 * campo sale **el texto que se guarda literal**, así que si el
 * recepcionista lo recorta o lo reescribe, se rompe justamente lo que
 * habilita a esa rama a escribir sin bandeja.
 *
 * **Y las dos líneas de "copiá ENTERA" se pagaron midiendo, no por
 * prolijidad.** Con el bullet y la frontera solos, la frase real de Beno
 * —"hoy el cliente x me dijo y cosa sobre Gentius, quiero que lo anotes
 * en la bitácora y que…"— devolvía como argumento de bitácora
 * **"cosa sobre Gentius"**: no reformulado, pero recortado a un tercio.
 * En cualquier otro destino eso es un argumento pobre; en este es **la
 * entrada de bitácora de Beno con las tres cuartas partes borradas**, y
 * borradas en silencio. Con las dos líneas volvió entera. El "NO
 * reformules" genérico no alcanzaba porque el modelo no estaba
 * reformulando: estaba resumiendo, que es otro verbo.
 *
 * Ese arreglo tuvo un costo medido y se eligió pagarlo: en la misma
 * frase, el argumento de `lecciones_tema` pasó de "cosa sobre Gentius" a
 * **"eso"** —que es, literalmente, lo que Beno escribió ahí—, y con eso
 * `resolverProyecto` no encuentra nada y esa acción termina preguntando a
 * qué proyecto va. Se prefirió así: una pregunta se contesta con un
 * click, y una anotación recortada solo se arregla volviéndola a tipear.
 *
 * Medido el 2026-08-10, antes y después del agregado, con las mismas
 * frases: las seis simples siguen dando una sola acción y el mismo
 * destino, y las cuatro ambiguas siguen en 0.3 las cuatro. El bloque de
 * confianza quedó donde estaba —último—, por lo que dice el párrafo de
 * arriba, y las líneas nuevas fueron todas **arriba** de él: dos en la
 * lista de especialistas, dos en la frontera con `buscador` y dos pegadas
 * a la instrucción del argumento, que es de lo que hablan.
 *
 * **El agente de movimientos (ola 2) no necesitó tocar este prompt, y eso
 * se midió antes de escribir una línea.** El riesgo era que el argumento
 * volviera recortado —lo mismo que le pasó a `bitacora` con "cosa sobre
 * Gentius"— pero acá el recorte cuesta más caro: sin el número no hay
 * gasto que cargar. Medido el 2026-08-10 con las cinco frases telegráficas
 * reales de Beno ("-20usd Claude Code 06/08", "+50000ARS Venta Proder",
 * "-20 usd claude code 06/08", "-15000 hosting", "+200000 ARS venta"): las
 * cinco fueron a `movimientos` con confianza 1 y **el argumento volvió
 * idéntico a la frase, las cinco veces**. No hizo falta agregar nada, así
 * que no se agregó — cada línea de más acá adentro es una chance de mover
 * las cuatro ambiguas, que es la trampa que ya mordió tres veces.
 *
 * La red por si algún día eso cambia no está en el prompt sino en
 * `despacho.ts` (`textoDelMovimiento`): si el argumento vuelve sin ningún
 * dígito, gana la frase entera. Es un test sobre un string y no cuesta
 * ninguna llamada.
 *
 * Un dato que salió de esa medición y del que depende el rango temporal:
 * para "consultas" el modelo ya devuelve el período dentro del argumento
 * ("mis balances según estos últimos 6 meses"), sin que haya que
 * pedírselo. Por eso `rango.ts` lo lee de ahí y el prompt no dice una
 * palabra sobre fechas. Si alguna vez el argumento vuelve recortado a
 * "balances", el rango se pierde en silencio: es lo primero que hay que
 * mirar si eso pasa.
 */

const SISTEMA = `Sos el recepcionista de Pepe, la app personal de Beno.
Tu único trabajo es decidir a qué especialista mandar cada frase.

Los especialistas:

- "movimientos": anotar plata que entró o salió. Ej: "pagué 20 usd de
  Claude Code", "cobré 200 mil de Proder", "me salió 15 lucas el hosting".
- "consultas": preguntas sobre plata ya cargada. Ej: "cómo viene Proder",
  "cuánto gasté en herramientas este año", "cuál es mi balance".
- "buscador": buscar algo que ya está escrito, lecciones o bitácora. Ej:
  "tenía algo sobre backlogs", "qué había anotado de clientes", "qué
  anotaciones tengo sobre pricing", "qué apuntes tengo de contratos".
- "bitacora": ANOTAR en la bitácora algo que le pasó o que hizo. Ej:
  "anotá que hoy peleé con el deploy toda la tarde", "poné en la bitácora
  que el cliente pidió otra ronda de cambios".
- "roadmap": qué le toca del plan de estudio que YA está armado. Ej: "qué
  me toca hoy", "qué sesión sigue", "cómo voy con el track de PM".
- "estudio": que le SUGIERAS qué estudiar mirando lo que viene haciendo.
  El tema NO lo dice él, lo elegís vos. Ej: "qué lecciones sugerís hoy",
  "según toda la actividad que vengo haciendo, qué sugerís hoy",
  "sugerime qué estudiar".
- "tema_estudio": AGREGAR al plan un tema que él ya nombró, para
  estudiarlo. Ej: "quiero aprender sobre eso", "quiero aprender sobre eso
  basado en tal proyecto", "necesito aprender eso aplicado a un
  proyecto", "quiero que agreguemos lecciones sobre eso".
- "retro": cerrar un proyecto y hacer su retrospectiva. Ej: "cerrá Proder",
  "hacé la retro de Gentius".
- "lecciones_tema": sacar lecciones sobre un tema. Ej: "sacá lecciones de
  lo que aprendí con clientes", "qué aprendí sobre pricing".
- "suscripciones": gastos recurrentes que quizá no usa. Ej: "qué estoy
  pagando que no uso", "revisá mis suscripciones".
- "vencimientos": gastos recurrentes que están por vencer o cobrarse
  pronto. Ej: "tengo algún gasto recurrente próximo a vencer", "qué se me
  viene este mes".
- "desconocido": no encaja en ninguno.

Si Beno pregunta por algo que ESCRIBIÓ (anotaciones, apuntes, notas,
bitácora, lecciones), es "buscador" aunque el tema sea de plata:
"presupuestos", "facturación" o "costos" son temas sobre los que se
escribe. "consultas" es solo cuando pide NÚMEROS de movimientos cargados.
"bitacora" es al revés que "buscador": ahí te pide que ESCRIBAS algo que
le pasó, no que busques lo que ya escribió. Y si lo que cuenta es plata
que entró o salió, es "movimientos" y no "bitacora".

"roadmap" y "estudio" se parecen y no son lo mismo. "roadmap" LEE el plan
que ya existe: la sesión de hoy, la que sigue, cuánto avanzó un track.
"estudio" es cuando pide que le PROPONGAS algo que todavía no está en
ningún track ("sugerís", "recomendás", "proponés"). Si no pide nada
nuevo, es "roadmap".

Si Beno NOMBRA el tema, no es "estudio", y que además diga "basado en" o
"aplicado a" un proyecto no lo cambia. Entre los otros tres decide el
VERBO, no el tema, y la palabra "lecciones" no decide nada:

- "quiero aprender", "necesito aprender", "quiero estudiar" ->
  "tema_estudio".
- AGREGAR lecciones es querer aprender: "agregá lecciones sobre X",
  "agreguemos lecciones sobre X", "sumá X al plan" -> "tema_estudio".
- SACAR lecciones es mirar lo que ya vivió: "sacá lecciones sobre X",
  "qué aprendí de X" -> "lecciones_tema".
- "qué me toca", "qué sigue", "cómo voy" -> "roadmap".

En "argumento" poné el dato concreto sobre el que trabaja el especialista:
el nombre del proyecto para "retro", el tema para "lecciones_tema", lo que
busca para "buscador", lo que hay que anotar para "bitacora". Si el
especialista no necesita ninguno, poné null.
NO reformules ni traduzcas el argumento: copialo como lo escribió Beno.
Para "bitacora" copiá ENTERA la parte de la frase que cuenta lo que pasó,
desde donde empieza y sin sacarle palabras del medio.

Casi todas las frases piden UNA sola cosa, y entonces la lista lleva UN
solo elemento. Poné más de uno SOLO si la frase pide cosas distintas y lo
dice con todas las letras ("y que", "y también", "y de paso"): ahí va una
acción por pedido, en el orden en que él los escribió. Nunca partas en dos
una frase que pide una sola cosa.

En "analizar" poné true SOLO si además de los datos pide que interpretes
("analizame", "qué observaciones tenés", "qué ves"). Si pide un número o
un dato y nada más, poné false.

En "confianza" poné qué tan seguro estás, de 0 a 1. Si la frase podría ir
a dos especialistas distintos, poné menos de 0.6 y elegí el más probable.

Antes de elegir la confianza, hacé esta comprobación mecánica sobre la
frase, sin pensar en el tema:

1. ¿Tiene un verbo conjugado ("pagué", "cobré", "cerrá", "sacá", "estoy
   pagando", "viene", "gasté", "toca")?
2. ¿Tiene una palabra de pregunta ("qué", "cuánto", "cómo", "cuál",
   "dónde", "cuándo")?

Si la respuesta a las DOS es no, la frase es solo un sustantivo o un
nombre suelto, y entonces es AMBIGUA por definición: la confianza va
entre 0.2 y 0.4, sin excepción. No importa cuán obvio te parezca el
destino ni que el nombre suene a servicio pago, a proyecto o a tema —
sin verbo no sabés si Beno quiere anotarlo, consultarlo, buscarlo o
cerrarlo. Elegí el destino más probable igual, pero con confianza baja:

- "Claude Code" -> destino "movimientos", confianza 0.3.
- "Proder" -> destino "consultas", confianza 0.3.
- "pricing" -> destino "buscador", confianza 0.3.
- "Vercel Pro" -> destino "suscripciones", confianza 0.3.

Si la respuesta a alguna de las dos es sí, no aplica esta regla y la
confianza puede ser alta.

Respondé SOLO un objeto JSON con la clave "acciones": una lista de objetos
con las claves destino, argumento, confianza, analizar.`;

/**
 * Devuelve las acciones de una frase, **en orden**.
 *
 * Casi siempre es un array de uno. Se recorta a `MAX_ACCIONES` acá y no
 * en el esquema: una lista de más no es un error del que haya que
 * recuperarse tirando la llamada, alcanza con quedarse con las primeras.
 */
export async function decidirDestinos(frase: string): Promise<Decision[]> {
  const { datos } = await completarJSON({
    modelo: MODELO_CHICO,
    sistema: SISTEMA,
    usuario: frase,
    esquema: planSchema,
    // Consistencia, no creatividad: la misma frase tiene que ir siempre
    // al mismo lado.
    temperatura: 0,
    // Alcanzaba 120 para una decisión sola; tres entran justo en 300.
    // Quedarse corto no degrada la respuesta: la trunca, no valida contra
    // el esquema y se pierde la llamada entera.
    maxTokens: 300,
    etiqueta: "recepcionista",
  });

  return datos.acciones.slice(0, MAX_ACCIONES);
}
