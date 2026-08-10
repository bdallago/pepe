import "server-only";

import type { Database } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * El único acceso a la base que tienen las tools del conector MCP remoto.
 *
 * ## Por qué service role y no un cliente con la identidad del usuario
 *
 * Se evaluaron los dos caminos. Gana la service role, y no por comodidad:
 *
 * 1. **El otro camino no achica el radio de explosión, lo agranda.** Para
 *    que RLS fuera la red haría falta firmar un JWT que Supabase acepte,
 *    y eso significa tener el *JWT secret* del proyecto en el entorno de
 *    la app. Ese secreto no sirve solo para firmar un token de Beno:
 *    firma cualquier claim, incluido `"role": "service_role"`. O sea que
 *    guardarlo es guardar **otra** credencial equivalente a la service
 *    role key que la app ya tiene (`createAdminClient()`, que usan el
 *    cron y la actualización forzada de cotización). Se suma un secreto
 *    más para rotar y no se saca ninguno.
 * 2. **El emisor de tokens de Pepe no es Supabase.** `/api/oauth/token`
 *    emite `pepe_at_…` opacos, guardados hasheados en `oauth_tokens`. No
 *    hay ningún JWT de Supabase dando vueltas al que agarrarse: habría
 *    que **fabricar** uno en cada request, con su propia expiración, su
 *    `sub`, su `role` y su `aud`. Es un segundo emisor de identidad
 *    dentro de la app, con su propia superficie de error, para llegar al
 *    mismo lugar.
 * 3. **La red de RLS se puede tener sin el JWT.** Lo que RLS aporta es
 *    que ninguna consulta salga sin filtrar por usuario. Eso es
 *    exactamente lo que impone este módulo, y lo impone el compilador:
 *    ver abajo.
 *
 * ## Cómo el filtro por usuario deja de depender de la memoria
 *
 * El cliente crudo **no sale de este archivo**. Lo único que reciben las
 * tools es un `DatosDelUsuario`, cuyo único método devuelve una consulta
 * que ya viene con `.eq("user_id", …)` aplicado. No hay forma de pedir
 * una tabla "sin filtrar", porque no hay ninguna función que la
 * devuelva: escribir la próxima tool sin filtro requeriría importar
 * `createAdminClient` a mano, que es un cambio visible en el diff y no
 * un olvido.
 *
 * Y `TablaDelUsuario` cierra el otro agujero: **solo se pueden nombrar
 * las tablas que tienen columna `user_id`**. Pedir `fx_rates` —global,
 * sin dueño— no compila, en vez de compilar y devolver un `.eq()` sobre
 * una columna que no existe, que es un error de runtime.
 */

type Tablas = Database["public"]["Tables"];

/**
 * Las tablas que tienen dueño, derivadas del esquema generado.
 *
 * Se calcula del tipo, no se escribe a mano: si mañana aparece una tabla
 * con `user_id`, entra sola; si alguna lo pierde, deja de compilar quien
 * la use. Una lista escrita a mano se queda vieja en silencio.
 */
export type TablaDelUsuario = {
  [K in keyof Tablas]: "user_id" extends keyof Tablas[K]["Row"] ? K : never;
}[keyof Tablas];

/**
 * Lo que se le puede pedir de más al `select`: el conteo total —lo que
 * necesita cualquier listado paginado para poder decir "hay más"— y
 * `head`, que trae el conteo **sin las filas**.
 */
type OpcionesDeSelect = {
  count?: "exact" | "planned" | "estimated";
  head?: boolean;
};

/**
 * Abre el acceso a los datos de **un** usuario.
 *
 * `user_id` sale siempre del access token verificado, nunca de un
 * argumento de la tool: el modelo no puede pedir los datos de otro
 * aunque se le ocurra mandarlo.
 */
export function datosDelUsuario(user_id: string) {
  const admin = createAdminClient();

  return {
    /** El dueño de todo lo que devuelve este objeto. */
    user_id,

    /**
     * Una consulta sobre `tabla`, **ya acotada al usuario**. Encima se le
     * encadena lo que haga falta (`.order()`, `.range()`, `.is()`, …);
     * el `.eq("user_id", …)` no se puede sacar.
     */
    de<T extends TablaDelUsuario>(tabla: T, opciones?: OpcionesDeSelect) {
      return (
        admin
          .from(tabla)
          .select("*", opciones)
          // ⚠ El `as never` es de acá adentro y de ningún otro lado.
          // Mientras `T` sea una variable de tipo, TypeScript no puede
          // resolver `keyof Row` y rechaza el literal `"user_id"` aunque
          // `TablaDelUsuario` ya garantice que la columna existe. En el
          // call site, con la tabla concreta, el tipo que sale es exacto
          // y se sigue encadenando con autocompletado.
          .eq("user_id" as never, user_id)
      );
    },
  };
}

export type DatosDelUsuario = ReturnType<typeof datosDelUsuario>;
