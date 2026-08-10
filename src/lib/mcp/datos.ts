import "server-only";

import { crearEntradaDeBitacora, type EntradaNueva } from "@/lib/bitacora";
import { sugerirClasificacion, type Sugerencia } from "@/lib/clasificacion";
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
 *
 * ## Lo que no es una consulta suelta
 *
 * Algunas cosas que necesitan las tools no son un `select`: una entrada
 * de bitácora tiene reglas de dominio propias (`lib/bitacora.ts`), la
 * clasificación de un movimiento tiene un orden que no es negociable
 * (`lib/clasificacion.ts`) y la búsqueda de lecciones vive en un RPC.
 *
 * Para esas hay **métodos con nombre**, no un escape hatch que devuelva
 * el cliente. La regla de arriba se mantiene —el cliente crudo no sale
 * de este archivo— y las reglas siguen teniendo un solo lugar donde
 * viven: acá no se reimplementa ninguna, se las llama pasándoles el
 * cliente que este módulo ya tiene y el `user_id` que ya conoce.
 *
 * Si mañana una tool necesita algo que no está acá, el trabajo es
 * agregarle un método a este objeto. Ese es el punto: aparece en el
 * diff.
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

    /**
     * Inserta una fila **con el dueño puesto por este módulo**.
     *
     * `user_id` no está en el tipo del parámetro: no es que se ignore si
     * lo mandás, es que no se puede mandar. Es la misma idea que `de()`,
     * del lado de la escritura.
     *
     * Lo único que se escribe por acá es `inbox`, y eso no es casual:
     * un tool del conector que escriba en una tabla de dominio sin pasar
     * por la bandeja viola la regla 6 de AGENTS.md. La excepción con
     * nombre y razón es `escribirBitacora()`, abajo.
     */
    crear<T extends TablaDelUsuario>(
      tabla: T,
      fila: Omit<Tablas[T]["Insert"], "user_id">,
    ) {
      return admin
        .from(tabla)
        .insert({ ...fila, user_id } as never)
        .select()
        .single();
    },

    /**
     * Tipo y categoría sugeridos para una descripción (spec 6.1).
     *
     * No reimplementa nada: llama a `lib/clasificacion.ts`, que mantiene
     * el orden que no es negociable —primero el histórico contra la base,
     * y **solo si no encontró nada** el modelo—. Lo único que agrega
     * este módulo es el `user_id`, que del lado del conector hace falta
     * porque la service role key saltea RLS.
     *
     * Devuelve `null` sin quejarse si no hay con qué sugerir: la regla 7
     * dice que ninguna feature de modelo puede ser bloqueante, y cargar
     * un movimiento sin categoría propuesta es perfectamente válido.
     */
    sugerirClasificacion(descripcion: string): Promise<Sugerencia | null> {
      return sugerirClasificacion(admin, descripcion, user_id);
    },

    /**
     * Escribe una entrada de bitácora, de verdad y sin pasar por la
     * bandeja.
     *
     * **Es la única escritura directa del conector, y puede serlo por lo
     * mismo que la del agente de bitácora**: el texto es de Beno palabra
     * por palabra. La regla 6 protege contra guardar *producción de un
     * modelo* sin confirmación; acá no hay producción de modelo, hay
     * transcripción. Si alguna vez la descripción de la tool pasa a
     * pedir que se resuma o se mejore el texto, ese razonamiento se cae
     * y esto pasa a necesitar la bandeja.
     *
     * El insert no está escrito acá a propósito: la regla de cómo nace
     * una entrada vive en `lib/bitacora.ts` y la comparten el formulario,
     * el agente y esto.
     */
    escribirBitacora(entrada: EntradaNueva) {
      return crearEntradaDeBitacora(admin, user_id, entrada);
    },

    /**
     * Busca lecciones y devuelve los ids **en orden de relevancia**.
     *
     * Ids y no filas, y ese es el punto: `buscar_lecciones_hibrido` es
     * `security invoker` y no recibe un usuario, así que con la service
     * role key vería las lecciones de cualquiera. Quien llama toma estos
     * ids y los pasa por `de("lessons").in("id", …)`, que sí está
     * acotado — o sea que **el ranking lo hace el RPC y la pertenencia la
     * impone este módulo**, y una lección ajena se cae en el segundo
     * paso aunque el primero la haya rankeado.
     *
     * Se prefirió esto antes que agregarle un `p_user_id` al RPC, al
     * revés que con `sugerir_categoria_historico`: aquella función son
     * treinta líneas y esta es la consulta de fusión RRF, delicada y
     * medida, de la que depende el buscador entero de la app. El costo
     * de tocarla es más alto que el de filtrar después.
     *
     * Va **sin embedding**, igual que el MCP local: generarlo necesita
     * los 266 MB del modelo. No es una versión degradada por accidente
     * —la regla 7 declara válida la búsqueda solo por texto— y con el
     * corpus de hoy es lo que mejor midió.
     */
    async rankearLecciones(consulta: string, limite: number): Promise<string[]> {
      const { data, error } = await admin.rpc("buscar_lecciones_hibrido", {
        p_consulta: consulta,
        p_embedding: undefined,
        p_limite: limite,
      });

      if (error) throw new Error(`Falló la búsqueda: ${error.message}`);
      return (data ?? []).map((fila) => fila.id);
    },
  };
}

export type DatosDelUsuario = ReturnType<typeof datosDelUsuario>;
