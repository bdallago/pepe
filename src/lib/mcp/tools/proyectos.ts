import "server-only";

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { datosDelPedido } from "@/lib/mcp/contexto";
import {
  SOLO_LECTURA,
  encabezado,
  leerPagina,
  paginaVacia,
  respuesta,
} from "@/lib/mcp/formato";

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
        "Los proyectos de Pepe, con su slug y si están activos. `projects` " +
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
        const estado = p.activo ? "activo" : "inactivo";
        const archivado = p.archivado_en ? ", archivado" : "";
        return `- ${p.nombre} (slug: ${p.slug}) — ${estado}${archivado}`;
      });

      return respuesta(
        [
          encabezado(listado, pagina, "proyecto", "proyectos"),
          ...lineas,
          "",
          // Sin esto, "activo" se lee como "no archivado", y no es eso.
          "Solo los activos participan del reparto de los gastos compartidos " +
            "(los movimientos que no tienen proyecto).",
        ].join("\n"),
      );
    },
  );
}
