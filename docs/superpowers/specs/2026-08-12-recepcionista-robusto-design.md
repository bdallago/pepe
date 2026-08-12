# Un recepcionista que se pueda tocar — diseño

> ✅ **EJECUTADO el 2026-08-12**, con una excepción medida: **la etapa B3
> se corrió, falló su criterio de aceptación y se revirtió.** El plan es
> `../plans/2026-08-12-recepcionista-robusto.md`.
>
> **Lo que la ejecución encontró y este spec no preveía:** el bloque de
> confianza hacía **dos** cosas, no una. Además de fijar la banda,
> sus cuatro ejemplos **anclaban qué destino elegir** para una frase
> ambigua, y a `ambiguedad.ts` se mudó solo lo primero. Medido con
> `"el hosting de Vercel Pro"`: pasó de `suscripciones` 0.3 a
> `movimientos` 0.4 —y ese 0.4 es `acotarConfianza()` recortando, no el
> modelo—, más tres frases que subieron de 0.9 a 1. El detalle está en
> AGENTS.md §9.
>
> **No se reintenta**, y no por prudencia: los 345 tokens no aceleran la
> medición (5500 ÷ 2268 sigue dando 2 llamadas/min, ya estaba anotado acá
> abajo) y el comportamiento visible no cambia. El objetivo de la etapa B
> —que la ambigüedad no dependa del prompt— **lo cumple B2 solo**.
>
> **El orden se cambió durante la ejecución**, a pedido de Beno: la etapa
> C fue primero. Fue la decisión correcta y por un motivo medible: con el
> atajo puesto antes, 9 de las 29 frases dejan de llamar al modelo y toda
> medición posterior sale más barata.

El recepcionista (`src/lib/agentes/recepcionista.ts`) es la puerta de
entrada de toda la app: una frase de Beno entra ahí y sale como una lista
de acciones. Es la pieza de la que dependen los catorce destinos, y es la
única cuyo bloque de comentarios documenta **seis mediciones a mano y
cuatro incidentes de rotura**.

Este spec no viene a mejorar lo que elige. Viene a que **se pueda tocar
sin miedo**, que hoy es lo que no se puede.

## El problema, en una frase

> *"No tiene sentido que se rompa cada vez, debería ser nuestro agente
> más importante."* — Beno, 2026-08-12

## El diagnóstico: no es el prompt

La lectura natural es que el prompt es frágil. Es cierto pero no es la
causa: **la causa es que verificarlo cuesta entre 15 y 47 minutos de
reloj, así que no se verifica.**

Medido el 2026-08-12 sobre el archivo real:

| | |
|---|---|
| Prompt del sistema | 6887 caracteres · 128 líneas |
| Tokens reservados por llamada | ~2613 (`prompt/3 + maxTokens`) |
| Techo de `MODELO_CHICO` | 5500 tokens/minuto |
| **Llamadas que entran por minuto** | **2** |

Y con eso, el costo de una medición:

| Alcance | Llamadas | Tiempo |
|---|---|---|
| El piso (10 frases × 3 corridas) | 30 | ~15 min |
| El piso ampliado (16 × 3) | 48 | ~24 min |
| El corpus real completo (31 × 3) | 93 | ~47 min |

La frase que ya está escrita en el propio archivo —*"el prompt pasó de
~2100 a ~2275 tokens, o sea que medirlo tarda más a cada línea"*— es
literal, y es un costo que crece con cada destino nuevo.

### Las tres consecuencias

1. **El piso de regresión es prosa en un comentario**, no algo que se
   corra. Las dieciséis frases y sus resultados esperados están escritos
   en castellano dentro de un bloque de 300 líneas. Nadie puede
   verificarlas sin volver a armar el arnés desde cero, seis veces
   seguidas.

2. **Las mediciones anteriores son de una corrida por frase**, y eso no
   alcanza. El propio comentario dice que `"agreguemos lecciones"`
   *"oscilaba entre los dos destinos entre corridas"*: **el modelo no es
   determinístico ni con `temperatura: 0`**. Una corrida no distingue "lo
   arreglé" de "salió bien esta vez", que es exactamente la diferencia
   que uno quiere saber después de tocar el prompt.

3. **La regla que más se rompió es la que menos tendría que estar ahí.**
   El bloque de confianza son 24 líneas y 345 tokens —el **15 % del
   prompt**— y se describe a sí mismo como *"una comprobación mecánica
   sobre la frase, sin pensar en el tema"*: ¿tiene verbo conjugado?
   ¿tiene palabra de pregunta? Eso es un test sobre un string, y AGENTS.md
   ya tiene la regla escrita para este caso: *si algo se puede resolver
   con un test sobre un string, se hace ahí.*

### El precedente ya existe, aplicado una sola vez

`normalizarClavesDecision()` en `tipos.ts` tolera que el modelo escriba
`"confianca"`. Su comentario dice textual: *"esto se arregla acá y no en
el prompt, a propósito"*, y documenta que **uno de los tres intentos
descartados fue exactamente aclarárselo al modelo** — no arregló el typo y
sí rompió el argumento literal de la frase telegráfica.

Lo mismo hace `pareceAnotacion()` en `bitacora.ts` y `textoDelMovimiento()`
en `despacho.ts`. El patrón bueno está identificado tres veces. Lo que
falta es aplicarlo donde más duele.

## La forma de la solución: tres etapas, en orden

No son alternativas. Cada una hace segura a la siguiente.

```
A. El banco y el comando  ──► B. La regla a código  ──► C. El atajo
   (no toca el prompt)          (saca 345 tokens)        (el modelo deja
   riesgo cero                  verificable gratis        de ser la puerta)
```

**Por qué ese orden y no otro:** B no se puede verificar sin A, y C no se
puede verificar sin A ni tiene sentido sin B. Pero además hay una razón
que no es de prudencia: **B hace que verificar salga gratis.** Las cuatro
anclas ambiguas —lo que se rompió las cuatro veces— hoy solo se verifican
disparando 12 llamadas contra Groq (6 minutos). Convertidas en función
pura se verifican **exhaustivamente en milisegundos y sin gastar un
token**.

---

## Etapa A — El banco de frases y el comando

### Qué es

Un archivo de datos con el corpus y un comando que lo corre:

```bash
npm run medir:recepcionista            # el piso: 10 frases, ~15 min
npm run medir:recepcionista -- --todo  # completo: 31 frases, ~47 min
```

### El banco

`src/lib/agentes/banco.ts` — **datos, no lógica**. Cada entrada:

```ts
interface CasoDelBanco {
  frase: string;
  /** De dónde salió. "real" = Beno la tipeó de verdad. */
  origen: "real" | "sintetica";
  /** En el piso o solo en el corpus completo. */
  piso: boolean;
  espera: {
    /** Uno o varios aceptables; el orden no importa. */
    destinos: Destino[];
    /** Cuántas acciones tiene que devolver. */
    acciones: number;
    /** Banda de confianza aceptable, inclusive. */
    confianza: [number, number];
    /** Cómo tiene que volver el argumento. */
    argumento?: "literal" | "contiene" | "null";
    /** Para "contiene": qué no puede faltar (una fecha, un monto). */
    contiene?: string[];
  };
}
```

Nace con las **31 frases que ya están documentadas** en los comentarios de
`recepcionista.ts` y en AGENTS.md §9: las 4 ambiguas, las 6 simples, las 5
telegráficas, las 15 reales de Beno y la de presupuestos. **No se inventa
ninguna.** Las que Beno tipeó de verdad se marcan `origen: "real"`, y esa
marca importa: son las que no se pueden negociar.

### El corredor

`scripts/medir-recepcionista.ts`. Lo que hace, en orden:

1. Corre cada frase del alcance elegido **N veces** (default 3).
2. Por frase acumula: destinos devueltos, confianzas, argumentos.
3. Compara contra `espera` y contra la **línea base** guardada.
4. Escribe la tabla y devuelve **código de salida ≠ 0 si algo falló**.

### Las tres decisiones que no son obvias

**1. Mide oscilación, no aciertos.** Una frase que da el destino correcto
**2 de 3 veces no pasa**. Es el agujero de todas las mediciones
anteriores: con una corrida por frase, la inestabilidad de
`"agreguemos lecciones"` fue visible solo porque alguien la corrió dos
veces de casualidad. La columna que más importa de la tabla es
`osciló`, no `ok`.

**2. Es retomable y muestra progreso**, como `backfill:embeddings`. A 2
llamadas por minuto, una corrida completa son 47 minutos: si se corta a
los 30 no se puede perder lo hecho. El estado va a un JSON en
`.medidas/` (gitignoreado, igual que `.modelos/`).

**3. La línea base se commitea; las corridas no.**
`docs/dev/recepcionista-linea-base.json` es el "antes" contra el que se
compara, y entra al repo para que el diff de un PR muestre **qué
confianzas se movieron**. Es el reemplazo de las seis tandas de prosa del
bloque de comentarios: en vez de escribir el resultado en castellano, se
commitea el número.

### Lo que el comando NO hace

- **No falla el build.** No entra a `npm run build` ni a un hook: 15
  minutos de espera en cada commit sería peor que el problema. Se corre a
  mano antes y después de tocar el prompt, que es cuando importa.
- **No mide calidad de la respuesta final**, solo la decisión del
  recepcionista. Lo que hace cada especialista con esa decisión ya tiene
  sus propios caminos.

---

## Etapa B — La regla mecánica sale del prompt

### Qué se mueve

Las 24 líneas del bloque de confianza —desde *"Antes de elegir la
confianza"* hasta los cuatro ejemplos— salen del prompt y entran a
`src/lib/agentes/ambiguedad.ts` como una **función pura**:

```ts
/** ¿Es un sustantivo o un nombre suelto, sin verbo ni pregunta? */
export function esAmbigua(frase: string): boolean;
```

Y en `recepcionista.ts`, después de que el modelo contesta:

```ts
return datos.acciones
  .slice(0, MAX_ACCIONES)
  .map((a) => (esAmbigua(frase) ? acotarConfianza(a) : a));
```

### La propiedad que la hace segura: acota hacia abajo y nunca hacia arriba

`acotarConfianza()` hace `Math.min(confianza, TECHO_AMBIGUA)` con
`TECHO_AMBIGUA = 0.4`. **Nunca sube una confianza.**

Eso vuelve al cambio incapaz de causar el daño que la app teme. El código
solo puede volver más prudente al sistema, nunca más audaz: el peor caso
de un error acá es **una pregunta de más**, que es explícitamente el error
barato según AGENTS.md §9 (*"una pregunta de más molesta, una derivación
equivocada muda hace lo que nadie pidió"*).

El **destino no se toca**: lo sigue eligiendo el modelo, igual que hoy. El
prompt ya le dice *"elegí el destino más probable igual"* y esa parte se
queda.

### Por qué en código funciona algo que en el prompt no funcionaba

Esto no es una intuición, está medido y escrito en el archivo: pedirle al
modelo la comprobación *"¿hay verbo? ¿hay pregunta?"* como regla abstracta
**dejó `"Claude Code"` en confianza 1**. Lo único que la bajaba eran los
cuatro ejemplos concretos, y el comentario avisa: *"si sacás los ejemplos,
'Claude Code' vuelve a 1"*.

O sea: hoy la regla **no se aplica**, se imita. En código se aplica
siempre, y por eso **los cuatro ejemplos también pueden salir del
prompt** — ya no hay nada que anclar.

### La función, ya prototipada y medida

Se construyó y se corrió contra el corpus antes de escribir este spec:
**44 de 44 casos correctos.** Cuatro señales, en este orden:

| # | Señal | Efecto |
|---|---|---|
| 1 | Palabra de pregunta (`qué`, `cuánto`, `cómo`, `cuál`, `dónde`, `cuándo`, `quién`, `por qué`) | **no** es ambigua |
| 2 | Contiene un dígito | **no** es ambigua |
| 3 | Tiene un verbo conjugado | **no** es ambigua |
| 4 | Ninguna de las anteriores | **es** ambigua |

El punto 3 es el único con sustancia. En rioplatense el imperativo y el
pretérito caen en **vocal acentuada final** (`cerrá`, `anotá`, `sacá`,
`poné`, `hacé`, `reabrí`, `pagué`, `cobré`, `salió`), y eso solo ya
resuelve casi todo. Se le suman:

- **Voseo de segunda persona**: `[áéíóú]s$` — `sugerís`, `tenés`, `querés`.
- **Terminaciones sin acento final**: `-aba, -ía, -amos, -emos, -imos,
  -ando, -iendo` — `tenía`, `agreguemos`, `estábamos`.
- **Una lista cerrada y corta** para los que no caen en ningún patrón:
  `estoy`, `viene`, `toca`, `tengo`, `hay`, `quiero`, `activalo`…

#### Tres cosas que salieron de construirla y hay que conservar

1. **No incluye `-an` ni `-en`.** Matchean demasiados sustantivos
   —`orden`, `imagen`, `margen`, `joven`— y cada uno sería una frase
   ambigua que deja de detectarse.

2. **No hay regla de enclíticos.** El prototipo tenía una
   (`^[a-zñ]{3,}(lo|la|le|…)$` para `activalo`, `sumale`) y **rompió
   `"Google Ads"`**: `"google"` termina en `le`. Los enclíticos reales de
   Beno están en la lista cerrada; la regla general costaba más de lo que
   traía. Fue el único fallo de la última corrida y se resolvió
   borrándola, no ajustándola.

3. **La asimetría de los errores está a favor.** Un falso positivo (dice
   ambigua y no lo era) cuesta una pregunta. Un falso negativo (no la
   detecta) **no acota nada y el comportamiento queda exactamente como
   hoy**: no hay regresión posible, solo mejora que no llegó. Por eso ante
   la duda la función **no** declara ambigüedad.

### Cómo se verifica

- **Los casos de la función: sin tocar Groq.** Un `describe` con los 44
  casos corre en milisegundos. Ahí van las cuatro anclas del piso de
  regresión, que dejan de necesitar el arnés caro.
- **Que el prompt más corto no rompa lo demás: con el arnés de la etapa
  A**, corpus completo, antes y después. Sacar 345 tokens es la clase de
  cambio que este prompt castiga, así que se mide igual que si se
  agregara.

### El riesgo, dicho con todas las letras

Sacar texto del prompt es un cambio del mismo tipo que agregarlo, y este
prompt se rompió cuatro veces por cambios así —dos de ellas **sin nombrar
lo que rompieron**—. La diferencia es que ahora hay con qué medirlo, y que
el resultado que importa (las cuatro anclas) queda protegido por código
aunque el modelo se mueva.

---

## Etapa C — El atajo determinístico

### Qué es

Que las frases mecánicamente decidibles **no lleguen al modelo**.

`decidirDestinos()` pasa a consultar primero un `preRouter` puro:

```ts
type Atajo = { decisiones: Decision[] } | null;
export function atajar(frase: string): Atajo;
```

Si devuelve algo, no hay llamada a Groq. Si devuelve `null`, sigue el
camino de hoy.

### Los dos casos que entran, y por qué solo esos dos

**1. El movimiento telegráfico.** `-20usd Claude Code 06/08` y sus cuatro
hermanas. Ya están medidas: *"las cinco fueron a `movimientos` con
confianza 1 y el argumento volvió idéntico a la frase, las cinco
veces"*. Un signo, un monto, una moneda opcional y una fecha opcional es
una expresión regular, y `agentes/movimientos.ts` **ya la parsea sin
modelo** — hoy se paga una llamada solo para que el modelo diga
"movimientos".

**2. La frase ambigua pura.** Si `esAmbigua()` da `true` y la frase no
llega a tres palabras, la respuesta correcta es preguntar. Preguntar no
necesita saber el destino: la pantalla ya ofrece las cuatro opciones con
el argumento intacto.

**Nada más entra.** No se agregan atajos "porque parecen fáciles": cada
uno es una regla que puede equivocarse en silencio, y el modelo es mejor
que una regexp en todo lo que no sea estrictamente mecánico.

### Lo que compra

- **Estabilidad perfecta donde hay atajo.** Una regexp no oscila entre
  corridas.
- **Latencia cero** en los casos más frecuentes. Hoy una frase
  telegráfica espera al limitador de Groq; medido el 2026-08-11, tres
  frases seguidas tardaron **~59 s cada una**.
- **Cupo liberado**, que es lo que hace que medir sea más barato y que la
  caja se sienta distinta usándola seguido.

### Lo que hay que cuidar

El atajo **no puede tener la última palabra sobre algo que escriba
directo**. Los dos casos elegidos cumplen: `movimientos` termina en un
formulario que Beno confirma, y la frase ambigua termina en una pregunta.
Si alguna vez se quiere atajar `bitacora` —que escribe directo— la
respuesta es que no.

---

## Lo que este spec NO toca

- **El umbral de 0.6 sigue siendo circular** y sigue estando. La etapa B
  lo mejora de hecho —para las frases ambiguas el número ya no lo elige el
  modelo— pero no lo resuelve para el resto, y resolverlo pide una
  calibración que hoy no tiene con qué hacerse. Queda anotado, no
  arreglado.
- **Los catorce destinos y sus fronteras.** Este spec no mueve ni un
  bullet de la lista de especialistas.
- **La partición en múltiples acciones.** Sigue siendo léxica y en el
  prompt.
- **`MAX_ACCIONES`, `temperatura: 0` y `maxTokens: 300`.**

## Criterio de aceptación

**Etapa A**
1. `npm run medir:recepcionista` corre el piso y escribe una tabla con
   destino, banda de confianza, argumento y **oscilación** por frase.
2. Se corta a la mitad y se vuelve a lanzar: **retoma donde estaba**.
3. Con el prompt sin tocar, el piso da verde y queda la línea base
   commiteada.

**Etapa B**
4. Los 44 casos de `esAmbigua()` pasan **sin una sola llamada a Groq**.
5. Las cuatro anclas (`Claude Code`, `Proder`, `pricing`, `Vercel Pro`)
   devuelven confianza **≤ 0.4 en las tres corridas**, con el bloque ya
   fuera del prompt.
6. El corpus completo, antes y después: **ningún destino cambia** y
   ninguna frase que hoy no oscila empieza a oscilar.
7. El prompt baja de **2613 a 2268** tokens reservados, y el comentario
   del archivo dice qué se movió y por qué —sin borrar el registro de los
   cuatro incidentes, que sigue siendo la razón por la que esto existe—.

⚠ **Sacar esos 345 tokens NO hace más rápida la medición, y conviene no
esperarlo.** Medido: 5500 ÷ 2613 = 2 llamadas por minuto, y 5500 ÷ 2268
= 2 también. Hace falta bajar de 1833 tokens para que entre una tercera,
y el prompt no llega ahí sacándole un bloque. Lo que sí acelera medir es
la etapa C, que directamente no llama.

**Etapa C**
8. Las cinco frases telegráficas se resuelven con **cero llamadas** y el
   argumento vuelve idéntico a la frase.
9. El corpus completo sigue dando lo mismo en todo lo que no atajó.

## Cómo se parte en planes

**Las tres etapas son mergeables por separado**, y conviene que lo sean:
A no toca el prompt, así que puede entrar sola y quedarse; B es un cambio
de comportamiento chico y acotado; C es el único que cambia por dónde
entra una frase. Si C se descarta o se pospone, A y B se sostienen solas.

Lo que **no** se puede partir es el orden. B sin A es volver a medir a
mano, que es el problema que este spec vino a resolver.

## Por dónde empezar

La etapa A entera antes de tocar una línea del prompt. Si al construir el
banco aparece una frase documentada cuyo resultado esperado ya no es el
que da hoy, **eso es un hallazgo y va anotado**, no corregido de callado:
es exactamente la clase de deriva silenciosa que este spec viene a hacer
visible.
