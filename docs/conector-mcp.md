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

## Qué sabe hacer

Once tools, ordenadas por **quién termina escribiendo en la base**. Ese
corte no es una etapa del desarrollo: es la regla que las gobierna.

### Leen y nada más

| Tool | Qué devuelve |
|---|---|
| `listar_proyectos` | Los proyectos con su slug y si siguen abiertos hoy. Casi todo lo demás pide un slug, así que suele ser el primer paso. Ojo: "cerrado" no quiere decir "no participa del reparto" — un proyecto cerrado se sigue llevando la parte que le tocó mientras estuvo vivo |
| `listar_movimientos` | Ingresos y egresos, filtrables por proyecto, fechas, categoría, tipo y estado. De a 25 |
| `balance` | Ingresos, egresos y saldo en una sola moneda. Sin proyecto, el general; con proyecto, el de ese proyecto **con su parte de lo compartido** (lee también `movement_projects`, o contestaría distinto que la pantalla) |
| `buscar_lecciones` | Búsqueda por texto en español sobre las lecciones anotadas. Incluye las archivadas |
| `leer_bitacora` | Las entradas del día a día, por rango de fechas y proyecto |

### Proponen: dejan el ítem en la bandeja

| Tool | Qué deja |
|---|---|
| `registrar_movimiento` | Un movimiento propuesto, con la categoría que Pepe sugiere sola |
| `registrar_leccion` | Una lección propuesta, que nace como **manual** (es tuya, no una hipótesis del modelo) |
| `registrar_nota` | Una entrada de bitácora **escrita por Claude**: un resumen de lo que charlaron, notas de una reunión, un relevamiento |
| `registrar_proyecto` | Un proyecto nuevo, con su presupuesto adentro si lo charlaron. Una tarjeta, una tecla |
| `registrar_presupuesto` | Un presupuesto para un cliente, cuando el proyecto ya existe o cuando todavía no hay ninguno |

**No cargan nada.** Dejan una fila en `inbox` y la bandeja de siempre es
donde se aceptan o se descartan. Es la regla que ordena toda la app —nada
se escribe sin que aprietes un botón— y no hizo falta inventarle un
mecanismo nuevo: ya existía.

La categoría de un movimiento sale del mismo camino que en el formulario:
primero **cómo lo clasificaste antes** (sin modelo, contra el histórico) y
solo si nunca lo viste, un modelo. Lo que el conector no puede saber —a
qué proyecto va, o qué categoría si no hay antecedente— **no se inventa**:
queda en blanco y la tarjeta de la bandeja lo pide antes de dejarte
aceptar.

La cotización **se congela al aceptar**, no al proponer: el par ARS/USD se
arma contra la fecha del movimiento en el momento en que el movimiento
pasa a existir.

**El precio de un presupuesto no lo calcula Claude, nunca.** Manda los
entregables con sus horas y el monto sale de multiplicar por tu tarifa de
Ajustes y el multiplicador del tipo de cliente, igual que si lo cargaras
vos. Si el cliente mencionó un número y no coincide, gana el de Pepe. Y
las citas del pedido que justifican cada entregable llegan **sin
verificar**: del lado del conector nadie las comprobó contra el texto, así
que la tarjeta las muestra como cita y no como respaldo.

Un presupuesto dictado nace en **borrador y sin proyecto**, y no puede ser
de otra manera: un borrador no cuelga de ninguno. El proyecto se elige al
aceptarlo desde su pantalla. Por eso `registrar_presupuesto` no te pide un
proyecto, y por eso el caso "proyecto nuevo con su presupuesto" va por
`registrar_proyecto`: adentro de un solo ítem, así una frase tuya no
cuesta dos viajes a la bandeja.

**Y `registrar_nota` es la que sostiene que `escribir_bitacora` pueda
escribir directo.** Hasta que existió, un resumen escrito por Claude no
tenía a dónde ir, y esa es la presión que termina metiéndolo por la puerta
que no le corresponde. Ahora la separación es nítida: tu texto va directo,
el suyo va a la bandeja — y la tarjeta te avisa que lo escribió él, para
que lo edites si suena a otra persona.

### Escribe directo

| Tool | Qué hace |
|---|---|
| `escribir_bitacora` | Anota una entrada de bitácora, de verdad |

Es la única, y puede serlo por una razón concreta: **lo que se guarda es
tu texto**. No hay producción de un modelo que confirmar. Si alguna vez la
descripción de esa tool pasa a pedir que se resuma o se mejore lo que
dijiste, ese razonamiento se cae y pasa a necesitar la bandeja como todo
lo demás.

`registrar_leccion` no entra acá aunque el contenido también sea tuyo, y
la diferencia vale la pena: del otro lado hay un modelo redactando y no
hay garantía mecánica de que no haya reformulado. Una lección es
exactamente el tipo de texto que un modelo "mejora" sin que se note — le
sube el registro, le saca el número concreto y la convierte en un rótulo.

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
