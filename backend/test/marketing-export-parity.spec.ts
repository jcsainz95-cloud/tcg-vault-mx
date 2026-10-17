/**
 * 🔒 CANDADO — export del Panel: paridad A=B (mismas cifras que el endpoint, celda por celda) y
 * saneado de fórmula a través del serializador REAL (Brief 2 §6 criterios 5 y 8, PM-B1).
 * El endpoint y el Excel se construyen del MISMO `ScreenPayload`; aquí se prueba que el serializador
 * reproduce ese payload sin alterarlo (y que una inyección sale como texto).
 */
import * as ExcelJS from 'exceljs';
import { MarketingExportService } from '../src/modules/marketing/export/marketing-export.service';
import { SMALL_CELL_SENTINEL } from '../src/modules/marketing/small-cells';
import type { ScreenPayload } from '../src/modules/marketing/marketing-aggregates.types';

const NOW = new Date('2026-10-19T15:30:00.000Z');

const INJECTION = '=HYPERLINK("https://example.com","x")';

const payload: ScreenPayload = {
  screen: 'd',
  period: { kind: 'week', from: '2026-10-05', to: '2026-10-11', label: '2026-W41', timezone: 'America/Mexico_City' },
  sourceLegend: { BD: 'Base de datos', GA4: 'GA4', SC: 'Search Console', Srv: 'Servidor' },
  tables: [
    {
      id: 'd1',
      title: 'Cartas más vendidas',
      source: 'mixed',
      columns: [
        { key: 'carta', labelEs: 'Carta', kind: 'text' },
        { key: 'vistas', labelEs: 'Fichas vistas', tech: 'view_item', kind: 'count' },
        { key: 'unidades', labelEs: 'Unidades vendidas', kind: 'count' },
        { key: 'mxn', labelEs: 'MX$ vendido', kind: 'money' },
      ],
      rows: [
        // Fila con inyección en el texto (utm/nombre de fuera) y celda pequeña «< 5» sin MX$.
        { carta: INJECTION, vistas: 'NO MEDIDO — GA4 sin encender', unidades: SMALL_CELL_SENTINEL, mxn: null },
        // Fila normal: números exactos (pesos con 2 decimales).
        { carta: 'Charizard · 151 4', vistas: 'NO MEDIDO — GA4 sin encender', unidades: 12, mxn: 3480.5 },
      ],
      measured: true,
    },
  ],
  // h1 (§MKT.E): anotaciones embebidas. La primera lleva una inyección de fórmula para probar el saneado
  // en la hoja «Info»; la segunda es una promoción con destino.
  annotations: [
    { date: '2026-10-06', kind: 'evento', label: '=cmd|peligro' },
    { date: '2026-10-08', kind: 'promocion', label: 'Promo de otoño', destino: '/es/promos/otono' },
  ],
};

describe('MarketingExportService — paridad y saneado', () => {
  const svc = new MarketingExportService();

  it('CSV reproduce las cifras del payload (A=B) y neutraliza la fórmula', () => {
    const csv = svc.screenCsv(payload);
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM
    const lines = csv.replace(/^﻿/, '').split('\r\n');
    // L0 título, L1 labels, L2 tech, L3 fila1, L4 fila2
    expect(lines[1]).toBe('"Carta","Fichas vistas","Unidades vendidas","MX$ vendido"');
    // Fila 1: inyección entre comillas y con apóstrofo; «< 5» como texto; MX$ vacío.
    expect(lines[3]).toBe(`"'=HYPERLINK(""https://example.com"",""x"")","NO MEDIDO — GA4 sin encender","< 5",`);
    // Fila 2: números crudos idénticos al payload (paridad).
    expect(lines[4]).toBe('"Charizard · 151 4","NO MEDIDO — GA4 sin encender",12,3480.5');
  });

  it('XLSX escribe texto como texto (nunca fórmula) y montos como número con formato, iguales al payload', async () => {
    const buf = await svc.workbook([payload], NOW);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.getWorksheet('pantalla_d')!;
    // row1 título, row2 labels, row3 tech, row4 fila1, row5 fila2.
    const r4 = ws.getRow(4);
    const cartaCell = r4.getCell(1);
    expect(typeof cartaCell.value).toBe('string');
    expect((cartaCell.value as string)[0]).toBe("'"); // neutralizada
    expect(cartaCell.type).not.toBe(ExcelJS.ValueType.Formula);
    expect(cartaCell.formula).toBeUndefined();
    expect(r4.getCell(3).value).toBe('< 5'); // celda pequeña como texto
    expect(r4.getCell(4).value).toBeNull(); // MX$ oculto

    const r5 = ws.getRow(5);
    expect(r5.getCell(3).value).toBe(12); // paridad: mismo número que el payload
    expect(r5.getCell(4).value).toBe(3480.5);
    expect(r5.getCell(4).numFmt).toBe('$#,##0.00');
  });

  it('la hoja «Info» existe y declara periodo y nota de celdas pequeñas', async () => {
    const buf = await svc.workbook([payload], NOW);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const info = wb.getWorksheet('Info')!;
    const texto = JSON.stringify(info.getSheetValues());
    expect(texto).toContain('2026-10-05');
    expect(texto).toContain('N<5');
  });

  it('la hoja «Info» embebe las anotaciones del periodo como TEXTO saneado (⛔ nunca fórmula)', async () => {
    const buf = await svc.workbook([payload], NOW);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const info = wb.getWorksheet('Info')!;
    // Busca la fila de la anotación con inyección: su detalle debe estar neutralizado con apóstrofo.
    let saneada: ExcelJS.Cell | undefined;
    let promo = false;
    info.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value === 'string') {
          if (cell.value.includes('=cmd|peligro')) saneada = cell;
          if (cell.value.includes('/es/promos/otono')) promo = true;
        }
      });
    });
    expect(saneada).toBeDefined();
    expect((saneada!.value as string)[0]).toBe("'"); // neutralizada
    expect(saneada!.type).not.toBe(ExcelJS.ValueType.Formula);
    expect(saneada!.formula).toBeUndefined();
    expect(promo).toBe(true); // la promoción con destino también aparece
  });

  it('rowCount cuenta las filas de datos de todas las tablas', () => {
    expect(svc.rowCount([payload])).toBe(2);
  });
});
