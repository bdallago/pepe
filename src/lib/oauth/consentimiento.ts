import "server-only";

import { createHmac } from "node:crypto";

import { supabaseServiceRoleKey } from "@/lib/env";
import { igualSeguro, VIDA_CONSENTIMIENTO_SEGUNDOS } from "@/lib/oauth/protocolo";

/**
 * La firma que ata el botón "Autorizar" al pedido que se mostró en
 * pantalla.
 *
 * ## Por qué hace falta
 *
 * El registro dinámico es **abierto**: cualquiera puede registrar un
 * cliente con su propia `redirect_uri`. Sin esto, alcanzaría con que Beno
 * abriera una página cualquiera que hiciera un POST a
 * `/oauth/authorize/confirmar` —el browser adjunta su cookie de sesión
 * sola— para que Pepe emitiera un código y se lo mandara al atacante. Un
 * CSRF de manual, y el premio es el acceso completo a sus finanzas.
 *
 * La firma lo cierra: el POST solo vale si trae un HMAC que únicamente
 * pudo calcular el servidor al renderizar la pantalla de consentimiento,
 * y ese HMAC cubre **todos** los parámetros más el `user_id` de la
 * sesión. Cambiar la `redirect_uri` invalida la firma; robarle la firma a
 * otra sesión tampoco sirve, porque el `user_id` va adentro.
 *
 * ## Por qué no hay variable de entorno nueva
 *
 * La clave se **deriva** de la service role key, que ya existe, es
 * server-only y sin ella OAuth no funciona igual (todo `almacen.ts` la
 * usa). Pedir un secreto más significaría que la primera conexión desde
 * Claude falla hasta que alguien se acuerde de cargarlo en Vercel, y esa
 * falla se vería como un "no me deja autorizar" imposible de diagnosticar
 * desde el otro lado. Se deriva con HMAC y no se usa directo para que
 * esta clave no sea la key: si la firma se filtrara, no se filtra el
 * acceso a la base.
 */
function clave(): Buffer {
  return createHmac("sha256", supabaseServiceRoleKey())
    .update("pepe:oauth:consentimiento:v1")
    .digest();
}

/** Lo que la firma cubre. Cambiar cualquiera de estos rompe la firma. */
export type DatosConsentimiento = {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
  state: string;
  resource: string;
  user_id: string;
};

function canonico(datos: DatosConsentimiento, vence: number): string {
  // Un separador que no puede aparecer adentro de ninguno de los valores,
  // para que no se pueda mover texto de un campo al de al lado y obtener
  // la misma cadena.
  return [
    String(vence),
    datos.client_id,
    datos.redirect_uri,
    datos.code_challenge,
    datos.scope,
    datos.state,
    datos.resource,
    datos.user_id,
  ].join("\n");
}

/**
 * Firma el pedido. El resultado va como campo oculto del formulario y
 * vuelve tal cual en el POST.
 */
export function firmarConsentimiento(datos: DatosConsentimiento): string {
  const vence = Math.floor(Date.now() / 1000) + VIDA_CONSENTIMIENTO_SEGUNDOS;
  const firma = createHmac("sha256", clave())
    .update(canonico(datos, vence))
    .digest("base64url");
  return `${vence}.${firma}`;
}

/**
 * Verifica la firma. Falla si venció: una pantalla de consentimiento
 * abierta hace horas ya no representa una decisión de ahora.
 */
export function verificarConsentimiento(
  datos: DatosConsentimiento,
  firmado: string,
): boolean {
  const corte = firmado.indexOf(".");
  if (corte <= 0) return false;

  const vence = Number(firmado.slice(0, corte));
  const firma = firmado.slice(corte + 1);
  if (!Number.isFinite(vence)) return false;
  if (vence * 1000 < Date.now()) return false;

  const esperada = createHmac("sha256", clave())
    .update(canonico(datos, vence))
    .digest("base64url");

  return igualSeguro(esperada, firma);
}
