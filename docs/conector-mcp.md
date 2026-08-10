# El conector MCP de Pepe

Pepe se puede agregar a Claude.ai como **custom connector**: te deja
operar la app conversando, sin abrir el browser.

- **URL del conector**: `https://pepe-beno.vercel.app/api/mcp`
- **Auth**: OAuth 2.1 con PKCE y registro dinámico de clientes
- **Transporte**: Streamable HTTP

## Cómo darlo de alta

1. En Claude.ai: **Settings → Connectors → Add custom connector**.
2. Pegá `https://pepe-beno.vercel.app/api/mcp`.
3. Dejá **vacíos** el Client ID y el Client Secret. Pepe soporta registro
   dinámico: Claude se registra solo.
4. Claude te abre el navegador en `/oauth/authorize`. Si no tenés sesión,
   entrás con Google como siempre.
5. Aparece la pantalla de consentimiento con **qué le estás dando**.
   Apretá **Autorizar**.
6. Volvés a Claude y el conector queda conectado.

En un chat nuevo, pedile *"listá mis proyectos de Pepe"*.

## Solo vos

`/authorize` compara tu id de Supabase contra **`MCP_USUARIO_PERMITIDO`**.
Cualquier otra cuenta de Google, aunque el login sea válido, se va con
`access_denied` y **no se emite ningún permiso**.

Encima de eso: cada tool filtra por el usuario del token, y ese filtro
**no depende de que alguien se acuerde de escribirlo** — las tools no ven
el cliente de Supabase crudo, sino uno que ya viene acotado por
`user_id` (ver `src/lib/mcp/datos.ts`).

### El día que Pepe tenga más de un usuario

`MCP_USUARIO_PERMITIDO` es una variable de entorno con **un** uuid: sirve
justo mientras Pepe sea de una persona. Si alguna vez hay más, esto pasa
a ser **una tabla de permitidos** (`mcp_usuarios_permitidos`, con
`user_id` y desde cuándo), y `/authorize` consulta ahí en vez de comparar
contra la variable. Es un cambio chico y aislado: el resto del flujo de
OAuth ya emite tokens por usuario y las tools ya filtran por el del
token, así que **nada más se entera**.

Lo que sí habría que agregar en ese momento es una pantalla para
administrar esa tabla — porque el día que haya que sacarle el acceso a
alguien, editar filas a mano en Supabase no es una respuesta.

## Probarlo local, antes de desplegar

```bash
npm run dev
```

El handshake completo, sin Claude de por medio:

```bash
U=http://localhost:3000/api/mcp

# 1. Sin token: tiene que dar 401 con el challenge.
curl -s -D - -o /dev/null -X POST "$U" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | grep -i 'www-authenticate'

# 2. Los tres documentos de descubrimiento.
curl -s http://localhost:3000/.well-known/oauth-protected-resource
curl -s http://localhost:3000/.well-known/oauth-protected-resource/api/mcp
curl -s http://localhost:3000/.well-known/oauth-authorization-server

# 3. Con un token válido (sacado del flujo de OAuth):
curl -s -X POST "$U" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2025-11-25' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"prueba","version":"1"}}}' \
  | grep '^data: ' | sed 's/^data: //'
```

⚠ **Las respuestas vienen en SSE**, no en JSON pelado: hay que quedarse
con las líneas que empiezan con `data: `. Un `| jq` directo falla y
parece un error del servidor cuando no lo es.

Para el inspector oficial: `npx @modelcontextprotocol/inspector`, y
apuntalo a la URL local. Es lo que mejor muestra el flujo de OAuth.

## Lo que se aprendió construyéndolo

Está en la sección del conector en `AGENTS.md`. Lo que más cuesta
descubrir solo:

- **El `401` es obligatorio.** La documentación de conectores dice, con
  todas las letras, que Claude **no** honra un `WWW-Authenticate` en una
  respuesta `200`. Sin el 401 el flujo no arranca y el síntoma es
  "no llego al servidor", que manda a buscar el problema al transporte.
- **`/api/mcp`, `/api/oauth/*` y `/.well-known/*` están fuera del
  middleware.** Los llama el servidor de Claude, sin cookies: un 307 a
  `/login` se ve del otro lado como HTML donde tenía que haber JSON.
- **`/oauth/authorize` es una página, no un route handler**, porque el
  login de Google es client-side y hay que sobrevivir al viaje de ida y
  vuelta con los parámetros de OAuth intactos.
- **El `resource` tiene que coincidir exactamente** con la URL que se
  escribe en Claude, **incluido el path**.
- **`/token` habla `x-www-form-urlencoded` y `/register` habla `json`.**
  Son dos parsers distintos; con uno solo, Claude come un 415.
