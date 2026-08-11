import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";

import { registrarBalance } from "@/lib/mcp/tools/balance";
import { registrarBitacora } from "@/lib/mcp/tools/bitacora";
import { registrarLecciones } from "@/lib/mcp/tools/lecciones";
import { registrarMovimientos } from "@/lib/mcp/tools/movimientos";
import { registrarNotas } from "@/lib/mcp/tools/notas";
import { registrarPresupuestos } from "@/lib/mcp/tools/presupuestos";
import { registrarProyectos } from "@/lib/mcp/tools/proyectos";
import { verificarAccessToken } from "@/lib/oauth/almacen";
import { RUTA_MCP } from "@/lib/oauth/protocolo";

/**
 * Servidor MCP de Pepe, expuesto como conector remoto de Claude.ai.
 *
 * Este archivo es **solo la puerta**: autenticación, cableado y nada
 * más. Las tools viven en `lib/mcp/tools/`, una familia por archivo, y
 * el único acceso a la base es `lib/mcp/datos.ts`.
 *
 * ## Las once tools, y el corte que las ordena
 *
 * El corte no es por tema, es por **quién termina escribiendo en la
 * base** (AGENTS.md §8):
 *
 * | Tool | Qué hace |
 * |---|---|
 * | `listar_proyectos`, `listar_movimientos`, `balance`, `buscar_lecciones`, `leer_bitacora` | leen |
 * | `registrar_movimiento`, `registrar_leccion`, `registrar_nota`, `registrar_proyecto`, `registrar_presupuesto` | dejan una propuesta en `inbox` |
 * | `escribir_bitacora` | escribe directo |
 *
 * Las del medio **no violan la regla 6**: sigue siendo Beno el que
 * aprieta el botón, en la misma bandeja de siempre. No hizo falta
 * inventar un mecanismo de confirmación nuevo porque ya existía. La
 * última puede escribir porque no hay producción de un modelo: el texto
 * es suyo (el desarrollo está en `lib/mcp/tools/bitacora.ts`).
 *
 * Lo que queda para más adelante, con uso encima, es la escritura
 * directa de movimientos y lecciones —si alguna vez se quiere— y
 * absorber 6.3, 6.4 y 6.5.
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
 *   todo listado pagina y nada devuelve un volcado completo. La única
 *   que no pagina es `balance`, y no puede: un total parcial no es un
 *   número incompleto, es un número equivocado.
 * - Timeout: **300 segundos**, de ahí el `maxDuration`. Sobra: la única
 *   tool que puede llamar a un modelo es `registrar_movimiento`, y
 *   solamente cuando el histórico no encontró nada.
 */

export const maxDuration = 300;

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
    // la tool tiene permitido tocar. Lo lee `lib/mcp/contexto.ts`.
    extra: { userId: acceso.user_id },
  };
}

const handler = createMcpHandler(
  (server) => {
    registrarProyectos(server);
    registrarMovimientos(server);
    registrarBalance(server);
    registrarLecciones(server);
    registrarBitacora(server);
    registrarNotas(server);
    registrarPresupuestos(server);
  },
  {
    // Sin esto el servidor se presenta como "mcp-typescript server on
    // vercel", el default del paquete. Es el nombre que Claude muestra al
    // conectar.
    serverInfo: { name: "Pepe", version: "0.2.0" },
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
