# Presupuestos en Pepe — diseño

> ✅ **APROBADO Y EJECUTADO: las etapas 0 a 5 están en producción** (última
> al 2026-08-11, la tabla de conversión que cierra la etapa 3). El
> encabezado de abajo decía "sin aprobar" porque se escribió sin Beno
> disponible; quedó desactualizado apenas se empezó a construir.
>
> **Solo falta la etapa 6**, el análisis del descarte hecho por un
> razonador, y sigue **bloqueada por diseño** hasta que haya **≥ 10
> presupuestos resueltos**. Al 2026-08-11 hay **cero presupuestos**
> cargados, así que no es una deuda: es una puerta que todavía no se abrió.
> No confundir la 3 con la 6 — la 3 es todo SQL y ya está.
>
> Dos cosas que la etapa 3 resolvió distinto de como las plantea la
> sección "Qué se puede aprender, y cuándo": el **techo** se muestra como
> corchete (aceptado más caro / descartado más barato) en vez de rangos de
> monto, porque con cuatro filas los baldes dan 0 % o 100 %; y las
> **monedas no se mezclan**, porque un presupuesto en USD con tarifa en
> USD no tiene `tasa_usada` que congelar. AGENTS.md §10.

Fecha: 2026-08-10
Estado original: diseño propuesto sin aprobar. Beno no estuvo disponible;
las decisiones que eran suyas se tomaron por la opción más conservadora y
están listadas al final.

Recoge el caso C de
`docs/superpowers/specs/2026-08-10-adjuntos-design.md`, que lo dejó
explícitamente afuera: *"el caso C no es una feature de adjuntos: es otro
proyecto entero disfrazado de frase"*. Este es ese proyecto.

---

## El problema

La frase 15 de las quince que Beno escribió como las tipearía de verdad
es:

```
15. Me haces un presupuesto para x proyecto? aca esta el spec
```

Hoy la app no tiene dónde poner la respuesta. La palabra "presupuesto"
aparece en el repo **solo** en prompts que le prohíben al modelo hablar
de presupuestos porque no existen en los datos
(`agentes/observaciones.ts:75,86`, `retro.ts:114`) y en una línea del
recepcionista que manda "presupuestos" al **buscador**, porque hoy es un
tema sobre el que se escribe y no una cosa que la app hace
(`agentes/recepcionista.ts:284`). No hay tabla, no hay pantalla, no hay
enum.

Y hay un problema de plata debajo del problema de software.
**Beno cobra 20.000 por hora a todos.** Contra las dos fuentes de
referencia que se midieron para este spec, eso es —con precisión
incómoda— el precio del cliente **más chico**: 20.992/h. No está barato
en general; le está cobrando a la empresa el precio del particular. Un
módulo que solo guarde presupuestos no arregla eso. Un módulo que le
muestre la escalera al lado de su tarifa, sí.

---

## Lo que Beno decidió, y sobre lo que se diseña

1. Tiene **una** tarifa hora definida por él.
2. Elige el **tipo de cliente**: particular/emprendedor, pyme o empresa.
3. Le pasa el pedido del cliente — **PDF, texto pegado, capturas, o
   contado por él; y mezclado**.
4. El sistema **estima el esfuerzo** (horas/semanas) leyendo eso.
5. El sistema **propone un presupuesto completo**: precio, cliente,
   tiempos, alcance.
6. **Beno puede editar todos los valores** antes de aprobarlo.
7. **Se exporta a PDF.**

Además:

- **Moneda elegible por presupuesto**: ARS o USD, según el cliente.
- **Si prospera se convierte en proyecto** de Pepe, con su
  `fecha_inicio`. **Si no prospera se descarta con motivo** — no era lo
  que el cliente quería / quedó desactualizado / no prosperó — porque le
  sirve *"como retro para analizar a futuro mi proceso y trayecto"*.
- **Volumen: unos pocos por año.** Se diseña para calidad, no para
  velocidad.
- **El modelo estima esfuerzo, NO pone el precio.**
- **Los avisos no tocan nada**: si su tarifa queda desfasada, la app
  avisa y él decide.

---

## Los datos de referencia, verificados de nuevo el 2026-08-10

Las dos fuentes se volvieron a bajar y a parsear para este spec, con
`curl` y `node`, sin browser. Las dos anduvieron.

### Fuente 1 — flamahaus

`https://flamahaus.com/tarifarios/` → **HTTP 200, 319.702 bytes,
`text/html`**.

El bloque `const DATA = [ … ];` está en el HTML servido y sale con un
solo regex. **93 objetos**, claves exactamente `cat, name, desc, A, B, C`,
repartidos en 7 categorías (`Audiovisual y Multimedia`,
`Desarrollo Web y Apps`, `Diseño`, `Contenido IA`, `Marketing Digital`,
`Video y Fotografía`, `Servicios por Hora`).

`A` = empresa (>100 empleados), `B` = pyme, `C` = particular/emprendedor.

Los tres anclas que importan (ARS/hora), leídos del HTML de hoy:

| servicio | A empresa | B pyme | C particular |
|---|---:|---:|---:|
| Desarrollo Web Frontend / Backend (por hora) | 62.975 | 41.983 | 20.992 |
| Programación Backend / DevOps / Cloud (por hora) | 71.972 | 47.981 | 23.991 |
| Desarrollo Aplicaciones Móviles (por hora) | 78.719 | 52.479 | 26.240 |

Y proyectos cerrados: Landing 674.730 / 449.820 / 224.910 · App web a
medida (MVP) 4.498.200 / 2.998.800 / 1.499.400 · Sitio corporativo
1.799.280 / 1.199.520 / 599.760 · Mantenimiento mensual 305.877 /
203.918 / 101.959.

**La escalera se verificó sobre las 93 filas, no sobre las de ejemplo:
`A = 3×C` y `B = 2×C` se cumplen en 93 de 93, con tolerancia de 1 peso.**
Cero violaciones. Eso convierte la escalera en algo que se puede
*asertar* en el cron, no solo en algo que se cree.

**Hallazgo nuevo, y es el que salva al parser.** La respuesta trae un
header `Link:` con
`<https://flamahaus.com/wp-json/wp/v2/pages/859>; rel="alternate"`. Ese
endpoint contesta 200 con 1.671 bytes de JSON y trae
**`modified_gmt: "2026-06-22T23:25:29"`** (y `date_gmt` de enero). O sea:
hay una fecha de última modificación autoritativa, oficial y baratísima
de consultar, que confirma el "actualizado jun 2026".

`content.rendered` viene **vacío** (la página la arma un page builder),
así que **el endpoint no reemplaza al scraping**: los precios siguen
saliendo del HTML. Pero sirve para lo único que hace accionable una
alarma —ver más abajo, "Falla ruidoso"—.

### Fuente 2 — salancy

El CSV público de `salarios.gonzalopozzo.com` bajó con `curl` →
**HTTP 200, 193.120 bytes, `text/csv`**. Encabezado exacto:
`Marca temporal, Posición, Seniority, Pais de residencia, Moneda, Salario bruto mensual`.
**2.344 filas, 2.079 de Argentina**, marcas temporales entre el
2026-01-12 y el 2026-01-15.

Medianas reproducidas (devs argentinos por el filtro amplio de la tabla
de abajo, USD convertido a 1520):

| seniority | n | bruto mensual | /hora (160 hs) |
|---|---:|---:|---:|
| Junior (1 a 3 años) | 375 | **1.824.000** | **11.400** |
| Semi Senior (3 a 5) | 683 | 3.031.871 | 18.949 |
| Senior (+5 años) | 488 | **5.624.000** | **35.150** |

Los dos números en negrita salen **idénticos** a los del brief. El `n`
difiere (375 contra 322) porque depende de qué posiciones cuentan como
"dev", y eso vale la pena medirlo porque es la crítica obvia:

| filtro de posición | n junior | mediana | /hora |
|---|---:|---:|---:|
| regex `Developer\|Engineer\|Programador\|Desarroll` | 375 | 1.824.000 | 11.400 |
| solo Fullstack + Backend + Frontend Developer | 318 | 1.815.420 | 11.346 |
| todas las posiciones de Argentina | 482 | 1.826.910 | 11.418 |

**Menos de 1 % de diferencia entre los tres.** El filtro no cambia la
conclusión, y eso es exactamente lo que uno quiere de una referencia.

Segunda robustez, la del dólar. De los 318 junior dev, **74 (23 %)
cotizaron en USD** y 244 en ARS, así que mover el dólar mueve poco la
mediana:

| dólar usado | mediana mensual | /hora |
|---:|---:|---:|
| 1.300 | 1.750.000 | 10.938 |
| 1.520 | 1.815.420 | 11.346 |
| 1.800 | 1.896.000 | 11.850 |

Un ±18 % en el dólar mueve la mediana ±4 %. **La referencia no es
sensible a con qué cotización se la convierta**, así que el cron puede
usar la del día (`fx_rates`) sin inventar una constante.

### La validación cruzada, que es lo mejor que tiene este diseño

Salancy es relación de dependencia. Para autónomo se multiplica por
**2,0** (rango convencional 1,8–2,5) por aguinaldo, obra social,
vacaciones, monotributo y horas no facturables:

```
11.400 × 2,0 = 22.800 ARS/hora
```

Contra los **20.992** de flamahaus para cliente particular: **9 % de
diferencia, por dos métodos totalmente independientes** —un tarifario
publicado por una escuela de creatividad y una encuesta abierta de
sueldos—. Esto no es un detalle de color: es lo que justifica que la app
se anime a decirle a Beno que su tarifa está corrida. Con una sola
fuente sería una opinión.

**Y contra eso, los 20.000 que Beno cobra hoy son el escalón de abajo,
para todos los clientes por igual.**

---

## Esquema

Convenciones del repo: **tablas y claves foráneas en inglés, columnas y
enums en español**. RLS por `auth.uid() = user_id`. `archivado_en` y
borrado por archivado (regla 4).

### Enums

```sql
create type public.tipo_cliente as enum ('particular', 'pyme', 'empresa');

create type public.estado_presupuesto as enum (
  'borrador', 'enviado', 'aceptado', 'descartado'
);

-- Los tres motivos son los que dijo Beno, textuales, más una bolsa.
-- No se inventan categorías: el punto de este campo es que él pueda
-- releer por qué se cayeron sus presupuestos, y una taxonomía que no
-- sea suya no le sirve para eso.
create type public.motivo_descarte as enum (
  'no_era_lo_que_queria', 'quedo_desactualizado', 'no_prospero', 'otro'
);
```

### `quotes`

| Columna | Qué | Notas |
|---|---|---|
| `id`, `user_id` | | |
| `numero` | Correlativo por usuario | `unique (user_id, numero)`. Es lo que dice el PDF: "Presupuesto Nº 7" |
| `project_id` | El proyecto, **solo cuando prospera** | `null` hasta que se acepta |
| `cliente_nombre` | Texto libre | Sin tabla `clients`, ver decisión 3 |
| `cliente_tipo` | `tipo_cliente` | Lo que elige el multiplicador |
| `titulo`, `resumen_alcance` | El qué | |
| `pedido_texto` | **Lo que Beno pegó o dictó** | Es la entrada del modelo y lo que citan las anclas. Ver "Dependencia de adjuntos" |
| `moneda` | Reusa el enum `moneda` existente | ARS o USD |
| `tarifa_hora` | **Congelada** | La tarifa de Beno *en ese momento* |
| `multiplicador` | **Congelado** | El del tipo de cliente *en ese momento* |
| `tasa_usada`, `tasa_fecha` | **Congeladas** | Solo si hubo conversión. Mismos nombres que `movements` |
| `horas_estimadas` | Suma de los ítems al guardar | Editable |
| `horas_por_semana` | **Congelada** | Con qué se convirtió horas → semanas |
| `semanas_estimadas` | Calculada, editable | |
| `total_origen` | El precio final, **editable a mano** | |
| `fecha` | `date`, string `YYYY-MM-DD` | |
| `validez_dias` | Default 15 | |
| `mostrar_horas` | Default **false** | Si las horas van al PDF. Ver decisión 6 |
| `condiciones` | Texto libre, default desde `settings` | "50 % al aceptar, 50 % a la entrega" |
| `estado` | `estado_presupuesto`, default `borrador` | |
| `enviado_en`, `resuelto_en` | `date` | |
| `motivo_descarte`, `motivo_detalle` | | |
| `reemplaza_a` | FK a `quotes(id)` | Para la cadena "quedó desactualizado → hice otro" |
| `modelo` | Qué modelo estimó, o `null` si fue a mano | |
| `archivado_en`, `created_at`, `updated_at` | | |

Checks, con el criterio que ya usa el repo para
`artifacts` (`(estado = 'completado') = (fecha_completado is not null)`)
y `sessions`:

```sql
check ((estado = 'descartado') = (motivo_descarte is not null))
check ((estado = 'aceptado') = (project_id is not null))
check (tarifa_hora > 0 and multiplicador > 0)
-- Las dos o ninguna, nunca una sola: es el mismo criterio que
-- `teoria_hecha = (teoria_fecha is not null)` en `sessions`.
check ((tasa_usada is null) = (tasa_fecha is null))
check (total_origen >= 0)
```

El segundo es fuerte a propósito: **aceptar un presupuesto ES crear o
elegir el proyecto**. Sin eso, "aceptado" queda como un rótulo que no
cambia nada, y la mitad de la gracia era que el presupuesto entrara a
Pepe como proyecto con su `fecha_inicio`.

**No hay check sobre `enviado_en`**, y es deliberado: un presupuesto se
puede descartar sin haberlo mandado nunca ("quedó desactualizado" antes
de enviarlo es un caso real y es de los que más enseñan).

### `quote_items`

| Columna | Qué |
|---|---|
| `id`, `user_id`, `quote_id` (`on delete cascade`) | |
| `orden` | `unique (quote_id, orden)` |
| `titulo` | El entregable |
| `detalle` | Qué incluye |
| `horas` | `numeric check (horas >= 0)` |
| `origen` | `'modelo'` \| `'manual'` |
| `ancla` | **La cita literal del pedido en la que se apoya la estimación** |
| `ancla_verificada` | `boolean` — si la cita aparece de verdad en `pedido_texto` |
| `confianza` | `'alta'` \| `'media'` \| `'baja'` |

`ancla` es el corazón del control antiinvención y tiene sección propia
más abajo.

### `quote_assumptions` y `quote_questions`

Dos tablas chicas (`quote_id`, `orden`, `texto`) en vez de dos arrays
`jsonb`: los supuestos van al PDF y se editan uno por uno, y las
preguntas se tachan a medida que el cliente contesta. Un `jsonb` que se
edita ítem por ítem es un `jsonb` que quería ser una tabla.

### `settings`, columnas nuevas

`settings` ya existe (`20260808000001_zombies.sql:41`) y su comentario
dice literalmente que es *"el lugar donde va a ir cayendo lo que hoy son
constantes y mañana Beno quiera tocar sin redesplegar"*. Es acá.

```sql
alter table public.settings
  add column tarifa_hora numeric(14, 2) check (tarifa_hora > 0),
  add column tarifa_moneda public.moneda not null default 'ARS',

  add column multiplicador_particular numeric(6, 3) not null default 1,
  add column multiplicador_pyme       numeric(6, 3) not null default 2,
  add column multiplicador_empresa    numeric(6, 3) not null default 3,

  add column horas_por_semana numeric(5, 2) not null default 20
    check (horas_por_semana between 1 and 80),

  -- Contra qué fila de flamahaus se compara su tarifa.
  add column servicio_referencia text not null default 'desarrollo-web-hora',
  -- Contra qué escalón de salancy.
  add column seniority_referencia text not null default 'junior',

  add column emisor_nombre text,
  add column emisor_contacto text,
  add column condiciones_default text;

alter table public.settings
  add constraint settings_multiplicadores_ordenados
  check (multiplicador_particular <= multiplicador_pyme
     and multiplicador_pyme <= multiplicador_empresa);
```

Los defaults 1 / 2 / 3 **no son un número redondo elegido a ojo**: son la
escalera medida de flamahaus, verificada en 93 de 93 filas.

`tarifa_hora` arranca en `null` a propósito: sin tarifa cargada la
pantalla de presupuestos pide cargarla antes que nada, en vez de
inventarle un valor por defecto y que Beno cotice con él sin darse
cuenta.

`seniority_referencia` es una preferencia y no una constante porque
**Beno no va a ser junior para siempre**, y un aviso calibrado contra el
escalón equivocado se calla justo cuando más falta hace.

**El histórico de la tarifa de Beno no necesita tabla.** Cada presupuesto
congela la suya, y a unos pocos por año esa serie de filas *es* el
histórico, con la ventaja de que cada valor está pegado al presupuesto en
el que se usó. Es el mismo razonamiento por el que `movements` congela
la tasa en vez de guardar una tabla de "qué tasa usaba yo en marzo".

### `rate_runs` y `rate_references`

Las dos **sin `user_id`**, como `fx_rates`: la referencia de mercado es
la misma para todos y la app es de un solo usuario pero conviene
modelarlo bien. RLS `select` para `authenticated`, escritura solo por
service role (el cron).

```sql
create table public.rate_runs (
  id uuid primary key default gen_random_uuid(),
  fuente text not null check (fuente in ('flamahaus', 'salancy')),
  fecha date not null,                    -- cuándo corrió
  estado text not null check (estado in ('ok', 'sin_cambios', 'sospechoso', 'error')),
  motivo text,                            -- qué falló, en castellano
  filas integer,                          -- cuántas se parsearon
  huella text,                            -- sha256 de lo parseado
  marca_origen text,                      -- modified_gmt / máxima Marca temporal
  crudo jsonb,                            -- solo si estado = 'sospechoso'
  corrido_en timestamptz not null default now(),
  unique (fuente, fecha)
);

create table public.rate_references (
  id uuid primary key default gen_random_uuid(),
  fuente text not null,
  fecha date not null,                    -- la corrida que la trajo
  clave text not null,                    -- 'desarrollo-web-hora', 'landing', 'salario-junior'
  segmento public.tipo_cliente,           -- null para salancy
  unidad text not null check (unidad in ('hora', 'mes', 'proyecto')),
  monto_ars numeric(16, 2) not null check (monto_ars > 0),
  unique (fuente, fecha, clave, segmento)
);

create index rate_references_lookup_idx
  on public.rate_references (clave, segmento, fecha desc);
```

**La referencia vigente para una fecha es la última fila con
`fecha <= X`**, exactamente el criterio de `fx_rate_for_date`. Por eso
una corrida que no encuentra cambios (`sin_cambios`) **no escribe filas
de referencia**: si escribiera, el histórico serían 52 filas idénticas
por año y el gráfico de "cómo se movió la referencia" pasaría a ser una
línea de puntos redundantes. El histórico útil es la serie de cambios,
no la serie de corridas — y las corridas quedan en `rate_runs`, que es
donde se mira si el cron está vivo.

> ⚠ **Las dos tablas van a `TABLAS` en `src/lib/respaldo.ts`**, junto con
> `quotes`, `quote_items`, `quote_assumptions` y `quote_questions`. Lo
> pide `AGENTS.md` con todas las letras: *"si agregás una tabla al
> esquema, agregala a `TABLAS`"*. Son seis tablas nuevas; olvidarse de
> una no da ningún error, solo un respaldo incompleto.

---

## El precio se calcula sin modelo

`src/lib/presupuestos.ts`, módulo **puro** (sin `server-only`, para que
el MCP lo pueda importar — ver `AGENTS.md` §8):

```
precio = redondear( horas × tarifa_hora × multiplicador(tipo_cliente) )
semanas = horas / horas_por_semana
```

Redondeo por moneda, según `src/lib/format.ts`: **ARS sin decimales, USD
con dos.**

Nada de esto pasa por un modelo, y eso es la regla de `AGENTS.md` §9
aplicada al pie de la letra: *"si algo se puede resolver sin modelo, se
resuelve sin modelo"*. El modelo devuelve horas; la aritmética es
aritmética.

**Las semanas también son aritmética**, y por eso el prompt tiene
prohibido hablar de calendario: cuántas semanas son 60 horas depende de
cuántas horas por semana le dedique Beno, que el modelo no sabe y la app
sí (`settings.horas_por_semana`, default 20 — conservador para alguien
con tres proyectos vivos).

---

## Moneda: se congela, y se congela una sola vez

Regla 1, sin excepciones.

- Si `quotes.moneda` coincide con `settings.tarifa_moneda`, no hay
  conversión y `tasa_usada` queda en `null`.
- Si no coincide, se resuelve la tasa **de la fecha del presupuesto** con
  `fx_rate_for_date` —la de esa fecha o la última anterior— y se congelan
  `tasa_usada` y `tasa_fecha` en la fila, con los mismos nombres de
  columna que `movements`.
- **Al releer un presupuesto NUNCA se recalcula nada.** Ni el total, ni
  la conversión, ni el precio por hora. Un presupuesto de marzo dice lo
  que decía en marzo. Es el mismo criterio que `retros.balance_ars` /
  `balance_usd`.
- **La única recotización posible es explícita y crea una fila nueva**:
  descartar el presupuesto viejo como `quedo_desactualizado` y generar
  uno nuevo con `reemplaza_a` apuntando al anterior. No hay un botón que
  "actualice" un presupuesto ya mandado, porque eso reescribiría un
  documento que el cliente ya tiene en la mano.

Es el eco exacto de `efectuarMovimiento()`, la única recotización de la
app: al cambiar de estado se recalcula contra la fecha real, y queda
registrado.

---

## La estimación de esfuerzo con modelo

Es el corazón y es lo más riesgoso: un presupuesto se manda a un cliente
y compromete plata.

### Qué modelo y con qué presupuesto de tokens

**`MODELO_RAZONADOR` (`openai/gpt-oss-120b`) con `esfuerzo: "medium"`.**

El razonamiento de `AGENTS.md` §6.d aplica igual acá: el enemigo es la
generalidad. Con `llama-3.3-70b-versatile` las lecciones de 6.3 salían
como rótulos y **agregarle ejemplos al prompt no movió la aguja: el techo
era el modelo**. Un entregable llamado "Desarrollo del backend, 40 horas"
es exactamente el mismo fracaso: es un rótulo con un número al lado, no
una estimación. Y a unos pocos presupuestos por año, la latencia y los
tokens del razonador son gratis.

`MODELO_GRANDE` se descarta por el mismo motivo por el que quedó sin usar
en el resto de la app: la entrada acá es acotada (un pedido de cliente,
no un histórico entero), así que el contexto grande no compra nada.

| Parámetro | Valor | Por qué |
|---|---:|---|
| `maxTokens` | **4500** | La salida son hasta 12 entregables con detalle y ancla, más supuestos y preguntas, y los **tokens de razonamiento salen de ahí adentro** (medidos en 2.668 con `medium` en 6.3). La retro usa el mismo número. Quedarse corto **no degrada: trunca, no valida contra el esquema y se pierde la llamada entera** (§6.d) |
| `PRESUPUESTO_PEDIDO_CHARS` | **6000** | ~2.000 tokens con `CHARS_POR_TOKEN = 3` |
| `temperatura` | 0.3 | Más baja que la retro (0.4): acá inventar cuesta plata |
| `timeoutMs` | 180.000 | Igual que la retro |

**Y hay que decir la parte incómoda: esta llamada no entra en un minuto,
y está bien.** La cuenta que hace el limitador es sistema (~1.500 tokens:
el prompt es largo, con nueve reglas antiinvención enumeradas) + pedido
(≤ 2.000) + `maxTokens` (4.500) ≈ **8.000**, contra el techo de 7.300 que
`lib/llm.ts` le da al razonador. O sea que dispara la salida de
emergencia `noEntraNunca` (`llm.ts:243`): espera a que la ventana se
vacíe y **sale igual**, porque esperar más no lo arregla — el minuto
siguiente tiene el mismo techo.

Se acepta a propósito, por tres motivos:

1. **El uso real está muy por debajo.** La estimación reserva
   `maxTokens` entero y `CHARS_POR_TOKEN = 3` es conservador; el gasto
   real esperado ronda los 5.500–6.500 tokens, contra el techo real de
   Groq de 8.000. El 429 no llega.
2. **Bajar los números para que entren es peor.** Recortar `maxTokens` a
   3.800 mete la salida a 300 tokens del techo con el razonamiento
   adentro, y truncar pierde la llamada entera. Es exactamente el error
   que documenta §6.d con la lista de 6.3 volviendo con una sola
   lección.
3. **Cuesta como mucho un minuto, unas pocas veces por año.** Es el
   mismo costo que la retro ya paga y que su propio comentario declara:
   *"dos retros seguidas dentro del mismo minuto esperan. No importa: se
   dispara a mano al cerrar un proyecto, de a una."*

La consecuencia práctica, escrita para que no sorprenda: **dos
presupuestos seguidos dentro del mismo minuto, el segundo espera.**

Si el pedido pasa de 6.000 caracteres se recorta y **la pantalla lo
dice**: un presupuesto armado sobre medio pedido, en silencio, es peor
que ninguno.

> El corte en 6000 caracteres es de la etapa 1 y es el mismo criterio con
> el que el spec de adjuntos corta los PDF en 60 páginas: *"que lo diga
> es mejor que que tarde"*. Un spec de 30 páginas son ~95.000 caracteres
> y no entra por acá; entra por el pase troceado y retomable de adjuntos,
> que es la etapa siguiente.

### La regla antiinvención, enumerada

Calcada del enfoque de `lib/retro.ts`, que está medido: la primera
corrida de la retro inventó un "plazo previsto" que no existía, procesos
que supuestamente faltaron y consecuencias que nadie registró, y lo que
lo arregló **no fue decir "no inventes" sino enumerar los errores
concretos uno por uno**. El modelo respeta la lista, no el principio.

La lista de acá no es la de la retro traducida: son los errores que
comete un modelo estimando un pedido de cliente.

```
Regla número uno, y la que más se rompe sola: **todo entregable que
listes tiene que estar pedido en el texto que te di.** Errores concretos
que NO tenés que cometer:

1. **Inventar entregables que el pedido no menciona.** Nada de "diseño de
   identidad", "capacitación al equipo", "migración de datos" ni
   "documentación técnica" si el pedido no los pide. Si te parece que
   falta algo, va en "preguntas", nunca en la lista de entregables.
2. **Poner precios, montos, tarifas o moneda.** No los sabés y no es tu
   trabajo. Devolvés horas y nada más.
3. **Nombrar tecnologías que el pedido no nombra.** Si no dice con qué
   está hecho, no digas "React", "WordPress", "Postgres" ni "AWS".
4. **Hablar de semanas, meses, plazos o fechas de entrega.** Devolvés
   horas de trabajo. Cuántas semanas son eso depende de cuántas horas por
   semana le dedique, y ese dato no te lo dieron.
5. **Inventar cantidades.** "5 pantallas", "3 integraciones", "unos 200
   productos": si el número no está escrito en el pedido, no está.
6. **Dar por sentado que el cliente aporta algo** —contenido, diseño,
   accesos, hosting, dominio— si el pedido no lo dice. Eso va en
   "supuestos", que es justamente para lo que estás asumiendo.
7. **Estimar lo que no entendiste.** Si una parte del pedido es ambigua,
   va en "preguntas" con la cita, no en un ítem con horas inventadas.
8. **Redondear para arriba "por las dudas".** El margen lo pone él
   después. Si vos también lo ponés, se cuenta dos veces y el presupuesto
   se va de precio sin que nadie haya decidido eso.
9. **Estimar el proyecto entero de una.** Un solo ítem de 200 horas no es
   una estimación, es un número. Partilo en entregables que se puedan
   discutir de a uno.

Ante la duda, menos ítems y más preguntas. Una lista corta y anclada vale
más que una larga y adornada.
```

Y la vara del título, la misma que rige 6.3, 6.4 y 6.5:
**el título de un entregable dice QUÉ SE ENTREGA, con nombre y apellido,
no un rótulo de etapa.** "Desarrollo backend" y "Testing y QA" son
rótulos; "Endpoint de importación del CSV de productos, con validación y
reporte de errores" es un entregable.

> ⚠ Esta es la vara **alta**, la de 6.3, y no la baja del extractor de
> bitácora. `AGENTS.md` §6 explica cuándo va cada una: la vara baja
> ("ante la duda, proponela") existe porque el extractor **reescribe lo
> que Beno vivió y escribió**, y ahí un falso negativo es una lección
> suya que no ve nunca. Acá es al revés: el modelo produce afirmaciones
> sobre material de un tercero y **un falso positivo termina en un
> documento que se manda a un cliente**. Los dos errores no cuestan
> igual, otra vez, pero en el otro sentido.

### El ancla, y por qué acá se puede verificar por código

Mismo criterio que el `ancla` de `lib/sugerencias.ts` y el `dato` de las
observaciones: **la salvaguarda contra lo inventado es poder ver la
fuente al lado**. El prompt pide:

```
Cada entregable lleva un campo "ancla" con la CITA LITERAL del pedido en
la que te apoyás: copiada tal cual, sin reescribirla, sin corregirle la
ortografía y sin traducirla. Máximo 200 caracteres. Si no podés copiar
una frase del pedido que justifique el entregable, el entregable no va.
```

**Y acá hay algo que las otras features no pueden hacer: verificar el
ancla mecánicamente.** El pedido es un texto que la app tiene entero, así
que después de validar el esquema se comprueba que cada `ancla`
—normalizada: minúsculas, sin acentos, espacios colapsados, con el mismo
criterio de `normalizar()` en `retro.ts:437`— **aparezca como substring
de `pedido_texto` normalizado**. En la retro y en las sugerencias el
ancla se lee y se juzga a ojo; acá se testea.

Qué se hace con un ancla que no verifica:

- **No se descarta el ítem en silencio.** Ese es el error que
  `AGENTS.md` §6 previene con el estado `error` de la bandeja: lo que no
  valida queda visible, no desaparece.
- El ítem llega al formulario con `ancla_verificada = false` y **la
  pantalla lo marca en rojo con la leyenda "esta cita no está en el
  pedido"**. Beno lo borra con una tecla o lo deja si le parece bien.
- Si **más de la mitad** de los ítems tienen el ancla sin verificar, la
  pantalla lo dice arriba de todo y sugiere rehacer la estimación. Es la
  señal de que el modelo se fue de tema entero, y un ítem a la vez no la
  muestra.

### La salida

```ts
const respuestaSchema = z.object({
  resumen_alcance: z.string().trim().min(1).max(1200),
  entregables: z.array(z.object({
    titulo:    z.string().trim().min(1).max(160),
    detalle:   z.string().trim().max(600),
    horas:     z.number().min(0.5).max(400),
    ancla:     z.string().trim().min(1).max(200),
    confianza: z.enum(["alta", "media", "baja"]),
  })).min(1).max(12),
  supuestos: z.array(z.string().trim().min(1).max(300)).max(8),
  preguntas: z.array(z.string().trim().min(1).max(300)).max(6),
});
```

`horas` con techo de 400 por ítem no es prolijidad: es el reflejo en el
esquema de la regla 9 del prompt. Un ítem de 500 horas es el proyecto
entero sin partir, y que no valide es preferible a que llegue.

### Dónde termina: en pantalla, no en la bandeja

**No pasa por `inbox`, y el razonamiento es el que ya está escrito en el
repo dos veces.**

- `AGENTS.md` §6.c, sobre el clasificador: *"el formulario es el panel de
  confirmación que pide la sección 6 del spec, por eso esto no pasa por
  inbox"*.
- El spec de agentes, sobre el agente de movimientos: *"porque hay
  alguien mirando en el momento en que se propone"*.

Un presupuesto se dispara a mano y se edita entero antes de existir. La
bandeja está diseñada para lo contrario —un ítem por vez, sin scroll, A/R/P/E—
y meter ahí un documento de doce ítems editables sería romper justo lo
que la hace usable.

**Y la fila no nace sola.** Se calca el precedente de la retro
(`retro.ts:24-33`): *"el texto se devuelve y no se guarda […] recién si
Beno aprieta Guardar pasa a la tabla"*. La estimación vuelve a pantalla
como borrador editable y la fila de `quotes` aparece con "Guardar". Sale
más caro si se cierra el browser —la llamada tarda—, y por eso está en
las decisiones a confirmar; pero es la opción conservadora y es la que ya
eligió este proyecto para el documento más parecido.

---

## El cron semanal de referencias

### Dónde corre: Vercel, y por qué no GitHub Actions

`vercel.json` ya tiene dos crons (`/api/cron/fx` diario y
`/api/cron/zombies`) y la cuenta es Pro. El tercero va ahí:

```json
{ "path": "/api/cron/tarifas", "schedule": "0 13 * * 1" }
```

Lunes 13:00 UTC = **10:00 de Argentina**, arranque de semana. Si falla,
Beno tiene la semana entera para verlo antes de que importe.

El respaldo diario **no** está en `vercel.json` y está bien que no esté:
`AGENTS.md` explica que lo agenda un workflow de GitHub Actions porque
*"así agendar y guardar son el mismo paso"* — el archivo se guarda en el
repo, así que el que agenda ya está donde va el resultado.

**Acá el resultado va a Supabase, y el que escribe Supabase es la app.**
Un workflow de GitHub tendría que guardarse la service role key de
Supabase para escribir dos tablas, o sea meter la credencial más
peligrosa del proyecto en una tercera plataforma, para ganar nada. La
lógica del respaldo, aplicada a este caso, apunta al revés.

**Semanal y no diario** porque las fuentes se mueven en meses, no en
días: flamahaus tiene `modified_gmt` de junio (`date_gmt` de enero) y el
CSV de salancy tiene todas sus marcas temporales entre el 12 y el 15 de
enero. Un cron diario haría siete veces los pedidos para traer lo mismo.

### Falla ruidoso: la validación va antes de escribir

El criterio se copia del workflow de respaldos, que **valida antes de
commitear** —HTTP 200, JSON parseable, marca `__pepe`, conteos distintos
de cero— porque el archivo es uno solo y *"un JSON roto committeado se
llevaría puesto el último respaldo bueno, en silencio, y te enterarías el
día que lo necesitás"*.

Acá es igual de traicionero: un presupuesto mal calibrado tampoco avisa.

**Las asserts de flamahaus, todas verificadas contra la página de hoy:**

| # | Assert | Medido hoy |
|---|---|---|
| 1 | HTTP 200 y `content-type: text/html` | ✓ |
| 2 | Hay exactamente un `const DATA = [ … ];` | ✓ (1 ocurrencia) |
| 3 | `JSON.parse` del bloque no explota | ✓ |
| 4 | `filas >= 80` | ✓ 93 |
| 5 | Todas las filas tienen `cat, name, desc, A, B, C` y A/B/C finitos > 0 | ✓ |
| 6 | **La escalera: `abs(A − 3C) ≤ 1` y `abs(B − 2C) ≤ 1` en todas las filas** | ✓ 93/93, 0 violaciones |
| 7 | Los tres servicios ancla existen por nombre exacto | ✓ |
| 8 | El ancla principal cae entre 2.000 y 2.000.000 ARS/hora | ✓ 20.992 |
| 9 | Salto contra la última referencia guardada ≤ ±60 % | primera corrida: no aplica |

El **6** es el más valioso y es el que salió de medir. Si mañana
flamahaus cambia a A = 2,5×C, el parser sigue funcionando y devuelve
números perfectamente plausibles, pero **el mapeo A/B/C → segmento y los
multiplicadores por defecto de Ajustes dejan de tener el respaldo que los
justifica**. Es la clase de rotura que un `try/catch` no ve.

El **9** no falla la corrida: la deja en **`sospechoso`**, guarda lo
parseado en `rate_runs.crudo` y **no escribe ninguna referencia**. En
Argentina un salto grande puede ser un aumento real, así que la app no
decide: muestra el antes y el después en Ajustes y Beno acepta o
descarta la corrida. Es la regla 6 aplicada a un scraper.

> Se evaluó mandar ese aviso a `inbox` y se descartó: la bandeja es *"el
> portón por donde entra todo lo que propone un modelo"*, y esto no lo
> propone un modelo. Diluir su contrato es exactamente el tipo de cosa
> contra la que este repo advierte. Vive en Ajustes, al lado de las
> referencias.

**Las asserts de salancy:**

| # | Assert | Medido hoy |
|---|---|---|
| 1 | HTTP 200 y `content-type: text/csv` | ✓ |
| 2 | Encabezado exacto de las seis columnas | ✓ |
| 3 | `filas >= 1500` | ✓ 2.344 |
| 4 | `filas de Argentina >= 1000` | ✓ 2.079 |
| 5 | Solo aparecen las monedas `ARS` y `USD` | ✓ |
| 6 | Cada seniority que se guarda tiene `n >= 30` | ✓ 318 / 578 / 383 |
| 7 | Hay una cotización en `fx_rates` para la fecha de la corrida | — |

El **5** importa: si aparece una moneda nueva, la conversión no está
definida y una mediana sobre unidades mezcladas es un número sin
significado que igual se ve razonable.

El **7** obliga a usar el Oficial BNA que ya guarda `/api/cron/fx` en vez
de clavar 1520 en el código. Se puede porque se midió que la elección de
cotización mueve la mediana ±4 % con el dólar ±18 %.

**Si alguna assert falla, no se escribe ni una fila de referencia.** La
corrida queda en `rate_runs` con `estado = 'error'` y `motivo` en
castellano, y el handler devuelve **HTTP 500** para que la corrida figure
como fallida en el panel de Vercel.

### El detector de cambios que hace accionable la alarma

Éste es el aporte del `wp-json` que se encontró midiendo. Cada corrida de
flamahaus guarda `modified_gmt` en `rate_runs.marca_origen`. Cuando el
parseo falla, el mensaje **no es "falló el parser"**, es una de dos cosas
distintas:

| `modified_gmt` | Diagnóstico | Qué hacer |
|---|---|---|
| **cambió** desde la última corrida ok | Tocaron la página. Es lo esperable el día que rediseñen | Arreglar el parser contra el HTML nuevo |
| **igual** que la última corrida ok | La página no cambió: se cayó el fetch, se movió el theme o hay un WAF nuevo | Mirar la red antes que el regex |

Sin esa distinción, toda alarma de scraping dice lo mismo y no se puede
priorizar. Con ella, el mail que llega ya trae la primera mitad del
diagnóstico. El `id=859` sale del header `Link:` de la propia página, así
que ni siquiera hace falta hardcodearlo — aunque hardcodearlo con el
comentario de dónde salió también es válido.

### Nunca servir un precio viejo como si fuera de hoy

Tres capas, y la tercera es la que cumple el requisito de verdad:

1. **Se valida antes de escribir.** Nada parcial entra a
   `rate_references`.
2. **La corrida fallida es visible**: 500 en el cron de Vercel y fila
   `error` en `rate_runs`.
3. **Los avisos se apagan solos.** Si pasaron **21 días** (tres ciclos
   semanales) sin una corrida `ok` o `sin_cambios` de una fuente, esa
   fuente pasa a **vencida**: el aviso de tarifa desfasada **desaparece**
   y en su lugar la pantalla dice *"las referencias de flamahaus están
   vencidas desde el 10/07; no se está comparando contra nada"*.

La tercera es la importante. Un aviso que se calla es infinitamente mejor
que un aviso calculado contra números de hace tres meses, porque el
segundo se lee igual de convincente que uno bueno. Es el mismo espíritu
que *"la falta de inventario es un error"* del respaldo: el silencio
tiene que ser ruidoso.

**Y la pantalla muestra siempre las dos fechas, que no son la misma:**

```
flamahaus   corrida 10/08/2026  ·  datos de jun 2026    ✓
salancy     corrida 10/08/2026  ·  datos de ene 2026    ✓
```

Salancy es una encuesta de enero que probablemente no se actualice nunca;
eso no es un error y no tiene que verse como uno. Lo que sí sería un
error es que la **corrida** quedara vieja. Mezclar las dos fechas en una
sola es cómo se termina confiando en un número de hace un año.

---

## Los avisos: dicen números, no juicios

Cálculo puro sobre `rate_references` + `settings`, sin modelo. No tocan
nada: es una línea en Ajustes y una línea discreta en la pantalla de
presupuestos.

Con los datos de hoy y la tarifa de hoy (20.000 ARS/h, `particular` como
servicio de referencia `desarrollo-web-hora`, `junior` en salancy):

```
Tu tarifa base: 20.000 ARS/hora.

Referencia flamahaus (jun 2026), Desarrollo Web Frontend / Backend:
  particular  20.992   ·   pyme  41.983   ·   empresa  62.975

Referencia salancy (ene 2026), junior en relación de dependencia:
  11.400/hora  →  22.800/hora como autónomo (×2 por costos propios)

Con tus multiplicadores (×1 / ×2 / ×3) estás cobrando
  particular  20.000   ·   pyme  40.000   ·   empresa  60.000
```

Reglas del aviso:

- **Se compara contra el mismo segmento**, nunca contra un promedio.
  Comparar la tarifa de Beno contra "el mercado" a secas es justo el
  error que lo tiene cobrándole a todos el precio del más chico.
- **Se muestra el número, no un consejo.** Nada de "deberías subir tu
  tarifa". La app pone las tres columnas al lado y Beno decide, que es
  literalmente lo que pidió.
- **Umbral de ±15 %** para que el aviso aparezca. Con los datos de hoy la
  desviación es de −4,7 % contra particular, así que **hoy este aviso no
  se muestra**, y está bien: la tarifa base de Beno está bien puesta para
  su cliente más chico. Lo que está mal es que se la cobre a todos, y eso
  lo arreglan los multiplicadores, no un aviso.
- El factor autónomo (**2,0**, rango convencional 1,8–2,5) va **escrito
  en el texto del aviso**, no escondido en una constante. Un número que
  transforma un dato no puede ser invisible.

---

## Editar antes de aprobar

La pantalla del presupuesto es un formulario entero, no una vista previa
con un botón. Todo se edita: título del entregable, detalle, horas, orden,
agregar y borrar ítems, supuestos, preguntas, condiciones, validez, y el
**total a mano** —porque a veces el número que sale de la cuenta no es el
número que uno quiere mandar—.

Marcas de procedencia, calcadas del formulario de movimientos del spec de
agentes ("no es adorno: es un libro de cuentas"):

```
Entregable   [ Endpoint de importación del CSV de productos   ]  ● del pedido
  horas      [ 12 ]                                              ● estimado · confianza media
  ancla      "que se puedan subir los productos con un excel"    ✓ verificada

Entregable   [ Panel de administración                        ]  ● del pedido
  horas      [ 30 ]                                              ● estimado · confianza baja
  ancla      "un panel para administrar todo"                    ⚠ no está en el pedido
```

Al tocar un campo su marca se apaga y `origen` pasa a `manual`. Es el
mismo comportamiento que la sugerencia de categoría, que *"se apaga
apenas Beno elige tipo o categoría a mano"*.

Y arriba, siempre visible: **horas totales → semanas → precio**,
recalculándose con cada edición. Que la relación entre las tres cosas sea
visible mientras se edita es la mitad del valor de la pantalla.

---

## El PDF

### Qué hay hoy

**Nada.** `package.json` no tiene ninguna dependencia que genere PDF —ni
la tiene el spec de adjuntos, que necesita *leer* PDF y para eso propone
`unpdf`—. Hay que decidirlo acá.

### Lo que se midió, el 2026-08-10

Con `npm install --package-lock-only` y `npm audit --json` sobre un
proyecto vacío:

| Opción | Paquetes en el árbol | Advisories |
|---|---:|---:|
| **Hoja de estilos de impresión** | **0** | **0** |
| `pdf-lib` | 5 | 0 |
| `jspdf` | 23 | 0 |
| `@react-pdf/renderer` | 67 | 0 |

**`npm audit` no discrimina: las tres librerías están hoy en cero.** El
requisito de `AGENTS.md` se cumple con cualquiera, así que la decisión
tiene que apoyarse en otra cosa.

### La decisión: hoja de estilos de impresión

La ruta `/presupuestos/[id]/pdf` es una **página normal de Next** con un
bloque `@media print`, y Beno la exporta con Ctrl+P → "Guardar como PDF".

Por qué, en orden de peso:

1. **Cero dependencias nuevas.** Es el mismo criterio con el que el spec
   de adjuntos eligió `unpdf` sobre `pdf-parse`.
2. **La tipografía ya está.** Fira Sans y Fira Code llegan por
   `next/font/google` (`app/layout.tsx:2`) y la clase `.cifra` alinea las
   columnas de plata. Con `@react-pdf/renderer` habría que conseguir los
   **`.ttf` de Fira Sans aparte**, porque `next/font` entrega `woff2` y
   `@react-pdf` no lo usa: o se commitean (~400 KB, OFL, entran) o se
   bajan en el build como los pesos del modelo. Es trabajo real para
   llegar a la misma tipografía que el navegador ya tiene cargada.
3. **Un renderer menos que mantener.** Con una hoja de impresión, el PDF
   *es* la pantalla. Con una librería son dos layouts que se van
   separando en silencio, y el que se rompe es el que nadie mira: el que
   se manda al cliente.
4. **Volumen.** Unos pocos por año. Un Ctrl+P no es una fricción.

Lo que cuesta, dicho derecho:

- **El navegador imprime su propio encabezado y pie** (URL, fecha,
  numeración) salvo que se destilde "Encabezados y pies de página".
  Chrome se acuerda de la elección, así que es una vez, pero es una vez
  que hay que saber. Es el defecto real de esta opción.
- **No queda un archivo del lado del servidor.** Ver abajo por qué no
  hace falta.
- El nombre del archivo lo elige el navegador a partir del `<title>`, que
  se puede fijar en `Presupuesto 7 – Cliente`. Alcanza.

### No hace falta guardar los bytes del PDF

Suena a que sí, porque un presupuesto mandado es un documento que hay que
poder recuperar. Pero **lo que se congela son las entradas, no la
salida** —`tarifa_hora`, `multiplicador`, `tasa_usada`, `tasa_fecha`,
`horas_por_semana`, los ítems—, así que la misma fila renderiza siempre
el mismo documento, hoy y en dos años.

Es exactamente el razonamiento de la regla 1: `movements` no guarda una
foto del formulario, guarda la tasa. Y es además el argumento que ya usó
el respaldo para **no** meter los bytes de los comprobantes adentro del
JSON.

### Impresión: la única vez que el fondo va blanco

`AGENTS.md` es terminante: *"fondo crema, nunca blanco puro. Si aparece
`#fff` en una superficie, está mal."* En `@media print` la superficie
deja de ser una pantalla y pasa a ser papel: el crema `#FFFDF5` se
imprime como una mancha beige que gasta tinta y se ve sucio.

La hoja de impresión pone fondo blanco y texto casi negro, **y ese es el
único lugar del repo donde eso es correcto**. Va con comentario, porque
si no el primero que lo vea lo va a "arreglar".

---

## Si prospera: se convierte en proyecto

Aceptar un presupuesto abre un paso corto: elegir un proyecto existente o
crear uno nuevo.

Al crear se llenan `nombre` (el del presupuesto o el del cliente), `slug`
derivado, `color` de los **ocho tonos validados** que ya ofrece Ajustes
—no un picker libre, para que los gráficos no se llenen de colores sin
validar—, `peso_prorrateo` en 1 y **`fecha_inicio`** con la fecha
acordada.

> ⚠ **Un proyecto activo más cambia el reparto de los gastos
> compartidos.** No es un detalle: `calcularParticipaciones()`
> (`src/lib/prorrateo.ts`) reparte por `peso_prorrateo` entre los
> proyectos **activos de hoy** y aplica ese reparto a **todo el
> histórico**, como explica largo el encabezado de
> `20260810000001_proyectos_fechas.sql`. O sea que aceptar un
> presupuesto **le cambia a Beno los balances por proyecto que viene
> mirando** (no el general, que suma el compartido una sola vez).
>
> No se arregla en este spec —es el trabajo de pasarle la fecha del
> movimiento al prorrateo, con su propia verificación del invariante—,
> pero **la pantalla lo avisa antes de crear el proyecto**. Que un
> número cambie es tolerable; que cambie sin que nadie lo dijera, no.
>
> La buena noticia es que cargar `fecha_inicio` desde acá es
> exactamente el dato que ese trabajo va a necesitar.

**No se crea ningún movimiento.** Un ingreso planificado por el total
sería tentador y ensuciaría el balance proyectado con plata que todavía
no se cobró y que quizá no se cobre nunca. Fuera de alcance.

---

## Si no prospera: el descarte con motivo

Descartar pide un motivo del enum y deja un `motivo_detalle` libre. La
fila **no se borra**: regla 4, se archiva o se deja descartada, y sigue
participando de cualquier lectura histórica.

### Qué se puede aprender, y cuándo

Con "unos pocos por año", el primer año esto es **una tabla que se mira,
no un modelo que opina**. Todo SQL, cero tokens:

- Tasa de aceptación **por tipo de cliente**. Si los `empresa` se caen
  todos, el multiplicador ×3 está mal calibrado *para sus clientes*, que
  es distinto de estar mal calibrado en abstracto.
- Tasa de aceptación **por rango de monto**. Dónde está el techo real.
- **Días entre `enviado_en` y `resuelto_en`.** Un `quedo_desactualizado`
  con muchos días adentro no es culpa del cliente.
- Cadenas de `reemplaza_a`: cuántas veces hubo que rehacer el mismo
  presupuesto.
- **Horas estimadas contra horas reales**, el día que exista de dónde
  sacar las reales. Es el dato más valioso de todos y hoy la app no lo
  tiene. Anotado abajo.

Los tres motivos no enseñan lo mismo, y la pantalla los separa:

| Motivo | Qué te dice |
|---|---|
| `no_era_lo_que_queria` | **Leíste mal el pedido.** Es el que apunta a la estimación y al prompt |
| `quedo_desactualizado` | **Tardaste.** Apunta al proceso, y se cruza con los días |
| `no_prospero` | Casi nada. Es la bolsa: el cliente desapareció, se cayó el proyecto de su lado |
| `otro` | Lo que enseña está en `motivo_detalle`, no en el enum |

**Una retro comercial hecha por un modelo queda explícitamente fuera de
la etapa 1.** Con cuatro filas resueltas, un razonador opinando sobre el
proceso comercial de Beno produce exactamente el consejo genérico que
`lib/sugerencias.ts` prohíbe con su regla número uno. Se mira de nuevo
cuando haya **≥ 10 presupuestos resueltos**, que a este ritmo son unos
tres años.

---

## Errores y modo degradado

Regla 7: si Groq está caído o se acabó la cuota, **la app sigue entera**.

| Falla | Qué pasa |
|---|---|
| Groq caído o sin cuota al estimar | **El presupuesto se carga a mano.** El formulario es el mismo, con la lista de entregables vacía y el botón de agregar. El error se muestra discreto |
| La salida no valida contra el esquema | Se trata como falla de modelo. **No se escribe nada**: no hay fila a medio hacer que limpiar |
| El ancla de un ítem no está en el pedido | El ítem llega marcado, no se descarta. Si son más de la mitad, se avisa arriba |
| El pedido pasa de 6000 caracteres | Se recorta y **la pantalla lo dice**. Nunca en silencio |
| No hay tarifa cargada en Ajustes | La pantalla pide cargarla. **No se inventa un default** |
| No hay cotización para convertir a USD | Se resuelve la última anterior (`fx_rate_for_date`). Si no hay ninguna, el presupuesto se hace en ARS y lo dice |
| El cron de tarifas falla | Corrida `error` en `rate_runs` + HTTP 500. **No se escribe ninguna referencia** |
| Las referencias pasan de 21 días | Los avisos **se apagan** y la pantalla dice que están vencidas |
| Salto de más de ±60 % en una referencia | Corrida `sospechoso`. No se escribe. Beno acepta o descarta en Ajustes |
| Se pierde la conexión mientras se edita | Se pierde el borrador (no está guardado). Es el costo de calcar el precedente de la retro; ver decisión 5 |

**Nada del módulo de presupuestos necesita un modelo para funcionar.** La
estimación automática es un acelerador; cargar, editar, calcular,
exportar, aceptar y descartar andan sin Groq.

---

## Dependencia del spec de adjuntos

Es la dependencia grande y hay que decirla derecho. Beno nombró **cuatro
formas** de pasar el pedido: PDF, texto pegado, capturas, o contado por
él. Y aclaró: **mezcladas**.

| Forma | ¿Se puede sin el spec de adjuntos? |
|---|---|
| **Texto pegado** | **Sí.** Un `<textarea>` que escribe `pedido_texto` |
| **Contado por él** | **Sí.** Es lo mismo: lo escribe o lo dicta en la caja |
| **PDF** | **No.** Necesita el bucket, la tabla `attachments` y `unpdf` |
| **Capturas** | **No.** Necesita todo lo anterior más `qwen/qwen3.6-27b` |
| **Mezcladas** | **No**, por definición |

**Lo que se puede construir entero hoy**: el esquema, la tarifa y los
multiplicadores en Ajustes, el cálculo del precio, el congelamiento de
moneda, el cron de referencias con sus avisos, la pantalla de edición, el
PDF, la conversión en proyecto y el descarte con motivo. **Es la mayor
parte del módulo**, y la estimación con modelo funciona sobre texto
pegado, que es la mitad de las formas que nombró Beno.

**Lo que no se puede sin adjuntos** es el caso de la frase 15 tal como la
escribió: *"acá está el spec"*. O sea: **la feature entera anda, pero el
disparador exacto que la motivó, no.** Hay que decirlo así.

Cuando el spec de adjuntos exista, lo que falta acá es chico:

1. `quote_attachments (quote_id, attachment_id)`.
2. Concatenar `attachments.texto_extraido` a `pedido_texto` para armar la
   entrada. **La columna no cambia** — por eso `pedido_texto` es texto y
   no un puntero a un archivo.
3. Un pedido largo (un spec de 30 páginas son ~95.000 caracteres) no
   entra en los 6000 de la etapa 1 y necesita el pase troceado y
   retomable que ese spec ya diseña.

### Y una dependencia en la otra dirección, que conviene ver ahora

El spec de adjuntos propone un **test sobre un string** en `despacho.ts`:
si la frase dice "presupuesto", "cotización" o "cotizar", la caja
contesta que todavía no sabe hacer presupuestos, guarda el archivo y no
gasta un token. **Cuando este módulo se implemente, ese test hay que
sacarlo** y en su lugar aparece un destino nuevo.

Y ahí está el costo real, que no es de código:

> **Un destino `presupuesto` toca el prompt del recepcionista, que es de
> vidrio.** `AGENTS.md` §9 documenta **cuatro incidentes medidos** de
> romper casos que ni siquiera se nombraron, uno de ellos justamente con
> la palabra `"pricing"`. Y no es una colisión hipotética: hoy el prompt
> tiene escrita la línea *"'presupuestos', 'facturación' o 'costos' son
> temas sobre los que se escribe"*, que manda esa palabra al
> **buscador** a propósito (`recepcionista.ts:284`).

O sea que el destino nuevo **choca con una línea que existe y que se puso
midiendo**. La regla de §9 aplica sin atenuantes: **antes de tocar ese
prompt, medir; después de tocarlo, volver a medir.** El piso de regresión
son las cuatro ambiguas sueltas (`"Claude Code"`, `"Proder"`,
`"pricing"`, `"Vercel Pro"`, todas por debajo de 0.6) y las seis simples
de una sola acción.

**Por eso el destino nuevo va último, no primero.** El módulo se
construye y se usa entrando por su propia pantalla —`/presupuestos`, con
su botón—, que no toca ningún prompt. La entrada por la caja es la
frutilla, y se paga con una medición.

---

## Etapas, y el tamaño real

No es chico. Seis tablas, un enum de cliente, tres enums nuevos, un cron
con dos parsers, un prompt de riesgo alto, una pantalla de edición
grande, un PDF y dos integraciones con módulos existentes.

| Etapa | Qué | ¿Necesita adjuntos? | ¿Necesita modelo? |
|---|---|---|---|
| **0** | Esquema + tarifa y multiplicadores en Ajustes + presupuesto **a mano** + PDF | No | **No** |
| **1** | Cron de referencias, histórico y avisos | No | No |
| **2** | Estimación con modelo sobre texto pegado | No | Sí |
| **3** | Aceptar → proyecto · descartar con motivo · la tabla de conversión | No | No |
| **4** | PDF y capturas como entrada | **Sí** | Sí |
| **5** | Destino `presupuesto` en el recepcionista | No | Sí + **medición** |
| **6** | Análisis del descarte con modelo | No | Sí, con **≥ 10 resueltos** |

**La etapa 0 no llama a ningún modelo y ya sirve sola**: hoy Beno no
tiene dónde guardar un presupuesto. Ese orden no es casual — es la regla
7 construida en el orden de las etapas en vez de parcheada al final.

---

## Qué NO entra

- **Facturación, cobranza, IVA, monotributo, datos fiscales.** Un
  presupuesto no es una factura y meterle un CUIT lo empieza a
  convertir en una.
- **Una tabla `clients`.** A unos pocos presupuestos por año, un CRM es
  cinco tablas para ahorrar tipear un nombre. `cliente_nombre` es texto.
- **Firma o aceptación online del cliente.** Otro producto.
- **Plantillas de presupuesto.**
- **Versionado dentro de la misma fila.** Un presupuesto que cambia se
  descarta como `quedo_desactualizado` y se hace otro con `reemplaza_a`.
  Editar un documento que el cliente ya tiene es mentirle al histórico.
- **Multi-moneda por ítem.** Un presupuesto, una moneda.
- **Un ingreso planificado automático al aceptar.**
- **Mandar el mail.**
- **Horas reales contra estimadas.** No hay dónde cargar las reales hoy.
- **Más fuentes de referencia.** Se investigaron nueve y sirvieron dos.
  Las otras siete no vuelven a mirarse.
- **Que el modelo ponga el precio.** Nunca.

---

## Decisiones que Beno tiene que confirmar

Todas se tomaron por la opción más conservadora para no dejar el spec
bloqueado. Ninguna es difícil de revertir.

| # | Decisión tomada | La alternativa | Por qué se eligió así |
|---|---|---|---|
| 1 | **PDF por hoja de estilos de impresión (Ctrl+P)** | `@react-pdf/renderer` (67 paquetes, 0 advisories medidos) | Cero dependencias, la tipografía y la paleta ya están cargadas, y un solo layout que mantener. **Es la decisión más probable de que Beno dé vuelta**: el costo es el encabezado del navegador y que no queda un archivo del lado del servidor. La alternativa ya está investigada y medida, así que subir cuesta poco |
| 2 | **Aceptar exige proyecto** (`check` en la base) | Aceptar y linkear después | "Si prospera se convierte en proyecto" era el pedido. Un "aceptado" que no crea nada es un rótulo |
| 3 | **Sin tabla `clients`** | Un mini-CRM | Unos pocos por año. Si algún día hay clientes que repiten, sale de mirar `cliente_nombre` |
| 4 | **Los cuatro motivos de descarte, y solo esos** | Una taxonomía más fina (precio, plazo, competencia, sin respuesta) | Los tres primeros son textuales de Beno. Una taxonomía que no es suya no le sirve para releer su propio proceso |
| 5 | **El borrador no se guarda solo** | Nacer como fila `borrador` apenas contesta el modelo | Calca el precedente de la retro, que es el documento más parecido de la app. El costo es perder el borrador si se cierra el browser, y en un presupuesto se edita más que en una retro: es el segundo candidato a revisarse |
| 6 | **Las horas NO van al PDF** (`mostrar_horas` default `false`) | Mostrarlas siempre | Mostrar las horas convierte la charla en una discusión de tarifa horaria, que es justo el mecanismo por el que hoy le cobra a todos el precio del más chico. El switch existe por si en algún cliente conviene |
| 7 | **Un solo tarifario de referencia por vez** (`servicio_referencia`) | Comparar contra los trece servicios por hora | Un aviso que compara contra trece cosas no dice nada. Cambiar cuál es un select en Ajustes |
| 8 | **Factor autónomo 2,0 fijo en código** | Configurable | Rango convencional 1,8–2,5. Es una perilla que nadie sabe mover bien y va escrita en el texto del aviso, así que se ve |
| 9 | **Umbral del aviso ±15 %, vencimiento a los 21 días** | Otros números | 21 días son tres ciclos semanales: dos corridas fallidas seguidas todavía no apagan nada. ±15 % es lo que separa una desviación de ruido |
| 10 | **`horas_por_semana` default 20** | 40 | Beno tiene tres proyectos vivos y trabaja solo. Un default de 40 promete plazos que no se cumplen, y un plazo incumplido en un presupuesto cuesta más que uno holgado |
| 11 | **Corte del pedido en 6.000 caracteres, y se acepta esperar un minuto** | Recortar los números para entrar en la ventana de un minuto | Recortar `maxTokens` para no esperar mete la salida al borde del truncado, y truncar pierde la llamada entera. Esperar cuesta un minuto unas pocas veces por año. Trocear pedidos largos es el trabajo de la etapa 4, junto con adjuntos |
| 12 | **El cron corre en Vercel** | GitHub Actions, como el respaldo | El resultado va a Supabase y el que escribe Supabase es la app. Un workflow necesitaría la service role key guardada en GitHub, para no ganar nada |
| 13 | **La corrida sospechosa vive en Ajustes, no en `inbox`** | Mandarla a la bandeja | La bandeja es el portón de lo que propone **un modelo**. Un scraper no lo es, y diluir ese contrato es el tipo de cosa contra la que este repo advierte |
| 14 | **Multiplicadores ordenados por `check`** | Sin restricción | `particular ≤ pyme ≤ empresa` atrapa el error de tipeo. Si algún día Beno quiere romper el orden, se cae un check y se discute |

---

## Lo que hay que medir antes de dar la etapa 2 por buena

Todo lo de arriba sobre las fuentes está medido. **La estimación no.**

1. **Correr el prompt contra dos o tres pedidos reales de sus clientes.**
   Mirar tres cosas, en este orden:
   - ¿Las anclas **verifican** contra el pedido? Ese número es medible sin
     opinión y es el primer semáforo.
   - ¿Los títulos son entregables o rótulos? Si sale "Desarrollo backend,
     40 horas", el techo es el modelo y hay que medir alternativas, igual
     que se hizo en 6.d.
   - ¿Las horas son plausibles **para Beno**? Un modelo estima para un dev
     genérico y él tiene su propia velocidad. Si están sistemáticamente
     bajas o altas, no se toca el prompt: se agrega un factor personal en
     `settings`, que es un número que él puede calibrar y el modelo no.
2. **Comparar contra `MODELO_GRANDE` en el mismo pedido**, aunque el
   razonamiento diga que gana el razonador. En 6.d el orden esperado se
   dio vuelta al medirlo.
3. **Mirar el `usage` real contra los 8.000 de Groq.** Se da por
   descontado que el limitador propio va a esperar (la estimación da
   ~8.000 contra un techo de 7.300); lo que hay que confirmar es que el
   gasto **real** quede debajo de 8.000 y no llegue un 429. Si llegara,
   la salida es bajar `PRESUPUESTO_PEDIDO_CHARS`, no `maxTokens`:
   truncar la respuesta es peor que recortar la entrada, porque la
   entrada recortada se avisa en pantalla y la truncada se pierde
   entera.
4. Después de agregar las dependencias —si finalmente entra alguna—,
   `npm audit` tiene que seguir en **cero**, y
   `npm run typecheck && npm run lint && npm run build` en verde.

Es el mismo criterio con el que se eligió el modelo de embeddings y con
el que se descartó llama para 6.3: **medir contra datos reales en
español, no contra la documentación.**

---

## Anotado, no resuelto acá

- **Horas reales.** El dato que volvería útil de verdad al histórico de
  presupuestos es estimado contra real, y hoy la app no tiene dónde
  cargar horas trabajadas. Es otra feature (y probablemente otro spec).
- **El prorrateo por fecha.** Aceptar presupuestos va a crear proyectos
  seguido, y cada proyecto activo nuevo mueve el reparto de los gastos
  compartidos hacia atrás. La migración `20260810000001` ya lo dejó
  escrito y las columnas puestas; este módulo lo vuelve más frecuente.
- **`inbox` no participa de este módulo.** Es la primera feature con
  salida de modelo que no toca la bandeja. Vale la pena chequear que la
  regla siga siendo la que dice `AGENTS.md` §6.c —hay alguien mirando—
  y no que se esté abriendo una excepción por comodidad.
- **El respaldo tiene que crecer seis tablas.** `TABLAS` en
  `src/lib/respaldo.ts`. Sin eso el backup queda incompleto sin ningún
  error visible, que es la peor forma de fallar en un backup.
- **`rate_references` no tiene `user_id`.** Copia el modelo de
  `fx_rates`, que ya está en `TABLAS` y se respalda igual. Si algún día
  la app deja de ser de un solo usuario, las referencias siguen siendo
  compartidas y eso está bien.
- **Los avisos y el MCP.** `presupuestos.ts` es puro y sin `server-only`
  a propósito, así que el día que se quiera "¿cómo vengo de tarifa?"
  desde Claude Code, la regla ya está en un solo lugar.
