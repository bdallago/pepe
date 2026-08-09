#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  blockProgress,
  isComplete,
  nextSession,
  orderedSessions,
  trackProgress,
} from "@/lib/aprendizaje";
import { calcularBalances, calcularBalancesProyecto } from "@/lib/balances";
import { formatMoney } from "@/lib/format";
import { formatDate } from "@/lib/dates";

import {
  buscarLecciones,
  getBitacora,
  getBlocks,
  getCategorias,
  getMovimientos,
  getProyectos,
  getSessions,
  getTracks,
} from "./datos.mts";

/**
 * Servidor MCP de Pepe (spec 12).
 *
 * **Corre local, por stdio, arrancado por Claude Code.** No hay endpoint
 * ni URL: no existe superficie de ataque desde afuera. Fue una decisión
 * explícita de Beno el 2026-08-09, después de preguntar qué pasaba si
 * alguien de afuera agarraba el MCP — la respuesta más segura no era un
 * token mejor, era que no hubiera nada escuchando.
 *
 * ## La regla que ordena todo esto
 *
 * **Ningún tool escribe en una tabla de dominio.** Los de lectura leen; y
 * cuando lleguen los de escritura, van a dejar la fila en `inbox` como
 * `pendiente` para que Beno la confirme en la bandeja, igual que todo lo
 * demás. Un tool que escriba directo viola la regla 6 de `AGENTS.md`; no
 * es un atajo, es un bug. Ver la sección 8 de ese archivo.
 *
 * ## Qué se reutiliza y qué no
 *
 * Las **reglas de dominio** se importan tal cual (`lib/balances`,
 * `lib/prorrateo`, `lib/format`, `lib/dates`): son módulos puros. Las
 * **consultas** están reescritas en `datos.ts` porque `lib/queries.ts`
 * está marcado con `server-only` y fuera de Next no se puede importar.
 * O sea: el prorrateo tiene un solo lugar donde vive, y no es este.
 */

const server = new McpServer({
  name: "pepe",
  version: "0.1.0",
});

const monedaSchema = z
  .enum(["ARS", "USD"])
  .default("ARS")
  .describe("Moneda en la que expresar los montos.");

const estadoSchema = z
  .enum(["efectuado", "planificado", "ambos"])
  .default("efectuado")
  .describe(
    "Qué movimientos contar. 'efectuado' es lo que ya pasó; " +
      "'ambos' incluye lo planificado a futuro.",
  );

// ---------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------

server.registerTool(
  "listar_proyectos",
  {
    title: "Listar proyectos",
    description:
      "Los proyectos de Pepe con su peso de prorrateo y si están activos. " +
      "`projects` es la entidad raíz de toda la app: las lecciones y la " +
      "bitácora también cuelgan de un proyecto.",
    inputSchema: {},
  },
  async () => {
    const proyectos = await getProyectos();

    const lineas = proyectos.map(
      (p) =>
        `- ${p.nombre} (slug: ${p.slug})` +
        ` — ${p.activo ? "activo" : "inactivo"}` +
        `, peso de prorrateo ${p.peso_prorrateo}` +
        (p.archivado_en ? " [archivado]" : ""),
    );

    return {
      content: [
        {
          type: "text" as const,
          text: proyectos.length
            ? `${proyectos.length} proyectos:\n${lineas.join("\n")}`
            : "No hay proyectos cargados.",
        },
      ],
    };
  },
);

server.registerTool(
  "balance",
  {
    title: "Balance",
    description:
      "Balance de ingresos y egresos. Sin `proyecto` devuelve el general " +
      "con el desglose por proyecto; con `proyecto` (el slug) devuelve el " +
      "de ese proyecto, incluyendo su porción prorrateada de los gastos " +
      "compartidos.",
    inputSchema: {
      proyecto: z
        .string()
        .optional()
        .describe("Slug del proyecto. Omitilo para el balance general."),
      moneda: monedaSchema,
      estado: estadoSchema,
      desde: z.string().optional().describe("Fecha inicial, YYYY-MM-DD."),
      hasta: z.string().optional().describe("Fecha final, YYYY-MM-DD."),
    },
  },
  async ({ proyecto, moneda, estado, desde, hasta }) => {
    const [movimientos, proyectos, categorias] = await Promise.all([
      getMovimientos(),
      getProyectos(),
      getCategorias(),
    ]);

    const filtros = { desde, hasta, estado };

    if (proyecto) {
      const p = proyectos.find((x) => x.slug === proyecto);
      if (!p) {
        const slugs = proyectos.map((x) => x.slug).join(", ");
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `No existe el proyecto "${proyecto}". Los que hay: ${slugs}.`,
            },
          ],
        };
      }

      const b = calcularBalancesProyecto(
        movimientos,
        proyectos,
        categorias,
        p.id,
        moneda,
        filtros,
      );

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Balance de ${p.nombre} (${estado}, en ${moneda}):`,
              `  Ingresos:  ${formatMoney(b.efectuado.ingresos, moneda)}`,
              `  Egresos:   ${formatMoney(b.efectuado.egresos, moneda)}`,
              `  Balance:   ${formatMoney(b.efectuado.balance, moneda)}`,
              b.participacion
                ? `  Le toca el ${(b.participacion.fraccion * 100).toFixed(1)} % de los gastos compartidos.`
                : `  No participa del prorrateo (proyecto inactivo).`,
              `  Sobre ${b.cantidadMovimientos} movimientos.`,
            ].join("\n"),
          },
        ],
      };
    }

    const b = calcularBalances(movimientos, proyectos, categorias, moneda, filtros);

    const porProyecto = b.porProyecto
      .map((x) => `  - ${x.nombre}: ${formatMoney(x.balance, moneda)}`)
      .join("\n");

    const aviso =
      b.compartidoSinRepartir > 0
        ? `\n⚠ ${formatMoney(b.compartidoSinRepartir, moneda)} de gastos compartidos no se` +
          ` pudieron repartir: no hay proyectos activos. Por eso la suma por` +
          ` proyecto no llega al general.`
        : "";

    return {
      content: [
        {
          type: "text" as const,
          text: [
            `Balance general (${estado}, en ${moneda}):`,
            `  Ingresos:  ${formatMoney(b.efectuado.ingresos, moneda)}`,
            `  Egresos:   ${formatMoney(b.efectuado.egresos, moneda)}`,
            `  Balance:   ${formatMoney(b.efectuado.balance, moneda)}`,
            `  Proyectado (con planificados): ${formatMoney(b.proyectado.balance, moneda)}`,
            `  Sobre ${b.cantidadMovimientos} movimientos.`,
            ``,
            // La aclaración no es cosmética: en ARS los montos van sin
            // decimales, así que los balances por proyecto redondeados
            // pueden no sumar el general redondeado —un peso arriba o
            // abajo— aunque el invariante cierre exacto. Sin esta línea,
            // quien lea la respuesta concluye que las cuentas no dan.
            `Por proyecto (redondeado para mostrar; en crudo suman exactamente el general):`,
            porProyecto,
            aviso,
          ]
            .join("\n")
            .trimEnd(),
        },
      ],
    };
  },
);

server.registerTool(
  "leer_bitacora",
  {
    title: "Leer la bitácora",
    description:
      "Entradas de la bitácora, de la más reciente a la más vieja. " +
      "Es el registro de lo que Beno hizo y pensó cada día.",
    inputSchema: {
      desde: z.string().optional().describe("Fecha inicial, YYYY-MM-DD."),
      hasta: z.string().optional().describe("Fecha final, YYYY-MM-DD."),
      limite: z.number().int().min(1).max(100).default(20),
    },
  },
  async ({ desde, hasta, limite }) => {
    const entradas = (await getBitacora(desde, hasta)).slice(0, limite);

    if (entradas.length === 0) {
      return {
        content: [
          { type: "text" as const, text: "No hay entradas en ese rango." },
        ],
      };
    }

    const texto = entradas
      .map((e) => `## ${formatDate(e.fecha)}\n${e.contenido}`)
      .join("\n\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `${entradas.length} entradas:\n\n${texto}`,
        },
      ],
    };
  },
);

server.registerTool(
  "buscar_lecciones",
  {
    title: "Buscar lecciones",
    description:
      "Busca en las lecciones aprendidas por texto completo en español. " +
      "Incluye las archivadas a propósito: un proyecto cerrado no ensucia " +
      "las pantallas, pero su conocimiento no se pierde.",
    inputSchema: {
      consulta: z.string().min(1).describe("Qué buscar. Basta con el tema."),
      limite: z.number().int().min(1).max(25).default(10),
    },
  },
  async ({ consulta, limite }) => {
    const resultados = await buscarLecciones(consulta, limite);

    if (resultados.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Ninguna lección coincide con "${consulta}".`,
          },
        ],
      };
    }

    const texto = resultados
      .map((r, i) => {
        const marca = r.archivado_en ? " [archivada]" : "";
        return (
          `${i + 1}. ${r.titulo}${marca}\n` +
          `   ${formatDate(r.fecha)} · ${r.categoria} · origen: ${r.origen}\n` +
          `   ${r.contenido}`
        );
      })
      .join("\n\n");

    return {
      content: [
        {
          type: "text" as const,
          // Se aclara el modo para que nadie lea "no hay resultados" como
          // "no existe la lección": si las palabras no aparecen en el
          // texto, el full-text no la encuentra aunque el tema sea ese.
          text:
            `${resultados.length} lecciones (búsqueda por texto, sin ` +
            `similitud semántica):\n\n${texto}`,
        },
      ],
    };
  },
);

server.registerTool(
  "ver_roadmap",
  {
    title: "Ver el roadmap",
    description:
      "El temario de estudio: tracks, bloques y sesiones con su progreso. " +
      "El progreso de cada sesión es doble — leer la teoría y aplicarla son " +
      "dos cosas distintas — así que se informan por separado.",
    inputSchema: {
      track: z
        .string()
        .optional()
        .describe("Slug del track. Omitilo para ver todos."),
      solo_pendientes: z
        .boolean()
        .default(false)
        .describe("Mostrar únicamente las sesiones que faltan completar."),
    },
  },
  async ({ track, solo_pendientes }) => {
    const [tracks, bloques, sesiones] = await Promise.all([
      getTracks(),
      getBlocks(),
      getSessions(),
    ]);

    const elegidos = track ? tracks.filter((t) => t.slug === track) : tracks;

    if (elegidos.length === 0) {
      const slugs = tracks.map((t) => t.slug).join(", ");
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `No existe el track "${track}". Los que hay: ${slugs}.`,
          },
        ],
      };
    }

    const partes = elegidos.map((t) => {
      const progreso = trackProgress(t.id, bloques, sesiones);
      const proxima = nextSession(t.id, bloques, sesiones);
      const ordenadas = orderedSessions(t.id, bloques, sesiones);

      const lineas: string[] = [
        `# ${t.nombre} (${t.slug})`,
        `Progreso: ${progreso.hechas}/${progreso.total} sesiones (${progreso.pct} %)`,
        proxima ? `Próxima: ${proxima.titulo}` : `Track terminado.`,
        ``,
      ];

      const deBloque = bloques.filter((b) => b.track_id === t.id);

      for (const b of deBloque) {
        const p = blockProgress(b.id, sesiones);
        const suyas = ordenadas.filter((s) => s.block_id === b.id);
        const visibles = solo_pendientes
          ? suyas.filter((s) => !isComplete(s))
          : suyas;

        if (visibles.length === 0) continue;

        lineas.push(`## ${b.titulo} — ${p.hechas}/${p.total}`);
        for (const s of visibles) lineas.push(`   ${lineaSesion(s)}`);
        lineas.push(``);
      }

      // Las sesiones sin bloque son las que salieron de convertir una
      // sugerencia (spec 6.4): nacen al final del track y a propósito
      // fuera del temario importado. Sin este grupo no aparecerían en
      // ninguna parte, porque el Roadmap agrupa por bloque.
      const sueltas = ordenadas.filter((s) => s.block_id === null);
      const visiblesSueltas = solo_pendientes
        ? sueltas.filter((s) => !isComplete(s))
        : sueltas;

      if (visiblesSueltas.length > 0) {
        lineas.push(`## Agregadas`);
        for (const s of visiblesSueltas) lineas.push(`   ${lineaSesion(s)}`);
      }

      return lineas.join("\n").trimEnd();
    });

    return {
      content: [{ type: "text" as const, text: partes.join("\n\n") }],
    };
  },
);

/** Una sesión con su progreso doble, que es el punto de la sección. */
function lineaSesion(s: {
  titulo: string;
  teoria_hecha: boolean;
  aplicacion_hecha: boolean;
}): string {
  const teoria = s.teoria_hecha ? "teoría ✓" : "teoría ·";
  const aplicacion = s.aplicacion_hecha ? "aplicación ✓" : "aplicación ·";
  return `${s.titulo}  [${teoria} | ${aplicacion}]`;
}

// ---------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
