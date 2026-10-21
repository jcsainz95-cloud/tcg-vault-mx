/**
 * 🔒 CANDADO — régimen de celdas del panel y supresión coherente mes↔semanas (API_CONTRACT v1.103 §MKT.G.2/.3/.5/.10,
 * §MKT.G.9 (8)(9)(10)(11); D-MKT-PANEL-2 y D-MKT-PANEL-4). Sin BD: `MarketingAnalyticsService` y `MarketingExportService`
 * REALES; Prisma y `sales-analytics` mockeados. Los ficheros (.csv/.xlsx) se leen de verdad (ExcelJS) y se
 * afirma sobre las FILAS de sus hojas de datos `pantalla_*`, nunca sobre «Info» (que trae «< 5» siempre; R3).
 *
 * | §MKT.G.9 | Qué fija |
 * |---|---|
 * | 8 | super_admin ⇒ `privacy:'exact'` y el 3 real con su MX$; sesión delegada ⇒ «< 5» y MX$ null; mismas tablas y filas sin «Otros» |
 * | 9 | con sesión super_admin, export/export-todo/weekly-excel llevan «< 5»; aggregates también. Estático: `screen()` sin régimen por defecto y `'exact'` solo lo produce el manejador del panel |
 * | 10 | febrero 2027, clave k = [3,6,6,6] ⇒ semana 1 «< 5» y el MES «oculta» con MX$ null; ningún fichero despeja el 3 |
 * | 11 | `month=2026-10` cerrado SOLO cuando cierra la semana de su último día (lun 2-nov-2026); dom 1-nov aún 400 |
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ExcelJS from 'exceljs';
import { MarketingController } from '../src/modules/marketing/marketing.controller';
import { MarketingAnalyticsService } from '../src/modules/marketing/marketing-analytics.service';
import { MarketingExportService } from '../src/modules/marketing/export/marketing-export.service';
import { MARKETING_SCREENS, marketingPeriodOptions, resolveMarketingPeriod } from '../src/modules/marketing/marketing-period';
import { OTROS_LABEL, SMALL_CELL_HIDDEN, SMALL_CELL_SENTINEL } from '../src/modules/marketing/small-cells';
import type { AggTable, ScreenPayload } from '../src/modules/marketing/marketing-aggregates.types';
import { exportArgs, periodArgs, screenArgs } from './helpers/marketing-query';

const card = (name: string, number: string) => ({ name, number, set: { name: 'Set MX' } });

/** Una venta de carta suelta con su `settledAt` (el mock filtra por el rango que pide el servicio). */
interface Sale {
  cardId: string;
  name: string;
  number: string;
  cents: number;
  at: Date;
}

function build(sales: Sale[], opts: { paid?: { n: number; cents: number } } = {}) {
  const inRange = (d: Date, r: { gte: Date; lt: Date }) => d >= r.gte && d < r.lt;
  const m = {
    report: jest.fn().mockResolvedValue({
      totals: { orders: 9, chargedCents: 900000, avgTicketCents: 100000, piecesPerOrder: 1 },
      previousTotals: { orders: 9, chargedCents: 900000, avgTicketCents: 100000, piecesPerOrder: 1 },
      comparison: { orders: { diff: 0, pct: null }, chargedCents: { diff: 0, pct: null } },
    }),
    sellRequestAggregate: jest.fn().mockImplementation(({ where }: { where: { status?: string } }) =>
      Promise.resolve(
        where.status === 'pagada'
          ? { _count: { _all: opts.paid?.n ?? 3 }, _sum: { payoutNetCents: opts.paid?.cents ?? 456000 } }
          : { _count: { _all: 12 }, _sum: { quotedTotalCents: 789000 } },
      ),
    ),
    orderItemFindMany: jest.fn().mockImplementation(({ where }: { where: { order: { settledAt: { gte: Date; lt: Date } } } }) =>
      Promise.resolve(
        sales
          .filter((s) => inRange(s.at, where.order.settledAt))
          .map((s, i) => ({ orderId: `o${i}`, unitPriceCents: s.cents, inventoryItem: { cardId: s.cardId, card: card(s.name, s.number) } })),
      ),
    ),
  };
  const prisma = {
    sellRequest: { aggregate: m.sellRequestAggregate },
    sellRequestItem: { findMany: jest.fn().mockResolvedValue([]) },
    orderItem: { findMany: m.orderItemFindMany },
    inventoryItem: { groupBy: jest.fn().mockResolvedValue([]) },
    wishlistItem: { groupBy: jest.fn().mockResolvedValue([]) },
    card: { findMany: jest.fn().mockResolvedValue([]) },
    buylistQuoteDailyCount: { groupBy: jest.fn().mockResolvedValue([]) },
    order: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    marketingBannerConsentCounter: { count: jest.fn().mockResolvedValue(0) },
  } as never;
  const analytics = new MarketingAnalyticsService(prisma, { report: m.report } as never, { forPeriod: jest.fn().mockResolvedValue([]) } as never);
  const exporter = new MarketingExportService();
  const accessLog = { record: jest.fn().mockResolvedValue(undefined) };
  const ctrl = new MarketingController(analytics, exporter, accessLog as never);
  return { ctrl, m };
}

const SUPER = { id: 'u-owner', role: 'super_admin' } as const;
const DELEGADA = { id: 'u-op', role: 'vault_operator' } as const;
const tokenReq = { marketingToken: { id: 'tok-1', label: 'marketing-reader' } } as never;

/** Respuesta de Express mínima: guarda cabeceras y cuerpo. */
function fakeRes() {
  const res = { headers: {} as Record<string, string>, body: undefined as unknown };
  return Object.assign(res, {
    setHeader: (k: string, v: string) => ((res.headers[k.toLowerCase()] = v), res),
    send: (b: unknown) => ((res.body = b), res),
  });
}

/** Celda leída de un fichero, como texto ('' si vacía). Números como `String(n)` (igual en .xlsx y .csv). */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && 'richText' in (v as object)) {
    return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('');
  }
  return String(v);
}

/** Separa una línea CSV del export (texto siempre entrecomillado con `""`; números sin comillas). */
function csvCells(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Filas (celdas como texto) de la HOJA DE DATOS `pantalla_<screen>` de un .xlsx, o del .csv de una pantalla.
 * ⛔ Nunca la hoja «Info»: lleva el literal «< 5» en su nota de privacidad SIEMPRE, también en `exact`, y una
 * aserción sobre ella no puede ponerse roja (techlead R3 sobre `62e8250b`). Las filas vacías salen como `[]`.
 */
async function dataSheetRows(body: unknown, screen: string): Promise<string[][]> {
  if (typeof body === 'string') {
    return body
      .replace(/^﻿/, '')
      .split('\r\n')
      .map((l) => (l === '' ? [] : csvCells(l)));
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(body as ExcelJS.Buffer);
  const ws = wb.getWorksheet(`pantalla_${screen}`);
  if (!ws) throw new Error(`el libro no trae la hoja pantalla_${screen}`);
  const rows: string[][] = [];
  for (let i = 1; i <= ws.rowCount; i++) {
    const vals = ws.getRow(i).values as unknown[]; // índice 0 vacío por convenio de exceljs
    const cells = Array.isArray(vals) ? Array.from(vals.slice(1), cellText) : [];
    while (cells.length && cells[cells.length - 1] === '') cells.pop();
    rows.push(cells);
  }
  return rows;
}

/**
 * Las filas de la tabla `tableId` de una hoja de datos, como objetos por `labelEs`. Bloque = fila `[id] título`,
 * cabecera, fila técnica y filas de datos hasta la primera vacía o «Nota: …».
 */
function fileTable(sheet: string[][], tableId: string): Record<string, string>[] {
  const start = sheet.findIndex((r) => (r[0] ?? '').startsWith(`[${tableId}] `));
  if (start < 0) throw new Error(`la hoja de datos no trae la tabla ${tableId}`);
  const header = sheet[start + 1];
  const out: Record<string, string>[] = [];
  for (let i = start + 3; i < sheet.length; i++) {
    const r = sheet[i];
    if (r.length === 0 || (r[0] ?? '').startsWith('Nota: ')) break;
    out.push(Object.fromEntries(header.map((h, j) => [h, r[j] ?? ''])));
  }
  return out;
}

/**
 * §MKT.G.9 (9) sobre el FICHERO, semana W41. d1: Carta B (N=3, MX$ 600) no aparece ni como fila ni como cifra (ningún
 * 3 en «Unidades vendidas» ni 600 en «MX$»), su pareja Carta A tampoco, y la fila «Otros» lleva «< 5» con MX$ vacío.
 * En `exact` el fichero traería A 6/600, B 3/600 y ninguna fila «Otros» ⇒ rojo. Con `withA3`, la fila de pagadas de
 * a3 (N=3, MX$ 4560) lleva «< 5» y MX$ vacío (en `exact`: 3 y 4560).
 */
async function expectFileSuppressed(label: string, body: unknown, withA3: boolean): Promise<void> {
  const UNI = 'Unidades vendidas';
  const MXN = 'MX$ vendido (IVA incluido)';
  const d1 = fileTable(await dataSheetRows(body, 'd'), 'd1');
  expect([label, d1.map((r) => r.Carta)]).toEqual([label, ['Carta C · Set MX 003', OTROS_LABEL]]);
  expect([label, d1.some((r) => r[UNI] === '3' || r[MXN] === '600')]).toEqual([label, false]);
  expect([label, d1.find((r) => r.Carta === OTROS_LABEL)]).toEqual([
    label,
    expect.objectContaining({ [UNI]: SMALL_CELL_SENTINEL, [MXN]: SMALL_CELL_HIDDEN }),
  ]);
  if (withA3) {
    const a3 = fileTable(await dataSheetRows(body, 'a'), 'a3');
    expect([label, a3[1]]).toEqual([
      label,
      { Concepto: 'Ofertas aceptadas / pagadas', 'Nº': SMALL_CELL_SENTINEL, 'MX$ (IVA incluido)': SMALL_CELL_HIDDEN },
    ]);
  }
}

const tbl = (p: ScreenPayload, id: string): AggTable => p.tables.find((t) => t.id === id)!;

// Semana cerrada 5-11 oct 2026: Carta A ×6 (visible), Carta B ×3 a $200 (N=3, MX$ 600 conocido), Carta C ×7.
const OCT_W41 = new Date('2026-10-07T18:00:00.000Z');
const SALES_W41: Sale[] = [
  ...Array.from({ length: 6 }, () => ({ cardId: 'A', name: 'Carta A', number: '001', cents: 10000, at: OCT_W41 })),
  ...Array.from({ length: 3 }, () => ({ cardId: 'B', name: 'Carta B', number: '002', cents: 20000, at: OCT_W41 })),
  ...Array.from({ length: 7 }, () => ({ cardId: 'C', name: 'Carta C', number: '003', cents: 15000, at: OCT_W41 })),
];

afterEach(() => {
  jest.useRealTimers();
});
const clock = (iso: string) => jest.useFakeTimers({ now: new Date(iso), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });

describe('§MKT.G.9 (8) — el dueño ve el número real; la sesión delegada ve «< 5»', () => {
  beforeEach(() => clock('2026-10-14T12:00:00.000Z'));

  it('d1 (N=3, MX$ 600) y a3 (pagadas N=3, MX$ 4560): exact para super_admin, ocultas para la delegada', async () => {
    const { ctrl } = build(SALES_W41);
    const q = { week: '2026-W41' };
    const dOwner = await ctrl.panel(SUPER, ...screenArgs({ pantalla: 'd', ...q }));
    const dDeleg = await ctrl.panel(DELEGADA, ...screenArgs({ pantalla: 'd', ...q }));
    expect(dOwner.privacy).toBe('exact');
    expect(dDeleg.privacy).toBe('small_cells');

    const bOwner = tbl(dOwner, 'd1').rows.find((r) => r.carta === 'Carta B · Set MX 002');
    expect(bOwner).toMatchObject({ unidadesVendidas: 3, mxn: 600 });
    // Delegada: B=3 es la única oculta ⇒ cae en «Otros» con su pareja; nadie ve el 3 ni los 600.
    const d1Deleg = tbl(dDeleg, 'd1');
    expect(d1Deleg.rows.some((r) => r.unidadesVendidas === 3 || r.mxn === 600)).toBe(false);
    expect(d1Deleg.rows.find((r) => r.carta === OTROS_LABEL)).toMatchObject({ unidadesVendidas: SMALL_CELL_SENTINEL, mxn: SMALL_CELL_HIDDEN });

    const aOwner = await ctrl.panel(SUPER, ...screenArgs({ pantalla: 'a', ...q }));
    const aDeleg = await ctrl.panel(DELEGADA, ...screenArgs({ pantalla: 'a', ...q }));
    expect(tbl(aOwner, 'a3').rows[1]).toMatchObject({ n: 3, mxn: 4560 });
    expect(tbl(aDeleg, 'a3').rows[1]).toMatchObject({ n: SMALL_CELL_SENTINEL, mxn: SMALL_CELL_HIDDEN });
  });

  it('exact: mismas tablas, mismas columnas; filas = las de small_cells sin «Otros»; ningún «< 5» ni «oculta»', async () => {
    const { ctrl } = build(SALES_W41);
    for (const s of MARKETING_SCREENS) {
      const owner = await ctrl.panel(SUPER, ...screenArgs({ pantalla: s, week: '2026-W41' }));
      const deleg = await ctrl.panel(DELEGADA, ...screenArgs({ pantalla: s, week: '2026-W41' }));
      expect(owner.tables.map((t) => t.id)).toEqual(deleg.tables.map((t) => t.id));
      for (const t of owner.tables) {
        const d = tbl(deleg, t.id);
        expect(t.columns).toEqual(d.columns);
        const firstKey = t.columns[0]?.key;
        if (!firstKey) continue;
        const ownerLabels = new Set(t.rows.map((r) => r[firstKey]));
        for (const r of d.rows) if (r[firstKey] !== OTROS_LABEL) expect(ownerLabels.has(r[firstKey])).toBe(true);
        expect(ownerLabels.has(OTROS_LABEL)).toBe(false);
      }
      const json = JSON.stringify(owner.tables);
      expect(json).not.toContain(`"${SMALL_CELL_SENTINEL}"`);
      expect(json).not.toContain(`"${SMALL_CELL_HIDDEN}"`);
    }
  });
});

describe('§MKT.G.9 (9) — fuera de la pantalla nunca es exacto', () => {
  beforeEach(() => clock('2026-10-14T12:00:00.000Z'));

  it('sesión super_admin: export csv/xlsx, export/todo y weekly-excel suprimen EN LAS FILAS de datos; aggregates también', async () => {
    const { ctrl } = build(SALES_W41);
    const q = { pantalla: 'd', week: '2026-W41' };
    for (const format of ['csv', 'xlsx']) {
      const res = fakeRes();
      await ctrl.export(SUPER, res as never, ...exportArgs({ ...q, format }));
      await expectFileSuppressed(`export ${format}`, res.body, false);
    }
    const todo = fakeRes();
    await ctrl.exportAll(SUPER, todo as never, ...periodArgs({ week: '2026-W41' }));
    await expectFileSuppressed('export/todo', todo.body, true);
    // Sin selector ⇒ última semana cerrada al 14-oct-2026 = W41 (los mismos datos).
    const semana = fakeRes();
    await ctrl.weeklyExcel(SUPER, semana as never, ...periodArgs({}));
    await expectFileSuppressed('weekly-excel', semana.body, true);

    const agg = await ctrl.aggregates(tokenReq, ...screenArgs({ ...q }));
    expect(agg.privacy).toBe('small_cells');
    expect(JSON.stringify(agg)).toContain(SMALL_CELL_SENTINEL);
  });

  it('estático: `screen()` NO tiene régimen por defecto (4 parámetros obligatorios)', () => {
    // Function.length cuenta los parámetros ANTES del primero con valor por defecto.
    expect(MarketingAnalyticsService.prototype.screen.length).toBe(4);
  });

  it("estático: el literal 'exact' como VALOR producido solo aparece en el manejador del panel (marketing.controller.ts)", () => {
    const dir = path.join(__dirname, '../src/modules/marketing');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(dir);
    const producers: string[] = [];
    for (const f of files) {
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
        if (!code.includes("'exact'")) return;
        // Comparaciones (=== / !==) y tipos (`'small_cells' | 'exact'`, `'exact' & { marca }`) no PRODUCEN el régimen.
        const stripped = code
          .replace(/[!=]==\s*'exact'/g, '')
          .replace(/\|\s*'exact'/g, '')
          .replace(/'exact'\s*\|/g, '')
          .replace(/=\s*'exact'\s*&/g, '');
        if (stripped.includes("'exact'")) producers.push(`${path.relative(dir, f)}:${i + 1}`);
      });
    }
    expect(producers.length).toBe(1);
    expect(producers[0]).toMatch(/^marketing\.controller\.ts:\d+$/);
  });

  it('tipo (D3): el régimen exacto es un tipo MARCADO — `screen()` no acepta el literal \'exact\' a pelo', () => {
    const { ctrl } = build([]);
    const svc = (ctrl as unknown as { analytics: MarketingAnalyticsService }).analytics;
    const period = resolveMarketingPeriod({ week: '2026-W41' }, new Date());
    // El candado es el COMPILADOR (ts-jest y `tsc --noEmit` comprueban tipos): si `CellPrivacy` vuelve a admitir el
    // literal, esta directiva queda sin error que esperar y la compilación de este fichero cae (TS2578).
    // @ts-expect-error — 'exact' no es asignable a CellPrivacy; solo `panelPrivacy()` fabrica `ExactPrivacy`.
    const call = () => svc.screen('h', period, new Date(), 'exact');
    expect(typeof call).toBe('function');
  });

  it('estático (D3): el único cast a `ExactPrivacy`/`CellPrivacy` del módulo está en el manejador del panel', () => {
    const dir = path.join(__dirname, '../src/modules/marketing');
    const casts: string[] = [];
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) {
          fs.readFileSync(p, 'utf8')
            .split('\n')
            .forEach((line, i) => {
              const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
              if (/\bas\s+(ExactPrivacy|CellPrivacy)\b/.test(code)) casts.push(`${path.relative(dir, p)}:${i + 1}`);
            });
        }
      }
    };
    walk(dir);
    expect(casts).toHaveLength(1);
    expect(casts[0]).toMatch(/^marketing\.controller\.ts:\d+$/);
  });

  it('estático (MKT-TL7r): `as never` / `as unknown as` (saltan el tipo marcado) — ninguno en el módulo', () => {
    // Residuo de D3: `screen(…, x as never)` o `as unknown as CellPrivacy` fabrican el régimen exacto sin pasar por
    // `panelPrivacy()` y el compilador no lo ve. TL-MKT-9 (2026-10-18): la última excepción (leer `req.marketingToken`)
    // se cerró tipando la petición con `MarketingTokenRequest` (exportado por `marketing-token.guard.ts`) ⇒ cero.
    const dir = path.join(__dirname, '../src/modules/marketing');
    const escapes: string[] = [];
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) {
          fs.readFileSync(p, 'utf8')
            .split('\n')
            .forEach((line, i) => {
              const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
              const n = (code.match(/\bas\s+never\b/g) ?? []).length + (code.match(/\bas\s+unknown\s+as\b/g) ?? []).length;
              for (let k = 0; k < n; k++) escapes.push(`${path.relative(dir, p)}:${i + 1}`);
            });
        }
      }
    };
    walk(dir);
    expect(escapes).toEqual([]);
  });
});

describe('§MKT.G.9 (10) — supresión coherente mes↔semanas (febrero 2027 = sus 4 semanas exactas)', () => {
  // Semanas de febrero 2027: 1-7, 8-14, 15-21, 22-28 (lunes a domingo). Hora 18:00 UTC = 12:00 CDMX.
  const day = (d: number) => new Date(`2027-02-${String(d).padStart(2, '0')}T18:00:00.000Z`);
  const weekDays = [3, 10, 17, 24];
  const mk = (cardId: string, name: string, number: string, perWeek: number[]): Sale[] =>
    perWeek.flatMap((n, w) => Array.from({ length: n }, () => ({ cardId, name, number, cents: 10000, at: day(weekDays[w]) })));
  const SALES_FEB: Sale[] = [
    ...mk('K', 'Carta K', '010', [3, 6, 6, 6]), // mes 21; semana 1 = 3 (oculta)
    ...mk('M', 'Carta M', '011', [8, 8, 8, 8]), // pareja de K en la semana 1 (la siguiente más chica)
    ...mk('L', 'Carta L', '012', [10, 10, 10, 10]),
  ];
  const K = 'Carta K · Set MX 010';
  const M = 'Carta M · Set MX 011';
  const L = 'Carta L · Set MX 012';

  beforeEach(() => clock('2027-03-02T18:00:00.000Z'));

  it('semana 1: K «< 5» (en «Otros» con M). Mes: K y M «oculta» con MX$ null; L visible', async () => {
    const { ctrl } = build(SALES_FEB);
    const w1 = tbl(await ctrl.aggregates(tokenReq, ...screenArgs({ pantalla: 'd', weekStart: '2027-02-01' })), 'd1');
    expect(w1.rows.some((r) => r.carta === K || r.carta === M)).toBe(false);
    expect(w1.rows.find((r) => r.carta === OTROS_LABEL)).toMatchObject({ unidadesVendidas: SMALL_CELL_SENTINEL, mxn: SMALL_CELL_HIDDEN });

    const mes = tbl(await ctrl.aggregates(tokenReq, ...screenArgs({ pantalla: 'd', month: '2027-02' })), 'd1');
    expect(mes.rows.find((r) => r.carta === K)).toMatchObject({ unidadesVendidas: SMALL_CELL_HIDDEN, mxn: SMALL_CELL_HIDDEN });
    expect(mes.rows.find((r) => r.carta === M)).toMatchObject({ unidadesVendidas: SMALL_CELL_HIDDEN, mxn: SMALL_CELL_HIDDEN });
    expect(mes.rows.find((r) => r.carta === L)).toMatchObject({ unidadesVendidas: 40, mxn: 4000 });
  });

  it('ninguna combinación de los cinco ficheros (4 semanas + mes) despeja el 3 de K', async () => {
    const { ctrl } = build(SALES_FEB);
    const files: AggTable[] = [];
    for (const ws of ['2027-02-01', '2027-02-08', '2027-02-15', '2027-02-22']) {
      files.push(tbl(await ctrl.aggregates(tokenReq, ...screenArgs({ pantalla: 'd', weekStart: ws })), 'd1'));
    }
    const mes = tbl(await ctrl.aggregates(tokenReq, ...screenArgs({ pantalla: 'd', month: '2027-02' })), 'd1');
    // Para despejar la semana 1 de K hace falta el total del mes de K como número: no está.
    expect(typeof mes.rows.find((r) => r.carta === K)?.unidadesVendidas).not.toBe('number');
    // Y el mes de M tampoco (si no, M_mes − M_sem2..4 = M_sem1 y Otros_sem1 − M_sem1 sería K… aunque Otros no es número).
    expect(typeof mes.rows.find((r) => r.carta === M)?.unidadesVendidas).not.toBe('number');
    // Ninguna celda numérica de K suma 3 con nada: las semanas visibles de K son 6, 6, 6.
    const kNums = files.flatMap((t) => t.rows.filter((r) => r.carta === K).map((r) => r.unidadesVendidas));
    expect(kNums).toEqual([6, 6, 6]);
  });

  it('el régimen exacto (dueño) enseña los 21 reales en el mes: la supresión coherente NO aplica en exact', async () => {
    const { ctrl } = build(SALES_FEB);
    const mes = tbl(await ctrl.panel(SUPER, ...screenArgs({ pantalla: 'd', month: '2027-02' })), 'd1');
    expect(mes.rows.find((r) => r.carta === K)).toMatchObject({ unidadesVendidas: 21, mxn: 2100 });
  });

  it('a3 (pagadas) en el mes hereda la ocultación de una semana con N<5', async () => {
    // El mock de pagadas responde por rango: semana 1 ⇒ 3, semanas 2-4 ⇒ 6; el mes ⇒ 21 (cuatro semanas exactas).
    const { ctrl, m } = build(SALES_FEB);
    const w1 = new Date('2027-02-01T06:00:00.000Z'); // lunes 1-feb 00:00 CDMX
    m.sellRequestAggregate.mockImplementation(({ where }: { where: { status?: string; paidAt?: { gte: Date; lt: Date } } }) => {
      if (where.status !== 'pagada') return Promise.resolve({ _count: { _all: 12 }, _sum: { quotedTotalCents: 789000 } });
      const r = where.paidAt!;
      const days = Math.round((r.lt.getTime() - r.gte.getTime()) / 86_400_000);
      const n = days > 7 ? 21 : r.gte.getTime() === w1.getTime() ? 3 : 6;
      return Promise.resolve({ _count: { _all: n }, _sum: { payoutNetCents: n * 100000 } });
    });
    const a3 = tbl(await ctrl.aggregates(tokenReq, ...screenArgs({ pantalla: 'a', month: '2027-02' })), 'a3');
    expect(a3.rows[1]).toMatchObject({ n: SMALL_CELL_HIDDEN, mxn: SMALL_CELL_HIDDEN });
  });
});

describe('§MKT.G.9 (11) — mes cerrado = su última semana cerrada', () => {
  it.each([
    ['lun 26-oct-2026 (contrato)', '2026-10-26T18:00:00.000Z', 400],
    ['dom 1-nov-2026 (octubre acabó, su última semana NO): discrimina la regla nueva', '2026-11-01T18:00:00.000Z', 400],
    ['lun 2-nov-2026 (contrato)', '2026-11-02T18:00:00.000Z', 200],
  ])('%s ⇒ month=2026-10 %s, y periods lo ofrece solo si 200', async (_n, iso, esperado) => {
    clock(iso);
    const now = new Date(iso);
    let status = 200;
    try {
      resolveMarketingPeriod({ month: '2026-10' }, now);
    } catch (e) {
      status = (e as { getStatus: () => number }).getStatus();
    }
    expect(status).toBe(esperado);
    const ofrecido = marketingPeriodOptions(now).closedMonths.some((m) => m.month === '2026-10');
    expect(ofrecido).toBe(esperado === 200);
    // Y la ruta del panel aplica la MISMA regla.
    const { ctrl } = build([]);
    const r = ctrl.panel(SUPER, ...screenArgs({ pantalla: 'h', month: '2026-10' }));
    if (esperado === 200) await expect(r).resolves.toMatchObject({ period: { kind: 'month', label: '2026-10' } });
    else await expect(r).rejects.toMatchObject({ status: 400 });
  });

  it('periods: cada mes ofrecido lo acepta resolveMarketingPeriod (dom 1-nov-2026 ⇒ el primero es septiembre)', () => {
    const now = new Date('2026-11-01T18:00:00.000Z');
    const r = marketingPeriodOptions(now);
    expect(r.closedMonths[0].month).toBe('2026-09');
    expect(r.closedMonths).toHaveLength(12);
    for (const mo of r.closedMonths) expect(() => resolveMarketingPeriod({ month: mo.month }, now)).not.toThrow();
  });
});
