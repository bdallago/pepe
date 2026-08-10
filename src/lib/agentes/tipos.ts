import { z } from "zod";

/**
 * Los destinos posibles del recepcionista.
 *
 * `movimientos` está desde ahora aunque su agente llegue en la ola 2: si
 * no estuviera, "pagué 20 usd de Claude" caería en `desconocido` y el
 * recepcionista quedaría mintiendo sobre lo que la app entiende. Con el
 * destino declarado, el despacho contesta "todavía no, usá el formulario",
 * que es la verdad.
 *
 * `roadmap` y `estudio` son dos preguntas distintas y por un tiempo
 * compartieron destino: "qué me toca hoy" terminaba llamando a 6.4, que
 * INVENTA temas nuevos con el razonador. Son cosas opuestas — una lee el
 * plan que ya está armado (sin modelo), la otra propone lo que todavía no
 * existe (con el modelo más caro de la app)— así que van separadas.
 *
 * `tema_estudio` es el cuarto de esa familia y salió de medir cómo
 * escribe Beno de verdad: "quiero aprender sobre tal cosa basado en tal
 * proyecto" no lo cubría ninguno de los otros tres. `roadmap` LEE el
 * plan, `estudio` PROPONE lo que Beno no pidió y `lecciones_tema` mira
 * para atrás, a lo que ya vivió. Acá el tema lo trae él y lo que pide es
 * que se lo AGREGUEN al plan.
 */
export const DESTINOS = [
  "consultas",
  "buscador",
  "roadmap",
  "estudio",
  "tema_estudio",
  "retro",
  "lecciones_tema",
  "suscripciones",
  "vencimientos",
  "movimientos",
  "desconocido",
] as const;

export type Destino = (typeof DESTINOS)[number];

/** Lo que devuelve el recepcionista. Se valida contra la salida del modelo. */
export const decisionSchema = z.object({
  destino: z.enum(DESTINOS),
  /**
   * El dato concreto sobre el que trabaja el especialista: el nombre del
   * proyecto para una retro, el tema para generar lecciones, la consulta
   * para el buscador. Texto libre a propósito: resolverlo a un id es
   * trabajo determinístico, no del modelo.
   */
  argumento: z.string().trim().max(300).nullable(),
  /** 0 a 1. Por debajo de UMBRAL_CONFIANZA se pregunta en vez de derivar. */
  confianza: z.number().min(0).max(1),
  /**
   * Si además de los datos pide interpretación ("analizame", "qué
   * observaciones tenés", "qué ves"). Por ahora lo mira solo `consultas`,
   * que con esto agrega dos o tres observaciones a los números.
   *
   * Lo decide el recepcionista y no un `includes` sobre la frase: el
   * pedido de análisis se escribe de mil maneras y esa es justamente la
   * clase de decisión para la que ya hay un modelo leyendo la frase.
   *
   * Es **opcional**, no `default(false)`: cuando Beno corrige el destino a
   * mano, el handler arma la decisión sin pasar por el modelo y no hay
   * análisis que pedir. Undefined y false valen lo mismo acá.
   */
  analizar: z.boolean().optional(),
});

export type Decision = z.infer<typeof decisionSchema>;

/**
 * Cuántas acciones como mucho se sacan de una sola frase.
 *
 * Tres, y el número sale de tres cosas distintas:
 *
 * 1. **La frase más larga que Beno escribió de verdad pide tres cosas**
 *    ("anotalo en la bitácora, generame lecciones sobre eso, y tenelo
 *    para la retro"). Cuatro sería un tope que nada real toca.
 * 2. **Cada acción puede costar una llamada al modelo**, y dos de ellas
 *    al razonador (`retro`, `lecciones_tema`), que son las más lentas y
 *    las más caras en tokens de toda la app. Tres encadenadas ya son
 *    minutos de espera y buena parte del techo por minuto de Groq.
 * 3. Sin tope, **una frase mal leída se abre en ocho llamadas**, cada una
 *    dejando propuestas en la bandeja. Escribir de más es barato para el
 *    modelo y caro de limpiar para Beno.
 *
 * El tope se aplica **recortando** la lista, no rechazándola: ver
 * `planSchema`.
 */
export const MAX_ACCIONES = 3;

/**
 * Lo que devuelve el recepcionista: una lista **ordenada** de decisiones.
 *
 * Es una lista y no una decisión sola porque una frase puede pedir varias
 * cosas ("anotalo en la bitácora y generame lecciones sobre eso"), y
 * quedarse con una sola era descartar el resto en silencio. Igual, la
 * abrumadora mayoría de las frases trae **un solo elemento**, y el
 * despachador sigue recibiendo una `Decision` por vez.
 *
 * El tope de `MAX_ACCIONES` **no** está acá adentro a propósito. Un
 * `.max()` convertiría una lista de cuatro en un error de esquema, o sea
 * en una llamada perdida entera; recortar en el borde deja las tres
 * primeras, que son las que Beno escribió primero. Se recorta en
 * `decidirDestinos()`.
 */
export const planSchema = z.object({
  acciones: z.array(decisionSchema).min(1),
});

export type Plan = z.infer<typeof planSchema>;

/** Debajo de esto el recepcionista pregunta en vez de adivinar. */
export const UMBRAL_CONFIANZA = 0.6;

/**
 * Lo que contesta **una** acción. Unión discriminada para que el
 * componente no tenga que adivinar qué recibió.
 *
 * Es lo que devuelve `despachar()`, y es lo que va adentro de cada paso
 * de una cadena. Que no incluya `cadena` no es un olvido: una cadena de
 * cadenas no significa nada y el tipo lo impide.
 */
export type RespuestaSimple =
  | {
      clase: "texto";
      destino: Destino;
      titulo: string;
      cuerpo: string;
      /**
       * Interpretación de los números de `cuerpo`, cuando Beno la pidió.
       *
       * Va como campo aparte y no pegada al cuerpo por dos motivos. Uno:
       * el cuerpo se renderiza con `cifra` (Fira Code tabular) porque ahí
       * caen montos que tienen que alinear en vertical, y la prosa en
       * monoespaciada se lee mal. Dos: el `dato` es la salvaguarda contra
       * la observación inventada —el número que la sostiene— y funciona
       * solo si se puede leer separado, igual que el `ancla` de las
       * sugerencias de estudio.
       */
      observaciones?: { texto: string; dato: string }[];
    }
  | {
      clase: "lista";
      destino: Destino;
      titulo: string;
      items: {
        titulo: string;
        detalle: string;
        /**
         * El dato concreto que justifica el ítem, cuando lo hay. Nace en
         * las sugerencias de estudio (6.4), donde es la salvaguarda
         * contra el consejo genérico: va como campo aparte —y no pegado
         * al detalle— para que la pantalla lo pueda destacar igual que
         * la de Sugerencias. Si se mezcla con la prosa, deja de servir
         * para descartar de un vistazo, que es todo su punto.
         */
        ancla?: string;
      }[];
    }
  | {
      clase: "propuestas";
      destino: Destino;
      titulo: string;
      cuantas: number;
      /** Adónde ir a confirmarlas. */
      href: string;
    }
  | {
      clase: "pregunta";
      titulo: string;
      opciones: { etiqueta: string; destino: Destino; argumento: string | null }[];
    }
  | { clase: "aviso"; titulo: string; cuerpo: string };

/**
 * Lo que la caja termina mostrando: una respuesta sola, o la cadena de
 * varias cuando la frase pedía varias cosas.
 *
 * Con una sola acción —el caso normal— se devuelve la `RespuestaSimple`
 * pelada y la pantalla se ve exactamente igual que antes. La variante
 * `cadena` aparece **solo** cuando hubo más de una acción.
 */
export type RespuestaAgente =
  | RespuestaSimple
  | {
      clase: "cadena";
      /** Dice de entrada cuántas se hicieron y cuántas no. */
      titulo: string;
      /** En el mismo orden en que Beno las escribió. */
      pasos: { destino: Destino; respuesta: RespuestaSimple }[];
      /**
       * Lo que quedó sin ejecutar porque la cadena frenó en una pregunta.
       *
       * Va explícito y se muestra: la mitad de las acciones de Pepe
       * escriben algo (propuestas en la bandeja, o una sesión), así que
       * "esto no lo hice" es información, no relleno.
       */
      pendientes: { destino: Destino; argumento: string | null }[];
    };
