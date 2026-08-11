import "server-only";

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  calcularBalances,
  calcularBalancesProyecto,
  type Totales,
} from "@/lib/balances";
import { formatDate, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { datosDelPedido } from "@/lib/mcp/contexto";
import { SOLO_LECTURA, respuesta } from "@/lib/mcp/formato";
import {
  COMPARTIDO,
  avisoProyectoDesconocido,
  resolverProyecto,
} from "@/lib/mcp/resolver";
import { estaVivo, etiquetaProrrateo, pesosSonUniformes } from "@/lib/prorrateo";
import type { Moneda } from "@/lib/supabase/database.types";

/**
 * La tool de plata.
 *
 * ## Es una sola, y eso se decidió
 *
 * El diseño original tenía `balance_general` y `balance_proyecto`. Van
 * fusionadas: para el que llama es la misma pregunta con un filtro de
 * más, y dos tools que se diferencian en un argumento le dan al modelo
 * una oportunidad extra de elegir la equivocada. Sin `proyecto`
 * contesta el general; con `proyecto`, el de ese proyecto.
 *
 * ## Nada se calcula acá
 *
 * Los números salen de `lib/balances.ts` y `lib/prorrateo.ts` tal cual.
 * Es la misma división que respeta el MCP local: **se reescriben las
 * consultas, que son triviales, y ninguna regla**. El invariante que
 * sostiene la app —`suma(balance de cada proyecto) === balance general`—
 * tiene un solo lugar donde vive, y este archivo no es ese lugar.
 *
 * Por lo mismo los proyectos se leen sin filtrar `archivado_en`: es lo
 * que hace la pantalla, y filtrar acá haría que el conector conteste
 * números distintos a los que Beno está mirando.
 */

/**
 * Cuántos movimientos se traen para calcular.
 *
 * El balance no se puede paginar: un total parcial es un número
 * equivocado, no un número incompleto. El techo existe porque PostgREST
 * corta en 1000 por defecto y un corte silencioso acá sería la peor
 * forma posible de fallar. Con los datos de Beno sobra por dos órdenes
 * de magnitud; el día que no alcance, el cálculo se muda a la base.
 */
const TECHO_MOVIMIENTOS = 20000;

const fechaISO = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha va como YYYY-MM-DD.");

function lineaTotales(etiqueta: string, t: Totales, moneda: Moneda): string {
  return `- ${etiqueta}: ${formatMoney(t.balance, moneda)} (ingresos ${formatMoney(t.ingresos, moneda)}, egresos ${formatMoney(t.egresos, moneda)})`;
}

export function registrarBalance(server: McpServer) {
  server.registerTool(
    "balance",
    {
      title: "Balance",
      description:
        "Cuánta plata entró y salió, en una sola moneda. Sin `proyecto` " +
        "da el balance general de Pepe; con `proyecto`, el de ese " +
        "proyecto **incluyendo la parte que le toca de los gastos " +
        "compartidos** (los que no tienen proyecto se reparten entre los " +
        "que estaban abiertos en la fecha de cada gasto, así que un " +
        "proyecto cerrado sigue llevándose la parte que le tocó mientras " +
        "estuvo vivo). Devuelve dos totales que no son lo mismo: *efectuado* " +
        "es plata que ya se movió y *proyectado* suma además lo " +
        "planificado. Cada movimiento se convierte con la cotización que " +
        "quedó congelada el día que se cargó, nunca con la de hoy.",
      inputSchema: z.object({
        proyecto: z
          .string()
          .optional()
          .describe(
            "Slug o nombre del proyecto. Omitilo para el balance general de toda la app.",
          ),
        moneda: z
          .enum(["ARS", "USD"])
          .default("ARS")
          .describe("En qué moneda expresar los totales."),
        desde: fechaISO.optional().describe("Fecha mínima, inclusive."),
        hasta: fechaISO.optional().describe("Fecha máxima, inclusive."),
      }),
      annotations: SOLO_LECTURA,
    },
    async ({ proyecto, moneda, desde, hasta }, ctx) => {
      const datos = datosDelPedido(ctx);

      const objetivo = proyecto
        ? await resolverProyecto(datos, proyecto)
        : null;

      if (objetivo?.tipo === "no-encontrado") {
        return respuesta(avisoProyectoDesconocido(proyecto!, objetivo.disponibles));
      }

      // `compartido` no es un proyecto: no tiene balance propio, es el
      // pozo que se reparte. Decirlo es más útil que devolver ceros.
      if (objetivo?.tipo === "compartido") {
        return respuesta(
          `"${COMPARTIDO}" no es un proyecto, así que no tiene balance propio: cada movimiento sin proyecto se reparte entre los proyectos que estaban abiertos ese día y ya está contado adentro del balance de cada uno. Pedime el balance general, o el de un proyecto puntual. Para verlos sueltos, \`listar_movimientos\` con proyecto "${COMPARTIDO}".`,
        );
      }

      const [movimientos, proyectos, categorias] = await Promise.all([
        datos
          .de("movements")
          .order("fecha", { ascending: false })
          .limit(TECHO_MOVIMIENTOS),
        datos.de("projects").order("nombre"),
        datos.de("categories"),
      ]);

      if (movimientos.error) {
        throw new Error(
          `No se pudieron leer los movimientos: ${movimientos.error.message}`,
        );
      }

      const movs = movimientos.data ?? [];
      const projs = proyectos.data ?? [];
      const cats = categorias.data ?? [];

      const filtros = { desde, hasta, estado: "ambos" as const };
      const rango =
        desde || hasta
          ? ` entre ${desde ? formatDate(desde) : "el principio"} y ${hasta ? formatDate(hasta) : "hoy"}`
          : "";

      if (objetivo?.tipo === "proyecto") {
        const b = calcularBalancesProyecto(
          movs,
          projs,
          cats,
          objetivo.proyecto.id,
          moneda,
          filtros,
        );

        const lineas = [
          `Balance de ${objetivo.proyecto.nombre}${rango}, en ${moneda}:`,
          lineaTotales("Efectuado", b.efectuado, moneda),
          lineaTotales("Proyectado (con lo planificado)", b.proyectado, moneda),
          `- Movimientos imputados: ${b.cantidadMovimientos}`,
        ];

        // La pregunta que contesta esta línea no es "¿participa hoy?"
        // sino "¿los números de arriba llevan parte de algún compartido?".
        // Con reparto por fecha las dos se separan: Proder está cerrado
        // —no participa del reparto de hoy— y sin embargo el 94 % de sus
        // egresos es su parte de los compartidos de cuando estaba
        // abierto. Decidirlo por `participacion` le decía al modelo lo
        // contrario de lo que dicen los números dos renglones más arriba.
        const cerrado = !estaVivo(objetivo.proyecto);

        if (b.incluyeCompartidos && b.participacion) {
          lineas.push(
            `- Los números de arriba ya incluyen su parte de los gastos compartidos. Hoy le toca ${etiquetaProrrateo(b.participacion, pesosSonUniformes(projs, todayISO()))}; los de fechas anteriores se repartieron entre los proyectos que estaban abiertos ese día, que pueden ser otros.`,
          );
        } else if (b.incluyeCompartidos) {
          lineas.push(
            `- Los números de arriba ya incluyen la parte de los gastos compartidos que le tocó mientras estuvo abierto${cerrado ? ". Está cerrado, así que no entra en el reparto de los de hoy" : ", pero hoy no entra en el reparto"}.`,
          );
        } else {
          lineas.push(
            `- En este rango no lleva parte de ningún gasto compartido${cerrado ? ", y está cerrado, así que tampoco entra en el reparto de los de hoy" : ""}.`,
          );
        }

        if (b.egresosPorCategoria.length > 0) {
          lineas.push("", "Egresos por categoría:");
          for (const c of b.egresosPorCategoria.slice(0, 8)) {
            lineas.push(`- ${c.nombre}: ${formatMoney(c.total, moneda)}`);
          }
        }

        return respuesta(lineas.join("\n"));
      }

      const b = calcularBalances(movs, projs, cats, moneda, filtros);

      const lineas = [
        `Balance general${rango}, en ${moneda}:`,
        lineaTotales("Efectuado", b.efectuado, moneda),
        lineaTotales("Proyectado (con lo planificado)", b.proyectado, moneda),
        `- Movimientos: ${b.cantidadMovimientos}`,
      ];

      if (b.porProyecto.length > 0) {
        lineas.push("", "Por proyecto (ya con su parte de lo compartido):");
        for (const p of b.porProyecto) {
          lineas.push(
            `- ${p.nombre}${p.activo ? "" : " (inactivo)"}: ${formatMoney(p.balance, moneda)}`,
          );
        }
      }

      // La única excepción real y documentada al invariante. Si no se
      // avisa, la suma por proyecto no llega al general y parece un bug.
      if (b.compartidoSinRepartir !== 0) {
        lineas.push(
          "",
          `⚠ Hay ${formatMoney(Math.abs(b.compartidoSinRepartir), moneda)} de gastos compartidos sin repartir: ningún proyecto estaba abierto en sus fechas. Están contados en el balance general pero en ninguno de los balances por proyecto.`,
          ...b.movimientosSinRepartir
            .slice(0, 5)
            .map((m) => `  - ${formatDate(m.fecha)} · ${m.descripcion}`),
        );
      }

      if (b.egresosPorCategoria.length > 0) {
        lineas.push("", "Egresos por categoría:");
        for (const c of b.egresosPorCategoria.slice(0, 8)) {
          lineas.push(`- ${c.nombre}: ${formatMoney(c.total, moneda)}`);
        }
      }

      return respuesta(lineas.join("\n"));
    },
  );
}
