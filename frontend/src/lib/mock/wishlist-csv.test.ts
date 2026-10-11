import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { csvTextCell, mockWishlistDemand, mockWishlistDemandCsv } from './wishlist';

/*
 * C2 de techlead (§WSH sobre 503cf07): el CSV del simulador decía `paga_hasta`, `precio_normal_sin_iva`… y no traía la
 * sección `sellados`, mientras el servidor y `API_CONTRACT §WSH.8` v1.87.2 fijan OTRA cabecera literal. Un E2E de mocks
 * verde sobre una cabecera inventada no mide el contrato. El ancla es el CONTRATO (no `backend/`): la cabecera se lee
 * del texto de §WSH.8. Falla cerrado si alguien reformatea ese párrafo (se relee y se re-bendice).
 */

const CONTRACT_PATH = join(__dirname, '..', '..', '..', '..', 'docs', 'API_CONTRACT.md');

function contractCsvHeaders(): { rows: string; sealed: string } {
  const doc = readFileSync(CONTRACT_PATH, 'utf8');
  const start = doc.indexOf('### WSH.8 ');
  const end = doc.indexOf('### WSH.9 ', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const sec = doc.slice(start, end);
  const rows = /`(carta,set,numero,acabado,[a-z0-9_,]+)`/.exec(sec)?.[1];
  const sealed = /`(producto,[a-z0-9_,]+)`/.exec(sec)?.[1];
  expect(rows, 'cabecera de filas en §WSH.8').toBeTruthy();
  expect(sealed, 'cabecera de sellados en §WSH.8').toBeTruthy();
  return { rows: rows!, sealed: sealed! };
}

describe('C2 · CSV del simulador = cabecera literal de API_CONTRACT §WSH.8 v1.87.2', () => {
  it('primera línea = cabecera de filas del contrato, carácter a carácter', () => {
    const { rows } = contractCsvHeaders();
    expect(mockWishlistDemandCsv().split('\n')[0]).toBe(rows);
  });

  it('tras las filas: una línea vacía, la línea `sellados`, su cabecera y una fila por sellado', () => {
    const { sealed } = contractCsvHeaders();
    const body = mockWishlistDemand();
    const lines = mockWishlistDemandCsv().replace(/\n$/, '').split('\n');
    const n = body.rows.length;
    expect(lines).toHaveLength(1 + n + 1 + 1 + 1 + body.sealed.length);
    expect(lines[1 + n]).toBe('');
    expect(lines[2 + n]).toBe('sellados');
    expect(lines[3 + n]).toBe(sealed);
    expect(lines[4 + n]).toBe('"Surging Sparks Booster Box",box,mint,4');
  });

  it('celdas de texto entre comillas; montos en pesos con 2 decimales; nivel sin cuentas ⇒ 0 y celdas vacías', () => {
    const lines = mockWishlistDemandCsv().split('\n');
    const first = mockWishlistDemand().rows[0];
    const cells = lines[1].split(',');
    expect(cells[0]).toBe(`"${first.cardName}"`);
    expect(cells[1]).toBe(`"${first.setName}"`);
    expect(cells[2]).toBe(`"${first.number}"`);
    expect(cells[3]).toBe(first.finish);
    // Fila sin mercado (la última): sus columnas de dinero vacías, nunca 0.00.
    const last = lines[mockWishlistDemand().rows.length].split(',');
    expect(last).not.toContain('0.00');
    // Una fila con solo el nivel del 10 %: cuentas_16 = 0 y max_16/techo_16 vacíos.
    expect(last.slice(5, 8)).toEqual(['0', '', '']);
  });

  it('protección contra fórmulas: = + - @ tabulador o retorno al inicio ⇒ prefijo `\'`; comillas dobladas', () => {
    for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
      expect(csvTextCell(`${lead}SUM(A1)`)).toBe(`"'${lead}SUM(A1)"`);
    }
    expect(csvTextCell('Pikachu "VMAX"')).toBe('"Pikachu ""VMAX"""');
    expect(csvTextCell('Base Set')).toBe('"Base Set"');
  });
});
