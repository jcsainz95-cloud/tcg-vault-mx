/**
 * cell-safety.ts — 🔒 CANDADO DE SANEADO DE FÓRMULA del export del Panel (Brief 2 §4 «Seguridad del
 * archivo» PM-B1; ARCHITECTURE §13.5; API_CONTRACT §MKT.E). PURO. Los `utm_*`, términos de búsqueda y
 * anotaciones vienen de FUERA (PV-M2): una celda que empiece por `=`,`+`,`-`,`@`, tab o `\r` es una
 * inyección de fórmula si Excel/LibreOffice la abre como tal.
 *
 * - **CSV:** prefijo `'` en toda celda de texto que empiece por carácter peligroso, y la celda SIEMPRE
 *   entre comillas con las `"` escapadas (`"` ⇒ `""`). Fichero UTF-8 **con BOM** (Excel Windows).
 * - **XLSX:** todo texto se escribe como **celda de tipo texto** (nunca fórmula). exceljs no convierte
 *   una cadena en fórmula (solo lo hace con `{ formula }`), pero igualmente anteponemos `'` al texto
 *   peligroso para que, copiado/pegado o reinterpretado, JAMÁS se evalúe. Números van como número.
 */

/** Caracteres que, al inicio de una celda, disparan evaluación de fórmula en Excel/LibreOffice. */
const DANGEROUS_LEADING = ['=', '+', '-', '@', '\t', '\r'];

/** BOM UTF-8: Excel en Windows lo necesita para leer acentos. */
export const CSV_BOM = '﻿';

/** ¿Esta cadena sería interpretada como fórmula? (empieza por carácter peligroso). */
export function isFormulaInjection(value: string): boolean {
  return value.length > 0 && DANGEROUS_LEADING.includes(value[0]);
}

/**
 * Antepone `'` si el texto empieza por carácter peligroso. Base compartida por CSV y XLSX: el texto
 * nunca se evalúa como fórmula. (Para XLSX el apóstrofo lo absorbe Excel como «forzar texto».)
 */
export function neutralizeFormula(value: string): string {
  return isFormulaInjection(value) ? `'${value}` : value;
}

/**
 * Celda de texto para CSV: neutraliza la fórmula y SIEMPRE entrecomilla escapando `"` ⇒ `""`.
 * Entrecomillar siempre evita además que una coma, salto de línea o `\r` del contenido rompa la fila.
 */
export function csvTextCell(value: string): string {
  const neutral = neutralizeFormula(value);
  return `"${neutral.replace(/"/g, '""')}"`;
}

/** Celda numérica para CSV: número crudo (nunca entrecomillado), o vacío si null. */
export function csvNumberCell(value: number | null): string {
  return value === null || value === undefined ? '' : String(value);
}

/** Valor de texto para XLSX (exceljs): neutralizado. El llamador lo pone como `cell.value = string`. */
export function xlsxTextValue(value: string): string {
  return neutralizeFormula(value);
}

/** Une una fila de celdas CSV ya saneadas con coma. */
export function csvRow(cells: string[]): string {
  return cells.join(',');
}
