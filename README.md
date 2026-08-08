# Pepe

App web personal con tres secciones: la **plata** de mis proyectos de
software, lo que **estudio** aplicado a ellos, y la **bitácora** de lo que
voy aprendiendo.

Nació como reemplazo de una planilla de gastos. En agosto de 2026 absorbió
una segunda app mía de estudio, que dejó de existir por separado.

Un solo usuario, autenticación con Google, base en Supabase, deploy en Vercel.

## Qué hace

### Finanzas

- **Balance general** con tarjetas de ingresos, egresos, balance neto y
  balance proyectado (incluyendo los planificados), conmutador global
  **ARS / USD** y filtros de rango y estado.
- **Vista por proyecto** con la misma estructura, incluyendo su porción
  prorrateada de los gastos compartidos.
- **Movimientos**: tabla ordenable y filtrable por fecha, proyecto,
  categoría, tipo, estado y moneda, con búsqueda, edición, borrado y
  export a CSV respetando los filtros activos.
- **Recurrentes**: ABM de movimientos que se repiten. El cron diario los
  genera como planificados, sin duplicar.
- **Comprobantes**: subida opcional de imagen o PDF a un bucket privado,
  con preview y descarga por URL firmada.
- **Carga rápida** con `⌘K` / `Ctrl+K`, disponible dentro de Finanzas.
- **Sugerencia de tipo y categoría** al escribir la descripción: primero
  contra el propio histórico, y solo si no hay match, con un modelo
  (ver "Lo que propone el modelo" más abajo).

### Aprendizaje

- **Hoy**: la sesión que toca en cada track, con su teoría, la fuente y la
  consigna a aplicar. Leer y aplicar se marcan por separado: no son lo
  mismo, y esa distinción es el punto de la sección.
- **Semana**: la grilla de lunes a domingo con lo que viene proyectado.
- **Roadmap**: los bloques de cada track con su avance y su bibliografía.
- **Artefactos**: los entregables que hay que producir, con su estado.
- **Repaso**: un quiz armado con los temas ya completados. No usa ningún
  modelo: las preguntas y los distractores salen de las propias sesiones.
- **Lecciones**: buscador en lenguaje natural sobre lo aprendido
  (ver "El buscador de lecciones" más abajo).

### Bitácora

Qué hice y qué aprendí cada día, atado a un proyecto. Es la materia prima
de la que salen las lecciones.

### Bandeja

No es una cuarta sección: es el portón por donde entra **todo** lo que
propone un modelo, para finanzas y para aprendizaje por igual. Vive como
icono con contador arriba a la derecha.

Se procesa como el triage de Linear: **un ítem por vez, sin scroll, todo
con teclado** (`A` aceptar, `R` rechazar, `P` posponer, `E` editar) y
swipe en mobile. La acción se aplica al instante, sin esperar al
servidor. Si revisar veinte propuestas costara veinte clicks, la bandeja
se abandonaría en dos semanas y todo el diseño de confirmación humana
dejaría de tener sentido.

## Las tres reglas que importan

### 1. El tipo de cambio se congela

Cada movimiento guarda `monto_ars`, `monto_usd`, `tasa_usada` y
`tasa_fecha` en el momento de la carga. **Los montos históricos nunca se
recalculan con la cotización actual.** Un gasto de abril de USD 20 vale lo
que valía en abril.

La referencia es el **dólar Oficial BNA, valor venta**, que un cron trae
todos los días de [dolarapi.com](https://dolarapi.com/v1/dolares/oficial).
Al cargar un movimiento se usa la cotización de su fecha; si no existe (fin
de semana, feriado, carga retroactiva) se usa la última anterior y la UI lo
avisa. La tasa también se puede forzar a mano.

La única recotización de la app es marcar un planificado como efectuado:
ahí se recalcula contra la fecha real de efectivización.

### 2. Los gastos compartidos se prorratean al vuelo

Un movimiento sin proyecto (`project_id = null`) es compartido: sirve a
todos los proyectos. En las vistas por proyecto se reparte entre los
**activos**, ponderado por su `peso_prorrateo`.

El reparto se calcula en cada consulta, **nunca se guardan filas
duplicadas**. El reparto usa el método de resto mayor sobre centavos
enteros, así la suma de los balances por proyecto da exactamente el
balance general (la pantalla de Proyectos verifica y muestra ese chequeo).

### 3. El importe real es el que escribiste

El formulario muestra ARS y USD a la vez. El campo donde escribís queda
como `moneda_origen` y es el importe real; el otro es derivado y se
recalcula solo, incluso si cambiás la fecha.

## Puesta en marcha

### 1. Crear el proyecto en Supabase

1. Entrá a [supabase.com/dashboard](https://supabase.com/dashboard) y creá
   un proyecto nuevo. Elegí la región más cercana (`South America (São
   Paulo)` para Argentina).
2. Guardá la contraseña de la base que te pide: la vas a necesitar si
   después querés conectarte por `psql`.
3. Esperá a que termine de aprovisionarse (un par de minutos).

### 2. Correr las migraciones

**Opción A — desde el dashboard (la más rápida):**

Abrí el **SQL Editor** y ejecutá, en este orden, el contenido de:

1. `supabase/migrations/20260101000000_schema.sql`
2. `supabase/migrations/20260101000001_rls.sql`
3. `supabase/migrations/20260101000002_storage.sql`
4. `supabase/migrations/20260807000000_aprendizaje.sql`
5. `supabase/migrations/20260807000001_aprendizaje_rls.sql`
6. `supabase/migrations/20260807000002_track_fecha_inicio.sql`
7. `supabase/migrations/20260807000003_busqueda_lecciones.sql`
8. `supabase/migrations/20260807000004_busqueda_or.sql`
9. `supabase/migrations/20260807000005_clasificacion.sql`
10. `supabase/migrations/20260807000006_historico_nucleo.sql`

**Opción B — con la CLI:**

```bash
npx supabase login
npx supabase link --project-ref <tu-project-ref>
npx supabase db push
```

El `project-ref` es la parte del medio de la URL del proyecto:
`https://<project-ref>.supabase.co`.

### 3. Configurar el OAuth de Google

**En la consola de Google Cloud:**

1. Entrá a [console.cloud.google.com](https://console.cloud.google.com) y
   creá un proyecto (o usá uno existente).
2. **APIs & Services → OAuth consent screen**: elegí *External*, completá
   nombre de la app y tu mail, y agregate a vos mismo en *Test users*. Si
   la app es solo para vos, no hace falta publicarla.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Tipo: *Web application*
   - **Authorized redirect URI**:
     `https://<tu-project-ref>.supabase.co/auth/v1/callback`

     Ojo: acá va la URL de **Supabase**, no la de tu app.
4. Copiá el **Client ID** y el **Client secret**.

**En Supabase:**

1. **Authentication → Providers → Google**: activalo y pegá el Client ID y
   el Client secret.
2. **Authentication → URL Configuration**:
   - *Site URL*: `http://localhost:3000` en desarrollo, la URL de Vercel
     en producción.
   - *Redirect URLs*: agregá `http://localhost:3000/**` y
     `https://<tu-app>.vercel.app/**`.

### 4. Variables de entorno

Copiá `.env.example` a `.env.local` y completá:

| Variable | Dónde sale | Notas |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API | Pública. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API | Pública, protegida por RLS. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API | **Secreta.** Saltea RLS. Solo server-side. |
| `CRON_SECRET` | Vos | `openssl rand -hex 32` |
| `GROQ_API_KEY` | [console.groq.com/keys](https://console.groq.com/keys) | **Secreta.** Solo server-side. Sin ella la app anda entera en modo manual. |

No hace falta configurar la URL del sitio: el redirect del OAuth se arma
con `window.location.origin`, así que anda igual en localhost, en los
previews de Vercel y en producción.

```bash
cp .env.example .env.local
```

### 5. Correr en local

```bash
npm install
npm run dev
```

Abrí `http://localhost:3000`, entrá con Google y andá a **Ajustes →
Cotización → Actualizar ahora** para cargar la primera cotización. Sin eso
no se pueden cargar movimientos.

### 6. Deploy en Vercel

1. Subí el repo a GitHub.
2. En [vercel.com](https://vercel.com) importá el repositorio.
3. Cargá las variables de entorno de la tabla de arriba en **Settings →
   Environment Variables**, para *Production*, *Preview* y *Development*.
4. Deploy.
5. Volvé a Supabase → **Authentication → URL Configuration** y actualizá el
   *Site URL* y las *Redirect URLs* con el dominio de Vercel.

El cron ya está declarado en `vercel.json`:

```json
{ "crons": [{ "path": "/api/cron/fx", "schedule": "0 0 * * *" }] }
```

Corre a las **00:00 UTC**, que son las **21:00 de Argentina**. Vercel manda
`Authorization: Bearer $CRON_SECRET`, y la ruta rechaza cualquier cosa que
no coincida.

> Los crons de Vercel se registran al hacer deploy en **producción**. En un
> preview no se ejecutan.

Para probarlo a mano:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<tu-app>.vercel.app/api/cron/fx
```

### 7. Cargar el historial de cotizaciones (recomendado)

El cron guarda **la cotización del día**, así que una instalación nueva
arranca sin historial: si cargás un movimiento de hace tres meses, se le va
a aplicar la única tasa que existe. Para que las cargas retroactivas usen
la tasa que de verdad correspondía, conviene backfillear la serie.

`dolarapi.com` solo devuelve la cotización actual. La serie histórica está
en `api.argentinadatos.com`, que es de la misma familia:

```bash
curl -s https://api.argentinadatos.com/v1/cotizaciones/dolares/oficial \
  > oficial.json
```

Cada elemento es `{ casa, compra, venta, fecha }`, así que el mapeo a
`fx_rates` es directo. Insertalos con la service role key (la tabla es de
solo lectura vía RLS), en lotes y con `Prefer: resolution=merge-duplicates`
para que sea idempotente.

### 8. Datos de ejemplo (opcional)

Después de haber entrado por lo menos una vez con Google, ejecutá
`supabase/seed.sql` desde el SQL Editor. Crea tres proyectos, doce meses de
movimientos (con gastos compartidos para ver el prorrateo), un par de
planificados y una recurrencia. Todo va prefijado con `[demo]` para que sea
fácil de borrar; las instrucciones de limpieza están al principio del
archivo.

## El buscador de lecciones

Busca en lenguaje natural (*"qué aprendí sobre cobrarle a clientes
chicos"*) combinando **dos rankings**:

1. **Full-text en español** de Postgres (`to_tsvector('spanish', …)`), con
   el título pesando más que el cuerpo. Instantáneo y sin modelo.
2. **Similitud semántica** con pgvector sobre embeddings de 768
   dimensiones.

Se fusionan con **Reciprocal Rank Fusion**, no con una suma ponderada: una
similitud coseno de 0.83 y un `ts_rank` de 0.12 no están en la misma
escala, y normalizarlas a mano habría metido otra constante arbitraria.

El modelo es **`multilingual-e5-base`** (variante `q8`), corriendo local en
un route handler. Se eligió midiendo contra datos reales en español:

| Modelo | Dimensiones | Aciertos |
|---|---|---|
| `gte-small` (el nativo de las Edge Functions de Supabase, solo inglés) | 384 | 2/4 |
| `multilingual-e5-small` | 384 | 2/4 |
| `multilingual-e5-base` q8 | 768 | 3/4 |
| `multilingual-e5-base` fp32 (1.1 GB, indesplegable) | 768 | 4/4 |

**E5 exige prefijos**: `"query: "` para la consulta y `"passage: "` para lo
que se indexa. Sin eso la calidad se cae y el modelo parece peor de lo que
es.

Los pesos (266 MB) **no están en el repo**: los baja `npm run
descargar:modelo`, que corre dentro del `build`. El repo es público y
GitHub rechaza archivos de más de 100 MB.

**La búsqueda nunca depende del modelo.** Si no carga, tarda de más o
falla, la consulta se responde igual solo con full-text.

## Lo que propone el modelo

El motor de inferencia es **Groq**, detrás de `GROQ_API_KEY`. Todas las
llamadas pasan por el servidor y están centralizadas en `src/lib/llm.ts`:
salida JSON validada con Zod antes de tocar la base, reintentos con
backoff, timeout y logging de uso.

**Nada de esto es bloqueante.** Sin Groq —caído, sin cuota o sin key— la
app funciona entera en modo manual: cargar un gasto, escribir una lección
y registrar la bitácora andan siempre.

### Extracción de lecciones desde la bitácora

Un pase que recorre las entradas y le pide al modelo que separe el
registro operativo ("hice la sesión de SQL") del aprendizaje real ("me
trabé con X, la causa era Y"), y reescriba lo segundo como lección
autocontenida.

Las propuestas van a la **bandeja**, nunca directo a `lessons`. Al
aceptar una, se crea la lección con `origen = 'importada'` y se genera su
embedding en segundo plano. Es retomable: cada entrada ya mirada queda
registrada, así que el pase se puede cortar y volver a correr sin
reprocesar ni duplicar.

### Categoría sugerida al cargar un movimiento

En **este orden exacto**:

1. **Contra el histórico**, en SQL y sin modelo. Si la descripción ya
   apareció antes, se usa la categoría de esa vez. Gana la más usada, y
   ante empate la más reciente.
2. **Recién ahí, el modelo**, con la lista de categorías y ejemplos de
   movimientos previos.

El orden no es para ahorrar tokens: es para que las decisiones propias le
ganen siempre a las de un modelo. Y como cada movimiento confirmado entra
al histórico, el paso 2 se llama cada vez menos.

El match tiene dos niveles, y el segundo salió de medir contra datos
reales: las cargas recurrentes se describen con el período adentro
("Claude Pro - Julio", "Vercel Pro - Junio"), así que la descripción
normalizada **nunca se repite** y con comparación exacta todo caía al
modelo. Por eso también se compara el **núcleo**: la descripción sin el
mes ni el año del final. La interfaz distingue los dos casos, porque la
evidencia no es la misma:

| Lo que escribís | De dónde sale | Qué dice la pantalla |
|---|---|---|
| `Vercel Pro - Julio` | histórico, texto idéntico | "como la vez anterior" |
| `Claude Pro - Agosto` | histórico, mismo núcleo | "como los meses anteriores" |
| `Alquiler de oficina` | modelo | "sugerida" |

La sugerencia **nunca decide**: llega precargada y se apaga apenas tocás
tipo o categoría a mano.

### Límites del tier gratuito

El techo que muerde **no son los 30 requests/minuto sino los 6000
tokens/minuto**. Con ~800 tokens por entrada, el pase de extracción se
choca el límite en la cuarta llamada con el contador de pedidos en 4 de
30. El limitador de `llm.ts` cuenta las dos cosas y espera antes de
salir, en vez de comerse el 429.

## Comandos

```bash
npm run dev        # servidor de desarrollo
npm run build      # build de producción (baja el modelo si falta)
npm run start      # servir el build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit

npm run descargar:modelo      # pesos del modelo de embeddings
npm run backfill:embeddings   # genera los embeddings faltantes, retomable
npm run import:colmena        # importador de la app de estudio (histórico)
```

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · shadcn/ui ·
Supabase (Postgres + Auth + Storage + pgvector) · Recharts ·
react-hook-form + Zod · Transformers.js · Vercel.

Tipografía **Fira Sans + Fira Code**. El mono no es decorativo: la clase
`.cifra` lo aplica a montos, fechas y cotizaciones para que las columnas
de plata aliñen en vertical.

La paleta de gráficos está **validada para daltonismo y contraste** en
modo claro y oscuro. Ingresos y egresos van en teal↔naranja y no en
verde/rojo: verde/rojo mide ΔE 6.9 (banda de riesgo) contra 15.9 del par
elegido. Si cambiás las superficies, hay que revalidar — el contraste se
mide contra el fondo real.

Sin librerías de estado global ni ORM: el cliente de Supabase se usa
directo, con tipos en `src/lib/supabase/database.types.ts`. Para
regenerarlos desde el esquema real:

```bash
npx supabase gen types typescript --project-id <ref> --schema public \
  > src/lib/supabase/database.types.ts
```

Después hay que **volver a pegar a mano** el bloque de alias del final del
archivo. Y ojo con un detalle del generador: a los argumentos de funciones
RPC con `default null` no les agrega `| null`. No lo parchees en el
archivo generado —se pierde en la próxima corrida—: pasá `?? undefined`
en el call site, que omite el parámetro y deja que Postgres aplique su
default.

## Notas de seguridad

- Todas las tablas de datos tienen RLS con `auth.uid() = user_id`.
- `fx_rates` es global y de solo lectura para usuarios autenticados; la
  escribe el cron con la service role key.
- El bucket `comprobantes` es privado, con los archivos bajo
  `<user_id>/…` y políticas que validan el primer segmento del path. Las
  descargas van siempre por URL firmada.
- `SUPABASE_SERVICE_ROLE_KEY` no lleva prefijo `NEXT_PUBLIC_` y solo se
  importa desde módulos marcados con `server-only`. Lo mismo vale para
  `GROQ_API_KEY`: todas las llamadas al modelo pasan por el servidor y la
  key nunca llega al browser.
- El export de la app de estudio (`colmena-backup-*.json`) está
  gitignoreado: son entradas personales de bitácora y el repo es público.
