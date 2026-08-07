import type { SesionCompletada } from "@/lib/aprendizaje";
import type { StudySession } from "@/lib/supabase/database.types";

/**
 * Generador de quiz local: sin IA, sin API key, sin red.
 *
 * Arma preguntas de opción múltiple con los temas YA completados, empezando
 * por los vistos hace más tiempo (repaso espaciado pobre pero honesto). Los
 * distractores salen de otras sesiones del temario, así que son plausibles
 * en vez de obviamente falsos.
 *
 * ⚠️ Es puro salvo por `Math.random()` (el barajado). Eso significa que la
 * misma entrada da salidas distintas en el servidor y en el cliente, así que
 * la generación tiene que dispararse **en el cliente, desde un handler de
 * evento** ("Empezar quiz", "Otra ronda"). Llamarlo durante el render —o en
 * un Server Component— rompe la hidratación.
 *
 * Sin `server-only` justamente porque su lugar es el cliente.
 */

export interface PreguntaQuiz {
  /** Enunciado, puede tener saltos de línea. */
  pregunta: string;
  opciones: string[];
  /** Índice dentro de `opciones` de la respuesta correcta. */
  respuesta: number;
  explicacion: string;
}

/** Lo que necesita una sesión para entrar al quiz. */
export type SesionDeQuiz = Pick<
  StudySession,
  "titulo" | "teoria_texto" | "teoria_link" | "consigna"
>;

function barajar<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dominioDe(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Arma las opciones de una pregunta cuya respuesta es `correcta`, tomando
 * hasta tres distractores distintos del `pool`.
 */
function armarOpciones<T>(
  correcta: T,
  pool: readonly T[],
  etiqueta: (item: T) => string,
): { opciones: string[]; respuesta: number } {
  const correctaLabel = etiqueta(correcta);
  const distractores: string[] = [];
  const vistas = new Set([correctaLabel]);

  for (const otro of barajar(pool)) {
    const label = etiqueta(otro);
    if (!vistas.has(label)) {
      distractores.push(label);
      vistas.add(label);
    }
    if (distractores.length === 3) break;
  }

  const opciones = barajar([correctaLabel, ...distractores]);
  return { opciones, respuesta: opciones.indexOf(correctaLabel) };
}

type TipoDePregunta = (
  sesion: SesionDeQuiz,
  pool: readonly SesionDeQuiz[],
) => PreguntaQuiz | null;

/**
 * Los tres tipos de pregunta. Cada uno devuelve null cuando la sesión no
 * tiene el dato que necesita o no hay distractores suficientes: con menos de
 * cuatro opciones la pregunta se regala sola.
 */
const TIPOS: TipoDePregunta[] = [
  // Teoría → tema
  (sesion, pool) => {
    if (!sesion.teoria_texto) return null;
    const { opciones, respuesta } = armarOpciones(sesion, pool, (x) => x.titulo);
    if (opciones.length < 4) return null;
    return {
      pregunta: `¿A qué tema corresponde esta idea teórica?\n\n“${sesion.teoria_texto}”`,
      opciones,
      respuesta,
      explicacion: `Es el tema: ${sesion.titulo}.`,
    };
  },
  // Consigna → tema
  (sesion, pool) => {
    if (!sesion.consigna) return null;
    const { opciones, respuesta } = armarOpciones(sesion, pool, (x) => x.titulo);
    if (opciones.length < 4) return null;
    return {
      pregunta: `¿De qué tema es esta consigna?\n\n“${sesion.consigna}”`,
      opciones,
      respuesta,
      explicacion: `Corresponde a: ${sesion.titulo}.`,
    };
  },
  // Tema → fuente
  (sesion, pool) => {
    if (!sesion.teoria_link) return null;
    const conLink = pool.filter((x) => x.teoria_link);
    const { opciones, respuesta } = armarOpciones(sesion, conLink, (x) =>
      dominioDe(x.teoria_link ?? ""),
    );
    if (opciones.length < 4) return null;
    return {
      pregunta: `¿Cuál es la fuente teórica del tema “${sesion.titulo}”?`,
      opciones,
      respuesta,
      explicacion: `Fuente: ${dominioDe(sesion.teoria_link)}.`,
    };
  },
];

/**
 * Genera hasta `cantidad` preguntas.
 *
 * @param completadas Sesiones ya terminadas (con `completedOn`), de
 *   `completedSessions()`. Es de donde salen las respuestas correctas.
 * @param todasLasSesiones Todo el temario, para que los distractores no se
 *   limiten a lo ya visto.
 *
 * Llamalo desde un handler de evento del cliente: usa `Math.random()`.
 */
export function generateQuiz(
  completadas: SesionCompletada[],
  todasLasSesiones: SesionDeQuiz[],
  cantidad = 5,
): PreguntaQuiz[] {
  if (completadas.length === 0) return [];

  // Repaso espaciado: primero lo que se vio hace más tiempo.
  const ordenadas = [...completadas].sort((a, b) =>
    a.completedOn.localeCompare(b.completedOn),
  );

  const preguntas: PreguntaQuiz[] = [];
  let tipo = 0;

  for (const sesion of ordenadas) {
    if (preguntas.length >= cantidad) break;
    // Rota el tipo de pregunta para que no salgan todas iguales.
    for (let intento = 0; intento < TIPOS.length; intento++) {
      const pregunta = TIPOS[(tipo + intento) % TIPOS.length](
        sesion,
        todasLasSesiones,
      );
      if (pregunta) {
        preguntas.push(pregunta);
        tipo++;
        break;
      }
    }
  }

  // Con pocos temas completados se reusa el mismo tema con otro tipo de
  // pregunta. El `guardia` corta el caso en que ningún tipo produce nada.
  let guardia = 0;
  while (preguntas.length < cantidad && guardia < 50) {
    const sesion = ordenadas[guardia % ordenadas.length];
    const pregunta = TIPOS[(guardia + tipo) % TIPOS.length](
      sesion,
      todasLasSesiones,
    );
    if (pregunta && !preguntas.some((p) => p.pregunta === pregunta.pregunta)) {
      preguntas.push(pregunta);
    }
    guardia++;
  }

  return preguntas.slice(0, cantidad);
}
