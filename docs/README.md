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
| [`conector-mcp.md`](conector-mcp.md) | Cómo dar de alta el conector de Claude.ai, sus 8 tools y cómo probarlo sin Claude | sí |
| [`informe-estado.md`](informe-estado.md) | **Foto** de la auditoría del 2026-08-09. No se reescribe; tiene un banner con lo que cambió desde entonces | congelado |
| [`registro-correcciones.md`](registro-correcciones.md) | Estado + historial de bugs y correcciones. "Registro" y no "bitácora": Bitácora es una sección del producto | sí, a mano |
| [`archivo/`](archivo/) | Detalle largo que no entra en los documentos vivos | según se necesite |
| [`superpowers/specs/`](superpowers/specs) | El diseño de cada feature: qué se decidió y por qué se descartó lo otro | uno por feature |
| [`superpowers/plans/`](superpowers/plans) | El plan de implementación, tarea por tarea | uno por spec |

**El registro de correcciones está vacío a propósito**
([`registro-correcciones.md`](registro-correcciones.md)): todavía no hubo
un bug que ameritara entrada, pero el archivo existe igual para que la
primera corrección ya tenga dónde anotarse. Se llama "registro" y no
"bitácora" porque en Pepe **Bitácora es una sección del producto**. El
historial fino sigue en los mensajes de commit, largos a propósito y con
el porqué de cada cambio: `git log` es el detalle.

**Tampoco hay índice estructural generado.** Con `rg` sobre `src/` alcanza:
el vocabulario del repo es dominio en castellano, donde el match exacto
gana.

## Quién mantiene esto

Los dos manuales, el registro de correcciones y el índice se editan a
mano y los actualiza `/actualizar`: los manuales, cuando una
funcionalidad cambia de forma — pantalla nueva, action nueva, tabla
nueva — y el registro, cuando se corrige un bug. Los specs y los planes **no se tocan después de
escritos**: son el registro de qué se decidió con la información que había
en ese momento.
