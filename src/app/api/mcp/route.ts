import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

/**
 * Servidor MCP de Pepe, expuesto como conector remoto de Claude.ai.
 *
 * ⚠ **ESTO ES UN SPIKE Y TODAVÍA NO TIENE AUTENTICACIÓN.** Devuelve datos
 * inventados a propósito: la URL es pública y cualquiera que la adivine
 * puede llamarlo. Hasta que esté OAuth, acá no se toca la base.
 *
 * El orden —transporte primero, auth después— es deliberado: si se
 * arman las dos cosas juntas y no conecta, no hay forma de saber si el
 * problema es el transporte o el auth. Este paso responde una sola
 * pregunta: **¿Claude.ai lo ve y lo llama?**
 *
 * ## Lo que hay que saber del protocolo
 *
 * `mcp-handler` sirve la spec **2026-07-28** de forma nativa y cae a
 * Streamable HTTP sin estado para los clientes de 2025, que es lo que
 * usa Claude.ai hoy. Un solo handler cubre las dos generaciones.
 *
 * ⚠ **`/api/mcp` está excluido del middleware.** Ver el comentario en
 * `src/middleware.ts`: si no lo estuviera, un cliente sin cookie se
 * comería un 307 a `/login` en vez de hablar JSON-RPC, y el síntoma
 * ("no llego al servidor") mandaría a buscar el problema al lugar
 * equivocado.
 *
 * ## Límites medidos, de la documentación de conectores
 *
 * - Resultado de una tool en Claude.ai: **~150.000 caracteres**. Por eso
 *   todo listado pagina y nada devuelve un volcado completo.
 * - Timeout: **300 segundos**, de ahí el `maxDuration`.
 */

export const maxDuration = 300;

/** Cuántos proyectos entran en una página. Ver el límite de arriba. */
const POR_PAGINA = 25;

/**
 * Datos de mentira, y rotulados como tales dentro del propio texto.
 *
 * Un servidor sin auth en una URL pública que devolviera los proyectos
 * reales de Beno los estaría publicando. Que digan "ejemplo" adentro es
 * la garantía de que, si alguna vez esto llega a producción sin auth por
 * error, se nota en la primera respuesta en vez de filtrar en silencio.
 */
const PROYECTOS_DE_EJEMPLO = [
  { nombre: "Proyecto de ejemplo A", slug: "ejemplo-a", activo: true },
  { nombre: "Proyecto de ejemplo B", slug: "ejemplo-b", activo: true },
  { nombre: "Proyecto de ejemplo C", slug: "ejemplo-c", activo: false },
];

const handler = createMcpHandler((server) => {
  server.registerTool(
    "listar_proyectos",
    {
      title: "Listar proyectos",
      // La descripción es lo único que tiene el modelo para elegir bien
      // sin adivinar, así que dice qué devuelve y qué NO.
      description:
        "Los proyectos de Pepe, con su slug y si están activos. `projects` " +
        "es la entidad raíz de la app: los movimientos, las lecciones y la " +
        "bitácora cuelgan de un proyecto. No devuelve balances ni " +
        "movimientos: para eso están las tools de plata.",
      inputSchema: z.object({
        pagina: z
          .number()
          .int()
          .min(1)
          .default(1)
          .describe("Página, empezando en 1."),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ pagina }) => {
      const desde = (pagina - 1) * POR_PAGINA;
      const pagina_actual = PROYECTOS_DE_EJEMPLO.slice(desde, desde + POR_PAGINA);
      const total = PROYECTOS_DE_EJEMPLO.length;
      const hayMas = desde + pagina_actual.length < total;

      const lineas = pagina_actual.map(
        (p) =>
          `- ${p.nombre} (slug: ${p.slug}) — ${p.activo ? "activo" : "inactivo"}`,
      );

      return {
        content: [
          {
            type: "text" as const,
            text: [
              "⚠ SERVIDOR DE PRUEBA SIN AUTENTICACIÓN: estos proyectos son",
              "inventados. Todavía no está conectado a los datos reales.",
              "",
              `${total} proyectos (página ${pagina}${hayMas ? ", hay más" : ""}):`,
              ...lineas,
            ].join("\n"),
          },
        ],
      };
    },
  );
}, {
  // Sin esto el servidor se presenta como "mcp-typescript server on
  // vercel", el default del paquete. Es el nombre que Claude muestra al
  // conectar, así que decir cuál es y que está en prueba evita que Beno
  // lo confunda con el definitivo.
  serverInfo: { name: "Pepe (prueba sin auth)", version: "0.0.1" },
});

export { handler as GET, handler as POST, handler as DELETE };
