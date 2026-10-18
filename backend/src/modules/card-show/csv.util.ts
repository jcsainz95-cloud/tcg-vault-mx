/**
 * csv.util.ts — v1.93⟨cardshow⟩ (API_CONTRACT §CARDSHOW.15).
 *
 * Export CSV del panel con DEFENSA anti-inyección de fórmulas (CSV/Formula Injection): un valor que
 * empieza por `= + - @` o por un carácter de control (`\t \r \n`) lo interpretan Excel/Sheets como
 * fórmula. Como el export incluye datos TECLEADOS por el público (correo, `playerName`), cada celda
 * se neutraliza con un apóstrofo delante y se entrecomilla si hace falta.
 *
 * ⛔ El export NUNCA incluye IP (el modelo no la guarda). El del organizador del torneo SÍ incluye
 * `playerName`/`playerId` (único destino autorizado); el de leads/panel NO expone PENDING.
 */

const FORMULA_LEAD = /^[=+\-@\t\r\n]/;

/** Neutraliza una celda contra inyección de fórmulas y la entrecomilla cuando contiene `, " \n \r`. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  // Anti-inyección de fórmulas: prefijo apóstrofo si abre con un carácter peligroso.
  if (FORMULA_LEAD.test(s)) s = `'${s}`;
  // Entrecomillado RFC 4180 si contiene separador, comillas o saltos.
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Arma una línea CSV a partir de celdas ya neutralizadas. */
export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

/** Documento CSV completo: cabecera + filas, terminado en `\n`. ⛔ Sin BOM (lo añade el serve, ver `withBom`). */
export function csvDocument(header: string[], rows: unknown[][]): string {
  const lines = [csvRow(header), ...rows.map(csvRow)];
  return `${lines.join('\n')}\n`;
}

/**
 * BOM de UTF-8 (`U+FEFF` → bytes EF BB BF). Excel en Windows asume la codificación local (Windows-1252)
 * si el archivo no trae BOM y rompe los acentos (á, é, í, ñ…). Prefijar el BOM hace que Excel/Sheets
 * detecten UTF-8 y los rendericen bien. Se añade SOLO al servir el export (§CARDSHOW.15), no en
 * `csvDocument`, para no contaminar el contenido que afirman las pruebas de celda/documento.
 */
export const CSV_BOM = '﻿';

/** Prefija el BOM de UTF-8 a un CSV ya armado (idempotente: no duplica si ya lo trae). */
export function withBom(csv: string): string {
  return csv.startsWith(CSV_BOM) ? csv : CSV_BOM + csv;
}
