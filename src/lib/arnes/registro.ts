import type { PromptDeclarado } from "@/lib/llm";
import {
  CONTEXTO_ADJUNTO_SINTESIS,
  CONTEXTO_ADJUNTO_TROZO,
  CONTEXTO_CLASIFICACION,
  CONTEXTO_ESTIMACION,
  CONTEXTO_EXTRACCION,
  CONTEXTO_EXTRACCION_OPERATIVA,
  CONTEXTO_GENERACION,
  CONTEXTO_OBSERVACIONES,
  CONTEXTO_RETRO,
  CONTEXTO_SUGERENCIAS,
  CONTEXTO_ZOMBIES,
  FRASES_MOVIMIENTO,
  ruidoPng,
} from "@/lib/arnes/fixtures";
import {
  estaContenido,
  numerosSinRespaldo,
  pareceRotulo,
  tonoDeAsistente,
} from "@/lib/arnes/jueces";

/**
 * Las trece familias de prompt de la app: con qué se les manda y qué tiene
 * que cumplir lo que devuelven.
 *
 * ⚠ **DATOS.** El juicio mecánico compartido está en `jueces.ts`, las
 * entradas en `fixtures.ts` y el disparo en `scripts/medir.mts`. Es el
 * mismo corte que `banco.ts` / `veredicto.ts` / `medir-recepcionista.mts`,
 * que es el único que ya se probó en este repo.
 *
 * ## Por qué el prompt se carga con un import dinámico
 *
 * Los trece módulos son `server-only`, y `npm test` corre **sin**
 * `--conditions=react-server` a propósito: así el runner de tests es
 * también la garantía de que los módulos de dominio —los que el MCP tiene
 * que poder importar— no arrastren nada de Next (AGENTS.md §8). Un import
 * estático acá haría fallar todos los tests.
 *
 * Con el loader dinámico, el test de completitud puede verificar el
 * registro **sin ejecutar** un solo import, y el corredor —que sí corre con
 * la condición puesta— trae el descriptor de producción cuando lo necesita.
 *
 * ## Lo que este registro NO hace
 *
 * No juzga si la respuesta es buena. Juzga que cumpla lo que su prompt
 * promete. Y **ningún juez se afloja para que una corrida dé verde**: si un
 * prompt falla su propia vara, eso es el hallazgo.
 */

export interface CasoDeArnes {
  nombre: string;
  /** El `usuario` que se le manda al prompt. */
  usuario: string;
  /** Imágenes, solo para la familia de capturas. */
  imagenes?: string[];
  /**
   * Qué tiene que cumplir la salida. Devuelve los problemas, uno por
   * string; vacío es pasar.
   */
  juzgar: (salida: unknown, usuario: string) => string[];
}

export interface Familia {
  /** El id que se pasa a `npm run medir <id>`. */
  id: string;
  /** Dónde vive el prompt, relativo a la raíz. Lo cruza el test de completitud. */
  archivo: string;
  /** El nombre del descriptor exportado, para el reporte. */
  descriptor: string;
  /**
   * Cuánto cuesta medirla, para poder avisar antes de gastar el cupo.
   *
   * `razonador` entra **una llamada por minuto** y tiene techo diario de
   * 200 000 tokens; `chico` entra de a dos o tres por minuto.
   */
  clase: "chico" | "razonador" | "vision";
  /**
   * Trae el descriptor de producción. Dinámico por lo de arriba.
   *
   * El doble cast es deliberado y no se puede evitar con elegancia: cada
   * descriptor está tipado con SU esquema de Zod, y `ZodType<Algo>` no es
   * asignable a `ZodType<unknown>` porque el tipo aparece en posición
   * contravariante en `refine`. El corredor solo lee `sistema`, `modelo` y
   * pasa el resto a `completarJSON`, así que perder el tipo acá no pierde
   * nada: el esquema sigue validando en runtime, que es donde importa.
   */
  cargar: () => Promise<PromptDeclarado<unknown>>;
  casos: readonly CasoDeArnes[];
}

/* ────────────────────────────────────────────────────────────
 * Ayudas de los jueces
 * ──────────────────────────────────────────────────────────── */

/** Junta todo el texto de una salida, para los jueces que miran el conjunto. */
function textos(valor: unknown): string {
  if (typeof valor === "string") return valor;
  if (Array.isArray(valor)) return valor.map(textos).join("\n");
  if (valor && typeof valor === "object") {
    return Object.values(valor).map(textos).join("\n");
  }
  return "";
}

/**
 * Los chequeos que se repiten, con el de números **opt-in**.
 *
 * ⚠ **`numerosSinRespaldo` no se aplica a toda la salida, y eso se midió.**
 * La primera corrida real (2026-08-13) lo tenía puesto en todas las
 * familias y produjo tres rojos que eran del juez y no del prompt: un
 * `"60,7 %"` calculado en las observaciones —que es lo que el prompt
 * **pide**—, un `"30"` en la consigna de una sugerencia y otro en una
 * lección de 6.3. Donde el prompt pide **proponer** —las horas de un
 * presupuesto, qué hacer en dos horas, una lección sobre un tema— un número
 * nuevo es la respuesta correcta.
 *
 * Así que cada familia dice **qué texto suyo** tiene que apoyarse en la
 * entrada, con `anclado`. Lo que no pasa por ahí, no se chequea.
 */
function comunes(
  salida: unknown,
  usuario: string,
  opciones: { rotulos?: string[]; anclado?: string } = {},
): string[] {
  const problemas: string[] = [];

  if (opciones.anclado !== undefined) {
    const inventados = numerosSinRespaldo(opciones.anclado, usuario);
    if (inventados.length > 0) {
      problemas.push(`números que no le dimos: ${inventados.join(", ")}`);
    }
  }

  const tono = tonoDeAsistente(textos(salida));
  if (tono.length > 0) problemas.push(`tono de asistente: ${tono.join(", ")}`);

  for (const titulo of opciones.rotulos ?? []) {
    if (pareceRotulo(titulo)) problemas.push(`título de rótulo: "${titulo}"`);
  }

  return problemas;
}

/** Las lecciones de una salida que las trae, sin atarse a su esquema. */
function titulosDeLecciones(salida: unknown): string[] {
  const lecciones = (salida as { lecciones?: { titulo?: string }[] })?.lecciones;
  return (lecciones ?? []).map((l) => l.titulo ?? "");
}

/* ────────────────────────────────────────────────────────────
 * Las trece
 * ──────────────────────────────────────────────────────────── */

export const FAMILIAS: readonly Familia[] = [
  {
    id: "recepcionista",
    archivo: "src/lib/agentes/recepcionista.ts",
    descriptor: "PROMPT_RECEPCIONISTA",
    clase: "chico",
    cargar: async () =>
      (await import("@/lib/agentes/recepcionista"))
        .PROMPT_RECEPCIONISTA as unknown as PromptDeclarado<unknown>,
    /*
      ⚠ **Esta familia DELEGA y no duplica.** El recepcionista ya tiene su
      banco (`agentes/banco.ts`, 29 frases con destino, banda de confianza
      y forma del argumento) y su juez (`agentes/veredicto.ts`), que son
      más específicos que cualquier cosa que se pueda escribir acá. Su
      corredor sigue siendo `npm run medir:recepcionista`.

      Lo que queda acá es un solo caso de humo, para que el registro esté
      completo —el test de completitud cuenta trece— y para que el arnés
      genérico no invente una segunda verdad sobre el prompt más frágil de
      la app.
    */
    casos: [
      {
        nombre: "humo: una consulta simple sigue yendo a consultas",
        usuario: "cómo viene Proder",
        juzgar: (salida) => {
          const acciones = (salida as { acciones?: { destino?: string }[] })
            .acciones;
          if (!acciones || acciones.length === 0) return ["no devolvió acciones"];
          return acciones[0]!.destino === "consultas"
            ? []
            : [
                `destino "${acciones[0]!.destino}": el banco de banco.ts es el que manda acá, corré npm run medir:recepcionista`,
              ];
        },
      },
    ],
  },

  {
    id: "retro",
    archivo: "src/lib/retro.ts",
    descriptor: "PROMPT_RETRO",
    clase: "razonador",
    cargar: async () =>
      (await import("@/lib/retro"))
        .PROMPT_RETRO as unknown as PromptDeclarado<unknown>,
    casos: [
      {
        nombre: "proyecto que cerró en pérdida por subcontratar",
        usuario: CONTEXTO_RETRO,
        juzgar: (salida, usuario) => {
          // Acá el chequeo de números va sobre TODO, y es la única familia
          // donde eso es correcto sin matices: las cuatro secciones y las
          // lecciones son afirmaciones sobre lo que pasó, y el prompt lo
          // dice en su regla 1 (*"todo lo que afirmes tiene que apoyarse en
          // los datos que te di"*).
          const todo = textos(salida);
          const problemas = comunes(salida, usuario, {
            rotulos: titulosDeLecciones(salida),
            anclado: todo,
          });

          /*
            La lista de errores concretos del prompt, la parte que se puede
            chequear con un test sobre un string. El prompt los enumera uno
            por uno —y no dice "no inventes"— porque el modelo respeta la
            lista y no el principio; esto es lo mismo del otro lado.
          */
          if (/plazo|fecha prevista|entrega prevista|a tiempo|en tiempo/i.test(todo)) {
            problemas.push(
              "habla de plazos, y el contexto no trae ningún plan ni fecha objetivo",
            );
          }
          if (/falt(ó|aron|aba) (proceso|control|documentaci|test)/i.test(todo)) {
            problemas.push(
              "afirma que faltaron procesos o controles: que no se lo hayan contado no significa que no existieran",
            );
          }

          const r = salida as { titulo?: string; costo_real?: string };
          if (!r.titulo || r.titulo.length < 10) {
            problemas.push("sin título, o demasiado corto para decir algo");
          }
          if (!r.costo_real || r.costo_real.length < 40) {
            problemas.push("costo_real vacío o de una línea: es la sección que se pidió interpretar");
          }

          return problemas;
        },
      },
    ],
  },

  {
    id: "generacion",
    archivo: "src/lib/generacion.ts",
    descriptor: "PROMPT_GENERACION",
    clase: "razonador",
    cargar: async () =>
      (await import("@/lib/generacion"))
        .PROMPT_GENERACION as unknown as PromptDeclarado<unknown>,
    casos: [
      {
        nombre: "lecciones sobre cómo cobrar los cambios de alcance",
        usuario: CONTEXTO_GENERACION,
        juzgar: (salida, usuario) => {
          /*
            ⚠ **Sin `anclado`, y medido.** 6.3 propone lecciones **sobre un
            tema**, no afirmaciones sobre unos datos: la entrada son dos
            líneas y ningún número. Con el chequeo puesto, un `"cobrá el 30 %
            adelantado"` —una propuesta perfectamente buena— salía marcado
            como invención. Lo que sí se cobra acá es la vara del título, que
            es de lo que esta familia se trata.
          */
          const titulos = titulosDeLecciones(salida);
          const problemas = comunes(salida, usuario, { rotulos: titulos });

          if (titulos.length === 0) {
            problemas.push("lista vacía: con un tema y un proyecto tendría que proponer algo");
          }

          // La que ya tiene, que el prompt le dice explícitamente que no
          // repita.
          if (titulos.some((t) => /subcontratar el parser/i.test(t))) {
            problemas.push("repitió una lección que ya tenía");
          }

          return problemas;
        },
      },
    ],
  },

  {
    id: "sugerencias",
    archivo: "src/lib/sugerencias.ts",
    descriptor: "PROMPT_SUGERENCIAS",
    clase: "razonador",
    cargar: async () =>
      (await import("@/lib/sugerencias"))
        .PROMPT_SUGERENCIAS as unknown as PromptDeclarado<unknown>,
    casos: [
      {
        nombre: "qué estudiar con dos tracks, uno trabado",
        usuario: CONTEXTO_SUGERENCIAS,
        juzgar: (salida, usuario) => {
          const sugerencias =
            (salida as { sugerencias?: { titulo: string; ancla: string }[] })
              .sugerencias ?? [];

          /*
            ⚠ **El `anclado` es SOLO el campo `ancla`**, no la sugerencia
            entera. La `consigna` propone qué hacer en las próximas dos horas
            —"armá una planilla de 30 filas"— y ahí un número nuevo es la
            respuesta correcta. Medido el 2026-08-13: con el chequeo sobre
            todo, un `"30"` de una consigna salía como invención.
          */
          const problemas = comunes(salida, usuario, {
            rotulos: sugerencias.map((s) => s.titulo),
            anclado: sugerencias.map((s) => s.ancla).join("\n"),
          });

          if (sugerencias.length === 0) {
            problemas.push("lista vacía: el contexto tiene datos de sobra para anclar");
          }

          /*
            La regla número uno del prompt, mecanizada: el `ancla` cita un
            dato de la entrada.

            ⚠ **Se chequea por NÚMEROS y no por texto literal**, y también
            salió de medir. El prompt no pide una cita textual —pide citar el
            dato— y el modelo escribe `"Egreso categoría infraestructura:
            452.000 ARS"` donde el contexto dice `"- infraestructura:
            452.000"`. Exigir la subcadena marcó en rojo tres anclas
            perfectamente ancladas. Lo que sí se puede exigir es que el
            número que cita exista, y de eso ya se encarga `anclado`.

            Lo único que queda acá es que el ancla **no venga vacía de
            datos**: un ancla sin ningún número y sin ninguna palabra del
            contexto es la sugerencia genérica que la regla prohíbe.
          */
          for (const s of sugerencias) {
            const tieneNumero = /\d/.test(s.ancla);
            const tocaElContexto = s.ancla
              .split(/[,.;:"]/)
              .map((t) => t.trim())
              .filter((t) => t.length >= 8)
              .some((t) => estaContenido(t, usuario));

            if (!tieneNumero && !tocaElContexto) {
              problemas.push(
                `ancla sin ningún dato del contexto: "${s.ancla}"`,
              );
            }
          }

          return problemas;
        },
      },
    ],
  },

  {
    id: "observaciones",
    archivo: "src/lib/agentes/observaciones.ts",
    descriptor: "PROMPT_OBSERVACIONES",
    clase: "razonador",
    cargar: async () =>
      (await import("@/lib/agentes/observaciones"))
        .PROMPT_OBSERVACIONES as unknown as PromptDeclarado<unknown>,
    casos: [
      {
        nombre: "balance general de seis meses con un mes fuera de serie",
        usuario: CONTEXTO_OBSERVACIONES,
        juzgar: (salida, usuario) => {
          const observaciones =
            (salida as { observaciones?: { texto: string; dato: string }[] })
              .observaciones ?? [];

          /*
            ⚠ **`anclado` es el `dato`, no el `texto`.** El prompt pide
            justamente CRUZAR números —"qué parte del total se llevó una
            categoría"— así que el `texto` está lleno de números calculados y
            eso es lo correcto. Medido el 2026-08-13: con el chequeo sobre
            todo, un `"60,7 %"` (que es 981.400 / 1.615.900) salía como
            invención. El `dato`, en cambio, **cita**: ahí el número tiene que
            estar.
          */
          const problemas = comunes(salida, usuario, {
            anclado: observaciones.map((o) => o.dato).join("\n"),
          });

          if (observaciones.length === 0) {
            problemas.push("ninguna observación: el contexto tiene cruces obvios");
          }

          for (const o of observaciones) {
            if (!/\d/.test(o.dato)) {
              problemas.push(`dato sin ningún número: "${o.dato}"`);
            }
          }

          return problemas;
        },
      },
    ],
  },

  {
    id: "estimacion",
    archivo: "src/lib/presupuestos/estimacion.ts",
    descriptor: "PROMPT_ESTIMACION",
    clase: "razonador",
    cargar: async () =>
      (await import("@/lib/presupuestos/estimacion"))
        .PROMPT_ESTIMACION as unknown as PromptDeclarado<unknown>,
    casos: [
      {
        nombre: "pedido incompleto de una distribuidora",
        usuario: CONTEXTO_ESTIMACION,
        juzgar: (salida, usuario) => {
          const r = salida as {
            resumen_alcance?: string;
            entregables?: { titulo: string; horas: number; ancla: string }[];
            supuestos?: string[];
            preguntas?: string[];
          };
          const entregables = r.entregables ?? [];

          /*
            ⚠ **Sin `anclado`, y es la familia donde más obvio es por qué:
            las horas las inventa el modelo, y eso es su trabajo.** El
            precio, en cambio, no lo calcula él nunca —sale de multiplicar
            por la tarifa de Ajustes— así que acá no hay ningún número que
            tenga que estar en la entrada. Lo que sí se cobra es la cita
            literal del `ancla`, que es lo mismo que ya decide
            `ancla_verificada` en producción.
          */
          const problemas = comunes(salida, usuario, {
            rotulos: entregables.map((e) => e.titulo),
          });

          for (const e of entregables) {
            if (!(e.horas > 0)) {
              problemas.push(`entregable sin horas: "${e.titulo}"`);
            }
            // La misma regla que ya corre en producción y decide
            // `ancla_verificada`. Acá se cobra igual: lo que produce el
            // modelo termina en un PDF con el nombre de Beno.
            if (!estaContenido(e.ancla, usuario)) {
              problemas.push(`ancla que no está en el pedido: "${e.ancla}"`);
            }
          }

          // El pedido esconde tres cosas a propósito (usuarios, origen de
          // los datos, diseño). Sin preguntas, las asumió.
          if ((r.preguntas ?? []).length === 0) {
            problemas.push(
              "ninguna pregunta: el pedido no dice usuarios, ni de dónde salen los datos, ni si hay diseño",
            );
          }

          return problemas;
        },
      },
    ],
  },

  {
    id: "extraccion",
    archivo: "src/lib/extraccion.ts",
    descriptor: "PROMPT_EXTRACCION",
    clase: "chico",
    cargar: async () =>
      (await import("@/lib/extraccion"))
        .PROMPT_EXTRACCION as unknown as PromptDeclarado<unknown>,
    casos: [
      {
        /*
          ⚠ **El único juez que va al revés, y está escrito por qué.** Acá
          el modelo reescribe lo que Beno vivió, no produce afirmaciones
          propias, así que la vara de 6.3 NO se aplica: `pareceRotulo` no
          entra. Lo que se cobra es que PROPONGA —la vara es baja a
          propósito, §6— y que no le agregue lo que no dijo.
        */
        nombre: "una entrada con una idea adentro: tiene que proponerla",
        usuario: CONTEXTO_EXTRACCION,
        juzgar: (salida, usuario) => {
          const r = salida as {
            tiene_leccion?: boolean;
            titulo?: string | null;
            contenido?: string | null;
            categoria?: string | null;
          };
          const problemas: string[] = [];

          if (!r.tiene_leccion) {
            problemas.push(
              "descartó una entrada con una idea adentro: la vara es BAJA a propósito (ante la duda, proponela)",
            );
            return problemas;
          }

          if (!r.titulo || !r.contenido || !r.categoria) {
            problemas.push("dijo que hay lección pero dejó campos vacíos");
          }

          // Acá sí va el chequeo de números sobre todo: el extractor
          // **transcribe** lo que Beno escribió, así que un número que no
          // esté en la entrada es algo que le agregó.
          problemas.push(
            ...comunes(salida, usuario, { anclado: textos(salida) }),
          );
          return problemas;
        },
      },
      {
        nombre: "una entrada puramente operativa: tiene que decir que no hay",
        usuario: CONTEXTO_EXTRACCION_OPERATIVA,
        juzgar: (salida) => {
          const r = salida as { tiene_leccion?: boolean };
          return r.tiene_leccion
            ? ["propuso una lección sobre un registro sin ninguna idea adentro"]
            : [];
        },
      },
    ],
  },

  {
    id: "clasificacion",
    archivo: "src/lib/clasificacion.ts",
    descriptor: "PROMPT_CLASIFICACION",
    clase: "chico",
    cargar: async () =>
      (await import("@/lib/clasificacion"))
        .PROMPT_CLASIFICACION as unknown as PromptDeclarado<unknown>,
    casos: [
      {
        nombre: "Vercel Pro - Agosto, con Junio en el histórico",
        usuario: CONTEXTO_CLASIFICACION,
        juzgar: (salida, usuario) => {
          const r = salida as { tipo?: string; categoria?: string };
          const problemas: string[] = [];

          // La categoría tiene que estar COPIADA de la lista. Si inventa
          // una, en producción no hay sugerencia —el daño está contenido—
          // pero se vería como "el histórico no encontró nada".
          if (!r.categoria || !estaContenido(r.categoria, usuario)) {
            problemas.push(`categoría inventada: "${r.categoria}"`);
          }
          if (r.tipo !== "egreso") {
            problemas.push(`tipo "${r.tipo}": ante la duda es egreso, y acá no hay duda`);
          }
          // El histórico manda: "Vercel Pro - Junio" está clasificado.
          if (r.categoria && !/infraestructura/i.test(r.categoria)) {
            problemas.push(
              `categoría "${r.categoria}": el ejemplo de Junio dice infraestructura y los ejemplos previos mandan`,
            );
          }

          return problemas;
        },
      },
    ],
  },

  {
    id: "zombies",
    archivo: "src/lib/zombies.ts",
    descriptor: "PROMPT_ZOMBIES",
    clase: "chico",
    cargar: async () =>
      (await import("@/lib/zombies"))
        .PROMPT_ZOMBIES as unknown as PromptDeclarado<unknown>,
    casos: [
      {
        nombre: "una licencia mensual sin actividad desde hace 71 días",
        usuario: CONTEXTO_ZOMBIES,
        juzgar: (salida, usuario) => {
          const aviso = (salida as { aviso?: string }).aviso ?? "";
          // El aviso tiene que decir el dato concreto que se le pasó y nada
          // más: el prompt le prohíbe suponer para qué se usa el servicio.
          const problemas = comunes(salida, usuario, { anclado: aviso });

          if (!/60/.test(aviso) && !/71/.test(aviso)) {
            problemas.push(
              "el aviso no dice ningún dato concreto (ni el monto ni hace cuánto)",
            );
          }
          if (/!/.test(aviso)) {
            problemas.push("signos de exclamación: es una observación, no un reto");
          }
          // Aceptar un zombie sin recurrencia declarada NO da de baja nada,
          // y la pantalla lo dice. Un aviso que insinúe lo contrario
          // contradice a la app.
          if (/(ya )?(la |lo )?(dimos|diste|dio) de baja|cancelad[oa]/i.test(aviso)) {
            problemas.push("promete una baja que la app no hace");
          }

          return problemas;
        },
      },
    ],
  },

  {
    id: "movimiento",
    archivo: "src/lib/agentes/movimientos.ts",
    descriptor: "PROMPT_MOVIMIENTO",
    clase: "chico",
    cargar: async () =>
      (await import("@/lib/agentes/movimientos"))
        .PROMPT_MOVIMIENTO as unknown as PromptDeclarado<unknown>,
    /*
      Las tres frases NO son telegráficas, y es a propósito: las
      telegráficas no llegan al modelo —las resuelve `leerTelegrafico()`
      con un regex, gratis y sin red—, así que medirlas acá sería medir
      algo que en producción no pasa.
    */
    casos: FRASES_MOVIMIENTO.map((f) => ({
      nombre: `"${f.frase}"`,
      usuario: f.frase,
      juzgar: (salida: unknown, usuario: string): string[] => {
        const r = salida as {
          monto?: number | string | null;
          moneda?: string | null;
          descripcion?: string | null;
          fecha_texto?: string | null;
        };
        const problemas: string[] = [];

        // El COPIALA ENTERA, en dos mitades: contenida en la frase (no
        // inventó) y **completa** (no recortó). La segunda es la que
        // atrapa el fallo medido: "Venta Proder a cliente nuevo" -> "Venta".
        if (!r.descripcion) {
          problemas.push("sin descripción");
        } else {
          if (!estaContenido(r.descripcion, usuario)) {
            problemas.push(`descripción que no está en la frase: "${r.descripcion}"`);
          }
          if (r.descripcion.trim().toLowerCase() !== f.descripcion.toLowerCase()) {
            problemas.push(
              `descripción "${r.descripcion}" en vez de "${f.descripcion}"`,
            );
          }
        }

        if (Number(r.monto) !== f.monto) {
          problemas.push(`monto ${r.monto} en vez de ${f.monto}`);
        }
        if ((r.moneda ?? null) !== f.moneda) {
          problemas.push(`moneda ${r.moneda} en vez de ${f.moneda}`);
        }

        // La fecha va COPIADA, no calculada: la cuenta la hace
        // `agentes/fechas.ts`. Un modelo que la convierte a números rompe
        // la distinción entre "no dijo fecha" y "dijo hoy".
        if (f.fechaTexto === null) {
          if (r.fecha_texto) problemas.push(`inventó una fecha: "${r.fecha_texto}"`);
        } else if (!r.fecha_texto || !estaContenido(r.fecha_texto, usuario)) {
          problemas.push(
            `fecha_texto "${r.fecha_texto}": tenía que venir copiada ("${f.fechaTexto}")`,
          );
        }

        return problemas;
      },
    })),
  },

  {
    id: "adjunto_trozo",
    archivo: "src/lib/adjuntos.ts",
    descriptor: "PROMPT_ADJUNTO_TROZO",
    clase: "chico",
    cargar: async () =>
      (await import("@/lib/adjuntos"))
        .PROMPT_ADJUNTO_TROZO as unknown as PromptDeclarado<unknown>,
    casos: [
      {
        nombre: "tres cláusulas de un contrato marco",
        usuario: CONTEXTO_ADJUNTO_TROZO,
        juzgar: (salida, usuario) => {
          const puntos = (salida as { puntos?: string[] }).puntos ?? [];
          // Un resumen de un fragmento no puede traer números que el
          // fragmento no tenga: es extracción mecánica, no producción.
          const problemas = comunes(salida, usuario, {
            anclado: puntos.join("\n"),
          });

          if (puntos.length === 0) {
            problemas.push("ningún punto: el fragmento afirma varias cosas concretas");
          }
          return problemas;
        },
      },
    ],
  },

  {
    id: "adjunto_sintesis",
    archivo: "src/lib/adjuntos.ts",
    descriptor: "PROMPT_ADJUNTO_SINTESIS",
    clase: "razonador",
    cargar: async () =>
      (await import("@/lib/adjuntos"))
        .PROMPT_ADJUNTO_SINTESIS as unknown as PromptDeclarado<unknown>,
    casos: [
      {
        /*
          ⚠ **Vara de 6.3, no la del extractor.** AGENTS.md §6.g lo dice
          explícito: un PDF de un tercero no es lo que Beno vivió, es
          material ajeno del que el modelo produce afirmaciones. Si se
          afloja esta, hay que aflojar la de `generacion`.
        */
        nombre: "lecciones desde las cláusulas de un contrato",
        usuario: CONTEXTO_ADJUNTO_SINTESIS,
        juzgar: (salida, usuario) => {
          const titulos = titulosDeLecciones(salida);
          // Las lecciones salen de las afirmaciones que se le pasaron, así
          // que un número nuevo es un número que el documento no dice.
          const problemas = comunes(salida, usuario, {
            rotulos: titulos,
            anclado: textos(salida),
          });

          if (titulos.length === 0) {
            problemas.push("ninguna lección: el contrato tiene cláusulas discutibles");
          }
          return problemas;
        },
      },
    ],
  },

  {
    id: "adjunto_captura",
    archivo: "src/lib/adjuntos.ts",
    descriptor: "PROMPT_ADJUNTO_CAPTURA",
    clase: "vision",
    cargar: async () =>
      (await import("@/lib/adjuntos"))
        .PROMPT_ADJUNTO_CAPTURA as unknown as PromptDeclarado<unknown>,
    casos: [
      {
        /*
          El caso que ya se midió a mano el 2026-08-10 y que es la
          propiedad que hace viable todo el camino de imágenes: con ruido,
          `legible: false` y **cero conversación inventada**.
        */
        nombre: "ruido puro: tiene que decir que no se entiende",
        usuario: "No escribió nada al pasarte la imagen.",
        imagenes: [ruidoPng()],
        juzgar: (salida) => {
          const r = salida as {
            legible?: boolean;
            transcripcion?: string | null;
            de_que_es?: string | null;
          };
          const problemas: string[] = [];

          if (r.legible) {
            problemas.push(
              "dijo que es legible una imagen de ruido: inventó lo que no vio",
            );
          }
          if (r.transcripcion && r.transcripcion.length > 0) {
            problemas.push(`transcribió algo que no existe: "${r.transcripcion}"`);
          }
          if (!r.de_que_es) {
            problemas.push("no describió lo que sí veía");
          }
          return problemas;
        },
      },
    ],
  },
];

/** Una familia por id, para el corredor. */
export function familiaPorId(id: string): Familia | undefined {
  return FAMILIAS.find((f) => f.id === id);
}
