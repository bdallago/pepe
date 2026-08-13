# Documentación de Pepe

## Por dónde entrar

**Si sos un modelo que va a tocar código**, en este orden:

1. **[`dev/manual-agentico.md`](dev/manual-agentico.md)** — qué hay, dónde
   está y qué toca cuando lo movés. Una tabla por área, con las trampas.
2. **[`../AGENTS.md`](../AGENTS.md)** — **por qué** las cosas son como son.
   Si contradice al manual agéntico, gana `AGENTS.md`.
3. El spec de la feature en [`superpowers/specs/`](superpowers/specs), si
   existe.

**Si sos una persona**: [`manual-humano.md`](manual-humano.md), que cuenta
lo mismo de corrido y sin rutas de archivos.

**Si venís a usar la app, no a desarrollarla**:
[`../README.md`](../README.md).

## Qué hay acá

| Documento | Qué es | Vive |
|---|---|---|
| [`dev/manual-agentico.md`](dev/manual-agentico.md) | Mapa denso para modelos: funcionalidad → entrypoints → estado → trampas | sí, a mano |
| [`manual-humano.md`](manual-humano.md) | El mismo alcance, narrativo, para personas | sí, a mano |
| [`conector-mcp.md`](conector-mcp.md) | Cómo dar de alta el conector de Claude.ai, sus 11 tools y cómo probarlo sin Claude | sí |
| [`informe-estado.md`](informe-estado.md) | **Foto** de la auditoría del 2026-08-09. No se reescribe; tiene un banner con lo que cambió desde entonces | congelado |
| [`registro-correcciones.md`](registro-correcciones.md) | Estado + historial de bugs y correcciones. "Registro" y no "bitácora": Bitácora es una sección del producto | sí, a mano |
| [`archivo/`](archivo/) | Detalle largo que no entra en los documentos vivos | según se necesite |
| [`superpowers/specs/`](superpowers/specs) | El diseño de cada feature: qué se decidió y por qué se descartó lo otro | uno por feature |
| [`superpowers/plans/`](superpowers/plans) | El plan de implementación, tarea por tarea | uno por spec |

**El registro de correcciones** ([`registro-correcciones.md`](registro-correcciones.md))
arrancó el 2026-08-11 con las nueve entradas del reparto por fecha y
sumó las de "operar conversando" el mismo día. Se llama "registro" y no
"bitácora" porque en Pepe **Bitácora es una sección del producto**. El
historial fino sigue en los mensajes de commit, largos a propósito y con
el porqué de cada cambio: `git log` es el detalle; el registro guarda el
estado y el resumen de una o dos líneas por corrección.

## Lo que se verifica solo

Desde el 2026-08-12, y bastante más desde el 2026-08-13, hay comandos que
reemplazan trabajo que antes se hacía a mano y se olvidaba:

```bash
npm test                        # los casos puros: ninguno toca Groq ni la base
npm run verificar:doc           # la doc contra el código, ~1 s y cero tokens

npm run medir:recepcionista     # el piso del recepcionista, ~11 min
npm run medir:recepcionista -- --todo   # el corpus entero (29 frases), ~50 min

npm run medir -- --lista        # las 13 familias de prompt y lo que cuestan
npm run medir retro             # una familia contra Groq, retomable
```

**Y desde el 2026-08-13 `npm test` corre solo antes de cada commit**
(`.githooks/pre-commit`, lo engancha `npm install`; la salida de
emergencia es `git commit --no-verify`). Adentro va el linter de deriva
documental, así que eso es también lo único que impide commitear
documentación que afirma números que el código desmiente. Nació
encontrando cuatro.

`medir:recepcionista` es el que importa antes de tocar el prompt del
recepcionista, que tiene **cuatro incidentes medidos** de romperse por
agregarle texto. El banco de frases vive en `src/lib/agentes/banco.ts` y la
línea base commiteada en [`dev/recepcionista-linea-base.json`](dev/recepcionista-linea-base.json),
así que el diff de un PR muestra qué confianzas se movieron. **Oscilar
entre corridas cuenta como fallar**: el modelo no es determinístico ni con
`temperatura: 0`.

Tarda porque tiene que tardar: el limitador de Groq deja pasar **2
llamadas por minuto**. La llamada en sí son 653 ms.

`medir` es el hermano genérico, para los otros doce prompts: mismo corte
—banco, juez puro, corredor retomable— con las líneas base en
[`dev/lineas-base/`](dev/lineas-base/). **De a una familia por vez**: las
seis del razonador juntas son ~20 minutos y media cuota diaria. Lo que
corre gratis y en cada commit son sus **jueces**, que es donde vive la
mitad que más sirve.

**Tampoco hay índice estructural generado.** Con `rg` sobre `src/` alcanza:
el vocabulario del repo es dominio en castellano, donde el match exacto
gana.

## Quién mantiene esto

Los dos manuales, el registro de correcciones y el índice se editan a
mano y los actualiza `/actualizar`: los manuales, cuando una
funcionalidad cambia de forma — pantalla nueva, action nueva, tabla
nueva — y el registro, cuando se corrige un bug.

**Los specs y los planes no se reescriben después de escritos**: son el
registro de qué se decidió con la información que había en ese momento.
Lo que sí se les puede agregar es un bloque al principio diciendo que ya
se ejecutaron y **qué afirmaban que resultó ser falso** — eso no borra la
decisión, la contextualiza. El plan del reparto por fecha lo tiene, y vale
leerlo antes de escribir el próximo: se escribió sin ejecutar nada y
afirmaba siete cosas que no eran ciertas.

Al 2026-08-11 **los cinco specs llevan ese bloque**, y conviene leerlo
antes que el cuerpo: cuatro tenían el encabezado desactualizado —dos
seguían diciendo "sin aprobar" con la feature en producción— y el del
prorrateo difería una feature que después se construyó igual. El cuerpo
sigue siendo el de entonces; el bloque dice qué cambió.
