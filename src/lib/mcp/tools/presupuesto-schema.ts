import { z } from "zod";

/**
 * Lo que un modelo puede decir de un presupuesto: **el alcance y el
 * esfuerzo, nunca la plata**.
 *
 * ⚠ **No hay ningún campo de precio, y es la decisión.** Lo que produce el
 * modelo termina en un PDF que se le manda a un cliente con el nombre de
 * Beno, así que el monto lo calcula la app con la tarifa de Ajustes y los
 * multiplicadores por tipo de cliente (`lib/presupuestos.ts`), igual que
 * hoy. El modelo estima esfuerzo; el precio sale de multiplicar horas por
 * su tarifa.
 *
 * Es el caso concreto del fallo 3: Beno mencionó "los 2.400.000 ARS y las
 * 110/120h". Las horas son estimación y entran; el monto sale de la
 * cuenta, y si no coincide, **gana la app y se avisa la diferencia**.
 *
 * Vive en un archivo propio porque **lo usan las dos tools** que dictan
 * presupuestos: `registrar_proyecto` (adentro del payload) y
 * `registrar_presupuesto`. Metido adentro de cualquiera de las dos, la
 * otra tendría que importar de un archivo que registra tools y el orden de
 * creación pasaría a importar.
 *
 * Y **no lleva `import "server-only"`**: es un esquema de Zod y nada más.
 * El `server-only` está en los dos que lo importan, que son los que tocan
 * la base.
 */
export const presupuestoDictadoSchema = z.object({
  cliente_nombre: z.string().trim().min(1).max(120),
  cliente_tipo: z
    .enum(["particular", "pyme", "empresa"])
    .describe("Define el multiplicador que aplica Pepe sobre la tarifa base."),
  titulo: z.string().trim().min(1).max(160),
  resumen_alcance: z.string().trim().max(2000).default(""),
  pedido_texto: z
    .string()
    .trim()
    .max(60000)
    .describe(
      "Lo que dijo el cliente, tal cual. Es contra esto que se verifica cada entregable.",
    ),
  items: z
    .array(
      z.object({
        titulo: z.string().trim().min(1).max(160),
        detalle: z.string().trim().max(600).default(""),
        horas: z.number().nonnegative().max(400),
        /**
         * ⚠ Techo 400 y no 200, igual que `quoteItemSchema.ancla` de
         * `lib/schemas.ts`: una cita literal y correcta de 246 caracteres
         * es un caso real medido, y con 200 acá moriría recién al guardar.
         */
        ancla: z
          .string()
          .trim()
          .max(400)
          .nullable()
          .default(null)
          .describe(
            "La cita literal del pedido que justifica este entregable, o null si no hay ninguna.",
          ),
      }),
    )
    .min(1)
    .max(50),
  supuestos: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  preguntas: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
});

export type PresupuestoDictado = z.infer<typeof presupuestoDictadoSchema>;
