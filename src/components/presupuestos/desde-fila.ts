import type { PresupuestoImprimible } from "@/components/presupuestos/tipos";
import type { PresupuestoCompleto } from "@/lib/presupuestos-server";
import type { QuoteInput } from "@/lib/schemas";

/**
 * De la fila de `quotes` a las dos formas que la usan: el documento
 * imprimible y el formulario.
 *
 * ⚠ **Acá no se calcula nada.** Los números salen de la fila tal como
 * quedaron congelados: `total_origen`, `horas_estimadas` y
 * `semanas_estimadas` son la foto del momento en que se guardó. Si esta
 * función recalculara el total contra la cotización de hoy, un
 * presupuesto de marzo diría en agosto un precio que nunca se mandó.
 *
 * Los datos del emisor (nombre y contacto) sí salen de `settings` y no de
 * la fila, y es a propósito: son de Beno, no del presupuesto. Si cambia su
 * mail, los presupuestos viejos tienen que reimprimirse con el nuevo —
 * justamente porque el mail viejo ya no contesta.
 */

export interface DatosEmisor {
  emisor_nombre: string | null;
  emisor_contacto: string | null;
}

export function aImprimible(
  { quote, items, supuestos, preguntas }: PresupuestoCompleto,
  emisor: DatosEmisor,
): PresupuestoImprimible {
  return {
    numero: quote.numero,
    fecha: quote.fecha,
    validez_dias: quote.validez_dias,
    titulo: quote.titulo,
    resumen_alcance: quote.resumen_alcance || null,
    cliente_nombre: quote.cliente_nombre,
    cliente_tipo: quote.cliente_tipo,
    emisor_nombre: emisor.emisor_nombre,
    emisor_contacto: emisor.emisor_contacto,
    items: items.map((item) => ({
      titulo: item.titulo,
      detalle: item.detalle || null,
      horas: Number(item.horas),
    })),
    // Los supuestos van al papel: son las condiciones de contorno bajo las
    // que vale el precio. Las preguntas también, y no es un descuido —
    // mandarlas escritas es lo que hace que el cliente las conteste en vez
    // de que queden en la cabeza de uno.
    supuestos: supuestos.map((fila) => fila.texto),
    preguntas: preguntas.map((fila) => fila.texto),
    condiciones: quote.condiciones || null,
    moneda: quote.moneda,
    total_origen: Number(quote.total_origen),
    horas_estimadas: Number(quote.horas_estimadas),
    semanas_estimadas: Number(quote.semanas_estimadas),
    mostrar_horas: quote.mostrar_horas,
  };
}

/**
 * @param totalCalculado Lo que da la cuenta con los valores **congelados**
 *   de la fila. Sirve para una sola cosa y no es un detalle: saber si el
 *   total guardado lo puso Beno a mano. Si coincide con la cuenta, el
 *   formulario lo deja seguir a los ítems mientras se edita; si no
 *   coincide, es porque lo pisó y no hay que volver a pisárselo.
 */
export function aFormulario(
  { quote, items, supuestos, preguntas }: PresupuestoCompleto,
  totalCalculado: number,
): QuoteInput {
  return {
    cliente_nombre: quote.cliente_nombre,
    cliente_tipo: quote.cliente_tipo,
    titulo: quote.titulo,
    resumen_alcance: quote.resumen_alcance,
    pedido_texto: quote.pedido_texto,
    moneda: quote.moneda,
    fecha: quote.fecha,
    validez_dias: quote.validez_dias,
    mostrar_horas: quote.mostrar_horas,
    condiciones: quote.condiciones,
    total_origen: Number(quote.total_origen),
    total_editado:
      Math.abs(totalCalculado - Number(quote.total_origen)) > 0.005,
    items: items.map((item) => ({
      titulo: item.titulo,
      detalle: item.detalle,
      horas: Number(item.horas),
      origen: item.origen === "modelo" ? "modelo" : "manual",
      ancla: item.ancla,
      ancla_verificada: item.ancla_verificada,
      confianza:
        item.confianza === "alta" ||
        item.confianza === "media" ||
        item.confianza === "baja"
          ? item.confianza
          : null,
    })),
    supuestos: supuestos.map((fila) => fila.texto),
    preguntas: preguntas.map((fila) => fila.texto),
    modelo: quote.modelo,
    reemplaza_a: quote.reemplaza_a,
  };
}
