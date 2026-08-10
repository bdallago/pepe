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
| [`superpowers/specs/`](superpowers/specs) | El diseño de cada feature: qué se decidió y por qué se descartó lo otro | uno por feature |
| [`superpowers/plans/`](superpowers/plans) | El plan de implementación, tarea por tarea | uno por spec |

**No hay bitácora de bugs ni changelog**, y no hace falta inventarlos: el
historial de este proyecto está en los mensajes de commit, que son largos
a propósito y explican el porqué de cada cambio. `git log` es el registro.

**Tampoco hay índice estructural generado.** Con `rg` sobre `src/` alcanza:
el vocabulario del repo es dominio en castellano, donde el match exacto
gana.

## Quién mantiene esto

Los dos manuales y el índice se editan a mano y los actualiza
`/actualizar` cuando una funcionalidad cambia de forma — pantalla nueva,
action nueva, tabla nueva. Los specs y los planes **no se tocan después de
escritos**: son el registro de qué se decidió con la información que había
en ese momento.
