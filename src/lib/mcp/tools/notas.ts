import "server-only";

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { todayISO } from "@/lib/dates";
import { datosDelPedido } from "@/lib/mcp/contexto";
import { PROPONE, respuesta } from "@/lib/mcp/formato";
import { avisoProyectoDesconocido, resolverProyecto } from "@/lib/mcp/resolver";

/**
 * `registrar_nota`: una nota **escrita por el modelo** que termina siendo
 * una entrada de bitácora, previa confirmación.
 *
 * ## Por qué existe, y por qué no es `escribir_bitacora`
 *
 * Son las dos puntas de la misma distinción y por eso van separadas.
 * `escribir_bitacora` escribe directo porque **el texto es de Beno palabra
 * por palabra**; acá el texto lo produjo un modelo resumiendo una
 * conversación, así que pasa por la bandeja como cualquier otra producción
 * de un modelo. Es exactamente la forma de `nota_de_adjunto`, donde el
 * texto sale de mirar una captura.
 *
 * ⚠ **Y esto es lo que hace que `escribir_bitacora` pueda seguir
 * escribiendo directo.** Hasta que existió, un resumen del modelo no tenía
 * a dónde ir, y esa es la presión que termina aflojando la única regla que
 * permite escribir sin confirmación. Con las dos tools, la separación es
 * nítida y verificable: tu texto va directo, el suyo va a la bandeja.
 *
 * Salió del fallo 3 del 2026-08-10, donde el modelo **detectó solo** que
 * lo que iba a cargar era un resumen suyo y no la voz de Beno, y avisó. El
 * criterio estaba; faltaba la capacidad.
 */
export function registrarNotas(server: McpServer) {
  server.registerTool(
    "registrar_nota",
    {
      title: "Registrar una nota en la bitácora",
      // La descripción tiene que dejar clarísimo que esto NO escribe la
      // entrada, y también CUÁNDO usar esta y no `escribir_bitacora`: si
      // el modelo elige mal, un resumen suyo termina guardado como si lo
      // hubiera escrito Beno.
      description:
        "Propone una entrada de bitácora **escrita por vos** (un resumen " +
        "de lo que charlaron, un relevamiento, notas de una reunión). " +
        "**No la crea**: deja una propuesta en la bandeja de Pepe y Beno " +
        "la acepta, la edita o la descarta. Al contestar decí que quedó " +
        "propuesta, no que quedó cargada.\n\n" +
        "Usá `escribir_bitacora` en cambio cuando el texto sea de Beno " +
        "palabra por palabra y vos solo lo estés pasando tal cual: esa " +
        "escribe directo, y por eso no sirve para nada que hayas " +
        "redactado o resumido vos.",
      inputSchema: z.object({
        contenido: z
          .string()
          .trim()
          .min(1)
          .max(6000)
          .describe("El texto de la entrada, tal como quedaría en la bitácora."),
        proyecto: z
          .string()
          .optional()
          .describe(
            "Slug del proyecto del que cuelga. Si no sabés, no lo mandes: se elige en la bandeja.",
          ),
        fecha: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha va como YYYY-MM-DD.")
          .optional()
          .describe("Por defecto, hoy."),
      }),
      annotations: PROPONE,
    },
    async ({ contenido, proyecto, fecha }, ctx) => {
      const datos = datosDelPedido(ctx);

      let projectId: string | undefined;
      if (proyecto) {
        const resuelto = await resolverProyecto(datos, proyecto);
        // `compartido` no existe para una nota: `daily_log.project_id` es
        // NOT NULL. Se trata igual que un slug que no existe.
        if (resuelto.tipo !== "proyecto") {
          return respuesta(
            `${avisoProyectoDesconocido(
              proyecto,
              resuelto.tipo === "no-encontrado" ? resuelto.disponibles : [],
            )}\n\nUna entrada de bitácora cuelga siempre de un proyecto concreto: no hay "compartido" acá.\n\nNo propuse nada todavía.`,
          );
        }
        projectId = resuelto.proyecto.id;
      }

      const fechaFinal = fecha ?? todayISO();

      const { data: item, error } = await datos.crear("inbox", {
        tipo: "nota_dictada",
        estado: "pendiente",
        payload: {
          contenido,
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
          "Quedó **propuesta**, todavía no escrita en la bitácora.",
          "",
          projectId
            ? "Tiene proyecto y fecha: le alcanza con apretar Aceptar."
            : "Le falta el proyecto: la bandeja se lo pide antes de dejarlo aceptar.",
          "",
          "La tarjeta le avisa que el texto lo escribiste vos y no él, así que puede editarlo antes de aceptar.",
        ].join("\n"),
      );
    },
  );
}
