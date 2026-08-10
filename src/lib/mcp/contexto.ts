import "server-only";

import type { AuthInfo } from "@modelcontextprotocol/server";

import { datosDelUsuario, type DatosDelUsuario } from "@/lib/mcp/datos";

/**
 * De dónde sale la identidad en cada tool del conector remoto.
 *
 * Está en su propio módulo porque lo usan todas las tools y porque es el
 * único lugar donde se decide **de quién son los datos que se van a
 * tocar**. Un solo lugar, y no una línea repetida en cada handler que
 * alguien pueda escribir distinto.
 */

/** El contexto que `mcp-handler` le pasa a un handler de tool. */
export interface ContextoTool {
  http?: { authInfo?: AuthInfo };
}

/**
 * El usuario del token, o un error ruidoso.
 *
 * `withMcpAuth` con `required: true` ya garantiza que hay `authInfo`, así
 * que esto no debería disparar nunca. Está igual porque el precio de
 * equivocarse es leer o escribir datos de otra persona: si algún día el
 * contexto llega vacío por un cambio de la librería, la tool tiene que
 * romper, no seguir con un `user_id` vacío.
 */
export function usuarioDelToken(ctx: ContextoTool): string {
  const userId = ctx.http?.authInfo?.extra?.userId;

  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error("El token no identifica a ningún usuario.");
  }

  return userId;
}

/**
 * El acceso a la base para este pedido, ya acotado al dueño del token.
 *
 * Es la única puerta que abren las tools. Ningún argumento de ninguna
 * tool puede cambiar de quién son los datos: el `user_id` sale del token
 * verificado y de ningún otro lado.
 */
export function datosDelPedido(ctx: ContextoTool): DatosDelUsuario {
  return datosDelUsuario(usuarioDelToken(ctx));
}
