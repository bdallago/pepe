# Agentes en Pepe — diseño

Fecha: 2026-08-09
Estado: **aprobado el diseño, pendiente el plan de implementación**

## Alcance de este spec

Diseña **diez agentes en cuatro olas**, pero el plan de implementación que
sale de acá cubre **solo las olas 1 y 2** (siete agentes y el
recepcionista). Las olas 3 y 4 están descriptas para que la arquitectura
las contemple, no para construirlas ahora: la 3 está bloqueada por una
decisión abierta y la 4 depende de las anteriores.

## El problema

Pepe tiene un montón de funciones útiles repartidas en tres secciones, y
para usar cualquiera hay que saber en qué pantalla vive y qué botón
apretar. Peor: cargar un gasto exige abrir un formulario y llenar siete
campos.

No es que sea difícil. Es que **hay que acordarse**, y por eso no pasa.

La apuesta de este diseño es que una sola caja donde escribís en
castellano —*"pagué 20 usd de Claude Code"*— baja lo suficiente la
fricción como para que la app se use a diario. Ese uso diario es, además,
la condición que el spec pone para la fase siguiente (el MCP nativo).

## Arquitectura

Un **recepcionista** que lee tu frase y deriva al **especialista** que
corresponde. Cada especialista tiene su prompt, su esquema de salida y su
destino propio.

```
   Inicio ─────────┐
                   ├──►  Recepcionista  ──►  especialista  ──►  destino
   Atajo global ───┘      decidirDestino()
   (cualquier pantalla)

   Caja en Movimientos ─────────────────►  agente de movimientos
                                            (sin recepcionista: ya estás ahí)
```

- **`decidirDestino(frase) → { destino, confianza, pregunta? }`**. Si la
  confianza es alta, deriva y muestra a dónde te llevó. Si es baja,
  pregunta con dos o tres opciones concretas en vez de adivinar.
  Usa `MODELO_CHICO`: es una clasificación entre pocas opciones con
  salida de decenas de tokens, no necesita razonamiento.
- **La caja de Movimientos saltea el recepcionista.** Estando en esa
  pantalla no hay nada que decidir, y saltearlo elimina una llamada y la
  única forma de equivocarse.
- **El atajo global deriva a todos los agentes**, igual que el inicio.
  (Una respuesta anterior lo acotó a plata; quedó superada al pasar de un
  especialista a nueve.)

### Archivos

Sigue la separación que ya usa el resto del proyecto: la lógica en
módulos de `src/lib/` que reciben un cliente de Supabase y devuelven
datos tipados, y los route handlers como cáscara delgada.

- `lib/agentes/recepcionista.ts` — la decisión de destino.
- `lib/agentes/<especialista>.ts` — uno por agente.
- `/api/agentes/interpretar` — cáscara: autentica, valida, traduce errores.
- `<CajaAgente>` — un componente, tres superficies.

Los agentes de la ola 1 **no traen lógica nueva**: importan las funciones
que ya existen y funcionan.

## El roster

### Ola 1 — cáscara sobre lo que ya anda

Cero lógica nueva, cero riesgo de dominio, y le dan al recepcionista seis
destinos reales desde el primer día.

| Agente | Ejemplo | Termina en | Reusa |
|---|---|---|---|
| Consultas de plata | *"¿cómo viene Proder?"* | Números ahí mismo, más un link a la pantalla | `balances.ts`, `prorrateo.ts` |
| Buscador | *"¿tenía algo sobre backlogs?"* | Lecciones y bitácora | Búsqueda híbrida (5) |
| Estudio | *"¿qué me toca hoy?"* | Roadmap y sugerencias | `aprendizaje.ts`, 6.4 |
| Retro | *"cerrá Proder"* | Borrador editable → `retros` | 6.5 completo |
| Lecciones sobre un tema | *"sacá lecciones de clientes"* | **Bandeja** | 6.3 completo |
| Suscripciones | *"¿qué pago que no uso?"* | **Bandeja** | 6.2 completo |

### Ola 2 — el agente de movimientos

El único con lógica nueva. Detallado abajo.

### Ola 3 — depende de una decisión pendiente

| Agente | Ejemplo | Decisión abierta |
|---|---|---|
| Conocimiento | *"aprendí que conviene cobrar por versión mayor"* | Va a bandeja (regla 6), sin discusión |
| Bitácora | *"hoy peleé con el deploy toda la tarde"* | **Si transcribe tu texto tal cual, escribe directo; si lo reformula, va a bandeja.** Sin resolver. |

### Ola 4

- **Cierre del día**: a la noche pregunta *"¿algo de plata hoy? ¿algo que
  anotar?"* y levanta movimientos y bitácora de una pasada. Reusa los
  agentes de las olas 2 y 3. Es el único que ataca el problema de fondo
  —acordarse— en vez de hacer más rápido algo que ya podías hacer.
- **Gmail**: no es un agente con el que hablás, es un pase de fondo que
  deja propuestas en la bandeja. Misma cañería, forma distinta. Spec
  aparte.

### Qué no es un agente

Respaldo, ajustes y archivar son botones. Un agente ahí es peor que un
botón.

## El agente de movimientos

### Flujo

1. Escribís *"pagué 20 usd de Claude Code"*.
2. **Extracción** (`lib/agentes/movimientos.ts`): el modelo saca monto,
   moneda, descripción y fecha. Nada más. Modelo chico, salida corta.
3. **Clasificación**: la descripción entra a `lib/clasificacion.ts`, **el
   que ya existe y no se toca**. Primero busca en el histórico (SQL puro,
   contra índice) y solo cae al modelo si no encontró nada.
4. Se abre el **formulario de movimiento precargado**, con marcas de
   dónde salió cada campo.
5. Confirmás o corregís y guardás.

### Por qué no va a la bandeja

Porque hay alguien mirando en el momento en que se propone. `AGENTS.md`
ya lo resolvió para el clasificador: *"el formulario es el panel de
confirmación que pide la sección 6 del spec, por eso esto no pasa por
inbox"*. Un gasto dictado es el mismo caso.

**Consecuencia práctica: esta ola no necesita un tipo nuevo de bandeja.**
Ese trabajo aparece recién con Gmail, donde no hay nadie mirando.

### Por qué el histórico sigue primero

Si el mismo modelo que extrae además clasificara, tus decisiones
anteriores dejarían de ganar y "Claude Pro" se clasificaría de cero cada
vez, en vez de salir de las tres veces que ya lo cargaste vos. Es la
regla 6.c y no se negocia. Efecto secundario bueno: en el caso más
común —un gasto que ya cargaste— **no hay segunda llamada al modelo**.

### Marcas de confianza

El formulario señala qué puso el modelo y de dónde lo sacó. Al tocar un
campo, su marca se apaga.

```
Descripción  [ Claude Code          ] ● de tu frase
Monto USD    [ 20.00 ]                ● de tu frase
Monto ARS    [ 28.560 ]                 calculado
Tipo         (•) Egreso                ● como las 3 veces anteriores
Categoría    [ Herramientas       ▾ ]  ● como las 3 veces anteriores
Fecha        [ 2026-08-09 ]              hoy
Proyecto     [ Compartido         ▾ ]  ● sugerido
```

No es adorno. Es un libro de cuentas: si el modelo lee "15 mil" donde
eran 15 y el formulario se ve igual que siempre, lo guardás sin mirar.

### Cómo entra al formulario

**Por `escribirMonto(origen, valor)`, no seteando campos.** Esa función
hace lo mismo que tipear: fija `moneda_origen`, escribe el campo y
calcula el derivado. Seteando los campos a mano se pelea con el efecto
que a propósito excluye `monto_ars`/`monto_usd` de sus dependencias
(regla 3), y el resultado sería un par ARS/USD inconsistente.

## Errores y modo degradado

Ninguna feature de modelo puede ser bloqueante (regla 7).

| Falla | Qué pasa |
|---|---|
| Groq caído o sin cuota | **Se intenta un regex** para monto y moneda. Si sale, el formulario se abre con eso; si no, se abre vacío. Nunca se rompe. |
| No encuentra monto | Lo dice: *"no entendí un monto en esa frase"*. No inventa uno. |
| El recepcionista duda | Pregunta con opciones concretas. No adivina. |
| Deriva mal | La pantalla muestra a dónde te llevó y deja cambiarlo. |
| La salida no valida | Se trata como falla de modelo, no se escribe nada. |

## Presupuesto

Medido el 2026-08-09 disparando pedidos reales contra la cuenta, no
leyendo documentación. Detalle en la sección 6.b de `AGENTS.md`.

| Modelo | ped./min | ped./día | tok./min | tok./día |
|---|---|---|---|---|
| `llama-3.1-8b-instant` | 30 | 14 400 | 6000 | 500 000 |
| `openai/gpt-oss-120b` | 30 | 1000 | 8000 | 200 000 |

Un gasto dictado gasta **800 a 1500 tokens y 2 a 3 pedidos**. Contra el
techo diario del modelo chico, eso da para **~330 gastos por día**.

**Decisión: se queda en el tier gratuito.** No hay escenario de uso real
que lo toque. Lo único que puede tocar un techo es el backfill histórico
de Gmail (unos 2000 mails serían ~67 minutos por el ritmo de pedidos y
~3 días por el techo diario de tokens), y eso se resuelve con un pase por
lotes y retomable, no pagando. Pagar cuesta centavos por mes a esta
escala; lo único que compra es sacarse el techo de 30 por minuto.

## Decisiones abiertas

1. **Bitácora**: ¿transcribe y escribe directo, o reformula y va a
   bandeja? Bloquea la ola 3.
2. **Nombres y tono de los agentes**: si tienen nombre propio o se los
   nombra por función. No bloquea nada.

## Fuera de alcance

- El conector de Pepe dentro de claude.ai (servidor MCP remoto con
  OAuth). Spec aparte.
- Gmail. Spec aparte.
- Escrituras del MCP local: **quedan absorbidas por estos agentes**. El
  agente de movimientos hace lo mismo, en el browser, que es donde Beno
  está de verdad.
