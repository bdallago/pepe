import "server-only";

import type { McpServer } from "@modelcontextprotocol/server";

import { datosDelPedido } from "@/lib/mcp/contexto";
import { PROPONE, respuesta } from "@/lib/mcp/formato";
import { presupuestoDictadoSchema } from "@/lib/mcp/tools/presupuesto-schema";

/**
 * `registrar_presupuesto`: un presupuesto propuesto, a la bandeja.
 *
 * ⚠ **No toma un proyecto, y no es un olvido.** Un presupuesto en
 * `borrador` no cuelga de ninguno: `quotes` tiene el check
 * `(estado = 'aceptado') = (project_id is not null)`, así que el vínculo
 * se hace recién al aceptar el presupuesto desde su pantalla, que es donde
 * se elige o se crea el proyecto. Aceptar un pedido de proyecto acá sería
 * aceptar un dato que no se puede guardar en ningún lado.
 *
 * Para el caso "proyecto nuevo + su presupuesto" está `registrar_proyecto`,
 * que lo lleva adentro del payload: una tarjeta, una tecla.
 */
export function registrarPresupuestos(server: McpServer) {
  server.registerTool(
    "registrar_presupuesto",
    {
      title: "Registrar un presupuesto",
      description:
        "Propone un presupuesto para un cliente. **No lo crea**: deja una " +
        "propuesta en la bandeja de Pepe y Beno la acepta o la descarta. " +
        "Al contestar decí que quedó para aprobar, no que quedó cargado.\n\n" +
        "**Vos no calculás precios.** Mandá los entregables con sus horas " +
        "estimadas y el monto lo saca Pepe multiplicando por la tarifa de " +
        "Ajustes y el multiplicador del tipo de cliente. Si el cliente " +
        "mencionó un número, no lo mandes: mandá las horas.\n\n" +
        "Si el proyecto todavía no existe en Pepe, usá " +
        "`registrar_proyecto` con el presupuesto adentro: queda todo en " +
        "una sola tarjeta.",
      inputSchema: presupuestoDictadoSchema,
      annotations: PROPONE,
    },
    async (dictado, ctx) => {
      const datos = datosDelPedido(ctx);

      const { data: item, error } = await datos.crear("inbox", {
        tipo: "presupuesto_dictado",
        estado: "pendiente",
        payload: dictado,
      });

      if (error || !item) {
        throw new Error(
          `No pude dejar la propuesta en la bandeja: ${error?.message ?? "sin detalle"}`,
        );
      }

      const horas = dictado.items.reduce((total, i) => total + i.horas, 0);

      return respuesta(
        [
          `Quedó **para aprobar**: ${dictado.items.length} entregables, ${horas} horas en total.`,
          "",
          "El precio lo calcula Pepe con la tarifa de Ajustes cuando Beno lo acepte, así que puede no coincidir con el número que hayan charlado. Si no coincide, gana el de Pepe.",
          "",
          "Nace en **borrador** y sin proyecto: el proyecto se elige al aceptar el presupuesto desde su pantalla.",
        ].join("\n"),
      );
    },
  );
}
