import "server-only";

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { formatDate, todayISO } from "@/lib/dates";
import { datosDelPedido } from "@/lib/mcp/contexto";
import {
  PROPONE,
  SOLO_LECTURA,
  recortar,
  respuesta,
} from "@/lib/mcp/formato";
import { avisoProyectoDesconocido, resolverProyecto } from "@/lib/mcp/resolver";

/**
 * Buscar lecciones y proponer una nueva.
 *
 * ## Por qué `registrar_leccion` pasa por la bandeja y `escribir_bitacora` no
 *
 * Parece la misma situación —en los dos casos el texto es de Beno— y no
 * lo es. La bitácora del agente de la caja escribe directo porque ahí un
 * modelo **recorta un prefijo y nada más**: el contenido llega palabra
 * por palabra y eso es verificable leyendo `agentes/bitacora.ts`.
 *
 * Acá del otro lado hay Claude, redactando. Aunque el prompt le pida que
 * no reformule, no hay ninguna garantía mecánica de que no lo haga, y una
 * lección es exactamente el tipo de texto que un modelo "mejora" sin que
 * se note: le sube el registro, le saca el número concreto y la convierte
 * en un rótulo. Sin garantía, vale la regla 6 y la propuesta va a la
 * bandeja — que es además donde Beno puede corregirla con la tecla E
 * antes de aceptar.
 *
 * Nace con `origen = 'manual'`, no `generada`: es suya, no una hipótesis
 * de un modelo. De eso se encarga `ORIGEN_POR_TIPO` en
 * `lib/actions/inbox.ts`.
 */

const CATEGORIAS = [
  "tecnica",
  "producto",
  "comercial",
  "proceso",
  "personal",
] as const;

/** Cuánto se muestra de cada lección encontrada. */
const RECORTE = 200;

export function registrarLecciones(server: McpServer) {
  server.registerTool(
    "buscar_lecciones",
    {
      title: "Buscar lecciones",
      description:
        "Busca en las lecciones que Beno tiene anotadas en Pepe: cosas " +
        "que aprendió trabajando, una por fila, con título y contenido. " +
        "Es búsqueda por texto en español, así que alcanza con el tema " +
        "(no hace falta acertar las palabras exactas). Devuelve el título " +
        "entero y el principio del contenido; si te interesa una, pedila " +
        "por su título con más contexto. **Incluye las archivadas a " +
        "propósito**: un proyecto cerrado no ensucia las pantallas de la " +
        "app, pero su conocimiento no se pierde.",
      inputSchema: z.object({
        consulta: z
          .string()
          .trim()
          .min(2, "Poné al menos un par de letras.")
          .describe("El tema que buscás, en palabras sueltas o en una frase."),
        limite: z
          .number()
          .int()
          .min(1)
          .max(25)
          .default(10)
          .describe("Cuántas traer, como mucho."),
      }),
      annotations: SOLO_LECTURA,
    },
    async ({ consulta, limite }, ctx) => {
      const datos = datosDelPedido(ctx);

      // Dos pasos, y el segundo no es cosmético: el RPC rankea sin saber
      // de quién son las lecciones y este `in(...)` sobre una consulta
      // acotada es lo que impone la pertenencia. Ver `rankearLecciones()`.
      const ids = await datos.rankearLecciones(consulta, limite);

      if (ids.length === 0) {
        return respuesta(
          `No encontré ninguna lección sobre "${consulta}". Puede que no haya nada anotado todavía, o que convenga probar con otras palabras.`,
        );
      }

      const { data, error } = await datos.de("lessons").in("id", ids);
      if (error) {
        throw new Error(`No se pudieron leer las lecciones: ${error.message}`);
      }

      // El orden del RPC es el de relevancia y el `in(...)` no lo
      // respeta, así que se reordena por la posición del id.
      const porId = new Map((data ?? []).map((l) => [l.id, l]));
      const lecciones = ids
        .map((id) => porId.get(id))
        .filter((l): l is NonNullable<typeof l> => l !== undefined);

      if (lecciones.length === 0) {
        return respuesta(
          `No encontré ninguna lección tuya sobre "${consulta}".`,
        );
      }

      const { data: proyectos } = await datos.de("projects");
      const nombres = new Map((proyectos ?? []).map((p) => [p.id, p.nombre]));

      const bloques = lecciones.map((l) => {
        const marcas = [
          l.categoria,
          nombres.get(l.project_id) ?? "proyecto archivado",
          formatDate(l.fecha),
          l.origen === "generada" ? "hipótesis generada" : null,
          l.archivado_en ? "archivada" : null,
        ].filter(Boolean);

        return `**${l.titulo}**\n${recortar(l.contenido, RECORTE)}\n_(${marcas.join(" · ")})_`;
      });

      return respuesta(
        [
          `${lecciones.length} ${lecciones.length === 1 ? "lección" : "lecciones"} sobre "${consulta}", de la más relevante a la menos:`,
          "",
          bloques.join("\n\n"),
        ].join("\n"),
      );
    },
  );

  server.registerTool(
    "registrar_leccion",
    {
      title: "Registrar una lección",
      // El párrafo sobre no reformular es la contención principal de esta
      // tool, y por eso está redactado como una prohibición y no como una
      // preferencia. Ver el comentario de arriba del archivo.
      description:
        "Propone guardar una lección en Pepe. **No la guarda**: deja una " +
        "propuesta en la bandeja y Beno la acepta con un botón, así que al " +
        "contestar decí que quedó propuesta. " +
        "El título y el contenido tienen que ser **lo que dijo Beno, con " +
        "sus palabras**: no lo resumas, no lo mejores, no le subas el " +
        "registro y no le saques los números o los nombres concretos. Si " +
        "él dice \"cobrar por versión mayor me evitó tres meses de " +
        "cambios gratis\", eso es el título — no \"Gestionar el alcance " +
        "del proyecto\". Si lo que dijo no da para una lección, no la " +
        "propongas; él la escribe cuando quiera.",
      inputSchema: z.object({
        titulo: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe(
            "La lección en una frase, como la formuló Beno. Una afirmación concreta, no un rótulo.",
          ),
        contenido: z
          .string()
          .trim()
          .min(1)
          .max(5000)
          .describe("El desarrollo: qué pasó y por qué le sirve."),
        categoria: z
          .enum(CATEGORIAS)
          .describe(
            "tecnica = código y herramientas · producto = qué construir · comercial = clientes y plata · proceso = cómo trabaja · personal.",
          ),
        proyecto: z
          .string()
          .optional()
          .describe(
            "Slug del proyecto del que salió. Si no sabés, no lo mandes: se elige en la bandeja.",
          ),
        fecha: fechaDeLaLeccion(),
      }),
      annotations: PROPONE,
    },
    async ({ titulo, contenido, categoria, proyecto, fecha }, ctx) => {
      const datos = datosDelPedido(ctx);

      let projectId: string | undefined;
      let etiquetaProyecto = "lo elegís en la bandeja";

      if (proyecto) {
        const resuelto = await resolverProyecto(datos, proyecto);
        if (resuelto.tipo !== "proyecto") {
          // Una lección no puede ser "compartida": `lessons.project_id`
          // es NOT NULL. Si mandó `compartido`, cae acá y se le dice.
          return respuesta(
            `${avisoProyectoDesconocido(
              proyecto,
              resuelto.tipo === "no-encontrado" ? resuelto.disponibles : [],
            )}\n\nUna lección siempre cuelga de un proyecto concreto. No propuse nada todavía.`,
          );
        }
        projectId = resuelto.proyecto.id;
        etiquetaProyecto = resuelto.proyecto.nombre;
      }

      const fechaFinal = fecha ?? todayISO();

      const { data: item, error } = await datos.crear("inbox", {
        tipo: "leccion_dictada",
        estado: "pendiente",
        // Misma forma que las demás propuestas de lección: es lo que
        // valida `payloadSchema` en `lib/actions/inbox.ts` antes de
        // escribir la fila de dominio.
        payload: {
          titulo,
          contenido,
          categoria,
          fecha: fechaFinal,
          ...(projectId ? { project_id: projectId } : {}),
        },
      });

      if (error || !item) {
        throw new Error(
          `No pude dejar la propuesta en la bandeja: ${error?.message ?? "sin detalle"}`,
        );
      }

      return respuesta(
        [
          "Quedó **propuesta**, todavía no guardada. Beno la va a ver así en la bandeja:",
          "",
          `**${titulo}**`,
          contenido,
          `_(${categoria} · ${etiquetaProyecto} · ${formatDate(fechaFinal)})_`,
          "",
          projectId
            ? "Le alcanza con apretar Aceptar. Si algo quedó mal dicho, ahí mismo lo edita."
            : "Le falta el proyecto: la bandeja se lo pide antes de dejarlo aceptar.",
        ].join("\n"),
      );
    },
  );
}

/** La fecha de la lección: cuándo la aprendió, no cuándo la anotó. */
function fechaDeLaLeccion() {
  return z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha va como YYYY-MM-DD.")
    .optional()
    .describe("Cuándo le pasó, si lo dijo. Por defecto, hoy.");
}
