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

/** Debajo de esto el recepcionista pregunta en vez de adivinar. */
export const UMBRAL_CONFIANZA = 0.6;

/**
 * Lo que la caja termina mostrando. Unión discriminada para que el
 * componente no tenga que adivinar qué recibió.
 */
export type RespuestaAgente =
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
