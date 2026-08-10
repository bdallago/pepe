import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";

import { datosDelUsuario } from "@/lib/mcp/datos";
import { verificarAccessToken } from "@/lib/oauth/almacen";
import { RUTA_MCP } from "@/lib/oauth/protocolo";

/**
 * Servidor MCP de Pepe, expuesto como conector remoto de Claude.ai.
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
 *   todo listado pagina y nada devuelve un volcado completo. Con los
 *   proyectos de Beno sobra de lejos; la paginación está desde el
 *   principio para no tener que agregarla cuando ya moleste.
 * - Timeout: **300 segundos**, de ahí el `maxDuration`.
 */

export const maxDuration = 300;

/** Cuántos proyectos entran en una página. Ver el límite de arriba. */
const POR_PAGINA = 25;

/**
 * De dónde sale el `resource_metadata` del `WWW-Authenticate`.
 *
 * Se arma con `RUTA_MCP` y no escrito a mano: es la variante **con el
 * path del recurso pegado atrás** (RFC 9728 §3.1), la que Claude prueba
 * primero, y tiene que apuntar al archivo que existe en
 * `app/.well-known/oauth-protected-resource/api/mcp/route.ts`. Si el MCP
 * se muda de ruta, las dos cosas se mudan juntas.
 */
const RUTA_METADATA_DEL_RECURSO = `/.well-known/oauth-protected-resource${RUTA_MCP}`;

/**
 * El puente entre el almacén de tokens de Pepe y lo que espera MCP.
 *
 * Devolver `undefined` es la forma de decir "este token no sirve", sin
 * distinguir entre inexistente, revocado y vencido: a quien presenta un
 * token inválido no se le explica nada. Con `required: true`, cualquiera
 * de los tres termina igual — 401 con el challenge.
 */
async function verificarBearer(
  _request: Request,
  bearer?: string,
): Promise<AuthInfo | undefined> {
  if (!bearer) return undefined;

  const acceso = await verificarAccessToken(bearer);
  if (!acceso) return undefined;

  return {
    token: bearer,
    clientId: acceso.client_id,
    scopes: acceso.alcances,
    expiresAt: acceso.vence_en,
    // `extra` es el único lugar de `AuthInfo` donde entra algo propio, y
    // acá viaja lo que de verdad importa: **de quién** son los datos que
    // la tool tiene permitido tocar.
    extra: { userId: acceso.user_id },
  };
}

/**
 * El usuario del token, o un error ruidoso.
 *
 * `withMcpAuth` con `required: true` ya garantiza que hay `authInfo`, así
 * que esto no debería disparar nunca. Está igual porque el precio de
 * equivocarse es leer datos de otra persona: si algún día el contexto
 * llega vacío por un cambio de la librería, la tool tiene que romper, no
 * seguir con un `user_id` vacío.
 */
function usuarioDelToken(ctx: { http?: { authInfo?: AuthInfo } }): string {
  const userId = ctx.http?.authInfo?.extra?.userId;

  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error("El token no identifica a ningún usuario.");
  }

  return userId;
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "listar_proyectos",
      {
        title: "Listar proyectos",
        // La descripción es lo único que tiene el modelo para elegir bien
        // sin adivinar.
        //
        // ⚠ **No nombres tools que no existen.** La primera versión
        // cerraba con "para eso están las tools de plata", y cuando Beno
        // preguntó cuánto había gastado, el modelo no inventó un número
        // —bien— pero le dijo que esas tools "no aparecen entre las
        // disponibles" y lo mandó a revisar si estaban deshabilitadas en
        // la configuración del conector. No estaban deshabilitadas: no
        // existían. Una descripción que promete hermanas manda a
        // diagnosticar un problema inventado.
        description:
          "Los proyectos de Pepe, con su slug y si están activos. `projects` " +
          "es la entidad raíz de la app: los movimientos, las lecciones y la " +
          "bitácora cuelgan de un proyecto. Devuelve el listado y nada más: " +
          "no trae balances, montos ni movimientos. Si te piden plata y esta " +
          "es la única tool disponible, decilo — el conector todavía no la " +
          "expone.",
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
      async ({ pagina }, ctx) => {
        // El único origen del usuario es el token. No hay ningún argumento
        // de la tool que pueda cambiarlo.
        const datos = datosDelUsuario(usuarioDelToken(ctx));

        const desde = (pagina - 1) * POR_PAGINA;

        // ⚠ **Sin filtrar `archivado_en` y ordenados por nombre**, que es
        // exactamente lo que hace `app/(app)/layout.tsx`. Ojo con
        // "mejorarlo" escondiendo los archivados: el MCP y la pantalla
        // tienen que contestar lo mismo, y un proyecto de menos acá
        // después se convierte en un balance que no cierra allá.
        const { data, count, error } = await datos
          .de("projects", { count: "exact" })
          .order("nombre")
          .range(desde, desde + POR_PAGINA - 1);

        // ⚠ Pedir una página más allá del final **no es un error**, pero
        // PostgREST contesta 416 `PGRST103` igual. Que el modelo reciba
        // "Requested range not satisfiable" cuando lo único que pasó es
        // que se pasó de página lo manda a reintentar o a inventarse una
        // explicación; decirle cuántos hay lo deja seguir solo.
        const seFueDeRango = error?.code === "PGRST103";

        if (error && !seFueDeRango) {
          throw new Error(`No se pudieron leer los proyectos: ${error.message}`);
        }

        const proyectos = seFueDeRango ? [] : (data ?? []);

        if (proyectos.length === 0) {
          // La respuesta de error no trae el conteo, así que se pide
          // aparte. Es la única rama que necesita una segunda consulta, y
          // es la rara: la del camino normal ya vino con el listado.
          const total = seFueDeRango
            ? ((await datos.de("projects", { count: "exact", head: true }))
                .count ?? 0)
            : (count ?? 0);

          return {
            content: [
              {
                type: "text" as const,
                text:
                  total === 0
                    ? "No hay ningún proyecto cargado."
                    : `La página ${pagina} está vacía: hay ${total} proyectos en total y entran ${POR_PAGINA} por página.`,
              },
            ],
          };
        }

        const total = count ?? proyectos.length;
        const hayMas = desde + proyectos.length < total;

        const lineas = proyectos.map((p) => {
          const estado = p.activo ? "activo" : "inactivo";
          const archivado = p.archivado_en ? ", archivado" : "";
          return `- ${p.nombre} (slug: ${p.slug}) — ${estado}${archivado}`;
        });

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `${total} proyectos (página ${pagina}${hayMas ? `, pedí la ${pagina + 1} para el resto` : ""}):`,
                ...lineas,
              ].join("\n"),
            },
          ],
        };
      },
    );
  },
  {
    // Sin esto el servidor se presenta como "mcp-typescript server on
    // vercel", el default del paquete. Es el nombre que Claude muestra al
    // conectar.
    serverInfo: { name: "Pepe", version: "0.1.0" },
  },
);

/**
 * ⚠ **El 401 es la puerta de entrada al flujo de OAuth, no un rechazo.**
 *
 * La documentación de conectores es literal: *"Claude does not honor a
 * `WWW-Authenticate` header on a `200` response"*. O sea que si esta ruta
 * contestara 200 —o un 401 sin el header— Claude nunca iría a buscar el
 * metadata del recurso, nunca encontraría el authorization server y nunca
 * arrancaría el registro dinámico. El síntoma sería "no llego al
 * servidor", que manda a buscar el problema al transporte cuando en
 * realidad falta el challenge.
 *
 * De eso se encarga `required: true`: sin token, con uno inventado, con
 * uno vencido o con uno revocado, `verificarBearer` devuelve `undefined`
 * y `withMcpAuth` contesta 401 con
 * `WWW-Authenticate: Bearer error="invalid_token", …, resource_metadata="…"`.
 *
 * No se piden `requiredScopes`: `/authorize` otorga siempre al menos
 * `mcp` (ver `alcancesOtorgados`), y exigirlos acá agregaría un 403 que
 * hoy no puede pasar y que Claude interpreta distinto que el 401.
 */
const protegido = withMcpAuth(handler, verificarBearer, {
  required: true,
  resourceMetadataPath: RUTA_METADATA_DEL_RECURSO,
});

export { protegido as GET, protegido as POST, protegido as DELETE };
