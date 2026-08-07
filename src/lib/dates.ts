/**
 * Fechas.
 *
 * Las columnas `date` de Postgres se manejan siempre como strings
 * "YYYY-MM-DD". Nunca se pasan por `new Date(str)` sin cuidado: eso las
 * interpreta en UTC y en Argentina (UTC-3) devuelve el día anterior.
 * Todo lo que sea aritmética de calendario usa mediodía local.
 */

export const TZ_ARGENTINA = "America/Argentina/Buenos_Aires";

/** Hoy en Argentina, como "YYYY-MM-DD". */
export function todayISO(): string {
  return isoFromParts(nowInArgentina());
}

function nowInArgentina(): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_ARGENTINA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  return { year: get("year"), month: get("month"), day: get("day") };
}

function isoFromParts({
  year,
  month,
  day,
}: {
  year: number;
  month: number;
  day: number;
}): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Convierte "YYYY-MM-DD" en un Date local al mediodía (inmune a DST y UTC). */
export function parseISODate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

/** Convierte un Date local a "YYYY-MM-DD". */
export function toISODate(date: Date): string {
  return isoFromParts({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  });
}

/** "2026-04-15" → "15/04/2026" */
export function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

/** "2026-04-15" → "15/04" */
export function formatDayMonth(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

/** "2026-04" → "abr 2026" */
export function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  const label = new Intl.DateTimeFormat("es-AR", {
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, 15, 12));
  return label.replace(".", "");
}

/** "2026-04-15" → "2026-04" */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function addDays(iso: string, days: number): string {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

/**
 * Día de la semana en formato ISO: 1 = lunes … 7 = domingo.
 *
 * `getDay()` devuelve 0 para el domingo; acá se lo lleva a 7 para que el
 * lunes sea el 1 y la semana arranque donde arranca en el calendario de
 * acá. Es el mismo criterio que usa `tracks.cadencia` en la base.
 */
export function weekday(iso: string): number {
  const dia = parseISODate(iso).getDay();
  return dia === 0 ? 7 : dia;
}

/** Lunes de la semana que contiene `iso`. */
export function mondayOf(iso: string): string {
  return addDays(iso, -(weekday(iso) - 1));
}

export function addMonths(iso: string, months: number): string {
  const date = parseISODate(iso);
  date.setMonth(date.getMonth() + months);
  return toISODate(date);
}

/** Primer día del mes de `iso`. */
export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** Último día del mes de `iso`. */
export function endOfMonth(iso: string): string {
  const [year, month] = iso.split("-").map(Number);
  return toISODate(new Date(year, month, 0, 12));
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Lista ordenada de meses "YYYY-MM" entre dos fechas, ambas inclusive.
 * Se usa para que los gráficos tengan meses vacíos en vez de saltos.
 */
export function monthRange(desde: string, hasta: string): string[] {
  const months: string[] = [];
  let cursor = startOfMonth(desde);
  const limit = startOfMonth(hasta);

  // Guarda contra rangos absurdos que colgarían el render.
  while (cursor <= limit && months.length < 600) {
    months.push(cursor.slice(0, 7));
    cursor = addMonths(cursor, 1);
  }

  return months;
}

export function compareISO(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
