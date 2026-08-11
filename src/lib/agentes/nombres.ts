/**
 * Lo mínimo que necesita una fila para poder resolverse por texto: cómo
 * se llama y cómo se la nombra en una URL. Proyectos y tracks lo cumplen
 * los dos, y por eso comparten este criterio en vez de tener cada uno el
 * suyo.
 *
 * Vive en su propio módulo, separado de `agentes/resolver.ts` — que es
 * quien lo usaba primero— **sin `server-only`**, y a propósito: lo
 * consume también `agentes/bitacora.ts`, que no es `server-only`, y
 * `resolver.ts` sí lo es. Si `bitacora.ts` importara de `resolver.ts`
 * directamente, se volvería `server-only` por contagio —el paquete
 * `server-only` tira apenas se lo importa fuera de un entorno de
 * servidor— y dejaría de poder usarse desde donde hoy no hace falta esa
 * restricción. Este módulo es la parte común que a ninguno de los dos le
 * cuesta compartir.
 */
export interface Nombrado {
  nombre: string;
  slug: string;
}

/** Minúsculas, sin tildes y sin puntuación, para comparar nombres escritos a mano. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
