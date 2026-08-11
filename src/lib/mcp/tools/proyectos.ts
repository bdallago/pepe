import "server-only";

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { datosDelPedido } from "@/lib/mcp/contexto";
import {
  PROPONE,
  SOLO_LECTURA,
  encabezado,
  leerPagina,
  paginaVacia,
  respuesta,
} from "@/lib/mcp/formato";
import { presupuestoDictadoSchema } from "@/lib/mcp/tools/presupuesto-schema";
import { estaVivo } from "@/lib/prorrateo";

/**
 * El mismo validador de fecha que usa `tools/movimientos.ts`. Está escrito
 * dos veces —son tres líneas— y no en `formato.ts`: ese módulo es de
 * paginación y respuestas, y meterle un `z.string()` lo convierte en el
 * cajón de todo.
 */
const fechaISO = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha va como YYYY-MM-DD.");

export function registrarProyectos(server: McpServer) {
  server.registerTool(
    "listar_proyectos",
    {
      title: "Listar proyectos",
      // La descripción es lo único que tiene el modelo para elegir bien
      // sin adivinar.
      //
      // ⚠ **No nombres tools que no existen.** La primera versión cerraba
      // con "para eso están las tools de plata", y cuando Beno preguntó
      // cuánto había gastado, el modelo no inventó un número —bien— pero
      // le dijo que esas tools "no aparecen entre las disponibles" y lo
      // mandó a revisar si estaban deshabilitadas en la configuración del
      // conector. No estaban deshabilitadas: no existían. Una descripción
      // que promete hermanas manda a diagnosticar un problema inventado.
      //
      // Ahora sí existen, así que las que nombra son ellas y no una
      // familia difusa.
      description:
        "Los proyectos de Pepe, con su slug y si siguen abiertos hoy. `projects` " +
        "es la entidad raíz de la app: los movimientos, las lecciones y la " +
        "bitácora cuelgan de un proyecto. Devuelve el listado y nada más: " +
        "no trae balances ni movimientos. Para plata está `balance`; para " +
        "el detalle, `listar_movimientos`. **Empezá por acá cuando vayas a " +
        "usar otra tool**: casi todas piden el slug de un proyecto.",
      inputSchema: z.object({
        pagina: z
          .number()
          .int()
          .min(1)
          .default(1)
          .describe("Página, empezando en 1."),
      }),
      annotations: SOLO_LECTURA,
    },
    async ({ pagina }, ctx) => {
      const datos = datosDelPedido(ctx);

      // ⚠ **Sin filtrar `archivado_en` y ordenados por nombre**, que es
      // exactamente lo que hace `app/(app)/layout.tsx`. Ojo con
      // "mejorarlo" escondiendo los archivados: el MCP y la pantalla
      // tienen que contestar lo mismo, y un proyecto de menos acá después
      // se convierte en un balance que no cierra allá.
      const listado = await leerPagina(
        "los proyectos",
        pagina,
        (desde, hasta) =>
          datos
            .de("projects", { count: "exact" })
            .order("nombre")
            .range(desde, hasta),
        () => datos.de("projects", { count: "exact", head: true }),
      );

      if (listado.filas.length === 0) {
        return respuesta(
          paginaVacia(pagina, listado.total, "No hay ningún proyecto cargado."),
        );
      }

      const lineas = listado.filas.map((p) => {
        const estado = estaVivo(p) ? "activo" : "cerrado";
        const archivado = p.archivado_en ? ", archivado" : "";
        return `- ${p.nombre} (slug: ${p.slug}) — ${estado}${archivado}`;
      });

      return respuesta(
        [
          encabezado(listado, pagina, "proyecto", "proyectos"),
          ...lineas,
          "",
          // Sin esto, "activo" se lee como "no archivado", y no es eso.
          // Y "cerrado" tampoco es "no participa": participa de los
          // gastos compartidos anteriores a su cierre.
          "Cada gasto compartido (los movimientos que no tienen proyecto) " +
            "se reparte entre los proyectos que estaban abiertos ese día; " +
            "\"cerrado\" solo quiere decir que ya no entra en los de hoy.",
        ].join("\n"),
      );
    },
  );

  server.registerTool(
    "registrar_proyecto",
    {
      title: "Registrar un proyecto",
      description:
        "Propone un proyecto nuevo. **No lo crea**: deja una propuesta en " +
        "la bandeja de Pepe y Beno la acepta o la descarta. Al contestar " +
        "decí que quedó para aprobar, no que quedó cargado.\n\n" +
        "Podés mandarle un presupuesto adentro: si va, se crea junto con " +
        "el proyecto y en estado borrador, en una sola tarjeta. **Vos no " +
        "calculás precios**: mandá los entregables con sus horas y el " +
        "monto lo saca Pepe de la tarifa de Ajustes.",
      inputSchema: z.object({
        nombre: z.string().trim().min(1).max(80),
        de_que_se_trata: z
          .string()
          .trim()
          .max(2000)
          .optional()
          .describe("Para que Beno sepa de qué proyecto le estás hablando."),
        fecha_inicio: fechaISO
          .optional()
          .describe("Cuándo arranca. Si no la sabés, no la mandes."),
        fecha_fin: fechaISO
          .optional()
          .describe("Cuándo termina. Sin esto, el proyecto queda abierto."),
        presupuesto: presupuestoDictadoSchema
          .optional()
          .describe(
            "El presupuesto del proyecto, si lo charlaron. Se crea en borrador junto con el proyecto.",
          ),
      }),
      annotations: PROPONE,
    },
    async (
      { nombre, de_que_se_trata, fecha_inicio, fecha_fin, presupuesto },
      ctx,
    ) => {
      const datos = datosDelPedido(ctx);

      // El check `projects_fechas_coherentes` existe en la base desde
      // `20260810000001`. Frenar acá es decirlo en castellano en vez de
      // dejar que reviente al aceptar, cuando Beno ya no tiene contexto.
      if (fecha_inicio && fecha_fin && fecha_fin < fecha_inicio) {
        return respuesta(
          "El cierre no puede ser anterior al inicio. No propuse nada todavía.",
        );
      }

      const { data: item, error } = await datos.crear("inbox", {
        tipo: "proyecto_dictado",
        estado: "pendiente",
        payload: {
          nombre,
          ...(de_que_se_trata ? { de_que_se_trata } : {}),
          ...(fecha_inicio ? { fecha_inicio } : {}),
          ...(fecha_fin ? { fecha_fin } : {}),
          ...(presupuesto ? { presupuesto } : {}),
        },
      });

      if (error || !item) {
        throw new Error(
          `No pude dejar la propuesta en la bandeja: ${error?.message ?? "sin detalle"}`,
        );
      }

      return respuesta(
        [
          `Quedó **para aprobar**: el proyecto ${nombre} todavía no existe.`,
          "",
          presupuesto
            ? `Va con su presupuesto adentro (${presupuesto.items.length} entregables), que se crea en **borrador** si acepta. El precio lo calcula Pepe con la tarifa de Ajustes, así que puede no coincidir con el número que hayan charlado — si no coincide, gana el de Pepe y la tarjeta muestra la diferencia.`
            : "Sin presupuesto. Si después quieren armar uno, está `registrar_presupuesto`.",
          "",
          "Es una sola tarjeta y una sola tecla en la bandeja.",
        ].join("\n"),
      );
    },
  );
}
