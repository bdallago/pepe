import "server-only";

import type { McpServer } from "@modelcontextprotocol/server";

import { datosDelPedido, type ContextoTool } from "@/lib/mcp/contexto";

/**
 * Envuelve un `McpServer` para que **toda** tool deje su fila en el log.
 *
 * ## Por qué acá y no en cada tool
 *
 * Once tools son once lugares donde alguien puede escribirlo distinto, u
 * olvidarse. Peor: una tool nueva nacería sin log y nadie lo notaría —el
 * log no falla, simplemente no está—. Envolviendo el `server` una sola
 * vez, **una tool nueva queda registrada por existir**. Es el mismo
 * criterio con el que `lib/mcp/contexto.ts` es el único lugar donde se
 * decide de quién son los datos.
 *
 * ## Por qué el conector importa más que la caja para esto
 *
 * Lo que falta medir de verdad es **qué tool elige Claude** ante una frase
 * —los pasos 10 a 19 del plan de pruebas—, y esa decisión no pasa por
 * ningún código nuestro: la toma el modelo del otro lado, mirando las
 * descripciones de las tools. La única forma de verla es anotando qué
 * llamó, con qué argumentos y qué le contestamos.
 *
 * ⚠ **No puede romper una tool.** `registrarUso` no lanza, y lo que sí
 * podría lanzar —resolver el usuario del token— va adentro del `try`. Una
 * tool que funciona no puede fallar porque el diagnóstico falló.
 */
export function conLog(server: McpServer): McpServer {
  const original = server.registerTool.bind(server);

  return new Proxy(server, {
    get(objetivo, propiedad, receptor) {
      if (propiedad !== "registerTool") {
        return Reflect.get(objetivo, propiedad, receptor);
      }

      return (nombre: string, config: unknown, handler: HandlerDeTool) =>
        original(
          nombre as never,
          config as never,
          (async (args: Record<string, unknown>, ctx: ContextoTool) => {
            const arranque = Date.now();

            try {
              const salida = await handler(args, ctx);
              await anotar(nombre, args, ctx, salida, Date.now() - arranque);
              return salida;
            } catch (error: unknown) {
              // Se anota el error y **se relanza**: el conector tiene que
              // seguir contestándole a Claude lo mismo que antes.
              await anotar(
                nombre,
                args,
                ctx,
                undefined,
                Date.now() - arranque,
                error instanceof Error ? error.message : String(error),
              );
              throw error;
            }
          }) as never,
        );
    },
  });
}

/** La forma mínima de un handler de tool, sin atarse al tipo del paquete. */
type HandlerDeTool = (
  args: Record<string, unknown>,
  ctx: ContextoTool,
) => Promise<unknown>;

async function anotar(
  nombre: string,
  args: Record<string, unknown>,
  ctx: ContextoTool,
  salida: unknown,
  duracionMs: number,
  error?: string,
): Promise<void> {
  try {
    // ⚠ Se escribe con `datosDelPedido(ctx).registrarUso()` y no con el
    // cliente de Supabase a mano, porque `lib/mcp/datos.ts` no deja salir
    // el cliente crudo de su archivo. Ese método existe justamente para
    // esto y aparece en el diff, que es lo que ese módulo quiere.
    await datosDelPedido(ctx).registrarUso({
      // El nombre de la tool es lo que se lee de un vistazo en la cola:
      // es la decisión que se quiere revisar.
      pedido: nombre,
      entrada: args,
      salida,
      duracionMs,
      ...(error ? { error } : {}),
    });
  } catch (fallo: unknown) {
    console.warn(
      `[uso] no pude registrar la tool ${nombre}:`,
      fallo instanceof Error ? fallo.message : fallo,
    );
  }
}
