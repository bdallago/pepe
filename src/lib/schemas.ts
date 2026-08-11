import { z } from "zod";

/** Validación compartida entre los formularios y las Server Actions. */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (formato AAAA-MM-DD).");

const uuid = z.string().uuid("Identificador inválido.");

export const tipoMovimientoSchema = z.enum(["ingreso", "egreso"]);
export const monedaSchema = z.enum(["ARS", "USD"]);
export const estadoMovimientoSchema = z.enum(["efectuado", "planificado"]);
export const frecuenciaSchema = z.enum(["mensual", "anual"]);

// ─────────────────────────────────────────────────────────────
// Proyectos
// ─────────────────────────────────────────────────────────────
export const projectSchema = z
  .object({
    nombre: z
      .string()
      .trim()
      .min(1, "Poné un nombre.")
      .max(80, "Máximo 80 caracteres."),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido."),
    fecha_inicio: isoDate.nullable(),
    fecha_fin: isoDate.nullable(),
    peso_prorrateo: z
      .number()
      .positive("El peso tiene que ser mayor a cero.")
      .max(9999, "Peso demasiado grande."),
  })
  // La base tiene `projects_fechas_coherentes` desde
  // `20260810000001_proyectos_fechas.sql:46`. Sin este refine, cerrar un
  // proyecto antes de su inicio no lo frena el formulario: lo frena
  // Postgres, y lo que ve Beno es el texto crudo de una violación de
  // check constraint. Validar acá es decirle lo mismo en castellano.
  .refine(
    (p) => !p.fecha_inicio || !p.fecha_fin || p.fecha_fin >= p.fecha_inicio,
    { message: "El cierre no puede ser anterior al inicio.", path: ["fecha_fin"] },
  );

export type ProjectInput = z.infer<typeof projectSchema>;

/**
 * El color con el que nace un proyecto que no se creó desde el formulario
 * (por conversación, o aceptando una propuesta de la bandeja).
 *
 * Es `--chart-1`, el primero de los ocho tonos validados. **No es un color
 * libre**: el selector de Ajustes ofrece esos ocho justamente para que los
 * gráficos no se llenen de colores sin validar (`AGENTS.md`, "Gráficos"), y
 * un alta que no pasa por ese selector no puede ser la puerta por la que
 * entre uno que no está en la lista.
 */
export const COLOR_POR_DEFECTO_DE_PROYECTO = "#008F8F";

// ─────────────────────────────────────────────────────────────
// Categorías
// ─────────────────────────────────────────────────────────────
export const categorySchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, "Poné un nombre.")
    .max(60, "Máximo 60 caracteres."),
  tipo: tipoMovimientoSchema,
  archivada: z.boolean(),
});

export type CategoryInput = z.infer<typeof categorySchema>;

// ─────────────────────────────────────────────────────────────
// Movimientos
//
// El formulario muestra ARS y USD a la vez. `moneda_origen` marca cuál de
// los dos escribió el usuario: ese es el importe real, el otro es derivado.
// ─────────────────────────────────────────────────────────────
export const movementSchema = z.object({
  fecha: isoDate,
  descripcion: z
    .string()
    .trim()
    .min(1, "Poné una descripción.")
    .max(200, "Máximo 200 caracteres."),
  tipo: tipoMovimientoSchema,
  // null = gasto compartido entre todos los proyectos.
  project_id: uuid.nullable(),
  category_id: uuid,
  monto_origen: z
    .number()
    .nonnegative("El monto no puede ser negativo.")
    .max(1e12, "Monto demasiado grande."),
  moneda_origen: monedaSchema,
  tasa_usada: z
    .number()
    .positive("La cotización tiene que ser mayor a cero.")
    .max(1e9, "Cotización demasiado grande."),
  tasa_fecha: isoDate,
  estado: estadoMovimientoSchema,
  comprobante_path: z.string().max(400).nullable().optional(),
});

export type MovementInput = z.infer<typeof movementSchema>;

// ─────────────────────────────────────────────────────────────
// Recurrencias
// ─────────────────────────────────────────────────────────────
export const recurrenceSchema = z
  .object({
    descripcion: z
      .string()
      .trim()
      .min(1, "Poné una descripción.")
      .max(200, "Máximo 200 caracteres."),
    tipo: tipoMovimientoSchema,
    project_id: uuid.nullable(),
    category_id: uuid,
    monto_origen: z
      .number()
      .nonnegative("El monto no puede ser negativo.")
      .max(1e12, "Monto demasiado grande."),
    moneda_origen: monedaSchema,
    frecuencia: frecuenciaSchema,
    dia_del_mes: z
      .number()
      .int()
      .min(1, "Entre 1 y 31.")
      .max(31, "Entre 1 y 31."),
    fecha_inicio: isoDate,
    fecha_fin: isoDate.nullable(),
    activa: z.boolean(),
  })
  .refine(
    (value) => value.fecha_fin === null || value.fecha_fin >= value.fecha_inicio,
    {
      message: "La fecha de fin no puede ser anterior a la de inicio.",
      path: ["fecha_fin"],
    },
  );

export type RecurrenceInput = z.infer<typeof recurrenceSchema>;

// ─────────────────────────────────────────────────────────────
// Presupuestos
//
// ⚠ Lo que NO está en este esquema es tan importante como lo que está:
// `tarifa_hora`, `multiplicador`, `horas_por_semana`, `tasa_usada` y
// `tasa_fecha` **no viajan desde el formulario**. Los pone el servidor al
// guardar, leyéndolos de `settings` y de `fx_rates` (regla 1: son foto del
// momento). Si el cliente los mandara, cualquiera podría cambiar el
// congelado de un presupuesto viejo con un fetch a mano.
// ─────────────────────────────────────────────────────────────
export const tipoClienteSchema = z.enum(["particular", "pyme", "empresa"]);

export const quoteItemSchema = z.object({
  titulo: z
    .string()
    .trim()
    .min(1, "Poné qué se entrega.")
    .max(160, "Máximo 160 caracteres."),
  detalle: z.string().trim().max(600, "Máximo 600 caracteres."),
  horas: z
    .number()
    .nonnegative("Las horas no pueden ser negativas.")
    .max(400, "Un ítem de más de 400 horas es el proyecto entero sin partir."),
  /** Se apaga a 'manual' apenas se toca un campo del ítem. */
  origen: z.enum(["modelo", "manual"]),
  /**
   * 400 y no 200, que es lo que se le **pide** al modelo: el techo de acá
   * tiene que ser el mismo `ANCLA_MAX_CHARS` que acepta
   * `lib/presupuestos/estimacion.ts`, o una cita literal y correcta de 246
   * caracteres —el caso medido el 2026-08-10, un punto que el cliente
   * escribió en dos oraciones— pasaría la estimación y moriría recién al
   * guardar, con el presupuesto entero ya en pantalla. Si movés uno, mové
   * el otro.
   */
  ancla: z.string().trim().max(400).nullable(),
  ancla_verificada: z.boolean(),
  confianza: z.enum(["alta", "media", "baja"]).nullable(),
});

export type QuoteItemInput = z.infer<typeof quoteItemSchema>;

const lineaLibre = z.string().trim().min(1).max(300);

export const quoteSchema = z.object({
  cliente_nombre: z
    .string()
    .trim()
    .min(1, "Poné el nombre del cliente.")
    .max(120, "Máximo 120 caracteres."),
  cliente_tipo: tipoClienteSchema,

  titulo: z
    .string()
    .trim()
    .min(1, "Poné un título.")
    .max(160, "Máximo 160 caracteres."),
  resumen_alcance: z.string().trim().max(2000, "Máximo 2000 caracteres."),
  /** Lo que pegó o dictó. Es contra esto que se verifican las anclas. */
  pedido_texto: z.string().trim().max(60000),

  moneda: monedaSchema,
  fecha: isoDate,
  validez_dias: z
    .number()
    .int("Tiene que ser un número entero de días.")
    .positive("La validez tiene que ser de al menos un día.")
    .max(365, "Más de un año no es una validez."),
  mostrar_horas: z.boolean(),
  condiciones: z.string().trim().max(2000, "Máximo 2000 caracteres."),

  /**
   * El precio final, editable a mano: a veces el número que sale de la
   * cuenta no es el número que uno quiere mandar. `total_editado` dice si
   * Beno lo pisó; con `false` el servidor usa el que sale de
   * `calcularPresupuesto()` contra los valores congelados.
   */
  total_origen: z
    .number()
    .nonnegative("El total no puede ser negativo.")
    .max(1e12, "Total demasiado grande."),
  total_editado: z.boolean(),

  items: z.array(quoteItemSchema).max(50, "Máximo 50 entregables."),
  supuestos: z.array(lineaLibre).max(20, "Máximo 20 supuestos."),
  preguntas: z.array(lineaLibre).max(20, "Máximo 20 preguntas."),

  /** Qué modelo estimó, o null si se cargó a mano. */
  modelo: z.string().trim().max(80).nullable(),
  /** La cadena "quedó desactualizado → hice otro". */
  reemplaza_a: uuid.nullable(),
});

export type QuoteInput = z.infer<typeof quoteSchema>;

// ─────────────────────────────────────────────────────────────
// La tarifa y los multiplicadores, en Ajustes
// ─────────────────────────────────────────────────────────────
export const tarifasSchema = z
  .object({
    tarifa_hora: z
      .number()
      .positive("La tarifa tiene que ser mayor a cero.")
      .max(1e9, "Tarifa demasiado grande.")
      .nullable(),
    tarifa_moneda: monedaSchema,
    multiplicador_particular: z.number().positive("Tiene que ser mayor a cero."),
    multiplicador_pyme: z.number().positive("Tiene que ser mayor a cero."),
    multiplicador_empresa: z.number().positive("Tiene que ser mayor a cero."),
    horas_por_semana: z
      .number()
      .min(1, "Entre 1 y 80 horas por semana.")
      .max(80, "Entre 1 y 80 horas por semana."),
    emisor_nombre: z.string().trim().max(120).nullable(),
    emisor_contacto: z.string().trim().max(200).nullable(),
    condiciones_default: z.string().trim().max(2000).nullable(),
  })
  // El mismo check que la base (`settings_multiplicadores_ordenados`).
  // Duplicarlo acá no es redundancia: atrapa el error de tipeo con un
  // mensaje que se entiende, en vez de un 23514 de Postgres.
  .refine(
    (v) =>
      v.multiplicador_particular <= v.multiplicador_pyme &&
      v.multiplicador_pyme <= v.multiplicador_empresa,
    {
      message: "Los multiplicadores van de menor a mayor: particular ≤ pyme ≤ empresa.",
      path: ["multiplicador_pyme"],
    },
  );

export type TarifasInput = z.infer<typeof tarifasSchema>;
