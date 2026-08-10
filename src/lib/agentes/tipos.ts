import { z } from "zod";

import type {
  Moneda,
  TipoAdjunto,
  TipoMovimiento,
} from "@/lib/supabase/database.types";

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
 *
 * `bitacora` es el par que le faltaba a `buscador`, y su ausencia no era
 * neutral: hasta que existió, "anotalo en la bitácora" caía en `buscador`,
 * o sea que a un pedido de ESCRIBIR se le contestaba una búsqueda. Son la
 * misma tabla y las dos puntas opuestas — una guarda lo que Beno acaba de
 * vivir, la otra sale a buscar lo que ya guardó—. Su agente transcribe
 * literal y escribe directo; el porqué largo está en `agentes/bitacora.ts`.
 *
 * `presupuesto` es el segundo vecino incómodo de `buscador`, y el choque
 * estaba escrito en el prompt: una línea manda "presupuestos" a `buscador`
 * a propósito, porque "¿qué anotaciones tengo sobre gestión de
 * presupuestos?" pregunta por lo que Beno ESCRIBIÓ. Acá el pedido es el
 * opuesto: ARMAR uno para un cliente. Se separan por verbo, no por tema,
 * igual que `tema_estudio` y `lecciones_tema`.
 *
 * Su rama **no estima**: lleva a la pantalla de alta con el pedido
 * pegado y el botón lo aprieta Beno. Es la misma decisión que
 * `movimientos`, y por el mismo motivo — la estimación es producción de un
 * modelo que termina en un documento que se le manda a un cliente, así que
 * no arranca sola desde una caja de texto.
 */
export const DESTINOS = [
  "consultas",
  "buscador",
  "bitacora",
  "roadmap",
  "estudio",
  "tema_estudio",
  "retro",
  "lecciones_tema",
  "suscripciones",
  "vencimientos",
  "movimientos",
  "presupuesto",
  "desconocido",
] as const;

export type Destino = (typeof DESTINOS)[number];

/** Lo que devuelve el recepcionista. Se valida contra la salida del modelo. */
const decisionBase = z.object({
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

/**
 * Nombres con los que el modelo chico escribe, a veces, la clave
 * `confianza`.
 *
 * **Esto se arregla acá y no en el prompt, a propósito.** El prompt del
 * recepcionista es de vidrio (ver el bloque largo de `recepcionista.ts`):
 * hay cuatro incidentes medidos en los que agregarle texto rompió casos
 * que ni siquiera nombraba —dos anclas ambiguas que se fueron de 0.3 a
 * 0.8, y el argumento de una frase telegráfica que volvió reescrito y sin
 * la fecha—. Uno de esos tres intentos descartados fue **exactamente**
 * aclararle en la línea del JSON cómo se escriben las cuatro claves: no
 * arregló el `"confianca"` y sí rompió el argumento literal. Está
 * revertido.
 *
 * El caso medido el 2026-08-10 con "mirá, te paso capturas para que veas
 * esto que me contestó un cliente": el modelo **elige bien** (destino
 * `desconocido`, confianza baja) y lo único que sale mal es cómo escribe
 * la clave. Se reprodujo en tres corridas con temperatura 0. Tirar una
 * decisión correcta por una letra es el peor cambio posible por el precio
 * más caro posible.
 *
 * Entonces: el esquema tolera el nombre de la clave, y **nada más**. Si
 * la confianza no viene, sigue fallando igual que antes — lo que se
 * perdona es la ortografía, no la ausencia del dato con el que se decide
 * si preguntar o derivar.
 */
const ALIAS_CONFIANZA = ["confianca", "confiança", "confidence"] as const;

/**
 * Renombra el alias a `confianza` antes de validar. Si ya viene bien, o
 * si no viene de ninguna forma, devuelve el objeto tal cual y decide el
 * esquema.
 */
function normalizarClavesDecision(valor: unknown): unknown {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    return valor;
  }

  const objeto = valor as Record<string, unknown>;
  if (objeto.confianza !== undefined) return objeto;

  const alias = ALIAS_CONFIANZA.find((clave) => objeto[clave] !== undefined);
  if (!alias) return objeto;

  const { [alias]: confianza, ...resto } = objeto;
  return { ...resto, confianza };
}

export const decisionSchema = z.preprocess(
  normalizarClavesDecision,
  decisionBase,
);

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
  | {
      /**
       * Falta un dato y **hay que escribirlo**, no elegirlo.
       *
       * Es una clase aparte y no una `pregunta` con botones, y la razón es
       * que un monto no tiene opciones: los valores posibles son infinitos.
       * `pregunta` sirve cuando la respuesta es una de un puñado de cosas
       * que la app ya conoce (a qué proyecto, a qué track, a qué
       * especialista); acá el valor lo trae Beno. Forzarlo dentro de
       * `pregunta` habría dejado un botón "otra" que no puede hacer nada.
       *
       * Lo que Beno escribe se mete en el hueco de `plantilla` y vuelve
       * como una frase telegráfica completa, así que la segunda vuelta la
       * resuelve el regex **sin gastar otra llamada al modelo** y sin que
       * él tenga que retipear lo que ya dijo. Eso es todo el punto: si
       * completar un dato cuesta reescribir la frase entera, es más rápido
       * abrir el formulario.
       *
       * Corta la cadena igual que una `pregunta` (ver `cadena.ts`): no se
       * pueden contestar dos cosas a la vez en una caja de una línea.
       */
      clase: "completar";
      destino: Destino;
      titulo: string;
      cuerpo: string;
      /** Qué se espera, para el placeholder del campo. */
      ejemplo: string;
      /** Lo ya entendido, con `{}` donde va lo que falta. */
      plantilla: string;
      /** Atajos de un click. El valor reemplaza al `{}`. */
      opciones?: { etiqueta: string; valor: string }[];
    }
  | {
      /**
       * Un movimiento entendido y listo para confirmar.
       *
       * **No escribe nada**: la caja lo muestra y abre el formulario
       * precargado. Ese formulario es el panel de confirmación que pide la
       * sección 6 del spec —hay alguien mirando en el momento en que se
       * propone—, por eso esto no pasa por la bandeja, igual que el
       * clasificador de `lib/clasificacion.ts`.
       */
      clase: "movimiento";
      destino: Destino;
      titulo: string;
      /** Campo por campo, de dónde salió. Se muestra antes de abrir nada. */
      cuerpo: string;
      precarga: PrecargaMovimiento;
    }
  | {
      /**
       * Un pedido de presupuesto, listo para armar.
       *
       * **Acá no se estimó nada, y eso es la decisión.** La estimación es
       * el razonador con `maxTokens 4500` escribiendo el contenido de un
       * documento que se le manda a un cliente: no puede arrancar sola
       * desde una caja de texto. Esto lleva a la pantalla de alta con el
       * pedido ya pegado, y el botón "Estimar los entregables" lo aprieta
       * Beno — el mismo criterio con el que `movimiento` abre el
       * formulario en vez de guardar.
       *
       * Es una clase aparte y no un `propuestas` porque no hay ninguna
       * propuesta esperando: la caja de `propuestas` dice "te esperan en
       * la bandeja para que confirmes", y acá no hay nada en la bandeja.
       */
      clase: "presupuesto";
      destino: Destino;
      titulo: string;
      cuerpo: string;
      /** `/presupuestos/nuevo`, con el pedido en la query si entró. */
      href: string;
    }
  | {
      /**
       * Archivos guardados y listos para procesar.
       *
       * **No tiene `destino`, y no es un olvido.** Un adjunto no pasa por
       * el recepcionista: el camino lo decide la presencia del archivo y
       * el pase lo decide el MIME, las dos cosas en código y sin modelo
       * (ver `agentes/adjuntos.ts`). Un pie de "¿no era esto?" ofrecería
       * corregir una derivación que nunca hubo.
       *
       * Tampoco trae texto propuesto: cuando esto vuelve, **todavía no se
       * llamó a ningún modelo**. Lo único que pasó es que los archivos
       * quedaron guardados. La pantalla dispara el pase contra
       * `/api/adjuntos/procesar` y lo repite mientras queden restantes,
       * igual que el pase de extracción de la bandeja: un PDF mediano no
       * entra en ningún `maxDuration`.
       */
      clase: "adjuntos";
      titulo: string;
      cuerpo: string;
      items: { id: string; nombre: string; tipo: TipoAdjunto }[];
      /** `false` cuando se guardó el archivo pero no hay pase que correr. */
      procesar: boolean;
      /** Adónde ir a confirmar lo que salga. */
      href: string;
    }
  | { clase: "aviso"; titulo: string; cuerpo: string };

/**
 * Un archivo que el browser **ya subió** a Storage, tal como llega al
 * handler.
 *
 * La subida va del browser directo a Supabase, sin pasar por Next, igual
 * que `comprobante-input.tsx`. Por eso acá viajan metadatos y no bytes: el
 * archivo nunca atraviesa un route handler ni una Server Action, así que
 * ninguna discusión sobre tamaño máximo de request aplica.
 */
export interface AdjuntoSubido {
  /** `<user_id>/<uuid>.<ext>` dentro del bucket `adjuntos`. */
  path: string;
  nombre: string;
  mime: string;
  bytes: number;
}

export const adjuntoSubidoSchema = z.object({
  path: z.string().trim().min(1).max(300),
  nombre: z.string().trim().min(1).max(300),
  mime: z.string().trim().min(1).max(120),
  bytes: z.number().int().positive().max(10 * 1024 * 1024),
});

/**
 * Un movimiento leído de una frase, listo para precargar el formulario.
 *
 * Vive en este módulo —y no en `agentes/movimientos.ts`, que es
 * `server-only`— porque lo consumen los dos lados: el despacho lo arma y
 * `movement-form.tsx` lo recibe.
 *
 * **No trae tasa de cambio, y es a propósito.** El par ARS/USD lo arma el
 * formulario con la cotización de la fecha elegida, que es el único lugar
 * donde se congela (regla 1). Mandar una tasa desde acá sería un segundo
 * lugar donde se decide eso.
 */
export interface PrecargaMovimiento {
  descripcion: string;
  /** Positivo siempre: si es entrada o salida lo dice `tipo`. */
  monto: number;
  /** La que se escribió. El otro campo del formulario es el derivado. */
  moneda: Moneda;
  fecha: string;
  tipo: TipoMovimiento;
  categoryId: string | null;
  /** `null` es compartido, igual que en `movements`. */
  projectId: string | null;
  /**
   * De dónde salió cada campo, ya redactado.
   *
   * No es adorno: es un libro de cuentas y si el modelo lee "15 mil" donde
   * eran 15 y el formulario se ve igual que siempre, se guarda sin mirar.
   * Va como texto y no como un enum porque lo único que hace la pantalla
   * con esto es mostrarlo.
   */
  procedencia: {
    descripcion: string;
    monto: string;
    fecha: string;
    tipo: string;
    categoria: string | null;
    proyecto: string;
  };
}

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
