/**
 * marketing-export.service.ts — exports .xlsx/.csv del Panel (Brief 2 §4, PM-B1; ARCHITECTURE §13.5;
 * API_CONTRACT §MKT.E). Se construye del MISMO `ScreenPayload` que devuelve el endpoint ⇒ paridad A=B
 * por construcción. 🔒 Saneado de fórmula (PM-B1) vía `cell-safety`: texto que viene de fuera
 * (utm_*, términos, anotaciones) nunca se evalúa como fórmula.
 *
 * - CSV: UTF-8 **con BOM**, celdas de texto entrecomilladas y neutralizadas, montos como número (pesos).
 * - XLSX: texto como **celda de tipo texto** (nunca fórmula), montos como número con `$#,##0.00`.
 * - Hoja «Info»: periodo, corte, filtros, fuente por columna, columnas NO MEDIDO, nota de celdas N<5.
 */
import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { CSV_BOM, csvNumberCell, csvRow, csvTextCell, xlsxTextValue } from './cell-safety';
import { SMALL_CELL_SENTINEL } from '../small-cells';
import type { AggTable, Cell, ScreenPayload } from '../marketing-aggregates.types';

/** Celda tipada para serializar: distingue número, dinero y texto (y vacío). */
type RenderedCell =
  | { kind: 'empty' }
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'money'; value: number };

const MONEY_FMT = '$#,##0.00';

/** Traduce una celda del payload + tipo de columna a una celda tipada (saneada aparte en cada salida). */
function renderCell(value: Cell, kind: AggTable['columns'][number]['kind']): RenderedCell {
  if (value === null || value === undefined) return { kind: 'empty' };
  if (value === SMALL_CELL_SENTINEL) return { kind: 'text', value: SMALL_CELL_SENTINEL };
  if (typeof value === 'string') return { kind: 'text', value };
  // número:
  if (kind === 'money') return { kind: 'money', value };
  return { kind: 'number', value };
}

@Injectable()
export class MarketingExportService {
  /** Nombre de archivo del contrato: `tcghunt_<pantalla>_<desde>_<hasta>_corte-<AAAAMMDD-HHMM>.<ext>`. */
  filename(screen: string, from: string, to: string, now: Date, ext: 'xlsx' | 'csv'): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;
    return `tcghunt_${screen}_${from}_${to}_corte-${stamp}.${ext}`;
  }

  /** CSV de UNA pantalla (sus tablas apiladas). Con BOM. Cada tabla: título, cabecera, 2ª fila técnica, filas. */
  screenCsv(payload: ScreenPayload): string {
    const lines: string[] = [];
    for (const table of payload.tables) {
      lines.push(csvRow([csvTextCell(`[${table.id}] ${table.title}`)]));
      if (!table.measured) {
        lines.push(csvRow([csvTextCell(table.notMeasuredReason ?? 'NO MEDIDO')]));
        lines.push('');
        continue;
      }
      lines.push(csvRow(table.columns.map((c) => csvTextCell(c.labelEs))));
      lines.push(csvRow(table.columns.map((c) => csvTextCell(c.tech ?? ''))));
      for (const row of table.rows) {
        lines.push(
          csvRow(
            table.columns.map((c) => {
              const r = renderCell(row[c.key] ?? null, c.kind);
              if (r.kind === 'empty') return '';
              if (r.kind === 'text') return csvTextCell(r.value);
              return csvNumberCell(r.value);
            }),
          ),
        );
      }
      for (const note of table.notes ?? []) lines.push(csvRow([csvTextCell(`Nota: ${note}`)]));
      lines.push('');
    }
    return CSV_BOM + lines.join('\r\n') + '\r\n';
  }

  /** XLSX de UNA o VARIAS pantallas: una hoja por pantalla + hoja «Info». Devuelve Buffer. */
  async workbook(payloads: ScreenPayload[], now: Date): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'TCG HUNT — Panel de Marketing';
    wb.created = now;

    for (const payload of payloads) {
      const ws = wb.addWorksheet(`pantalla_${payload.screen}`);
      this.writeScreenSheet(ws, payload);
    }
    this.writeInfoSheet(wb.addWorksheet('Info'), payloads, now);

    // exceljs escribe a un Buffer de Node.
    const out = await wb.xlsx.writeBuffer();
    return Buffer.from(out);
  }

  private writeScreenSheet(ws: ExcelJS.Worksheet, payload: ScreenPayload): void {
    for (const table of payload.tables) {
      this.writeTextRow(ws, [`[${table.id}] ${table.title}`]);
      if (!table.measured) {
        this.writeTextRow(ws, [table.notMeasuredReason ?? 'NO MEDIDO']);
        ws.addRow([]);
        continue;
      }
      this.writeTextRow(ws, table.columns.map((c) => c.labelEs));
      this.writeTextRow(ws, table.columns.map((c) => c.tech ?? ''));
      for (const row of table.rows) {
        const excelRow = ws.addRow([]);
        table.columns.forEach((c, i) => {
          const cell = excelRow.getCell(i + 1);
          const r = renderCell(row[c.key] ?? null, c.kind);
          if (r.kind === 'empty') cell.value = null;
          else if (r.kind === 'text') cell.value = xlsxTextValue(r.value); // ⛔ nunca fórmula
          else if (r.kind === 'money') {
            cell.value = r.value;
            cell.numFmt = MONEY_FMT;
          } else cell.value = r.value;
        });
      }
      for (const note of table.notes ?? []) this.writeTextRow(ws, [`Nota: ${note}`]);
      ws.addRow([]);
    }
  }

  /** Fila de puro texto, cada celda neutralizada (jamás fórmula). */
  private writeTextRow(ws: ExcelJS.Worksheet, values: string[]): void {
    const row = ws.addRow([]);
    values.forEach((v, i) => {
      row.getCell(i + 1).value = xlsxTextValue(v);
    });
  }

  private writeInfoSheet(ws: ExcelJS.Worksheet, payloads: ScreenPayload[], now: Date): void {
    const first = payloads[0];
    const put = (k: string, v: string) => this.writeTextRow(ws, [k, v]);
    put('Panel de Marketing — TCG HUNT', '');
    if (first) {
      put('Periodo', `${first.period.from} → ${first.period.to} (${first.period.label})`);
      put('Zona horaria', first.period.timezone);
    }
    put('Fecha y hora de corte (UTC)', now.toISOString());
    put('Granularidad', 'Solo semana cerrada o mes cerrado (sin rango libre ni detalle por día) — PM-A1');
    put('Nota de privacidad', 'Celdas con N<5 ocultas: conteo «< 5» y sin MX$ (§5.2). Ninguna fila por pedido o solicitud.');
    // Notas de pantalla (la línea de cobertura de §MKT.G.4 incluida), sin repetir entre pantallas del libro.
    for (const note of [...new Set(payloads.flatMap((p) => p.notes ?? []))]) put('Nota', note);
    ws.addRow([]);
    this.writeTextRow(ws, ['Fuente por sigla', '']);
    if (first) for (const [sig, desc] of Object.entries(first.sourceLegend)) put(sig, desc);
    ws.addRow([]);
    this.writeTextRow(ws, ['Columnas / tablas NO MEDIDO', 'Motivo']);
    for (const p of payloads) for (const t of p.tables) if (!t.measured) put(`[${p.screen}] ${t.id} ${t.title}`, t.notMeasuredReason ?? 'NO MEDIDO');

    // Anotaciones de fecha del periodo (h1, §MKT.E): cada campo en su propia celda de TEXTO saneado
    // (⛔ nunca fórmula — `label`/`destino` vienen de un humano), SIN datos personales (validado al crear).
    // Todas las pantallas del libro comparten periodo ⇒ basta la 1ª.
    ws.addRow([]);
    this.writeTextRow(ws, ['Anotaciones de fecha', '', '', '']);
    this.writeTextRow(ws, ['Fecha', 'Tipo', 'Etiqueta', 'Destino (solo promoción)']);
    const annotations = first?.annotations ?? [];
    if (annotations.length === 0) {
      this.writeTextRow(ws, ['(sin anotaciones en el periodo)']);
    } else {
      for (const a of annotations) this.writeTextRow(ws, [a.date, a.kind, a.label, a.destino ?? '']);
    }
  }

  /** Nº de filas de datos exportadas (para el access-log `rowCount`). */
  rowCount(payloads: ScreenPayload[]): number {
    return payloads.reduce((n, p) => n + p.tables.reduce((m, t) => m + t.rows.length, 0), 0);
  }
}
