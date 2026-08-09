import { z } from "zod";

/**
 * Los destinos posibles del recepcionista.
 *
 * `movimientos` está desde ahora aunque su agente llegue en la ola 2: si
 * no estuviera, "pagué 20 usd de Claude" caería en `desconocido` y el
 * recepcionista quedaría mintiendo sobre lo que la app entiende. Con el
 * destino declarado, el despacho contesta "todavía no, usá el formulario",
 * que es la verdad.
 */
export const DESTINOS = [
  "consultas",
  "buscador",
  "estudio",
  "retro",
  "lecciones_tema",
  "suscripciones",
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
});

export type Decision = z.infer<typeof decisionSchema>;

/** Debajo de esto el recepcionista pregunta en vez de adivinar. */
export const UMBRAL_CONFIANZA = 0.6;

/**
 * Lo que la caja termina mostrando. Unión discriminada para que el
 * componente no tenga que adivinar qué recibió.
 */
export type RespuestaAgente =
  | { clase: "texto"; destino: Destino; titulo: string; cuerpo: string }
  | {
      clase: "lista";
      destino: Destino;
      titulo: string;
      items: { titulo: string; detalle: string }[];
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
