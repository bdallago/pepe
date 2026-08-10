# Operar Pepe conversando — diseño

Spec B de dos. El otro es `2026-08-10-prorrateo-por-fecha-design.md`, que
es el modelo de datos que este necesita abajo: B1 no puede escribir una
ventana de vida si las ventanas todavía no significan nada.

## El problema

El 2026-08-10, con el conector recién desplegado, Beno probó tres frases
propias. Las tres fallaron, cada una por un motivo distinto, y las tres
son el criterio de aceptación de este spec.

### Fallo 1 — las fechas de los proyectos

> *"Anota las fechas de apertura y cierre de Proder y El Prode de Beno
> 01/04/26 apertura y 31/07/26 para las dos"*

Devolvió **tres acciones, las tres equivocadas**: dos entradas de bitácora
con el contenido `"Proder"` y `"El Prode"`, y una retro de Proder que
nadie pidió, que dejó tres lecciones esperando en la bandeja.

La causa raíz no es el recepcionista: **no existe ningún destino que
escriba en `projects`.** Hay trece y ninguno toca la ficha de un proyecto.
Cuando un pedido no está cubierto, el recepcionista aterriza en el vecino
léxico más cercano, y "anotá" es el gancho de `bitacora` — que es
**el destino con el gancho más ancho de todos y el único que escribe
directo**. De ahí que un "no sé hacer eso" se haya convertido en dos filas
escritas.

Dos daños secundarios que hay que arreglar aparte:

- **El argumento volvió destrozado.** Las fechas desaparecieron enteras.
  Aunque el destino existiera, con ese argumento no se puede hacer nada.
- **Apareció una `retro` que nadie pidió**, casi seguro por la palabra
  "cierre".

### Fallo 2 — el movimiento a Gentius

> *"Anotame -20usd en Claude Code en el proyecto Gentius. Activalo de
> paso"*

Preguntó bien por la fecha —eso es la regla funcionando— pero el
formulario llegó con **Proyecto: Compartido** en vez de Gentius, y
"activalo de paso" se perdió.

Dos bugs apilados, los dos en `agentes/despacho.ts:503`:

```ts
const nombrado = resolverProyecto(descripcion, proyectos ?? []);
const proyecto = nombrado !== "ambiguo" && nombrado?.activo ? nombrado : null;
```

1. **Filtra por `activo`.** Un proyecto inactivo se cae a "Compartido" en
   silencio. Es exactamente la trampa que `lib/bitacora.ts` documenta con
   un ⚠ y con el relato de la vez que ya pasó: *"`activo` decide si un
   proyecto participa del prorrateo, no si se puede escribir sobre él"*.
   Se repitió, en otro archivo, tres días después.
2. **Busca el proyecto solo dentro de la descripción extraída.** La
   descripción era `"Claude Code"`, así que la palabra "Gentius" nunca
   entró en la comparación. Aunque no filtrara por `activo`, no lo
   habría encontrado.

Y "activalo de paso" se perdió por el mismo agujero del fallo 1.

### Fallo 3 — el proyecto de RRHH desde Claude.ai

> *"quiero que cargues en Pepe todo lo que charlamos sobre el proyecto del
> Agente de RRHH: lo conversado y relevado con las chicas de rrhh que lo
> pidieron, el presupuesto que averiguamos junto con las horas de trabajo,
> las tareas, de que se trata el proyecto, etc etc, todo"*

**Acá el modelo no falló.** Se frenó, explicó que en Pepe no existe ese
proyecto y que el conector no puede crear proyectos, y avisó que lo que
iba a cargar era un resumen suyo y no la voz de Beno. Las dos
observaciones son correctas; la segunda es precisamente la condición bajo
la cual `escribir_bitacora` tiene permiso de escribir directo, y la
detectó sola.

Lo que falta es capacidad: **no hay tool para crear un proyecto, ni para
crear un presupuesto, ni para dejar una nota escrita por un modelo.**

Lo que Beno esperaba —*"te creé un proyecto nuevo junto con un presupuesto
según lo que charlamos, fijate en Pepe para aprobarlo, modificarlo o
rechazarlo"*— es exactamente el patrón de la bandeja, que ya existe.

## B1 · El destino `proyecto`

Catorce destinos. El nuevo cubre crear un proyecto, cerrarlo, reabrirlo,
renombrarlo y mover sus fechas.

**Tiene que aguantar un pedido sobre varios proyectos.** "para las dos" no
es un caso raro: es la frase que originó todo esto. El recepcionista ya
sabe partir una frase en varias acciones —lo hizo, produjo tres— así que
lo que falta no es la maquinaria sino que **el argumento sobreviva al
reparto**. Hoy volvió como `"Proder"` y `"El Prode"`, sin las fechas.

La resolución de las fechas es determinística y no del modelo: `leerFecha`
de `agentes/fechas.ts`, la misma que usan bitácora y movimientos. El
modelo solo tiene que devolver a qué proyecto y qué se le pide.

### Escribe directo

Decisión de Beno, 2026-08-10. El razonamiento es el mismo que habilita a
`agentes/bitacora.ts`: **no hay producción de un modelo.** Las fechas las
dice Beno, leerlas es aritmética de calendario y el nombre del proyecto se
resuelve contra tres filas. No hay nada que confirmar que no haya escrito
él.

⚠ **Con una obligación que no tiene la bitácora**: mover una ventana mueve
balances. La respuesta tiene que decir **qué cambió y qué efecto tuvo**,
no un "listo". Por ejemplo: *"Proder ahora va del 01/04 al 20/07. Eso saca
a Claude Pro de julio de su reparto: pasa a partirse entre los otros
dos."* Sin eso, el usuario descubre el efecto tres pantallas después.

⚠ Y la misma condición de validez de siempre: **si alguna vez el prompt de
este destino pasa a pedirle al modelo que interprete, complete o infiera
fechas, el razonamiento se cae y esto pasa a necesitar la bandeja.**

### Crear un proyecto desde la caja

Cae en el mismo destino. Un proyecto nuevo se crea con nombre y ventana;
el resto (color, peso) queda en los valores por defecto y se edita en
Ajustes. No se pide nada más por conversación: un formulario de seis
campos disfrazado de diálogo es peor que el formulario.

## B2 · Los dos bugs del movimiento, y la pregunta que falta

**El filtro por `activo` se va.** Con el spec A la columna ni siquiera
existe; pero aunque existiera, estar vivo o no **no tiene nada que ver con
poder imputarle un gasto**. Un gasto de un proyecto cerrado se imputa a
ese proyecto: por eso mismo se cerró en esa fecha y no en otra.

**El proyecto se busca en la frase entera, no en la descripción
extraída.** Con una precedencia explícita, porque las dos fuentes pueden
contradecirse:

1. Lo que la frase dice **explícitamente** ("en el proyecto Gentius", "de
   Proder") gana siempre.
2. Si no hay mención explícita, lo que nombre la **descripción** ("Venta
   Proder Keerian"), que es el comportamiento de hoy y sirve.
3. Si no hay ninguna de las dos, **se pregunta**.

**El punto 3 es nuevo y lo pidió Beno**: hoy se asume "Compartido" en
silencio, y eso es una imputación tomada por la app sin decirlo. Se suma a
las preguntas que el agente ya hace por monto, descripción y fecha, con el
mismo criterio y en el mismo orden: primero lo más caro de equivocar.

La pregunta ofrece las tres opciones que existen —un proyecto, compartido,
o ninguno todavía— y **compartido tiene que ser una elección visible**, no
el default silencioso. Cuando la frase es explícita, no se pregunta nada.

## B3 · La salvaguarda de la bitácora

Independiente de todo lo demás, y es lo que evita que el próximo pedido no
cubierto vuelva a escribir basura.

**Si lo que se va a anotar no parece una anotación, se pregunta en vez de
escribir.** El test es sobre el string y no una línea nueva en el prompt.
Después de sacarle el prefijo de pedido, el contenido dispara la pregunta
si cumple **cualquiera** de estas dos:

- tiene **menos de 15 caracteres** o **menos de 3 palabras**; **o**
- resuelve exactamente contra el nombre o el slug de un proyecto o de un
  track, vía `resolverProyecto` / `resolverTrack`.

En cualquiera de los dos casos: *"¿Esto querías anotar en la bitácora, o
querías hacer algo con el proyecto Proder?"* — con las dos salidas a un
click.

`"Proder"` cae por las dos condiciones. Una anotación real de Beno —las
seis que tiene cargadas van de 200 a 1500 caracteres— no cae por ninguna.

⚠ **Va en código y no en el prompt del recepcionista, a propósito.** Es la
regla que ya se aplicó con `textoDelMovimiento()`: si algo se puede
resolver con un test sobre un string, se hace ahí. Ese prompt tiene cuatro
incidentes medidos de romperse por agregarle texto.

## B4 · Tres tools nuevas en el conector

Las tres **a la bandeja**, sin excepción. Son producción de un modelo
sobre tablas de dominio, así que la regla 6 aplica entera y no hay ningún
razonamiento que la exima.

Hacen falta **tres valores nuevos de `tipo_bandeja`**, en su propia
migración y separada de la que los use (un valor de enum no se puede usar
en la misma transacción que lo agregó):

| Valor | Lo deja | Aceptar crea |
|---|---|---|
| `proyecto_dictado` | `registrar_proyecto` | el proyecto, y su presupuesto en `borrador` si el payload lo trae |
| `presupuesto_dictado` | `registrar_presupuesto` | el presupuesto en `borrador`, sobre un proyecto que ya existe |
| `nota_dictada` | `registrar_nota` | una entrada de `daily_log` |

Cada uno tiene su propia tarjeta en la bandeja, y `nota_dictada` reusa
entera la de `nota_de_adjunto` salvo la columna de la izquierda: allá va
la imagen de la que salió el texto, acá va la frase de Beno que lo pidió.
La acción de aceptar se generaliza para tomar los dos tipos en vez de
duplicarse.

### `registrar_proyecto`

Nombre, de qué se trata, y la ventana si se sabe. Deja un ítem
`proyecto_dictado` en `inbox`.

**Y lleva el presupuesto adentro, opcional.** Es la respuesta al orden:
si fueran dos tools independientes, el presupuesto apuntaría a un proyecto
que todavía no existe, y aceptar una frase de Beno costaría dos viajes a
la bandeja. Con el presupuesto en el payload del proyecto, aceptar crea el
proyecto y después el presupuesto en `borrador`, en una sola tarjeta y con
una sola tecla — que es la vara explícita de la bandeja.

Si el proyecto ya existe, `registrar_presupuesto` va solo (abajo).

### `registrar_presupuesto`

Cliente, tipo de cliente, el pedido y los entregables con sus horas.

⚠ **Acá el modelo sí produce**, y lo que produce termina en un PDF que se
le manda a un cliente con el nombre de Beno. Por eso:

- El ítem de bandeja nace **siempre** como `borrador`, nunca como
  `enviado`.
- Los entregables entran marcados como del modelo, igual que los que salen
  de `estimarEsfuerzo()`.
- **El precio no lo calcula el modelo.** Lo calcula la app con la tarifa
  de Ajustes, como ya hace hoy. El modelo estima esfuerzo, nunca plata.

Esto último importa por el caso concreto: Beno mencionó "los 2.400.000 ARS
y las 110/120h". Las horas son estimación y entran; el monto sale de
multiplicar horas por su tarifa, y si no coincide con el que se charló,
**gana la app y se avisa la diferencia**.

### `registrar_nota`

Un texto **escrito por el modelo** que termina siendo una entrada de
bitácora, previa confirmación.

Es el hueco que dejó el fallo 3 y el que Claude detectó solo. La forma ya
existe: es exactamente `nota_de_adjunto`, el texto que un modelo saca de
una captura y que Beno confirma antes de que sea bitácora. Se reusa ese
camino —`aceptarNotaDeAdjunto` y su tarjeta— cambiando solo de dónde vino.

**Y esto es lo que hace que `escribir_bitacora` pueda seguir escribiendo
directo.** Hasta ahora, un resumen del modelo no tenía a dónde ir, y esa
es exactamente la presión que termina aflojando la regla de la otra tool.
Con `registrar_nota` existiendo, la separación es nítida y verificable:
tu texto va directo, el suyo va a la bandeja.

## B5 · Recalibrar el recepcionista, medido

**Paso propio, no efecto colateral.** Agregar un destino a ese prompt
rompió cuatro veces casos que ni siquiera nombraba: dos anclas ambiguas
que se fueron de 0.3 a 0.8, y el argumento de una frase telegráfica que
volvió reescrito y sin la fecha.

La receta que funcionó las últimas dos veces, y que hay que repetir:
**líneas léxicas y no prosa** (listas de palabras, no descripciones),
**arriba del bloque de confianza**, que queda último.

El piso de regresión, ampliado con este spec:

| Qué | Esperado |
|---|---|
| `"Claude Code"`, `"Proder"`, `"pricing"`, `"Vercel Pro"` | confianza < 0.6, pregunta |
| Las seis frases simples de siempre | una sola acción cada una |
| `-20usd Claude Code 06/08` | argumento literal, con la fecha |
| `"qué anotaciones tengo sobre gestión de presupuestos"` | `buscador`, no `presupuesto` |
| **Fallo 1** | dos acciones `proyecto`, **con las fechas en el argumento**, y **cero** `retro` |
| **Fallo 2** | dos acciones: `movimientos` con Gentius, y `proyecto` |

Las dos últimas filas son nuevas. Y hay un choque previsible que hay que
mirar de cerca: **`proyecto` y `retro` comparten la palabra "cierre"**. Se
separan por verbo, igual que `tema_estudio` de `lecciones_tema` y
`presupuesto` de `buscador`: *cerrar* un proyecto es cambiarle la fecha,
*hacer la retro* de un proyecto es escribir un documento sobre él.

**Antes de tocar el prompt, medir; después de tocarlo, volver a medir.**

## Criterio de aceptación

Las cuatro frases reales, tal cual las escribió Beno:

1. **Fallo 1** → las dos ventanas quedan escritas en los dos proyectos, la
   respuesta dice qué cambió en los balances, y **no se escribe nada en la
   bitácora ni se dispara ninguna retro**.

   Ojo con las fechas al probarlo: esa frase dice **31/07**, mientras que
   la migración del spec A carga **20/07** porque Beno corrigió el dato
   después. Correr la frase pisa el 20/07 con el 31/07, y **está bien** —
   la tool tiene que escribir lo que dice la frase. No cambia ningún
   número: Claude Pro del 07/07 cae adentro de las dos.
2. **Fallo 2** → el movimiento llega al formulario con **Gentius**, y
   además la ventana de Gentius queda abierta. Dos acciones, las dos
   hechas.
3. **Fallo 3** → Claude crea el proyecto del Agente de RRHH con su
   presupuesto en una sola tarjeta de bandeja, y el relevamiento entra
   como nota, también a la bandeja. La respuesta dice que quedó **para
   aprobar**, no que quedó cargado.
4. Una frase no cubierta por ningún destino —cualquiera que hoy caiga en
   `desconocido`— **no escribe nada en ninguna parte**.

El punto 4 es el que cierra el hallazgo transversal, y es el único que no
sale de una frase que Beno haya escrito: sale de lo que pasó con la que sí
escribió.
