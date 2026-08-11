import "server-only";

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { formatDate, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { datosDelPedido } from "@/lib/mcp/contexto";
import {
  PROPONE,
  SOLO_LECTURA,
  encabezado,
  leerPagina,
  paginaVacia,
  respuesta,
} from "@/lib/mcp/formato";
import {
  COMPARTIDO,
  avisoProyectoDesconocido,
  resolverCategoria,
  resolverProyecto,
} from "@/lib/mcp/resolver";
import type { Category, Project } from "@/lib/supabase/database.types";

/**
 * Las dos tools de movimientos: leerlos y proponer uno nuevo.
 *
 * ## Lo que cambia entre una y otra
 *
 * `listar_movimientos` lee y ya. `registrar_movimiento` **no crea un
 * movimiento**: deja una propuesta en `inbox` y Beno la acepta en la
 * bandeja. No es una limitación temporal ni una precaución de más — es
 * la regla 6 de AGENTS.md, y la regla 8 la dice para este caso con todas
 * las letras: *"un tool de MCP que escriba en una tabla de dominio sin
 * pasar por `inbox` es una violación de la regla 6, no un atajo"*.
 *
 * Que además contenga la inyección por prompt es consecuencia, no
 * motivo: si un texto de la base trae instrucciones escondidas, el peor
 * caso posible es una bandeja con propuestas que se rechazan con una
 * tecla. Nadie puede corromper un movimiento porque no existe el camino.
 */

const fechaISO = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha va como YYYY-MM-DD.");

/** Los montos que se muestran son los **de origen**, no los derivados. */
function lineaMovimiento(
  m: {
    fecha: string;
    descripcion: string;
    tipo: string;
    monto_origen: number;
    moneda_origen: "ARS" | "USD";
    estado: string;
    category_id: string;
    project_id: string | null;
  },
  categorias: Map<string, string>,
  proyectos: Map<string, string>,
): string {
  const signo = m.tipo === "ingreso" ? "+" : "-";
  const monto = `${signo}${formatMoney(Number(m.monto_origen), m.moneda_origen)}`;
  const proyecto = m.project_id
    ? (proyectos.get(m.project_id) ?? "proyecto archivado")
    : "compartido";
  const planificado = m.estado === "planificado" ? " · planificado" : "";

  return `- ${formatDate(m.fecha)} · ${m.descripcion} · ${monto} · ${
    categorias.get(m.category_id) ?? "sin categoría"
  } · ${proyecto}${planificado}`;
}

async function nombres(datos: ReturnType<typeof datosDelPedido>) {
  const [{ data: categorias }, { data: proyectos }] = await Promise.all([
    datos.de("categories"),
    datos.de("projects"),
  ]);

  return {
    categorias: new Map((categorias ?? []).map((c: Category) => [c.id, c.nombre])),
    proyectos: new Map((proyectos ?? []).map((p: Project) => [p.id, p.nombre])),
  };
}

export function registrarMovimientos(server: McpServer) {
  server.registerTool(
    "listar_movimientos",
    {
      title: "Listar movimientos",
      description:
        "Los movimientos de plata de Pepe: ingresos y egresos, uno por " +
        "línea, del más reciente al más viejo. Se puede filtrar por " +
        "proyecto, rango de fechas, categoría, tipo y estado. Los montos " +
        "que devuelve son **los de la moneda en que se cargó cada uno** " +
        "(es el importe real; el otro lado es derivado), así que no los " +
        "sumes entre monedas distintas: para totales usá `balance`, que " +
        "convierte con la cotización congelada de cada movimiento.",
      inputSchema: z.object({
        proyecto: z
          .string()
          .optional()
          .describe(
            `Slug o nombre del proyecto. Poné "${COMPARTIDO}" para los gastos sin proyecto asignado. Si lo omitís, trae todos.`,
          ),
        desde: fechaISO.optional().describe("Fecha mínima, inclusive."),
        hasta: fechaISO.optional().describe("Fecha máxima, inclusive."),
        categoria: z.string().optional().describe("Nombre exacto de la categoría."),
        tipo: z.enum(["ingreso", "egreso"]).optional(),
        estado: z
          .enum(["efectuado", "planificado", "ambos"])
          .default("ambos")
          .describe(
            "`planificado` es plata que todavía no se movió. Por defecto vienen los dos.",
          ),
        pagina: z.number().int().min(1).default(1),
      }),
      annotations: SOLO_LECTURA,
    },
    async ({ proyecto, desde, hasta, categoria, tipo, estado, pagina }, ctx) => {
      const datos = datosDelPedido(ctx);

      // El proyecto y la categoría se resuelven **antes** de consultar:
      // si el nombre no existe, es mejor decir cuáles hay que devolver
      // una lista vacía que se lee como "no gastaste nada ahí".
      let projectId: string | null | undefined;
      if (proyecto) {
        const resuelto = await resolverProyecto(datos, proyecto);
        if (resuelto.tipo === "no-encontrado") {
          return respuesta(
            avisoProyectoDesconocido(proyecto, resuelto.disponibles),
          );
        }
        projectId = resuelto.tipo === "compartido" ? null : resuelto.proyecto.id;
      }

      let categoryId: string | undefined;
      if (categoria) {
        const encontrada = await resolverCategoria(datos, categoria, tipo);
        if (!encontrada) {
          return respuesta(
            `No hay ninguna categoría que se llame "${categoria}". Pedí un listado sin filtrar por categoría para ver cuáles se usan.`,
          );
        }
        categoryId = encontrada.id;
      }

      const listado = await leerPagina(
        "los movimientos",
        pagina,
        (inicio, fin) => {
          let q = datos
            .de("movements", { count: "exact" })
            .order("fecha", { ascending: false })
            .order("created_at", { ascending: false })
            .range(inicio, fin);

          if (projectId === null) q = q.is("project_id", null);
          else if (projectId) q = q.eq("project_id", projectId);
          if (desde) q = q.gte("fecha", desde);
          if (hasta) q = q.lte("fecha", hasta);
          if (categoryId) q = q.eq("category_id", categoryId);
          if (tipo) q = q.eq("tipo", tipo);
          if (estado !== "ambos") q = q.eq("estado", estado);

          return q;
        },
        () => {
          let q = datos.de("movements", { count: "exact", head: true });
          if (projectId === null) q = q.is("project_id", null);
          else if (projectId) q = q.eq("project_id", projectId);
          if (desde) q = q.gte("fecha", desde);
          if (hasta) q = q.lte("fecha", hasta);
          if (categoryId) q = q.eq("category_id", categoryId);
          if (tipo) q = q.eq("tipo", tipo);
          if (estado !== "ambos") q = q.eq("estado", estado);
          return q;
        },
      );

      if (listado.filas.length === 0) {
        return respuesta(
          paginaVacia(
            pagina,
            listado.total,
            "No hay ningún movimiento que cumpla con eso.",
          ),
        );
      }

      const { categorias, proyectos } = await nombres(datos);

      return respuesta(
        [
          encabezado(listado, pagina, "movimiento", "movimientos"),
          ...listado.filas.map((m) => lineaMovimiento(m, categorias, proyectos)),
        ].join("\n"),
      );
    },
  );

  server.registerTool(
    "registrar_movimiento",
    {
      title: "Registrar un movimiento",
      // La descripción tiene que dejar clarísimo que esto NO crea el
      // movimiento. Si el modelo cree que sí, le va a contestar a Beno
      // "listo, lo cargué" y el gasto va a estar esperando en una bandeja
      // que él no sabe que tiene que mirar.
      description:
        "Propone un movimiento de plata. **No lo crea**: deja una " +
        "propuesta en la bandeja de Pepe y Beno la acepta o la descarta " +
        "con un botón. Nada entra a las cuentas sin que él lo confirme, " +
        "así que al contestar decí que quedó propuesto, no que quedó " +
        "cargado. Si no le pasás categoría, la propone Pepe: primero " +
        "mirando cómo clasificó antes esa misma descripción y, solo si " +
        "nunca la vio, con un modelo. Lo que falte (categoría o proyecto) " +
        "se elige en la bandeja, así que no inventes ninguno de los dos.",
      inputSchema: z.object({
        descripcion: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe(
            'Qué fue el gasto o el ingreso, como lo diría Beno: "Claude Pro - Agosto".',
          ),
        monto: z
          .number()
          .positive("El monto tiene que ser mayor a cero.")
          .max(1e12)
          .describe("Siempre positivo. Lo que decide el signo es el tipo."),
        moneda: z.enum(["ARS", "USD"]),
        tipo: z
          .enum(["ingreso", "egreso"])
          .optional()
          .describe(
            "Si lo omitís sale de la categoría elegida. La enorme mayoría son egresos.",
          ),
        categoria: z
          .string()
          .optional()
          .describe(
            "Nombre exacto de una categoría que ya exista. No se crean categorías desde acá.",
          ),
        proyecto: z
          .string()
          .optional()
          .describe(
            `Slug del proyecto, o "${COMPARTIDO}" si el gasto es de todos (tipo una suscripción). Si no sabés, no lo mandes: se elige en la bandeja.`,
          ),
        fecha: fechaISO.optional().describe("Por defecto, hoy."),
        estado: z
          .enum(["efectuado", "planificado"])
          .default("efectuado")
          .describe("`planificado` es plata que todavía no se movió."),
      }),
      annotations: PROPONE,
    },
    async (
      { descripcion, monto, moneda, tipo, categoria, proyecto, fecha, estado },
      ctx,
    ) => {
      const datos = datosDelPedido(ctx);

      let projectId: string | null | undefined;
      let etiquetaProyecto = "lo elegís en la bandeja";
      if (proyecto) {
        const resuelto = await resolverProyecto(datos, proyecto);
        if (resuelto.tipo === "no-encontrado") {
          // No se propone nada: un movimiento imputado al proyecto
          // equivocado es más difícil de detectar que uno que no se cargó.
          return respuesta(
            `${avisoProyectoDesconocido(proyecto, resuelto.disponibles)}\n\nNo propuse nada todavía. Volvé a llamarme con el slug correcto.`,
          );
        }
        if (resuelto.tipo === "compartido") {
          projectId = null;
          // El reparto se resuelve contra la fecha del movimiento, no
          // contra la foto de hoy, así que la etiqueta no puede prometer
          // un conjunto de proyectos: promete el criterio.
          etiquetaProyecto =
            "compartido, se reparte entre los proyectos que estaban abiertos en su fecha";
        } else {
          projectId = resuelto.proyecto.id;
          etiquetaProyecto = resuelto.proyecto.nombre;
        }
      }

      // La categoría explícita le gana a todo. Recién si no vino se
      // sugiere, y la sugerencia sigue el orden del spec 6.1: histórico
      // primero, modelo solo si el histórico no encontró nada.
      let elegida: Category | null = categoria
        ? await resolverCategoria(datos, categoria, tipo)
        : null;

      if (categoria && !elegida) {
        return respuesta(
          `No existe la categoría "${categoria}" y desde acá no se crean. Llamame de nuevo sin categoría —Pepe propone una— o con el nombre exacto de una que ya exista.\n\nNo propuse nada todavía.`,
        );
      }

      let comoSalio: string | null = null;

      if (!elegida) {
        // Si Groq está caído esto devuelve null y la propuesta entra
        // igual, sin categoría. Regla 7: ninguna feature de modelo puede
        // ser bloqueante.
        const sugerencia = await datos.sugerirClasificacion(descripcion);

        if (sugerencia) {
          elegida = await resolverCategoria(
            datos,
            sugerencia.categoriaNombre,
            sugerencia.tipo,
          );

          // "Como las 3 veces anteriores" y "como los meses anteriores"
          // no son la misma evidencia, y la función distingue una de
          // otra justamente para poder decirlo distinto.
          comoSalio =
            sugerencia.origen === "historico"
              ? sugerencia.exacto
                ? `ya lo clasificaste así ${sugerencia.veces} ${sugerencia.veces === 1 ? "vez" : "veces"} con esta misma descripción`
                : `es como venís clasificando esto los meses anteriores (${sugerencia.veces} ${sugerencia.veces === 1 ? "vez" : "veces"})`
              : "la propuso un modelo, no salió de tu histórico";
        }
      }

      const fechaFinal = fecha ?? todayISO();

      // ⚠ **La cotización no se congela acá.** El par ARS/USD se arma al
      // aceptar, contra la fecha del movimiento, con `congelarMontos()`.
      // Congelarlo ahora sería fijar la tasa del momento en que se
      // *propuso* algo que todavía no existe, y una propuesta puede
      // quedarse días en la bandeja. Peor: para un movimiento de hoy,
      // proponerlo antes de que corra el cron de cotizaciones lo dejaría
      // pegado a la tasa de ayer aunque al aceptarlo ya esté la de hoy.
      const { data: item, error } = await datos.crear("inbox", {
        tipo: "movimiento_dictado",
        estado: "pendiente",
        payload: {
          descripcion,
          fecha: fechaFinal,
          monto_origen: monto,
          moneda_origen: moneda,
          estado,
          ...(projectId !== undefined
            ? projectId === null
              ? { compartido: true }
              : { project_id: projectId }
            : {}),
          ...(elegida
            ? { category_id: elegida.id, categoria_nombre: elegida.nombre }
            : {}),
          ...(comoSalio ? { sugerencia: comoSalio } : {}),
        },
      });

      if (error || !item) {
        throw new Error(
          `No pude dejar la propuesta en la bandeja: ${error?.message ?? "sin detalle"}`,
        );
      }

      const signo = elegida?.tipo === "ingreso" ? "+" : "-";
      const falta = [
        elegida ? null : "la categoría",
        projectId === undefined ? "el proyecto" : null,
      ].filter(Boolean);

      return respuesta(
        [
          "Quedó **propuesto**, todavía no cargado. Esto es lo que va a ver Beno en la bandeja:",
          "",
          `- ${descripcion}`,
          `- ${signo}${formatMoney(monto, moneda)} el ${formatDate(fechaFinal)}${estado === "planificado" ? " (planificado)" : ""}`,
          `- Categoría: ${elegida ? elegida.nombre : "sin definir"}${comoSalio ? ` — ${comoSalio}` : ""}`,
          `- Proyecto: ${etiquetaProyecto}`,
          "",
          falta.length > 0
            ? `Le falta ${falta.join(" y ")}: la bandeja se lo pide antes de dejarlo aceptar.`
            : "Está completo: le alcanza con apretar Aceptar.",
        ].join("\n"),
      );
    },
  );
}
