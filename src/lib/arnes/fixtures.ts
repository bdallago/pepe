import { deflateSync } from "node:zlib";

/**
 * Las entradas con las que se mide cada prompt.
 *
 * ⚠ **Son sintéticas, y no por comodidad: el repo es público.**
 * `colmena-backup-*.json` está en `.gitignore` justamente porque las
 * entradas de bitácora reales son personales. Una fixture con la bitácora
 * de Beno adentro sería publicarla acá.
 *
 * Lo que imitan es la **forma** del contexto real —los montos, las
 * categorías, las fechas, los largos, el orden de los bloques— con
 * contenido inventado. Cada una está escrita contra el `armarContexto()`
 * (o el template) del módulo que la usa.
 *
 * ⚠ **Y ese es el límite honesto de este archivo**: si alguien cambia el
 * formato de un contexto en producción, estas fixtures no se enteran solas
 * y el arnés seguiría midiendo con la forma vieja. Es distinto del prompt,
 * que **sí** viene importado del módulo real (`PromptDeclarado`). Al tocar
 * un `armarContexto()`, mirar acá.
 *
 * ## Por qué los números son "raros"
 *
 * Están elegidos para que el juez pueda distinguir lo copiado de lo
 * inventado: nada de 1000 ni de 50000 redondos que el modelo podría
 * escribir por casualidad. `412500` o `469472` no aparecen si no los leyó.
 */

/* ── retro (6.5) ────────────────────────────────────────────── */

/**
 * Un proyecto que cerró en pérdida por subcontratar. Sigue el orden de
 * `armarContexto()` de `retro.ts`: proyecto, duración, plata, egresos por
 * categoría, movimientos, lecciones y bitácora.
 *
 * Trae adrede tres trampas para el juez:
 *  - **no hay ningún plazo ni fecha objetivo** (el modelo inventó uno la
 *    primera vez que se corrió esto de verdad),
 *  - **no dice de dónde vino cada venta**, así que atribuir causas es
 *    inventar,
 *  - y **el margen se explica con dos números que están los dos acá**, o
 *    sea que una observación buena no necesita agregar ninguno.
 */
export const CONTEXTO_RETRO = `Proyecto: Importador de facturas
Duración: del 2026-03-04 al 2026-06-03.
Plata (incluye la parte prorrateada de los gastos compartidos):
- Ingresos: 1.203.400 ARS / 0 USD
- Egresos: 1.615.900 ARS / 187 USD
- Balance: -412.500 ARS / -187 USD
- Movimientos imputados: 6
Egresos por categoría (ARS):
- subcontratacion: 981.400
- infraestructura: 452.000
- herramientas: 182.500
Movimientos:
- 2026-03-04 · Servidor dedicado del importador · -452.000 ARS · infraestructura
- 2026-03-19 · Anticipo del cliente · +601.700 ARS · ventas
- 2026-04-02 · Licencia anual del OCR · -127 USD · herramientas
- 2026-04-28 · Segundo anticipo · +601.700 ARS · ventas
- 2026-05-11 · Horas de un tercero para el parser · -981.400 ARS · subcontratacion
- 2026-06-02 · Licencia mensual del OCR · -60 USD · herramientas
Lecciones que ya anotó de este proyecto:
- Subcontratar el parser salió más caro que escribirlo (proceso)
Bitácora:
- 2026-05-12: el tercero entregó el parser y hubo que reescribir la mitad. El formato de las facturas del cliente no era el que habíamos visto en la reunión, y eso no lo chequeé antes de encargarlo.
- 2026-06-03: cerramos y el cliente quedó conforme, pero el margen se lo comió la subcontratación. La próxima vez que algo dependa de un formato ajeno, pido tres archivos reales antes de presupuestar.`;

/* ── generacion (6.3) ───────────────────────────────────────── */

export const CONTEXTO_GENERACION = `Tema: cómo cobrar los cambios de alcance
Proyecto: Importador de facturas

Lecciones que ya tiene de este proyecto (NO las repitas):
- Subcontratar el parser salió más caro que escribirlo (proceso)`;

/* ── sugerencias (6.4) ──────────────────────────────────────── */

/**
 * Sigue el orden de `armarContexto()` de `sugerencias.ts`. La trampa acá
 * es el track en curso: el prompt prohíbe sugerir lo que ya está cubierto
 * **salvo que el dato muestre que no avanza**, y este muestra las dos
 * cosas a la vez (uno avanzando y uno trabado).
 */
export const CONTEXTO_SUGERENCIAS = `Hoy es 2026-08-13. Actividad de los últimos 90 días.

Proyectos con actividad:
- Importador de facturas: 6 movimientos, balance -412.500 ARS
- Panel de turnos: 3 movimientos, balance 118.300 ARS

Egresos por categoría (ARS):
- subcontratacion: 981.400
- infraestructura: 452.000
- herramientas: 182.500

Últimas lecciones que anotó:
- Subcontratar el parser salió más caro que escribirlo (proceso, 2026-06-03)
- El cliente que paga por adelantado también decide más (comercial, 2026-05-02)

Tracks de estudio:
- Product Manager: 12 de 36 sesiones hechas, última hace 4 días
- SQL avanzado: 2 de 18 sesiones hechas, última hace 71 días`;

/* ── observaciones (la caja de consultas) ───────────────────── */

/**
 * Sigue el orden de `armarContexto()` de `agentes/observaciones.ts`.
 *
 * Está armada para que **la observación buena sea un cruce**: una sola
 * categoría se lleva más de la mitad de los egresos, y un solo proyecto
 * sostiene el balance general. Los dos se pueden decir sin agregar ni un
 * número.
 */
export const CONTEXTO_OBSERVACIONES = `Consulta: balance general.
Del 2026-03-01 al 2026-08-13. Hoy es 2026-08-13.
Todos los montos están en ARS y son de movimientos ya efectuados: lo planificado no entra.
Totales del rango:
- Ingresos: 1.321.700
- Egresos: 1.615.900
- Balance: -294.200
- Movimientos: 9
Mes a mes (6 meses):
- 2026-03: ingresos 601.700, egresos 452.000, balance 149.700
- 2026-04: ingresos 601.700, egresos 182.500, balance 419.200
- 2026-05: ingresos 0, egresos 981.400, balance -981.400
- 2026-06: ingresos 0, egresos 0, balance 0
- 2026-07: ingresos 118.300, egresos 0, balance 118.300
- 2026-08: ingresos 0, egresos 0, balance 0
Egresos por categoría:
- subcontratacion: 981.400
- infraestructura: 452.000
- herramientas: 182.500
Balance por proyecto:
- Importador de facturas: -412.500
- Panel de turnos: 118.300`;

/* ── estimacion (presupuestos) ──────────────────────────────── */

/**
 * Sigue `armarUsuario()` de `presupuestos/estimacion.ts`.
 *
 * El pedido es deliberadamente incompleto en tres cosas —no dice cuántos
 * usuarios, ni de dónde salen los datos, ni si hay diseño— para que la
 * salida buena tenga preguntas y supuestos, no entregables inventados.
 * Y trae **una frase citable literal** de cada cosa que se pide, que es lo
 * que las anclas tienen que copiar.
 */
export const CONTEXTO_ESTIMACION = `Pedido del cliente, tal como llegó:
---
Hola! Somos una distribuidora chica. Necesitamos una pantalla donde los vendedores carguen los pedidos del día y que después eso salga en un Excel para el depósito. Hoy lo hacen por WhatsApp y se pierden pedidos. Nos gustaría también ver un tablero con lo vendido por vendedor en el mes. Presupuestás?
---`;

/* ── extraccion (bitácora → lección) ────────────────────────── */

/**
 * ⚠ **Esta fixture está escrita para la vara BAJA de §6**, y eso es el
 * punto: lo que cuenta acá es que **proponga**. La entrada tiene una idea
 * adentro pero no es brillante ni redonda, que es como se escribe una
 * bitácora de verdad. Si el arnés empujara para que esto se descarte,
 * estaría empujando exactamente lo que AGENTS.md prohíbe.
 */
export const CONTEXTO_EXTRACCION = `Fecha de la entrada: 2026-05-12

Entrada:
Pasé la tarde peleando con el importador. El tercero entregó el parser y andaba con sus archivos de prueba, pero con los del cliente se caía en la primera línea. Resulta que las facturas del cliente vienen con el separador de miles en el campo de importe y el parser hacía Number() directo. Lo raro es que en la reunión nos habían mostrado dos archivos y ninguno tenía ese formato. Me quedó claro que pedir dos archivos de muestra no alcanza: hay que pedir los peores que tengan.`;

/** Una entrada puramente operativa: acá SÍ tiene que decir que no hay lección. */
export const CONTEXTO_EXTRACCION_OPERATIVA = `Fecha de la entrada: 2026-05-13

Entrada:
Hice la sesión de SQL, avancé con el roadmap y terminé el diseño de la pantalla de pedidos.`;

/* ── clasificacion (6.c, paso 2) ────────────────────────────── */

export const CONTEXTO_CLASIFICACION = `Categorías de egreso:
- infraestructura
- herramientas
- subcontratacion
- impuestos
- publicidad

Categorías de ingreso:
- ventas
- reembolsos

Movimientos anteriores:
- "Vercel Pro - Junio" -> egreso / infraestructura
- "Claude Pro - Julio" -> egreso / herramientas
- "Google Ads campaña lanzamiento" -> egreso / publicidad

Clasificá este movimiento:
"Vercel Pro - Agosto"`;

/* ── zombies ────────────────────────────────────────────────── */

/** Sigue `contextoDe()` de `zombies.ts`, con la periodicidad explícita. */
export const CONTEXTO_ZOMBIES = `Gasto: Licencia mensual del OCR
Es un cargo MENSUAL de 60 USD. Se cobra una vez por mes.
Cantidad de meses en los que ya se cobró: 4. El primero fue el 2026-04-02 y el último el 2026-07-02.
Es un gasto compartido entre todos los proyectos, y no hay actividad en ninguno desde el 2026-06-03 (71 días).`;

/* ── movimiento (el extractor de la caja) ───────────────────── */

/**
 * Frases que **no** son telegráficas, porque las telegráficas no llegan al
 * modelo: las resuelve `leerTelegrafico()` con un regex. Estas son las
 * únicas que gastan una llamada, así que son las únicas que hay que medir.
 *
 * La descripción esperada está al lado porque el juez la compara: es el
 * único caso donde el banco sabe la respuesta exacta.
 */
export const FRASES_MOVIMIENTO: readonly {
  frase: string;
  descripcion: string;
  monto: number;
  moneda: "ARS" | "USD" | null;
  /** Copiada literal de la frase, sin convertir. */
  fechaTexto: string | null;
}[] = [
  {
    frase: "pagué 20 dólares de Claude Code ayer",
    descripcion: "Claude Code",
    monto: 20,
    moneda: "USD",
    fechaTexto: "ayer",
  },
  {
    frase: "cobré 601700 por la Venta Proder a cliente nuevo",
    descripcion: "Venta Proder a cliente nuevo",
    monto: 601700,
    moneda: null,
    fechaTexto: null,
  },
  {
    frase: "me cobraron 15 lucas el hosting el martes",
    descripcion: "el hosting",
    monto: 15000,
    moneda: "ARS",
    fechaTexto: "el martes",
  },
];

/* ── adjuntos ───────────────────────────────────────────────── */

export const CONTEXTO_ADJUNTO_TROZO = `Documento: contrato-marco-distribuidora.pdf
Fragmento 1 de 3:

CLÁUSULA 7 — ALCANCE Y CAMBIOS. Todo requerimiento no descripto en el Anexo I será considerado un cambio de alcance y se cotizará por separado, con un plazo de respuesta de 5 días hábiles. El PROVEEDOR no está obligado a ejecutar cambios sin orden de compra previa.

CLÁUSULA 8 — SOPORTE. El soporte incluido cubre 8 horas mensuales durante los primeros 3 meses posteriores a la puesta en producción. Las horas no consumidas no se acumulan.

CLÁUSULA 12 — PAGOS. La facturación es a 30 días fecha de factura. La mora superior a 15 días habilita a suspender el servicio.`;

export const CONTEXTO_ADJUNTO_SINTESIS = `Documento: contrato-marco-distribuidora.pdf
Páginas: 3
Lo que escribió al pasártelo: mirá esto que me manda el cliente antes de firmar

Afirmaciones sacadas del documento:
- Todo requerimiento fuera del Anexo I se considera cambio de alcance y se cotiza aparte.
- Los cambios de alcance tienen 5 días hábiles de plazo de respuesta.
- El proveedor no está obligado a ejecutar cambios sin orden de compra previa.
- El soporte incluido son 8 horas mensuales por 3 meses después de producción.
- Las horas de soporte no consumidas no se acumulan.
- La facturación es a 30 días fecha de factura.
- La mora mayor a 15 días habilita a suspender el servicio.`;

/**
 * Una imagen de ruido, para el caso que ya está medido a mano el
 * 2026-08-10: con ruido puro el modelo tiene que contestar
 * `legible: false` y **no inventar una conversación**.
 *
 * Se genera acá en vez de guardar un archivo en el repo: así la fixture no
 * depende de un binario que alguien pueda mover o mirar, es determinística
 * (semilla fija) y no pesa nada.
 *
 * ⚠ **64×64 y no 1×1, y eso lo dijo Groq corriendo.** La primera versión
 * era el PNG mínimo de un píxel y las tres llamadas volvieron con
 * `HTTP 400: "Image must have at least 2 pixels in each dimension"`. Fue el
 * primer hallazgo del arnés que no era del prompt ni del juez, sino de la
 * fixture — y llegó igual como rojo, que es para lo que sirve.
 */
export function ruidoPng(): string {
  const lado = 64;
  const filas: Buffer[] = [];

  // Congruencial lineal con semilla fija: el mismo ruido siempre. Un ruido
  // distinto en cada corrida haría que "osciló entre corridas" mezclara la
  // inestabilidad del modelo con la de la entrada.
  let semilla = 20260813;
  const siguiente = () => {
    semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
    return (semilla >>> 16) & 0xff;
  };

  for (let y = 0; y < lado; y++) {
    // El 0 de adelante es el filtro de la línea (None), que el formato pide.
    const fila = Buffer.alloc(lado * 3 + 1);
    for (let i = 1; i < fila.length; i++) fila[i] = siguiente();
    filas.push(fila);
  }

  return `data:image/png;base64,${armarPng(lado, lado, Buffer.concat(filas))}`;
}

/**
 * Un PNG a mano: firma, IHDR, IDAT y IEND.
 *
 * Son veinte líneas y evitan una dependencia y un binario en el repo. El
 * único detalle que no es obvio es que cada chunk lleva su CRC32, y que el
 * IDAT va comprimido con zlib —que Node trae de fábrica—.
 */
function armarPng(ancho: number, alto: number, crudo: Buffer): string {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 2; // color: RGB
  // 10, 11 y 12 quedan en 0: compresión, filtro e interlazado estándar.

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(crudo)),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

function chunk(tipo: string, datos: Buffer): Buffer {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length, 0);

  const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo), 0);

  return Buffer.concat([largo, cuerpo, crc]);
}

const TABLA_CRC = (() => {
  const tabla = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c >>> 0;
  }
  return tabla;
})();

function crc32(datos: Buffer): number {
  let c = 0xffffffff;
  for (const byte of datos) c = TABLA_CRC[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
