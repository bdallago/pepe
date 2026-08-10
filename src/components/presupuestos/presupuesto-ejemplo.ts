import { calcularPresupuesto, sumarHoras } from "@/lib/presupuestos";
import type { ItemImprimible, PresupuestoImprimible } from "@/components/presupuestos/tipos";

/**
 * Un presupuesto de ejemplo para ver el documento **sin que exista todavía
 * la tabla `quotes`**.
 *
 * No son números inventados sueltos: la tarifa es la que Beno cobra hoy
 * (20.000 ARS/hora) y el total sale de `calcularPresupuesto`, así que el
 * ejemplo y la app calculan igual. Si el cálculo cambia, el ejemplo
 * cambia con él en vez de quedar mintiendo.
 *
 * Los títulos de los entregables siguen la vara del spec: dicen **qué se
 * entrega**, con nombre y apellido. "Desarrollo backend" y "Testing y QA"
 * son rótulos y no van; un título que podría estar en cualquier
 * presupuesto de cualquier proyecto está mal.
 */

const ITEMS: ItemImprimible[] = [
  {
    titulo:
      "Endpoint de importación del CSV de productos, con validación y reporte de errores por fila",
    detalle:
      "Carga del archivo, validación de columnas y tipos, y una devolución que dice qué fila falló y por qué en vez de rechazar el archivo entero.",
    horas: 12,
  },
  {
    titulo: "Pantalla de listado de productos con búsqueda y filtro por rubro",
    detalle:
      "Listado paginado, búsqueda por nombre y código, y filtro por rubro. Sin edición: eso es el ítem siguiente.",
    horas: 16,
  },
  {
    titulo: "Alta y edición de producto, con imagen y precio en dos monedas",
    detalle:
      "Formulario con validación, subida de una imagen por producto y precio en pesos y dólares.",
    horas: 18,
  },
  {
    titulo: "Puesta en producción con dominio propio y certificado",
    detalle:
      "Deploy, dominio apuntado, HTTPS y una pasada de verificación con datos reales antes de entregar.",
    horas: 6,
  },
];

const HORAS = sumarHoras(ITEMS);

const CALCULO = calcularPresupuesto({
  horas: HORAS,
  // Lo que Beno cobra hoy, a todos por igual. Que sea también el precio
  // del cliente más chico del tarifario es el problema que este módulo
  // pone a la vista.
  tarifa_hora: 20_000,
  tarifa_moneda: "ARS",
  cliente_tipo: "pyme",
  moneda: "ARS",
});

export const PRESUPUESTO_DE_EJEMPLO: PresupuestoImprimible = {
  numero: 7,
  fecha: "2026-08-10",
  validez_dias: 15,

  titulo: "Catálogo de productos administrable",
  resumen_alcance:
    "Un catálogo web con carga de productos desde planilla, listado con búsqueda y una pantalla de administración para dar de alta y editar. No incluye pasarela de pago ni carrito.",

  cliente_nombre: "Distribuidora del Litoral",
  cliente_tipo: "pyme",

  emisor_nombre: "Benito Dallago",
  emisor_contacto: "bdallago01@gmail.com",

  items: ITEMS,

  supuestos: [
    "El contenido de los productos (nombres, descripciones y fotos) lo aporta el cliente.",
    "La planilla de productos viene en un solo archivo y con una fila por producto.",
    "El hosting y el dominio los paga el cliente.",
  ],
  preguntas: [
    "¿Cuántos rubros distintos hay que contemplar en el filtro?",
    "¿Los precios se cargan a mano o salen de un sistema que ya existe?",
  ],
  condiciones:
    "50 % al aceptar el presupuesto y 50 % contra la entrega. El plazo se cuenta desde que llega el contenido de los productos.",

  moneda: CALCULO.moneda,
  total_origen: CALCULO.total_origen,

  horas_estimadas: CALCULO.horas,
  semanas_estimadas: CALCULO.semanas,

  // Default false: mostrar las horas convierte la charla en una
  // discusión de tarifa horaria.
  mostrar_horas: false,
};
