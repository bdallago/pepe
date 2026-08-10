import "server-only";

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { proyectoPorDefectoDeBitacora } from "@/lib/bitacora";
import { formatDate, todayISO } from "@/lib/dates";
import { datosDelPedido } from "@/lib/mcp/contexto";
import {
  ESCRIBE,
  SOLO_LECTURA,
  encabezado,
  leerPagina,
  paginaVacia,
  recortar,
  respuesta,
} from "@/lib/mcp/formato";
import { avisoProyectoDesconocido, resolverProyecto } from "@/lib/mcp/resolver";

/**
 * La bitácora: leerla y escribir en ella.
 *
 * ## `escribir_bitacora` es la única tool del conector que escribe directo
 *
 * Y puede serlo por una razón concreta, no por conveniencia: **no hay
 * producción de un modelo**. El contenido es lo que dictó Beno y la
 * fecha es aritmética de calendario. Es el mismo razonamiento que
 * habilita al agente de bitácora de la caja, desarrollado en
 * `agentes/bitacora.ts`.
 *
 * ⚠ **Si alguna vez alguien le agrega a la descripción de esta tool una
 * instrucción de resumir, mejorar, corregir o "redactar mejor" el texto,
 * el razonamiento se cae y esto pasa a necesitar la bandeja.** No es una
 * preferencia de estilo: es la única condición bajo la cual escribir sin
 * confirmación no contradice la regla 6 de AGENTS.md.
 *
 * Lo que sí queda como riesgo es la derivación equivocada —algo que iba
 * a otro lado termina como entrada del día— y se cubre igual que en la
 * caja: la respuesta dice exactamente qué se escribió, en qué fecha y en
 * qué proyecto, y borrar es archivar, así que nada se pierde.
 */

const fechaISO = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha va como YYYY-MM-DD.");

/** Cuánto se muestra de cada entrada al listar. */
const RECORTE = 400;

/** Cuántas entradas entran en una página: son más largas que una fila. */
const POR_PAGINA = 10;

export function registrarBitacora(server: McpServer) {
  server.registerTool(
    "leer_bitacora",
    {
      title: "Leer la bitácora",
      description:
        "Las entradas de bitácora de Beno: lo que fue anotando día a día " +
        "sobre en qué anduvo trabajando, de la más reciente a la más " +
        "vieja. Se puede acotar por rango de fechas y por proyecto. Es " +
        "texto suyo, sin editar. Devuelve el principio de cada entrada; " +
        "las largas vienen recortadas. No incluye las archivadas.",
      inputSchema: z.object({
        desde: fechaISO.optional().describe("Fecha mínima, inclusive."),
        hasta: fechaISO.optional().describe("Fecha máxima, inclusive."),
        proyecto: z
          .string()
          .optional()
          .describe("Slug o nombre del proyecto. Si lo omitís, trae todos."),
        pagina: z.number().int().min(1).default(1),
      }),
      annotations: SOLO_LECTURA,
    },
    async ({ desde, hasta, proyecto, pagina }, ctx) => {
      const datos = datosDelPedido(ctx);

      let projectId: string | undefined;
      if (proyecto) {
        const resuelto = await resolverProyecto(datos, proyecto);
        if (resuelto.tipo !== "proyecto") {
          return respuesta(
            avisoProyectoDesconocido(
              proyecto,
              resuelto.tipo === "no-encontrado" ? resuelto.disponibles : [],
            ),
          );
        }
        projectId = resuelto.proyecto.id;
      }

      const listado = await leerPagina(
        "la bitácora",
        pagina,
        (inicio, fin) => {
          let q = datos
            .de("daily_log", { count: "exact" })
            // Archivadas afuera de las listas, igual que en la app. La
            // regla 4 las deja participar de la **búsqueda**, que es
            // otra cosa y otra tool.
            .is("archivado_en", null)
            .order("fecha", { ascending: false })
            .order("created_at", { ascending: false })
            .range(inicio, fin);

          if (projectId) q = q.eq("project_id", projectId);
          if (desde) q = q.gte("fecha", desde);
          if (hasta) q = q.lte("fecha", hasta);

          return q;
        },
        () => {
          let q = datos
            .de("daily_log", { count: "exact", head: true })
            .is("archivado_en", null);
          if (projectId) q = q.eq("project_id", projectId);
          if (desde) q = q.gte("fecha", desde);
          if (hasta) q = q.lte("fecha", hasta);
          return q;
        },
        POR_PAGINA,
      );

      if (listado.filas.length === 0) {
        return respuesta(
          paginaVacia(
            pagina,
            listado.total,
            "No hay ninguna entrada de bitácora que cumpla con eso.",
            POR_PAGINA,
          ),
        );
      }

      const { data: proyectos } = await datos.de("projects");
      const nombres = new Map((proyectos ?? []).map((p) => [p.id, p.nombre]));

      const bloques = listado.filas.map((e) =>
        [
          `**${formatDate(e.fecha)}** · ${nombres.get(e.project_id) ?? "proyecto archivado"}`,
          recortar(e.contenido, RECORTE),
        ].join("\n"),
      );

      return respuesta(
        [
          encabezado(listado, pagina, "entrada", "entradas"),
          "",
          bloques.join("\n\n"),
        ].join("\n"),
      );
    },
  );

  server.registerTool(
    "escribir_bitacora",
    {
      title: "Escribir en la bitácora",
      // ⚠ Esta descripción es lo que sostiene que la tool pueda escribir
      // sin pasar por la bandeja. Leé el comentario de arriba del archivo
      // antes de tocarla.
      description:
        "Anota una entrada en la bitácora de Beno. **Esta sí escribe de " +
        "verdad**, es la única del conector que no pasa por la bandeja. " +
        "Puede hacerlo porque lo que se guarda es lo que dijo él: pasale " +
        "su texto **tal cual**, sin resumirlo, sin reescribirlo y sin " +
        "mejorarle la redacción. Sacale como mucho el pedido del " +
        "principio (\"anotá que…\") y nada más. Si no estás seguro de qué " +
        "parte quiere anotar, preguntale antes de escribir.",
      inputSchema: z.object({
        contenido: z
          .string()
          .trim()
          .min(1, "No hay nada para anotar.")
          .max(20000)
          .describe("El texto de Beno, palabra por palabra."),
        fecha: fechaISO
          .optional()
          .describe(
            'A qué día corresponde. Si dijo "ayer" o "el martes", resolvelo vos a una fecha. Por defecto, hoy.',
          ),
        proyecto: z
          .string()
          .optional()
          .describe(
            "Slug o nombre del proyecto. Si lo omitís va al de estudio, que es donde caen las anotaciones por defecto.",
          ),
      }),
      annotations: ESCRIBE,
    },
    async ({ contenido, fecha, proyecto }, ctx) => {
      const datos = datosDelPedido(ctx);

      let elegido;

      if (proyecto) {
        const resuelto = await resolverProyecto(datos, proyecto);
        if (resuelto.tipo !== "proyecto") {
          return respuesta(
            `${avisoProyectoDesconocido(
              proyecto,
              resuelto.tipo === "no-encontrado" ? resuelto.disponibles : [],
            )}\n\nNo anoté nada. Volvé a llamarme con un proyecto que exista, o sin proyecto para que vaya al de siempre.`,
          );
        }
        elegido = resuelto.proyecto;
      } else {
        const { data: proyectos, error } = await datos
          .de("projects")
          .order("nombre");

        if (error) {
          throw new Error(`No se pudieron leer los proyectos: ${error.message}`);
        }

        // ⚠ La regla de a qué proyecto va una entrada sin proyecto vive
        // en `lib/bitacora.ts` y la comparten el formulario, la caja y
        // esto. No la reimplementes acá: filtrar por `activo` es la
        // tentación de siempre y está mal, porque el proyecto de estudio
        // está inactivo a propósito.
        elegido = proyectoPorDefectoDeBitacora(proyectos ?? []);
      }

      if (!elegido) {
        return respuesta(
          "No hay ningún proyecto cargado en Pepe, y una entrada de bitácora tiene que colgar de uno. Creá un proyecto en la app y volvé a intentar.",
        );
      }

      const fechaFinal = fecha ?? todayISO();

      const { data: entrada, error } = await datos.escribirBitacora({
        contenido,
        fecha: fechaFinal,
        projectId: elegido.id,
      });

      if (error || !entrada) {
        throw new Error(
          `No pude anotar la entrada: ${error?.message ?? "sin detalle"}`,
        );
      }

      return respuesta(
        [
          `Anotado en la bitácora del ${formatDate(fechaFinal)}, en ${elegido.nombre}:`,
          "",
          contenido,
          "",
          "Ya está guardado. Si quedó mal, se edita o se archiva desde la sección Bitácora de la app.",
        ].join("\n"),
      );
    },
  );
}
