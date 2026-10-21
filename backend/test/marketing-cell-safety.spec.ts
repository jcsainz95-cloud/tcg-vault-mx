/**
 * 🔒 CANDADO — saneado de fórmula del export (Brief 2 §4/§6 criterio 5, PM-B1; ARCHITECTURE §13.5).
 * `=1+1`, `+1+1`, `-1+1`, `@SUM(1)` y `=HYPERLINK(...)` deben salir COMO TEXTO, nunca evaluados.
 */
import {
  csvNumberCell,
  csvTextCell,
  isFormulaInjection,
  neutralizeFormula,
  xlsxTextValue,
} from '../src/modules/marketing/export/cell-safety';

const INJECTIONS = ['=1+1', '+1+1', '-1+1', '@SUM(1)', '=HYPERLINK("https://example.com","x")', '\tcmd', '\rcmd'];

describe('cell-safety (anti inyección de fórmula)', () => {
  it.each(INJECTIONS)('detecta la inyección %s', (s) => {
    expect(isFormulaInjection(s)).toBe(true);
  });

  it.each(INJECTIONS)('CSV: antepone \' y entrecomilla %s (jamás se evalúa)', (s) => {
    const cell = csvTextCell(s);
    expect(cell.startsWith('"\'')).toBe(true); // comilla de apertura + apóstrofo neutralizador
    expect(cell.endsWith('"')).toBe(true);
  });

  it.each(INJECTIONS)('XLSX: el valor de texto empieza por \' %s (celda de texto, nunca fórmula)', (s) => {
    expect(xlsxTextValue(s)[0]).toBe("'");
  });

  it('texto inofensivo NO se altera', () => {
    expect(neutralizeFormula('charizard 151')).toBe('charizard 151');
    expect(isFormulaInjection('bio')).toBe(false);
    expect(xlsxTextValue('bio')).toBe('bio');
  });

  it('CSV escapa las comillas internas (" ⇒ "")', () => {
    expect(csvTextCell('a"b')).toBe('"a""b"');
  });

  it('CSV entrecomilla también coma/salto para no romper la fila', () => {
    expect(csvTextCell('a,b')).toBe('"a,b"');
  });

  it('celda numérica va cruda (nunca entrecomillada), vacío si null', () => {
    expect(csvNumberCell(1234.5)).toBe('1234.5');
    expect(csvNumberCell(null)).toBe('');
  });
});
