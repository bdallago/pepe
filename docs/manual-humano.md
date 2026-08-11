# Pepe, contado

Para una persona: un dev que llega, o Beno dentro de seis meses. No hay
rutas de archivos acá — de eso se ocupa el manual agéntico.

## La idea general

Pepe es la app personal de Beno, de un solo usuario. Nació como un balance
de ingresos y egresos por proyecto y después absorbió una app de estudio
que vivía aparte, así que hoy tiene tres secciones —Finanzas, Aprendizaje
y Bitácora— que comparten una sola cosa: **el proyecto**. Un movimiento
cuelga de un proyecto, una lección cuelga de un proyecto, una anotación
del día cuelga de un proyecto. Esa es la columna vertebral y casi todo lo
demás se entiende a partir de ahí.

Lo que la hace distinta de un Excel no es que sume: es que **todo lo que
propone un modelo pasa por una bandeja antes de existir**. La app usa
modelos en una docena de lugares, y ninguno escribe en las cuentas por su
cuenta.

---

## Finanzas

Cargás un movimiento con su fecha, su descripción y su monto, y elegís si
lo escribís en pesos o en dólares. **El que escribís es el importe real; el
otro se calcula solo** con la cotización del día y queda congelado ahí para
siempre. Un gasto de abril de veinte dólares vale lo que valía en abril, y
ninguna pantalla lo va a recalcular después con el dólar de hoy. La única
excepción es cuando marcás como efectuado algo que estaba planificado: ahí
sí se recotiza, contra la fecha real en que se movió la plata.

La cotización la trae un proceso automático todos los días. Si un día no
hay —un feriado, una carga retroactiva— se usa la última anterior y la
pantalla te lo dice. También la podés forzar a mano.

**Un movimiento puede no tener proyecto, y eso significa algo.** Quiere
decir que es compartido: Claude Pro, el hosting, la publicidad. Esos gastos
se reparten cada vez que mirás un balance, **sin duplicar nada en la
base**. Por eso la suma de lo que costó cada proyecto da exactamente el
balance general, y la pantalla de Proyectos verifica esa cuenta a la vista.

**Cada proyecto tiene una ventana: cuándo arrancó y cuándo cerró**, y un
gasto compartido se reparte entre los que estaban abiertos **el día de ese
gasto**. La diferencia no es un detalle: antes se repartía entre los que
estuvieran abiertos hoy, así que cerrar un proyecto cambiaba
retroactivamente cuánto había costado cada uno de los otros. Un gasto de
marzo se reparte entre los que estaban vivos en marzo, y va a seguir
diciendo lo mismo dentro de un año.

Las dos fechas se editan en Ajustes, y ahí también está el botón de cerrar
y reabrir. Dejar el cierre vacío quiere decir que el proyecto sigue
abierto. Si un gasto compartido cae en una fecha en la que no había ningún
proyecto abierto, no hay entre quiénes repartirlo: la app te avisa, te
dice **cuáles** son esos gastos, y los sigue contando en el balance
general.

Además hay gastos recurrentes, que generan los movimientos planificados
solos, y un detector que una vez por día busca **suscripciones que quizás
ya no uses**: cosas que venís pagando mes a mes mientras el proyecto que
las justificaba no muestra actividad. Cuando encuentra una, te la propone;
nunca da nada de baja por su cuenta.

Al escribir la descripción de un movimiento, la app **te propone el tipo y
la categoría**. Primero mira cómo clasificaste esa misma descripción antes
—sin modelo, instantáneo— y solo si nunca la vio le pregunta a uno. El
orden importa: tus decisiones le ganan siempre a las de un modelo. Y como
reconoce "Claude Pro - Agosto" como lo mismo que "Claude Pro - Julio", con
el tiempo se equivoca cada vez menos.

---

## Aprendizaje

Un plan de estudio se organiza en tracks, que tienen bloques, que tienen
sesiones. Cada sesión lleva **dos marcas separadas: leíste la teoría, y la
aplicaste.** No es lo mismo, y esa distinción es el punto entero de la
sección: se puede haber leído algo el martes y aplicado recién el viernes,
y la app tiene que poder decirlo.

Alrededor de eso hay un roadmap con el plan completo, una vista de la
semana, un repaso, y artefactos, que son las cosas concretas que vas
produciendo mientras estudiás.

Aparte están **las lecciones**: cosas que aprendiste trabajando, escritas
como una afirmación concreta y no como un título de libro de negocios. Se
buscan mezclando dos formas de buscar —por las palabras, y por el
significado— para que encuentres una lección aunque no te acuerdes de con
qué palabras la escribiste. Las lecciones de proyectos cerrados **siguen
apareciendo en la búsqueda**: un proyecto terminado no tiene por qué
ensuciar las pantallas, pero lo que aprendiste ahí no se pierde.

Las lecciones pueden nacer de cuatro lados: las escribís vos, las extrae
un modelo leyendo tu bitácora, las propone un modelo sobre un tema que
pediste, o salen del cierre de un proyecto. **La app se acuerda de cuál de
los cuatro fue**, y las muestra distinto — porque una hipótesis que nadie
vivió no vale lo mismo que algo que te pasó.

---

## Bitácora

Anotaciones del día a día sobre en qué anduviste trabajando. Texto libre,
tuyo, sin editar por nadie. Es la materia prima de la que después salen
lecciones.

Borrar acá —y en todo el módulo de aprendizaje— **es archivar**. Nada se
pierde de verdad salvo que pidas explícitamente lo contrario.

---

## La bandeja

Es la pieza que explica el resto. **Todo lo que produce un modelo termina
acá antes de existir**: una lección propuesta, una suscripción sospechosa,
la nota que salió de una captura, un movimiento dictado desde afuera, y
—desde el 2026-08-11— un proyecto entero con su presupuesto adentro, un
presupuesto suelto, o una nota que redactó Claude resumiendo una charla.

Del presupuesto conviene saber una cosa: **el precio no lo pone Claude
nunca**. Manda los entregables con las horas que estima y el monto lo saca
Pepe con tu tarifa de Ajustes, igual que si lo cargaras vos. Si en la
charla apareció otro número, gana el de Pepe. Y las citas del pedido que
justifican cada entregable llegan sin verificar, así que la tarjeta te las
muestra como cita y no como respaldo.

Está diseñada para vaciarla rápido, y eso es un requisito y no un lujo: un
ítem por vez, sin scroll, todo con el teclado, y la decisión se aplica al
instante sin esperar al servidor. Si revisar veinte propuestas costara
veinte clicks, la bandeja se abandonaría en dos semanas y todo el diseño de
confirmación humana perdería sentido.

Se acepta, se rechaza, se pospone, o se edita antes de aceptar — porque lo
que propone un modelo es un borrador, no un dictamen.

---

## Presupuestos

Le pegás el pedido de un cliente y un modelo **estima el esfuerzo en
horas**. El precio no lo pone el modelo nunca: lo calcula la app con tu
tarifa. Cada entregable viene con una **cita literal del pedido**, para que
puedas ver de dónde salió cada ítem.

El presupuesto se edita, se exporta a PDF y se manda. Si prospera se
convierte en proyecto; si no, se descarta con un motivo. Y una vez por
semana un proceso trae precios de referencia del mercado argentino y te
avisa si tu tarifa quedó desfasada. **Avisa: nunca la cambia.**

---

## Hablarle a la app

Hay una caja de texto en la pantalla de inicio, y un atajo de teclado para
abrirla desde cualquier lado. Escribís una frase como se te ocurra y la app
la deriva sola: cargar un gasto, anotar en la bitácora, buscar algo que
escribiste, ver qué te toca estudiar hoy, armar un presupuesto, o abrir y
cerrar un proyecto.

Eso último es nuevo y arregla algo que molestaba: antes no había forma de
tocar un proyecto hablando, así que un pedido de ese tipo aterrizaba en el
vecino más parecido —casi siempre la bitácora, que es la que escribe
directo— y terminabas con una anotación que decía "Proder" y nada más.
Ahora hay un destino propio, y **cuando cambia una ventana la respuesta te
dice qué gastos compartidos se reparten distinto**, porque mover las
fechas de un proyecto mueve los balances de los otros. Si de lo que
dijiste no sale ninguna fecha nueva, te avisa que no cambió nada en vez de
contestarte "listo".

Y la otra mitad del mismo arreglo: **lo que no sabe hacer ya no lo escribe
igual**. Si le pedís que anote algo que es apenas un nombre suelto, o el
nombre de un proyecto, pregunta antes en vez de guardarlo.

Dos cosas más que conviene saber. **Si le falta un dato, pregunta en vez de
inventarlo** — sobre todo la fecha, porque un gasto de la semana pasada
anotado hoy cae en el mes equivocado y agarra la cotización equivocada. Y
**si no está segura de qué le pediste, también pregunta**: un destino
equivocado con confianza alta te contesta cualquier cosa con seguridad, que
es mucho peor que admitir la duda.

También se puede operar desde afuera. Pepe se agrega a Claude.ai como
conector: preguntarle cuánto gastaste, buscar entre tus lecciones, dictarle
un movimiento, dictarle un proyecto nuevo con su presupuesto. Lo que se
dicta **queda propuesto en la bandeja**, no cargado — con una sola
excepción, la bitácora, que escribe en firme porque lo que se guarda ahí
es tu texto y no la producción de un modelo.

Esa excepción tiene su contracara, y por eso son dos cosas distintas:
cuando el texto lo **redactó Claude** —un resumen de lo que charlaron, las
notas de una reunión— no entra por ahí, va a la bandeja como todo lo
demás, y la tarjeta te avisa que no es tuyo para que lo edites si suena a
otra persona.

---

## Lo que pasa solo

- **Todos los días** se trae la cotización del dólar oficial.
- **Todos los días** se buscan suscripciones sin uso y, si aparece alguna,
  se te propone en la bandeja.
- **Todos los días** se hace un respaldo completo, que se guarda en un
  repositorio privado aparte. Incluye los archivos de comprobantes y
  adjuntos, que no viven en la base.
- **Una vez por semana** se actualizan los precios de referencia para
  presupuestos.

Y una regla que atraviesa todo: **si el modelo no contesta, la app sigue
funcionando entera en modo manual.** Cargar un gasto, escribir una lección
y anotar en la bitácora andan siempre, con o sin inteligencia artificial
del otro lado. Cuando algo de eso falla, se avisa discreto y no se
interrumpe lo que estabas haciendo.
