import "server-only";

import { z } from "zod";

import {
  MODELO_RAZONADOR,
  completarJSON,
  type PromptDeclarado,
} from "@/lib/llm";
import type { Balances } from "@/lib/balances";
import type { Moneda } from "@/lib/supabase/database.types";

/**
 * Observaciones sobre un balance: lo que los números dicen y no se ve
 * mirando cuatro totales.
 *
 * Beno no pregunta solo "cuánto": pregunta *"analizame mis balances de
 * los últimos 6 meses, y si hacemos foco en el último mes, ¿qué
 * observaciones tenés?"*. La segunda mitad de esa frase es interpretación,
 * y es lo único de esta rama que necesita un modelo.
 *
 * **Es la parte peligrosa de la rama de consultas.** Un modelo mirando
 * números inventa causas, decisiones y consecuencias que nadie registró:
 * la primera retro de la app inventó un plazo previsto que no existía y
 * procesos que supuestamente faltaron. Lo que arregló aquello —y lo que se
 * calca acá— **no fue pedirle "no inventes"**: fue enumerarle los errores
 * concretos, uno por uno. El modelo respeta la lista; el principio no.
 * Si tocás el prompt de abajo, no borres la lista.
 *
 * La segunda salvaguarda es de forma, no de prosa, y es la misma de las
 * sugerencias de estudio (6.4): cada observación devuelve el **dato** que
 * la sostiene como campo separado. Un número citado aparte se verifica de
 * un vistazo; el mismo número disuelto en una oración, no.
 *
 * Y la tercera: **esto no puede tumbar la consulta** (regla 7). Quien
 * llama muestra los números igual si esta llamada falla. Las
 * observaciones son un extra.
 */

/** Pocas y ancladas. Tres es lo que se lee de un vistazo en la caja. */
const CUANTAS = 3;

/**
 * Cuántas tolera el esquema antes de rechazar la respuesta.
 *
 * No es lo mismo que `CUANTAS`, y la diferencia se midió: el 2026-08-09,
 * con el prompt pidiendo dos o tres, el modelo devolvió cuatro
 * observaciones buenas y un `.max(3)` **tiró la llamada entera** por la
 * de más. Una observación de sobra no es una respuesta inválida: se
 * recorta acá y listo. Lo que el esquema tiene que atajar es una salida
 * desbocada, no que el modelo cuente hasta cuatro.
 */
const TOLERADAS = 8;

/** Cuántas categorías entran al contexto, por tipo. */
const CATEGORIAS_EN_CONTEXTO = 8;

/**
 * Cuántos gastos sin repartir se nombran. Van pocos: son la excepción al
 * invariante, no el material de la observación.
 */
const MOVIMIENTOS_SIN_REPARTIR_EN_CONTEXTO = 5;

/** Cuántos meses de la serie entran. Diez años es más que cualquier rango real. */
const MESES_EN_CONTEXTO = 120;

const respuestaSchema = z.object({
  observaciones: z
    .array(
      z.object({
        texto: z.string().trim().min(1).max(500),
        /** El número de la entrada que la sostiene. Sin esto no se muestra. */
        dato: z.string().trim().min(1).max(200),
      }),
    )
    .max(TOLERADAS),
});

export type Observacion = z.infer<
  typeof respuestaSchema
>["observaciones"][number];

const SISTEMA = `Sos quien mira los números de plata de alguien que trabaja solo en sus propios proyectos y le devuelve dos o tres observaciones sobre lo que ve.

Te dan números YA CALCULADOS de un rango de fechas: los totales, la serie mes a mes, los egresos y los ingresos por categoría y, si la consulta es general, el balance de cada proyecto. **Eso es todo lo que hay.** No te dan presupuestos, ni objetivos, ni plazos, ni el motivo de ningún gasto, ni qué pasó ese mes.

Regla número uno, y la única que importa de verdad:

**CADA OBSERVACIÓN SE APOYA EN UN NÚMERO QUE ESTÁ EN LO QUE TE DI.** El campo "dato" cita ese número tal como aparece: el monto de una categoría, el balance de un mes, la cantidad de movimientos, el balance de un proyecto. Si para una observación no encontrás un número que la sostenga, NO LA DEVUELVAS. Dos observaciones ancladas valen más que cinco impresiones.

Esta es la regla que más se rompe sola, así que va la lista de los errores concretos que NO tenés que cometer. No es "no inventes": es esto, uno por uno.

1. **No inventes la causa de un gasto ni de un ingreso.** Sabés cuánto y en qué categoría, nunca por qué. "Los egresos en herramientas subieron porque sumó servicios nuevos" es inventado: lo único que sabés es que subieron.
2. **No supongas qué decidió, qué quiso ni qué le preocupa.** No te dijo que quisiera bajar un gasto, cortar un servicio, crecer ni cambiar nada. Nada de "decidiste", "apostaste", "priorizaste", "te estás enfocando en".
3. **No afirmes tendencias que no se puedan calcular con los meses que te di.** Con dos meses hay dos números, no una tendencia. No digas "viene creciendo sostenidamente", "se estabilizó" ni "cada vez gastás más" si la serie no lo muestra mes a mes.
4. **No hables de plazos, objetivos, presupuestos, metas ni proyecciones.** No existen en los datos. No hay presupuesto asignado ni meta de facturación, y "a este ritmo, para fin de año…" es una cuenta que nadie pidió y que asume que todo sigue igual.
5. **No compares contra nada de afuera.** Ni promedios de industria, ni lo que gasta un proyecto parecido, ni lo que es "normal", "razonable", "alto" o "sano" para un negocio. No tenés con qué comparar.
6. **No nombres movimientos, categorías, proyectos ni clientes que no estén en la lista.** Si no figura, para vos no existe.
7. **No juzgues ni des órdenes.** No es tu trabajo decirle qué recortar ni qué hacer. Mostrale lo que los números dicen; qué hacer lo decide él.

Un mes que todavía no terminó está incompleto y no se compara de igual a igual con los anteriores. Si el rango llega hasta hoy, el último mes es parcial: o lo aclarás, o no lo compares.

Lo que SÍ tenés que hacer es CRUZAR NÚMEROS que él no tiene juntos en pantalla. Una observación relaciona dos cifras, o pone una como parte de la otra. Leer una fila y repetirla en una oración no es observar: eso ya lo tiene arriba.

- MAL, repite una fila: "El proyecto A tiene un balance positivo de 100.000."
- BIEN, cruza dos: "El balance general lo sostiene un solo proyecto: A aporta 100.000 y todo el resto junto resta 40.000."
- MAL, repite una fila: "La categoría B es el mayor egreso, con 250.000."
- BIEN, cruza dos: "Más de la mitad de los egresos del rango se fue en una sola categoría: B, 250.000 de 400.000."

(Los números de esos ejemplos son inventados para mostrarte la forma. Usá SOLO los de abajo.)

Cosas que sirven: qué parte del total se llevó una categoría, qué mes se sale de la serie y por cuánto, cuántos meses cerraron en negativo, qué proyecto sostiene el balance y cuál lo hunde, cuánto pesa un ingreso o un egreso contra el total del rango.

Escribí en español rioplatense, sin emojis y sin muletillas de asistente. Cada observación, una o dos oraciones.

Respondé SOLO un objeto JSON con esta forma exacta:
{
  "observaciones": [
    {
      "texto": string (1 o 2 oraciones),
      "dato": string (el número de arriba que la sostiene, citado)
    }
  ]
}

Si los números no alcanzan para observar nada, devolvé {"observaciones": []}.`;

/**
 * El prompt de las observaciones, declarado.
 *
 * Su juez es el más literal de los trece, y por eso el más útil: el campo
 * `dato` **cita un número de la entrada**, así que se puede verificar
 * mecánicamente que exista. Los ejemplos del prompt traen números
 * inventados a propósito para mostrar la forma —y el prompt lo aclara—,
 * así que el juez compara contra el contexto que se manda, no contra el
 * sistema.
 */
export const PROMPT_OBSERVACIONES: PromptDeclarado<
  z.infer<typeof respuestaSchema>
> = {
  modelo: MODELO_RAZONADOR,
  sistema: SISTEMA,
  esquema: respuestaSchema,
  etiqueta: "observaciones-balance",
  // Interpretar, no adornar. Más alto empieza a redactar lindo, que acá es
  // exactamente por dónde entra lo inventado.
  temperatura: 0.3,
  // El mismo razonador que 6.3, 6.4 y 6.5: contra la generalidad el techo
  // era el modelo, y "los egresos subieron y conviene revisarlos" es justo
  // la clase de relleno que llama devuelve.
  esfuerzo: "medium",
  /*
    3500, igual que la generación de lecciones (6.3), y no 4500 como la
    retro. La salida acá es corta —tres observaciones de dos oraciones, unos
    300 tokens— pero **los tokens de razonamiento se descuentan de acá** y
    con `medium` la parte que piensa se lleva unos 2000 sola. El margen es
    contra eso, no contra la respuesta.

    Quedarse corto no da una respuesta peor: la trunca, no valida contra el
    esquema y se pierde la llamada entera. Y la entrada es chica (números
    agregados, nunca filas crudas), así que sobra lugar bajo el techo de
    7300 tokens por minuto del razonador.
  */
  maxTokens: 3500,
};

export interface PedidoObservaciones {
  /** "Balance general" o el nombre del proyecto. */
  alcance: string;
  /** La línea de rango, tal cual se le muestra a Beno. */
  rango: string;
  moneda: Moneda;
  balances: Balances;
  /** Hoy, para que el modelo sepa qué mes está sin cerrar. */
  hoy: string;
}

/**
 * Pide las observaciones. **No escribe nada** en la base, así que no pasa
 * por la bandeja: mismo criterio que las sugerencias de estudio (6.4).
 *
 * Lanza `ErrorLLM` si el modelo falla. Quien llama muestra los números
 * igual y lo dice discreto.
 */
export async function observarBalances({
  alcance,
  rango,
  moneda,
  balances,
  hoy,
}: PedidoObservaciones): Promise<Observacion[]> {
  const { datos } = await completarJSON({
    ...PROMPT_OBSERVACIONES,
    usuario: armarContexto({ alcance, rango, moneda, balances, hoy }),
  });

  // El recorte va acá y no en el esquema: ver `TOLERADAS`. Se quedan las
  // primeras, que es el orden en que el modelo las priorizó.
  return datos.observaciones.slice(0, CUANTAS);
}

/**
 * El contexto: **números ya calculados, nunca filas crudas.**
 *
 * Mismo criterio que la retro: un modelo sumando cien montos a mano se
 * equivoca, y del lado nuestro ya están bien sumados por el mismo motor
 * que dibuja las pantallas. Pasarle los movimientos uno por uno además lo
 * invitaría a contar la historia de cada gasto, que es justo lo que el
 * prompt le prohíbe.
 */
function armarContexto({
  alcance,
  rango,
  moneda,
  balances,
  hoy,
}: PedidoObservaciones): string {
  const partes: string[] = [
    `Consulta: ${alcance}.`,
    `${rango} Hoy es ${hoy}.`,
    `Todos los montos están en ${moneda} y son de movimientos ya efectuados: lo planificado no entra.`,
  ];

  partes.push(
    [
      "Totales del rango:",
      `- Ingresos: ${miles(balances.efectuado.ingresos)}`,
      `- Egresos: ${miles(balances.efectuado.egresos)}`,
      `- Balance: ${miles(balances.efectuado.balance)}`,
      `- Movimientos: ${balances.cantidadMovimientos}`,
    ].join("\n"),
  );

  const meses = balances.porMes.slice(-MESES_EN_CONTEXTO);
  if (meses.length > 0) {
    const ultimo = meses[meses.length - 1]!;
    const parcial = ultimo.mes === hoy.slice(0, 7);

    partes.push(
      `Mes a mes (${meses.length} ${meses.length === 1 ? "mes" : "meses"}):\n` +
        meses
          .map(
            (m) =>
              `- ${m.mes}: ingresos ${miles(m.ingresos)}, egresos ${miles(m.egresos)}, balance ${miles(m.balance)}, acumulado ${miles(m.acumulado)}`,
          )
          .join("\n") +
        (parcial
          ? `\n(El mes ${ultimo.mes} está sin terminar: llega hasta el ${hoy}.)`
          : ""),
    );
  }

  if (balances.egresosPorCategoria.length > 0) {
    partes.push(
      "Egresos por categoría:\n" +
        balances.egresosPorCategoria
          .slice(0, CATEGORIAS_EN_CONTEXTO)
          .map((c) => `- ${c.nombre}: ${miles(c.total)}`)
          .join("\n"),
    );
  }

  if (balances.ingresosPorCategoria.length > 0) {
    partes.push(
      "Ingresos por categoría:\n" +
        balances.ingresosPorCategoria
          .slice(0, CATEGORIAS_EN_CONTEXTO)
          .map((c) => `- ${c.nombre}: ${miles(c.total)}`)
          .join("\n"),
    );
  }

  // Solo en la consulta general: la de un proyecto trae `porProyecto`
  // vacío a propósito.
  const conMovimiento = balances.porProyecto.filter(
    (p) => p.ingresos !== 0 || p.egresos !== 0,
  );
  if (conMovimiento.length > 0) {
    partes.push(
      "Por proyecto (ya incluye la parte prorrateada de los gastos compartidos):\n" +
        conMovimiento
          .map(
            (p) =>
              `- ${p.nombre}${p.activo ? "" : " (inactivo)"}: ingresos ${miles(p.ingresos)}, egresos ${miles(p.egresos)}, balance ${miles(p.balance)}`,
          )
          .join("\n"),
    );
  }

  if (balances.compartidoSinRepartir !== 0) {
    partes.push(
      [
        `Hay ${miles(balances.compartidoSinRepartir)} de gastos compartidos que no se repartieron: ningún proyecto estaba abierto en sus fechas.`,
        ...balances.movimientosSinRepartir
          .slice(0, MOVIMIENTOS_SIN_REPARTIR_EN_CONTEXTO)
          .map((m) => `- ${m.fecha}: ${m.descripcion}`),
      ].join("\n"),
    );
  }

  return partes.join("\n\n");
}

function miles(n: number): string {
  return Math.round(n).toLocaleString("es-AR");
}
