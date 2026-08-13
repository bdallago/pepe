import "server-only";

import { z } from "zod";

import {
  MODELO_RAZONADOR,
  completarJSON,
  type PromptDeclarado,
} from "@/lib/llm";
import { sumarHoras, type TipoCliente } from "@/lib/presupuestos";
import type { SupabaseClient } from "@/lib/supabase/server";

/**
 * Estimación de esfuerzo de un presupuesto (etapa 2 del spec de
 * presupuestos).
 *
 * Beno pega el pedido de un cliente y el modelo devuelve **una lista de
 * entregables con horas**, los supuestos sobre los que estimó y las
 * preguntas que hay que hacer antes de mandar nada.
 *
 * Tres cosas que definen este módulo y conviene no dar vuelta:
 *
 * 1. **El modelo no pone precios.** Devuelve horas y nada más. El precio
 *    lo calcula `src/lib/presupuestos.ts` multiplicando por la tarifa de
 *    Beno y por el multiplicador del tipo de cliente. Que el modelo no
 *    sepa la tarifa es lo que hace imposible que la "ajuste".
 * 2. **No escribe nada.** Ni en `quotes`, ni en `quote_items`, ni en
 *    `inbox`. Vuelve a pantalla como borrador editable y la fila nace
 *    recién con "Guardar", igual que la retro (`lib/retro.ts`). No pasa
 *    por la bandeja porque hay alguien mirando en el momento en que se
 *    propone, que es el mismo criterio de `AGENTS.md` §6.c para el
 *    clasificador de movimientos.
 * 3. **Cada entregable trae un `ancla`: una cita literal del pedido.** Y
 *    acá, a diferencia de la retro y de las sugerencias, el ancla **se
 *    verifica por código**: el pedido entero es un string que la app
 *    tiene, así que se comprueba que la cita aparezca de verdad adentro.
 *    Lo que no verifica se marca, no se descarta.
 *
 * Regla 7: si Groq está caído o sin cuota, esto lanza `ErrorLLM` y el
 * route handler lo traduce a un aviso discreto. **Cargar un presupuesto a
 * mano sigue andando igual**: el formulario es el mismo con la lista
 * vacía.
 */

type Cliente = SupabaseClient;

/**
 * Techo del pedido que entra al prompt.
 *
 * ~2000 tokens con el `CHARS_POR_TOKEN = 3` de `lib/llm.ts`. Si el pedido
 * pasa de acá se recorta y **se avisa** (`pedido_recortado`): un
 * presupuesto armado sobre medio pedido, en silencio, es peor que
 * ninguno. Trocear pedidos largos —un spec de 30 páginas son ~95.000
 * caracteres— es el trabajo del pase retomable de adjuntos, no de acá.
 */
export const PRESUPUESTO_PEDIDO_CHARS = 6_000;

/** Cuántos entregables se le piden como máximo. */
const MAX_ENTREGABLES = 12;

/**
 * Techo de horas por ítem, y no es prolijidad: es el reflejo en el
 * esquema de la regla "no estimes el proyecto entero de una". Un
 * entregable de 500 horas es el proyecto sin partir, disfrazado de ítem.
 *
 * **Qué pasa cuando el modelo se pasa:** el objeto entero no valida y
 * `completarJSON` lanza `ErrorLLM` de tipo `esquema` **con la respuesta
 * cruda adentro**. O sea que se pierde la estimación completa, no un
 * ítem. Es a propósito y es lo que pide el spec: *"que no valide es
 * preferible a que llegue"*. Un modelo que devuelve un ítem de 500 horas
 * ignoró la regla de partir en entregables discutibles, así que el resto
 * de esa lista tampoco es confiable. El costo es apretar el botón de
 * nuevo; el de la alternativa —dejarlo pasar marcado— es un número
 * enorme adentro de un documento que se manda a un cliente.
 */
const HORAS_MAX_POR_ITEM = 400;

/** Piso de horas por ítem. Media hora es lo más chico que se cotiza. */
const HORAS_MIN_POR_ITEM = 0.5;

/**
 * Lo que se le **pide** al modelo de largo de cita. Más que esto ya no es
 * una cita, es un párrafo.
 */
const ANCLA_CHARS_PEDIDOS = 200;

/**
 * Lo que **acepta el esquema**, que no es lo mismo, y la diferencia salió
 * de medir.
 *
 * Con el techo en 200 duro, el pedido largo de prueba del 2026-08-10 se
 * perdió entero: dos de sus seis citas medían 246 y 226 caracteres
 * porque el cliente había escrito ese punto en dos oraciones, y las dos
 * eran **literales y correctas**. Perder una estimación de seis
 * entregables buenos porque una cita se pasó de 46 caracteres es el
 * peor negocio posible.
 *
 * El largo del ancla es cosmético: es una cita que se muestra al lado
 * del ítem. Distinto del techo de horas, que es semántico y por eso sí
 * tiene que hacer fallar la llamada. La cita **no se recorta**: se
 * guarda tal cual, porque es lo único que hace verificable el ítem.
 */
const ANCLA_MAX_CHARS = 400;

export const CONFIANZAS = ["alta", "media", "baja"] as const;
export type Confianza = (typeof CONFIANZAS)[number];

const respuestaSchema = z.object({
  resumen_alcance: z.string().trim().min(1).max(1200),
  entregables: z
    .array(
      z.object({
        titulo: z.string().trim().min(1).max(160),
        detalle: z.string().trim().max(600),
        horas: z.number().min(HORAS_MIN_POR_ITEM).max(HORAS_MAX_POR_ITEM),
        ancla: z.string().trim().min(1).max(ANCLA_MAX_CHARS),
        confianza: z.enum(CONFIANZAS),
      }),
    )
    // **Sin piso: la lista vacía es una respuesta válida**, y esto
    // también salió de medir. Con `min(1)`, el pedido de prueba de una
    // línea ("hola, necesito una app, me pasás presupuesto?") hacía
    // exactamente lo que se le pide —lista vacía y seis preguntas— y el
    // esquema lo tiraba a la basura como si el modelo hubiera fallado.
    // El caso que el spec quiere que ande bien es justamente ese: sin
    // información no se inventan entregables, se pregunta.
    .max(MAX_ENTREGABLES),
  supuestos: z.array(z.string().trim().min(1).max(300)).max(8),
  preguntas: z.array(z.string().trim().min(1).max(300)).max(6),
});

const SISTEMA = `Sos quien estima el ESFUERZO de un trabajo de software a partir del pedido de un cliente, para alguien que trabaja solo y que va a mandar ese presupuesto con su nombre.

Te dan UN texto: el pedido, tal como llegó. Nada más. No hay un proyecto anterior, no hay una conversación previa, no hay un brief que no te pasaron.

Devolvés una lista de entregables con las HORAS de trabajo de cada uno, los supuestos sobre los que estimaste y las preguntas que hay que hacerle al cliente antes de mandar el presupuesto.

**Vos no ponés el precio.** La app multiplica tus horas por la tarifa de él y por el tipo de cliente. Si escribís un monto, una moneda o una tarifa por hora, el presupuesto sale mal.

Regla número uno, y la que más se rompe sola: **todo entregable que listes tiene que estar pedido en el texto que te di.** Errores concretos que NO tenés que cometer:

1. **Inventar entregables que el pedido no menciona.** Nada de "diseño de identidad", "capacitación al equipo", "migración de datos", "panel de métricas" ni "documentación técnica" si el pedido no los pide. Si te parece que falta algo, va en "preguntas", nunca en la lista de entregables.
2. **Poner precios, montos, tarifas, descuentos o moneda.** No los sabés y no es tu trabajo. Devolvés horas y nada más.
3. **Nombrar tecnologías, frameworks, servicios o decisiones de arquitectura que el pedido no nombre.** Si no dice con qué está hecho ni con qué hay que hacerlo, no digas "React", "WordPress", "Postgres", "AWS", "microservicios" ni "API REST". Si el stack cambia la estimación y no está escrito, eso es una pregunta.
4. **Hablar de semanas, meses, plazos, fechas de entrega, hitos o cronograma.** Estimás esfuerzo, no calendario. Cuántas semanas son esas horas depende de cuántas horas por semana le dedique él, y ese dato no te lo dieron.
5. **Dar por hecho que el diseño está resuelto, y dar por hecho que no lo está.** Si el pedido no dice si hay maquetas, identidad visual o un diseño aprobado, no metas horas de diseño ni las descuentes: va en "preguntas".
6. **Dar por incluido soporte, mantenimiento, hosting, dominio, garantía o capacitación.** Si el pedido no habla de eso, no existe. Como mucho se nombra en "supuestos" como lo que queda afuera; nunca como un entregable con horas.
7. **Inventar cantidades.** "5 pantallas", "3 integraciones", "unos 200 productos": si el número no está escrito en el pedido, no está.
8. **Dar por sentado que el cliente aporta algo** —contenido, textos, fotos, accesos, credenciales, datos— si el pedido no lo dice. Eso va en "supuestos", que es justamente para lo que estás asumiendo.
9. **Comparar con otros proyectos, con "lo que suele llevar", con "lo que se cobra en el mercado" o con estándares de la industria.** No tenés esos datos y el que va a hacer el trabajo tiene su propia velocidad. Estimás ESTE pedido.
10. **Estimar lo que no entendiste.** Si una parte del pedido es ambigua, va en "preguntas" citando la parte ambigua, no en un ítem con horas inventadas.
11. **Redondear para arriba "por las dudas".** El margen lo pone él después. Si vos también lo ponés, se cuenta dos veces y el presupuesto se va de precio sin que nadie haya decidido eso.
12. **Estimar el proyecto entero de una.** Un solo ítem de 200 horas no es una estimación, es un número. Partilo en entregables que se puedan discutir de a uno. Ningún ítem puede pasar de ${HORAS_MAX_POR_ITEM} horas.

Ante la duda, menos ítems y más preguntas. Una lista corta y anclada vale más que una larga y adornada.

**Y la lista de entregables PUEDE VENIR VACÍA.** Si el pedido no alcanza para partirlo en cosas concretas —"necesito una app", "un sistema para el depósito"—, no armes un ítem que repita el pedido con horas al lado: eso no es una estimación, es el pedido con un número inventado. Devolvés la lista de entregables vacía, el resumen de lo poco que se entiende y todas las preguntas que hagan falta. Es una respuesta correcta y es la más útil de todas, porque lo que hay que hacer con ese pedido es contestarle al cliente, no cotizarlo.

**El título de un entregable dice QUÉ SE ENTREGA, con nombre y apellido, no un rótulo de etapa.** "Desarrollo backend", "Frontend", "Testing y QA" y "Puesta en producción" son rótulos: podrían estar en cualquier presupuesto de cualquier proyecto, y por eso no sirven para ninguno. "Endpoint de importación del CSV de productos, con validación y reporte de errores" es un entregable. Si el título que escribiste sirve tal cual para otro proyecto distinto, está mal.

**Cada entregable lleva un campo "ancla" con la CITA LITERAL del pedido en la que te apoyás**: copiada tal cual, sin reescribirla, sin corregirle la ortografía, sin arreglarle las mayúsculas y sin traducirla. Tiene que ser un fragmento continuo del texto —nada de pegar dos pedazos separados con puntos suspensivos— de unos ${ANCLA_CHARS_PEDIDOS} caracteres; si la parte que justifica el entregable es más larga, copiá el pedazo que más importa, pero copialo entero y sin tocar. **Se comprueba automáticamente que esa cita esté adentro del pedido.** Si no podés copiar una frase del pedido que justifique el entregable, el entregable no va.

En "detalle" decís qué incluye el entregable, con las palabras del pedido. En "confianza" ponés "alta" si el pedido describe eso con precisión, "media" si se entiende pero falta detalle, y "baja" si estás estimando algo apenas esbozado (y entonces casi seguro tenés que dejar una pregunta al respecto).

Escribí en español rioplatense, sin emojis y sin muletillas de asistente.

Respondé SOLO un objeto JSON con esta forma exacta:
{
  "resumen_alcance": string (2 a 5 oraciones, qué se va a hacer, con las palabras del pedido),
  "entregables": [
    {
      "titulo": string (qué se entrega, máx 160 caracteres),
      "detalle": string (qué incluye, 1 a 3 oraciones),
      "horas": number (entre ${HORAS_MIN_POR_ITEM} y ${HORAS_MAX_POR_ITEM}),
      "ancla": string (cita literal del pedido, de unos ${ANCLA_CHARS_PEDIDOS} caracteres),
      "confianza": "alta" | "media" | "baja"
    }
  ],
  "supuestos": [string] (hasta 8; lo que estás asumiendo y no está escrito),
  "preguntas": [string] (hasta 6; lo que hay que preguntarle al cliente)
}`;

/**
 * El prompt de la estimación, declarado.
 *
 * Su juez es el único que **ya tenía media red en producción**: el chequeo
 * mecánico del ancla que corre más abajo y que decide
 * `ancla_verificada`. El arnés cobra lo que ese chequeo no cobra —que
 * ninguna hora quede en cero, que el resumen use las palabras del pedido y
 * que no aparezcan números que el pedido no traía—, porque lo que sale de
 * acá termina en un PDF con el nombre de Beno.
 *
 * ⚠ Y sigue valiendo lo de siempre: **el precio no lo calcula el modelo.**
 * Esto devuelve horas; el monto lo hace la app con la tarifa de Ajustes.
 */
export const PROMPT_ESTIMACION: PromptDeclarado<
  z.infer<typeof respuestaSchema>
> = {
  modelo: MODELO_RAZONADOR,
  sistema: SISTEMA,
  esquema: respuestaSchema,
  etiqueta: "presupuesto-estimacion",
  // Más baja que la retro (0.4): acá inventar cuesta plata.
  temperatura: 0.3,
  // El enemigo es la generalidad, igual que en 6.3: "Desarrollo backend,
  // 40 horas" es un rótulo con un número al lado, no una estimación, y con
  // los modelos sin razonamiento el techo era el modelo y no el prompt.
  esfuerzo: "medium",
  // Los tokens de razonamiento salen de acá adentro (medidos en 2668 con
  // `medium` en 6.3) y la salida son hasta doce entregables con detalle y
  // cita, más supuestos y preguntas. La retro usa el mismo número.
  //
  // ⚠ Con esto la llamada NO entra en la ventana de un minuto: sistema
  // (~1500) + pedido (≤ 2000) + maxTokens (4500) ≈ 8000 contra el techo de
  // 7300 que `lib/llm.ts` le da al razonador, así que dispara la salida de
  // emergencia `noEntraNunca` y espera la ventana. Está aceptado: recortar
  // `maxTokens` para que entre mete la salida al borde del truncado, y
  // truncar no degrada la respuesta —la pierde entera—. Esto corre unas
  // pocas veces por año. Si algún día llegara un 429 de verdad, lo que se
  // baja es `PRESUPUESTO_PEDIDO_CHARS`, no esto: la entrada recortada se
  // avisa en pantalla, la salida truncada se pierde en silencio.
  maxTokens: 4500,
  // Razonamiento con salida larga. El timeout por defecto se le queda
  // corto, igual que en la retro.
  timeoutMs: 180_000,
};

export interface OpcionesEstimacion {
  /** El pedido del cliente, tal como llegó. Es lo que citan las anclas. */
  pedidoTexto: string;
  /**
   * El tipo de cliente del presupuesto.
   *
   * ⚠ **No se le manda al modelo, y es a propósito.** El tipo de cliente
   * cambia el PRECIO —vía el multiplicador de `lib/presupuestos.ts`—, no
   * el trabajo: las horas de escribir un importador de CSV son las mismas
   * para un emprendedor que para una empresa. Si además se lo contáramos
   * al modelo, lo más probable es que inflara las horas para el cliente
   * grande y el ajuste se contaría dos veces, que es exactamente lo que
   * prohíbe la regla 11 del prompt.
   *
   * Está en la firma porque es parte de la entrada del presupuesto y
   * porque quien llama ya lo tiene a mano; que no viaje al prompt es la
   * decisión, no un olvido.
   */
  tipoCliente: TipoCliente;
}

export interface EntregableEstimado {
  titulo: string;
  detalle: string;
  horas: number;
  /** La cita del pedido en la que se apoya la estimación. */
  ancla: string;
  /** Si esa cita aparece de verdad adentro del pedido. Se comprueba acá. */
  ancla_verificada: boolean;
  confianza: Confianza;
}

export interface EstimacionEsfuerzo {
  resumen_alcance: string;
  entregables: EntregableEstimado[];
  supuestos: string[];
  preguntas: string[];
  /** Suma de las horas de los entregables, con el redondeo del módulo puro. */
  horas_totales: number;
  /** Cuántas anclas pasaron el chequeo de substring. */
  anclas_verificadas: number;
  /** Cuántas no. Cada una viene marcada en su ítem. */
  anclas_sin_verificar: number;
  /**
   * Más de la mitad de los ítems tiene el ancla sin verificar.
   *
   * La pantalla lo dice arriba de todo y sugiere rehacer la estimación:
   * es la señal de que el modelo se fue de tema entero, y un ítem a la
   * vez no la muestra.
   */
  revisar_todo: boolean;
  /** El pedido no entró completo en el prompt. La pantalla lo dice. */
  pedido_recortado: boolean;
  /** Cuántos caracteres del pedido se le pasaron al modelo. */
  pedido_chars: number;
  /** Qué modelo estimó. Va a `quotes.modelo` al guardar. */
  modelo: string;
}

/**
 * Estima el esfuerzo de un pedido. **No escribe nada.**
 *
 * Lanza `ErrorLLM` si el modelo falla o si la salida no valida: no hay
 * nada a medio escribir que limpiar, y el route handler lo traduce a un
 * aviso discreto para que Beno cargue el presupuesto a mano.
 *
 * `supabase` y `userId` están en la firma para que este módulo tenga la
 * misma forma que el resto de las features del proyecto y para el día que
 * haga falta leer algo de `settings` —el "factor personal" con el que
 * calibrar horas sistemáticamente altas o bajas está anotado en el spec
 * y todavía no existe—. Hoy la estimación sale entera del texto del
 * pedido, así que **no se lee ni se escribe una sola fila**.
 */
export async function estimarEsfuerzo(
  supabase: Cliente,
  userId: string,
  opciones: OpcionesEstimacion,
): Promise<EstimacionEsfuerzo> {
  const pedidoCompleto = opciones.pedidoTexto.trim();
  if (!pedidoCompleto) {
    throw new Error("El pedido está vacío: no hay nada que estimar.");
  }

  const recortado = pedidoCompleto.length > PRESUPUESTO_PEDIDO_CHARS;
  const pedido = recortado
    ? pedidoCompleto.slice(0, PRESUPUESTO_PEDIDO_CHARS)
    : pedidoCompleto;

  const usuario = armarUsuario(pedido, recortado);

  const { datos, uso } = await completarJSON({ ...PROMPT_ESTIMACION, usuario });

  // ── El chequeo mecánico del ancla ──────────────────────────────
  //
  // Se verifica contra el pedido COMPLETO y no contra el recortado: una
  // cita que está en el texto que Beno pegó es una cita real, y el
  // modelo solo pudo haberla sacado de lo que vio igual.
  const pedidoNormalizado = normalizarParaAncla(pedidoCompleto);

  const entregables: EntregableEstimado[] = datos.entregables.map((e) => ({
    titulo: e.titulo,
    detalle: e.detalle,
    horas: e.horas,
    ancla: e.ancla,
    ancla_verificada: contieneAncla(pedidoNormalizado, e.ancla),
    confianza: e.confianza,
  }));

  const verificadas = entregables.filter((e) => e.ancla_verificada).length;
  const sinVerificar = entregables.length - verificadas;

  return {
    resumen_alcance: datos.resumen_alcance,
    entregables,
    supuestos: datos.supuestos,
    preguntas: datos.preguntas,
    horas_totales: sumarHoras(entregables),
    anclas_verificadas: verificadas,
    anclas_sin_verificar: sinVerificar,
    revisar_todo: sinVerificar * 2 > entregables.length,
    pedido_recortado: recortado,
    pedido_chars: pedido.length,
    modelo: uso.modelo,
  };
}

/**
 * El pedido, con lo mínimo alrededor.
 *
 * El texto va sin tocar —ni recortado por línea, ni normalizado, ni
 * reescrito— porque las anclas tienen que ser citas literales de esto y
 * cualquier retoque de acá las volvería imposibles de verificar.
 */
function armarUsuario(pedido: string, recortado: boolean): string {
  const partes = ["Pedido del cliente, tal como llegó:", "---", pedido, "---"];

  if (recortado) {
    partes.push(
      "El pedido venía más largo y se cortó acá por espacio. No estimes" +
        " lo que no llegaste a leer: dejá anotado en las preguntas que" +
        " falta el final del pedido.",
    );
  }

  return partes.join("\n");
}

/**
 * ¿La cita está de verdad adentro del pedido?
 *
 * Es la diferencia entre esta feature y el `ancla` de `lib/sugerencias.ts`
 * o el `dato` de las observaciones: allá la cita se lee y se juzga a ojo
 * porque la fuente son cien filas de la base; acá la fuente es **un
 * string que la app tiene entero**, así que se testea.
 *
 * Se compara normalizado (minúsculas, sin acentos, espacios colapsados y
 * comillas y guiones tipográficos llevados a ASCII) porque esas cuatro
 * cosas son las que un modelo "arregla" sin querer al copiar, y ninguna
 * cambia el sentido de la cita. Lo que sí cambia el sentido —cambiar una
 * palabra, resumir la frase, unir dos pedazos— no pasa el chequeo, que es
 * exactamente lo que se quiere atrapar.
 */
export function contieneAncla(pedidoNormalizado: string, ancla: string): boolean {
  const buscada = normalizarParaAncla(ancla);
  if (!buscada) return false;
  return pedidoNormalizado.includes(buscada);
}

/**
 * Normalización para comparar citas.
 *
 * ⚠ No es la `normalizar()` de `retro.ts`, que arma un slug: esa
 * reemplaza todo lo que no sea alfanumérico por guiones y corta en 80
 * caracteres, así que sirve para una `clave_dedupe` y no para buscar una
 * frase adentro de un texto de 6000 caracteres.
 */
export function normalizarParaAncla(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // Comillas y guiones tipográficos a ASCII: es lo que más "arregla"
    // un modelo al copiar una frase, y no cambia el sentido de la cita.
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[   ]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
