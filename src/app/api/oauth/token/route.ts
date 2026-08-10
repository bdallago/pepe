import {
  buscarCliente,
  canjearCodigo,
  emitirTokens,
  leerRefresh,
  limpiarCodigosVencidos,
  revocarTokensDeCliente,
} from "@/lib/oauth/almacen";
import { urlDelRecurso } from "@/lib/oauth/descubrimiento";
import {
  alcancesOtorgados,
  comoTexto,
  errorOauth,
  jsonOauth,
  leerCuerpo,
  normalizarRecurso,
  opcionesOauth,
  redirectUriPermitida,
  verificarPkce,
} from "@/lib/oauth/protocolo";

/**
 * RFC 6749 §3.2 — el endpoint de token. Dos grants:
 * `authorization_code` (con PKCE) y `refresh_token` (con rotación).
 *
 * ## Los códigos de error importan más de lo que parece
 *
 * La documentación de conectores es explícita: ante **`invalid_grant`**
 * Claude entiende que el refresh murió y vuelve a pedir autorización;
 * ante cualquier otro código —`invalid_request`, o uno propio— se queda
 * colgado y el usuario ve un conector que no anda y no se arregla solo.
 * Por eso todo lo que signifique "esta credencial ya no vale" sale como
 * `invalid_grant`, sin importar cuál de las cinco razones haya sido.
 *
 * ## Latencia
 *
 * Claude corta el canje a los 10 segundos y el refresh a los 30. Acá no
 * hay ninguna llamada a un modelo ni nada pesado: dos o tres consultas
 * por índice y listo. Que siga siendo así.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // RFC 6749 §4.1.3 manda `application/x-www-form-urlencoded`. `leerCuerpo`
  // acepta además JSON: ver su comentario, la alternativa es un 415 pelado
  // que del otro lado no dice nada.
  const cuerpo = await leerCuerpo(request);

  if (!cuerpo) {
    return errorOauth(
      "invalid_request",
      "No se pudo leer el cuerpo. Se espera application/x-www-form-urlencoded " +
        "(RFC 6749 §4.1.3); también se acepta application/json.",
    );
  }

  const grant = comoTexto(cuerpo.grant_type);

  if (grant === "authorization_code") {
    return canjeDeCodigo(request, cuerpo);
  }
  if (grant === "refresh_token") {
    return refresco(request, cuerpo);
  }

  return errorOauth(
    "unsupported_grant_type",
    `\`${grant ?? "(vacío)"}\` no es un grant soportado. Los que hay son ` +
      "authorization_code y refresh_token.",
  );
}

export const OPTIONS = opcionesOauth;

/**
 * `resource` (RFC 8707), que la spec de MCP 2025-11-25 hace obligatorio
 * para el cliente.
 *
 * Si viene, tiene que ser **este** servidor MCP. Un token emitido para
 * otro recurso no se puede pedir acá, y aceptarlo en silencio sería
 * emitir una credencial con un público distinto del que el cliente cree.
 * Lo único que se perdona es la barra final.
 */
function recursoInvalido(request: Request, valor: string | undefined): boolean {
  if (!valor) return false;
  const esperado = normalizarRecurso(
    urlDelRecurso(request.headers, request.url),
  );
  return normalizarRecurso(valor) !== esperado;
}

async function canjeDeCodigo(
  request: Request,
  cuerpo: Record<string, unknown>,
): Promise<Response> {
  const codigo = comoTexto(cuerpo.code);
  const client_id = comoTexto(cuerpo.client_id);
  const redirect_uri = comoTexto(cuerpo.redirect_uri);
  const code_verifier = comoTexto(cuerpo.code_verifier);

  if (!codigo || !client_id || !code_verifier) {
    return errorOauth(
      "invalid_request",
      "Faltan parámetros: hacen falta code, client_id y code_verifier.",
    );
  }

  if (recursoInvalido(request, comoTexto(cuerpo.resource))) {
    return errorOauth(
      "invalid_target",
      "El `resource` pedido no es este servidor MCP.",
    );
  }

  // Cliente público: no hay secreto que verificar, pero el client_id
  // tiene que existir y, sobre todo, tiene que ser **el mismo** que pidió
  // el código. Eso se chequea abajo, contra la fila.
  const cliente = await buscarCliente(client_id);
  if (!cliente) {
    return errorOauth("invalid_client", "El client_id no está registrado.", 401);
  }

  const canje = await canjearCodigo(codigo);

  if (canje.estado === "desconocido") {
    return errorOauth("invalid_grant", "El código no existe o ya venció.");
  }

  if (canje.estado === "reusado") {
    // RFC 6749 §4.1.2: un código presentado dos veces es señal de que se
    // filtró, y hay que revocar lo que se emitió con él. Ver
    // `revocarTokensDeCliente` para por qué se tira la conexión entera.
    const revocados = await revocarTokensDeCliente(canje.client_id);
    console.warn(
      `[oauth] código de autorización reusado (cliente ${canje.client_id}). ` +
        `Revocados ${revocados} tokens de esa conexión.`,
    );
    return errorOauth("invalid_grant", "El código ya se había canjeado.");
  }

  if (canje.client_id !== client_id) {
    return errorOauth("invalid_grant", "El código no es de este cliente.");
  }

  if (Date.parse(canje.expires_at) <= Date.now()) {
    return errorOauth("invalid_grant", "El código venció.");
  }

  // RFC 6749 §4.1.3: si hubo `redirect_uri` en `/authorize`, tiene que
  // venir igual acá. Se compara con la misma regla del puerto de loopback
  // que usó `/authorize`, o Claude Code fallaría siempre: el servidor
  // local ya cambió de puerto entre una llamada y la otra.
  if (redirect_uri && !redirectUriPermitida([canje.redirect_uri], redirect_uri)) {
    return errorOauth("invalid_grant", "La redirect_uri no coincide con la del código.");
  }

  if (!verificarPkce(code_verifier, canje.code_challenge)) {
    // El código ya quedó quemado por `canjearCodigo`, y está bien: un
    // código es de un solo intento.
    return errorOauth("invalid_grant", "El code_verifier no corresponde al code_challenge.");
  }

  const tokens = await emitirTokens({
    client_id: canje.client_id,
    user_id: canje.user_id,
    scope: canje.scope,
  });

  // Higiene, de paso que estamos en el camino barato y frecuente.
  await limpiarCodigosVencidos();

  return jsonOauth({
    access_token: tokens.access_token,
    token_type: "Bearer",
    expires_in: tokens.expires_in,
    refresh_token: tokens.refresh_token,
    scope: tokens.scope,
  });
}

async function refresco(
  request: Request,
  cuerpo: Record<string, unknown>,
): Promise<Response> {
  const refresh_token = comoTexto(cuerpo.refresh_token);
  const client_id = comoTexto(cuerpo.client_id);

  if (!refresh_token || !client_id) {
    return errorOauth(
      "invalid_request",
      "Faltan parámetros: hacen falta refresh_token y client_id.",
    );
  }

  if (recursoInvalido(request, comoTexto(cuerpo.resource))) {
    return errorOauth(
      "invalid_target",
      "El `resource` pedido no es este servidor MCP.",
    );
  }

  const lectura = await leerRefresh(refresh_token);

  if (lectura.estado === "desconocido") {
    return errorOauth("invalid_grant", "El refresh token no existe.");
  }

  if (lectura.estado === "reusado") {
    // ⚠ Acá está la alarma. Un refresh token que ya fue rotado y vuelve a
    // aparecer significa que hay **dos** poseedores: el legítimo, que ya
    // tiene el nuevo, y alguien que se quedó con una copia del viejo. No
    // se puede saber cuál de los dos está hablando, así que se corta la
    // cadena entera y se obliga a re-autorizar — que a Beno le cuesta un
    // par de clicks y al que copió el token, todo.
    const revocados = await revocarTokensDeCliente(lectura.client_id);
    console.warn(
      `[oauth] refresh token reusado después de rotar (cliente ${lectura.client_id}). ` +
        `Revocados ${revocados} tokens de esa conexión.`,
    );
    return errorOauth("invalid_grant", "El refresh token ya se había usado.");
  }

  if (lectura.client_id !== client_id) {
    return errorOauth("invalid_grant", "El refresh token no es de este cliente.");
  }

  // El alcance de un refresh no puede crecer (RFC 6749 §6): si el cliente
  // pide, se le da la intersección con lo que ya tenía.
  const pedido = comoTexto(cuerpo.scope);
  const scope = pedido
    ? alcancesOtorgados(
        pedido
          .split(/\s+/)
          .filter((a) => lectura.scope.split(/\s+/).includes(a))
          .join(" "),
      )
    : lectura.scope;

  // OAuth 2.1 exige rotar el refresh token en clientes públicos, y la
  // documentación de conectores lo repite: el nuevo viaja en la misma
  // respuesta que deja inservible al viejo. El viejo queda marcado como
  // gastado por existir esta fila que lo apunta con `rotado_de` — ver
  // `emitirTokens`, incluido por qué su access token **no** se revoca.
  const tokens = await emitirTokens({
    client_id: lectura.client_id,
    user_id: lectura.user_id,
    scope,
    rotado_de: lectura.hash,
  });

  return jsonOauth({
    access_token: tokens.access_token,
    token_type: "Bearer",
    expires_in: tokens.expires_in,
    refresh_token: tokens.refresh_token,
    scope: tokens.scope,
  });
}
