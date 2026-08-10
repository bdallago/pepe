import "server-only";

import { slugify } from "@/lib/actions/shared";
import type { SupabaseClient } from "@/lib/supabase/server";

/**
 * Alta de sesiones que no vienen del temario importado.
 *
 * Hay dos caminos que terminan en la misma fila: el botón "convertir en
 * sesión" de Sugerencias (6.4) y el agente que agrega un tema al plan
 * desde la caja. La regla que comparten —**al final del track y sin
 * bloque**— es de dominio y tiene que vivir en un solo lugar; si cada
 * camino la escribiera por su cuenta, alcanzaría con que uno se olvidara
 * del `orden` para que la sesión nueva apareciera en el medio del
 * temario, mintiendo sobre de dónde salió.
 *
 * Por qué acá y no dentro de la Server Action que ya existía: las
 * actions arman su propio cliente desde las cookies (`requireSession`) y
 * el despacho de los agentes lo recibe ya construido. Con la regla en un
 * módulo que toma el cliente por parámetro, la usan los dos —y también
 * un script, que es lo único que permite probar la escritura sin una
 * sesión de browser—. La action quedó como cáscara: valida, llama a esto
 * y revalida.
 */
export async function crearSesionAlFinalDelTrack(
  supabase: SupabaseClient,
  userId: string,
  trackId: string,
  input: {
    titulo: string;
    consigna?: string | null;
    teoriaTexto?: string | null;
    /**
     * De dónde salió la sesión. Va adelante del slug y es el único rastro
     * de procedencia que queda en la fila: `sugerida-` para las de 6.4,
     * `tema-` para las que Beno pidió agregar por su nombre.
     */
    prefijoSlug: string;
  },
) {
  // El orden va después de la última del track, archivadas incluidas: si
  // se contaran solo las visibles, desarchivar una podría dejar dos
  // sesiones con el mismo número.
  const { data: ultima } = await supabase
    .from("sessions")
    .select("orden")
    .eq("track_id", trackId)
    .order("orden", { ascending: false })
    .limit(1)
    .maybeSingle();

  return await supabase
    .from("sessions")
    .insert({
      user_id: userId,
      track_id: trackId,
      // El slug es único por usuario y acá no viene de ningún export, así
      // que se genera. El sufijo aleatorio evita chocar con una sesión
      // vieja de título parecido.
      slug: `${input.prefijoSlug}-${slugify(input.titulo).slice(0, 60)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      titulo: input.titulo,
      consigna: input.consigna ?? null,
      teoria_texto: input.teoriaTexto ?? null,
      // `block_id` se deja en su default (null) a propósito: la sesión no
      // es parte del temario que vino del importador. El Roadmap las
      // junta en el grupo "Agregadas" justamente por eso.
      orden: (ultima?.orden ?? 0) + 1,
    })
    .select()
    .single();
}
