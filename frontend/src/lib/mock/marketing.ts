/**
 * MOCK · SERVIDOR FALSO del Panel de Marketing (`docs/API_CONTRACT.md §MKT.E` y `§MKT.G`, v1.101⟨mkt-panel⟩).
 * Sirve el modo demo (`NEXT_PUBLIC_USE_MOCKS`) y las e2e de mocks; el servidor real es `backend/src/modules/marketing/`.
 * Ningún componente importa de aquí: solo `lib/marketing-api.ts`, en su rama de mocks.
 *
 * Conducta OBSERVABLE que replica:
 * - `403 FORBIDDEN` en panel/periodos/anotaciones/descargas para quien no sea `super_admin` (Fase 0: solo el dueño
 *   tiene `marketing:read`, §MKT.G.1) y en `tokens` para cualquiera que no sea `super_admin` (§MKT.G.6).
 * - `400 VALIDATION_ERROR` si la semana o el mes pedidos no están en la lista de cerrados (§MKT.G.2).
 * - Catálogo de tablas por pantalla de §MKT.G.4 (ids y orden), con «< 5», «Otros (< 5 c/u)», tablas `measured:false`
 *   con su motivo «NO MEDIDO — …» y `columns: []` (como el servicio real hoy).
 * - Anotaciones: `422 VALIDATION_ERROR` si la etiqueta/destino trae `@` o rachas de ≥7 dígitos; `404` si no existe.
 * - Tokens: el claro sale SOLO en la respuesta del `POST`; revocar es idempotente.
 *
 * `privacy` (§MKT.G.2 v1.103): como el servidor, `exact` para la sesión `super_admin` (la única con permiso en Fase 0).
 * Para ver en demo lo que vería otra cuenta con `marketing:read`: `localStorage['tcg.mktPrivacy'] = 'small_cells'`.
 */
import type {
  MarketingAggTable,
  MarketingAnnotationDTO,
  MarketingAnnotationInput,
  MarketingApiTokenIssued,
  MarketingApiTokenView,
  MetaTestEventResult,
  MarketingPeriodsResponse,
  MarketingScreen,
  MarketingScreenPayload,
} from '@/types/contract';
import { ApiFixtureError } from './fixtures';
import { mockCallerRole } from './m4-ship';

const DAY = 86_400_000;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(day: string, n: number): string {
  return ymd(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY));
}
function todayMx(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(now);
}

export function mockMarketingPeriods(now: Date = new Date()): MarketingPeriodsResponse {
  requireMarketingRead();
  const today = todayMx(now);
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = lunes
  const thisMonday = addDays(today, -dow);
  const closedWeeks = Array.from({ length: 26 }, (_, i) => {
    const weekStart = addDays(thisMonday, -7 * (i + 1));
    return { weekStart, from: weekStart, to: addDays(weekStart, 6) };
  });
  const [y, m] = today.split('-').map(Number);
  const closedMonths = Array.from({ length: 12 }, (_, i) => {
    const first = new Date(Date.UTC(y, m - 2 - i, 1));
    const last = new Date(Date.UTC(y, m - 1 - i, 0));
    return { month: ymd(first).slice(0, 7), from: ymd(first), to: ymd(last) };
  });
  return { timezone: 'America/Mexico_City', lastClosedWeek: closedWeeks[0], closedWeeks, closedMonths };
}

function requireMarketingRead() {
  if (mockCallerRole() !== 'super_admin') throw new ApiFixtureError(403, 'FORBIDDEN', 'Forbidden');
}
function requireSuperAdmin() {
  if (mockCallerRole() !== 'super_admin') throw new ApiFixtureError(403, 'FORBIDDEN', 'Forbidden');
}
function badRequest(): never {
  throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'Invalid period');
}

export interface MockPeriodQuery {
  weekStart?: string;
  month?: string;
}

function resolvePeriod(q: MockPeriodQuery) {
  const p = mockMarketingPeriods();
  if (q.weekStart && q.month) badRequest();
  if (q.month) {
    const m = p.closedMonths.find((o) => o.month === q.month) ?? badRequest();
    return { kind: 'month' as const, from: m.from, to: m.to, label: m.month };
  }
  const w = q.weekStart ? (p.closedWeeks.find((o) => o.weekStart === q.weekStart) ?? badRequest()) : p.lastClosedWeek;
  return { kind: 'week' as const, from: w.from, to: w.to, label: w.weekStart };
}

/*
 * Títulos, etiquetas de columna, motivos «NO MEDIDO — …», leyenda de fuentes, nota de cobertura y rótulos de fila:
 * COPIA LITERAL de `backend/src/modules/marketing/marketing-analytics.service.ts` (el servidor real); ids y orden:
 * §MKT.G.4. ⛔ No se redactan aquí: la paridad la cobra `mock/marketing.parity.test.ts` (D5, techlead 2026-10-18).
 * Lo único propio del mock son las CIFRAS y los nombres de carta de demo.
 */
const GA4_OFF = 'NO MEDIDO — GA4 sin encender';
const SC_UNCONNECTED = 'NO MEDIDO — Search Console sin conectar';
const ORIGIN_OFF = 'NO MEDIDO — el origen de los pedidos aún no se registra (requiere el aviso de cookies con consentimiento)';
const BANNER_OFF = 'NO MEDIDO — el aviso de cookies todavía no está publicado';
/* v1.105 (§MKT.H.9): tablas diferidas, con su motivo literal (en cualquier modo). */
const PAGE_TYPE_DEFERRED = 'NO MEDIDO — la clasificación por tipo de página no está definida todavía';
const ABANDON_DEFERRED = 'NO MEDIDO — la consulta de abandono no está definida todavía';
const BUY_BUTTON_DEFERRED = 'NO MEDIDO — el evento del botón COMPRAR todavía no se envía';
const SEARCH_LOG_OFF =
  'NO MEDIDO — pendiente de la revisión de seguridad; el registro de búsquedas sin resultado no existe todavía';
const C7_MIN_PERIOD = 'NO MEDIDO — esta tabla necesita un periodo de al menos 4 semanas; elige un mes cerrado';
/**
 * Línea de cobertura por modo (§MKT.H.9 v1.105). El mock sirve el modo `off` (`COVERAGE_NOTE`); el de `on` se exporta
 * para la paridad y para quien pinte una demo encendida.
 */
export const COVERAGE_NOTE = 'Cobertura: GA4 sin encender; el origen de los pedidos aún no se registra.';
export const COVERAGE_NOTE_ON = 'Cobertura: GA4 y el origen de los pedidos solo cuentan a quien aceptó la analítica; la proporción está en f3.';
const OTROS_LABEL = 'Otros (< 5 c/u)';
const SOURCE_LEGEND: Record<string, string> = {
  BD: 'Base de datos de la tienda (pedidos, solicitudes de buylist, stock, conteos de servidor)',
  GA4: 'GA4 Data API (solo sesiones que aceptaron analítica) — Fase 2',
  SC: 'Search Console API — Fase 2',
  Srv: 'Conteo anónimo del servidor de la tienda',
};

function notMeasured(id: string, title: string, source: MarketingAggTable['source'], reason: string): MarketingAggTable {
  return { id, title, source, columns: [], rows: [], measured: false, notMeasuredReason: reason };
}

/** Semilla determinista del periodo: la misma URL da la misma pantalla. */
function seedOf(from: string): number {
  let h = 0;
  for (const ch of from) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/*
 * b5/b6 (v1.109, MKT-MEDIR-CS; §MKT.G.4/§MKT.H.14): títulos, columnas y notas COPIA LITERAL de `CS_HEADS`/`csTable` del
 * servicio. Dos componentes, `avisame` y `torneo`, SIN MX$; cada uno se oculta por separado («< 5») en `small_cells`.
 */
const CS_SOURCE_NOTE =
  'Registros confirmados (doble opt-in) por fecha de confirmación: «Avísame» (todos los tipos) y «Torneo» (todos los juegos). Una baja posterior no los resta. Un buzón con varios registros cuenta una vez para el umbral.';
const CS_UTM_NOTE = '«No válido»: algún utm_* no pasa la validación (el texto no se muestra). «Sin UTM»: llegó sin parámetros.';
const EXACT_CELLS_NOTE = 'Vista del dueño: cifras exactas. Fuera de esta pantalla (exports, analista) las celdas pequeñas se ocultan.';
const CS_CELLS_NOTE = 'Avísame y torneo se ocultan por separado: menos de 5 buzones distintos ⇒ «< 5».';
const CS_COUNT_COLUMNS: MarketingAggTable['columns'] = [
  { key: 'avisame', labelEs: 'Avísame (registros confirmados)', kind: 'count' },
  { key: 'torneo', labelEs: 'Torneo (preinscripciones confirmadas)', kind: 'count' },
];

/** b5 (una fila por día CDMX del periodo, en orden de fecha) y b6 (por UTM, mayor a menor), cifras de demo. */
function cardShowTables(from: string, to: string, exact: boolean): MarketingAggTable[] {
  const s = seedOf(from);
  const cell = (n: number) => (exact || n === 0 || n >= 5 ? n : ('< 5' as const));
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const cellsNote = exact ? EXACT_CELLS_NOTE : CS_CELLS_NOTE;
  const b6Rows: Array<[string, number, number]> = [
    ['instagram / social / card-show-cdmx', 20 + (s % 9), 9 + (s % 4)],
    ['Sin UTM', 11, 6],
    ['whatsapp / referral / grupo-jakomi', 6, 3],
    ['facebook / social / card-show-cdmx', 3, 1],
    ['No válido', 1, 0],
  ];
  return [
    {
      id: 'b5',
      title: 'Preregistros del Card Show por día',
      source: 'BD',
      columns: [{ key: 'dia', labelEs: 'Día de confirmación (CDMX)', kind: 'text' }, ...CS_COUNT_COLUMNS],
      rows: days.map((dia, i) => ({ dia, avisame: cell((s + i * 7) % 9), torneo: cell((s + i * 3) % 6) })),
      measured: true,
      notes: [CS_SOURCE_NOTE, cellsNote],
    },
    {
      id: 'b6',
      title: 'Preregistros del Card Show por UTM',
      source: 'BD',
      columns: [{ key: 'utm', labelEs: 'Origen (utm_source / utm_medium / utm_campaign)', kind: 'text' }, ...CS_COUNT_COLUMNS],
      rows: b6Rows.map(([utm, a, t]) => ({ utm, avisame: cell(a), torneo: cell(t) })),
      measured: true,
      notes: [CS_SOURCE_NOTE, CS_UTM_NOTE, cellsNote],
    },
  ];
}

function tablesFor(screen: MarketingScreen, kind: 'week' | 'month', from: string, exact: boolean, to: string = from): MarketingAggTable[] {
  const s = seedOf(from);
  const orders = 10 + (s % 25);
  const small = (n: number) => (exact || n >= 5 ? n : ('< 5' as const));
  switch (screen) {
    case 'a':
      return [
        {
          id: 'a1',
          title: 'Ventas de la semana (nº de pedidos pagados y MX$ con IVA)',
          source: 'BD',
          columns: [
            { key: 'periodo', labelEs: 'Periodo', kind: 'text' },
            { key: 'pedidos', labelEs: 'Pedidos', tech: 'orders', kind: 'count' },
            { key: 'mxn', labelEs: 'Monto MXN (IVA incluido)', tech: 'chargedCents', kind: 'money' },
          ],
          rows: [
            { periodo: 'Periodo actual', pedidos: orders, mxn: orders * 412.5 },
            { periodo: 'Periodo anterior', pedidos: orders - 3, mxn: (orders - 3) * 398 },
          ],
          measured: true,
        },
        {
          id: 'a2',
          title: 'Ticket medio y piezas por pedido',
          source: 'BD',
          columns: [
            { key: 'periodo', labelEs: 'Periodo', kind: 'text' },
            { key: 'ticket', labelEs: 'Ticket medio MXN (IVA incluido)', tech: 'avgTicketCents', kind: 'money' },
            { key: 'piezasPorPedido', labelEs: 'Piezas por pedido', tech: 'piecesPerOrder', kind: 'number' },
          ],
          rows: [
            { periodo: 'Periodo actual', ticket: 412.5, piezasPorPedido: 2.4 },
            { periodo: 'Periodo anterior', ticket: 398, piezasPorPedido: 2.1 },
          ],
          measured: true,
        },
        {
          id: 'a3',
          title: 'Cotizaciones de buylist',
          source: 'BD',
          columns: [
            { key: 'concepto', labelEs: 'Concepto', kind: 'text' },
            { key: 'n', labelEs: 'Nº', kind: 'count' },
            { key: 'mxn', labelEs: 'MX$ (IVA incluido)', kind: 'money' },
          ],
          rows: [
            { concepto: 'Solicitudes enviadas (generate_lead)', n: 12, mxn: 8450 },
            { concepto: 'Ofertas aceptadas / pagadas', n: small(3), mxn: exact ? 1890 : null },
          ],
          measured: true,
        },
        notMeasured('a4', 'Visitas y de dónde (5 grupos)', 'GA4', GA4_OFF),
        notMeasured('a5', 'Embudo sesiones → compra', 'GA4', GA4_OFF),
      ];
    case 'b':
      return [
        notMeasured('b1', 'Origen por utm_*', 'BD', ORIGIN_OFF),
        notMeasured('b2', 'Instagram por puerta (bio, story, promoción, mensaje directo)', 'BD', ORIGIN_OFF),
        notMeasured('b3', 'Por pieza (utm_content)', 'BD', ORIGIN_OFF),
        notMeasured('b4', 'Google orgánico, directo, referencias e IA', 'GA4', GA4_OFF),
        ...cardShowTables(from, to, exact),
      ];
    case 'c': {
      const c7Title = 'Nº de pedidos por estado de envío';
      const c7Columns: MarketingAggTable['columns'] = [
        { key: 'estado', labelEs: 'Estado', kind: 'text' },
        { key: 'pedidos', labelEs: 'Pedidos', kind: 'count' },
      ];
      const c7: MarketingAggTable =
        kind === 'month'
          ? {
              id: 'c7',
              title: c7Title,
              source: 'BD',
              columns: c7Columns,
              // `exact` (§MKT.G.2): cada estado con su valor real, sin agrupar. `small_cells`: N<5 ⇒ «Otros estados».
              rows: exact
                ? [
                    { estado: 'Jalisco', pedidos: 14 },
                    { estado: 'Ciudad de México', pedidos: 9 },
                    { estado: 'Nuevo León', pedidos: 3 },
                    { estado: 'Recogida en persona', pedidos: 2 },
                  ]
                : [
                    { estado: 'Jalisco', pedidos: 14 },
                    { estado: 'Ciudad de México', pedidos: 9 },
                    { estado: 'Otros estados', pedidos: '< 5' },
                    { estado: 'Recogida en persona', pedidos: '< 5' },
                  ],
              measured: true,
            }
          : { id: 'c7', title: c7Title, source: 'BD', columns: c7Columns, rows: [], measured: false, notMeasuredReason: C7_MIN_PERIOD };
      return [
        notMeasured('c1', 'Páginas y fichas más vistas', 'GA4', GA4_OFF),
        notMeasured('c2', 'Dónde pasan más tiempo', 'GA4', PAGE_TYPE_DEFERRED),
        notMeasured('c3', 'Dónde abandonan', 'GA4', ABANDON_DEFERRED),
        notMeasured('c4', '% de fichas donde el botón COMPRAR se ve', 'GA4', BUY_BUTTON_DEFERRED),
        notMeasured('c5', 'Dispositivo y navegador de Instagram', 'GA4', GA4_OFF),
        notMeasured('c6', 'Búsquedas sin resultado', 'Srv', SEARCH_LOG_OFF),
        c7,
        notMeasured('c8', 'Página de aterrizaje de Instagram', 'GA4', PAGE_TYPE_DEFERRED),
      ];
    }
    case 'd':
      return [
        {
          id: 'd1',
          title: 'Cartas más vistas vs más vendidas',
          source: 'mixed',
          columns: [
            { key: 'carta', labelEs: 'Carta', kind: 'text' },
            { key: 'vistas', labelEs: 'Fichas vistas', tech: 'view_item (GA4)', kind: 'count' },
            { key: 'unidadesVendidas', labelEs: 'Unidades vendidas', kind: 'count' },
            { key: 'mxn', labelEs: 'MX$ vendido (IVA incluido)', kind: 'money' },
            { key: 'aLaVentaHoy', labelEs: 'Unidades a la venta hoy', kind: 'count' },
          ],
          rows: [
            {
              carta: 'Charizard ex <script>alert(1)</script> · Obsidian Flames 125',
              vistas: GA4_OFF,
              unidadesVendidas: 7,
              mxn: 3150,
              aLaVentaHoy: 0,
            },
            ...(exact
              ? [
                  { carta: 'Pikachu · 151 25', vistas: GA4_OFF, unidadesVendidas: 2, mxn: 240, aLaVentaHoy: 4 },
                  { carta: 'Eevee · 151 133', vistas: GA4_OFF, unidadesVendidas: 1, mxn: 90, aLaVentaHoy: 1 },
                ]
              : [{ carta: OTROS_LABEL, vistas: GA4_OFF, unidadesVendidas: '< 5', mxn: null, aLaVentaHoy: null }]),
            // §MKT.G.10: en un mes `small_cells`, una clave oculta en alguna de sus semanas sale `'oculta'` aunque N≥5.
            ...(kind === 'month' && !exact
              ? [{ carta: 'Mewtwo · 151 150', vistas: GA4_OFF, unidadesVendidas: 'oculta', mxn: null, aLaVentaHoy: 2 }]
              : []),
          ],
          measured: true,
        },
        notMeasured('d2', 'Vistas sin venta', 'mixed', GA4_OFF),
        {
          id: 'd3',
          title: 'Agotado con demanda (stock 0 + lista de deseos)',
          source: 'mixed',
          columns: [
            { key: 'carta', labelEs: 'Carta', kind: 'text' },
            { key: 'aLaVentaHoy', labelEs: 'Unidades a la venta hoy', kind: 'count' },
            { key: 'listaDeseos', labelEs: 'Altas lista de deseos', kind: 'count' },
          ],
          rows: [],
          measured: true,
        },
        {
          id: 'd4',
          title: 'Buylist más cotizadas (nº de cálculos del cotizador)',
          source: 'Srv',
          columns: [
            { key: 'carta', labelEs: 'Carta', kind: 'text' },
            { key: 'calculos', labelEs: 'Cálculos del cotizador', kind: 'count' },
          ],
          rows: [{ carta: 'Mew · 151 151', calculos: 0 }],
          measured: true,
        },
        {
          id: 'd4b',
          title: 'Buylist más solicitadas (cartas en solicitudes enviadas)',
          source: 'BD',
          columns: [
            { key: 'carta', labelEs: 'Carta', kind: 'text' },
            { key: 'solicitudes', labelEs: 'Solicitudes enviadas que la incluyen', kind: 'count' },
          ],
          rows: [{ carta: 'Mew · 151 151', solicitudes: small(2) }],
          measured: true,
        },
      ];
    case 'e':
      return [notMeasured('e1', 'Consultas de Google', 'SC', SC_UNCONNECTED), notMeasured('e3', 'Referencias de asistentes de IA', 'GA4', GA4_OFF)];
    case 'f':
      return [
        notMeasured('f1', 'Tasa de aceptación del banner', 'Srv', BANNER_OFF),
        notMeasured('f3', 'Cobertura: % de pedidos con origen', 'BD', ORIGIN_OFF),
      ];
    case 'g':
      return [notMeasured('g1', 'Compras atribuidas a promociones (utm_medium=paid)', 'BD', ORIGIN_OFF)];
    case 'h':
      // h1 = las anotaciones del periodo como tabla (mismas filas que `annotations` del payload).
      return [
        {
          id: 'h1',
          title: 'Anotaciones de fecha (promociones, despliegues, eventos)',
          source: 'BD',
          columns: [
            { key: 'date', labelEs: 'Fecha', kind: 'text' },
            { key: 'kind', labelEs: 'Tipo', kind: 'text' },
            { key: 'label', labelEs: 'Etiqueta', kind: 'text' },
            { key: 'destino', labelEs: 'Destino (solo promoción)', kind: 'text' },
          ],
          rows: [],
          measured: true,
        },
      ];
  }
}

/**
 * C-P1 (API_CONTRACT v1.106 §MKT.G.5), espejo de `sealHiddenRows` del servidor (`marketing-analytics.service.ts`): en una
 * fila con un conteo oculto (`'< 5'` u `'oculta'`), toda celda no `text` que quedara `null` sale `'oculta'`. Así el mock
 * sirve la MISMA forma que el servidor y la pantalla no tiene que adivinar (TL-MKT2b-c). Candado: `marketing.parity.test.ts` «C-P1».
 */
function sealHiddenRows(t: MarketingAggTable): MarketingAggTable {
  if (!t.measured) return t;
  const nonText = t.columns.filter((c) => c.kind !== 'text').map((c) => c.key);
  return {
    ...t,
    rows: t.rows.map((r) => {
      if (!Object.values(r).some((v) => v === '< 5' || v === 'oculta')) return r;
      const out = { ...r };
      for (const k of nonText) if (out[k] === null || out[k] === undefined) out[k] = 'oculta';
      return out;
    }),
  };
}

export function mockMarketingPanel(screen: MarketingScreen, q: MockPeriodQuery): MarketingScreenPayload {
  requireMarketingRead();
  const period = resolvePeriod(q);
  const exact = !(typeof window !== 'undefined' && window.localStorage.getItem('tcg.mktPrivacy') === 'small_cells');
  const days = Math.round((Date.parse(period.to) - Date.parse(period.from)) / DAY) + 1;
  const embedded = annotations
    .filter((a) => a.date >= period.from && a.date <= period.to)
    .map(({ date, kind, label, destino }) => ({ date, kind, label, ...(destino ? { destino } : {}) }));
  // h1 = las anotaciones del periodo como tabla, igual que `screenH` del servidor.
  const tables = tablesFor(screen, period.kind, period.from, exact, period.to)
    .map((t) =>
      t.id === 'h1'
        ? { ...t, rows: embedded.map((a) => ({ date: a.date, kind: a.kind, label: a.label, destino: a.destino ?? null })) }
        : t,
    )
    .map(sealHiddenRows);
  const payload: MarketingScreenPayload = {
    screen,
    period: { ...period, timezone: 'America/Mexico_City' },
    sourceLegend: SOURCE_LEGEND,
    tables,
    annotations: embedded,
    notes: [COVERAGE_NOTE],
    privacy: exact ? 'exact' : 'small_cells',
  };
  if (screen === 'a') payload.previousPeriod = { from: addDays(period.from, -days), to: addDays(period.from, -1) };
  return payload;
}

// ---------------------------------------------------------------- anotaciones (§MKT.E)

let annotations: MarketingAnnotationDTO[] = [];
let annSeq = 0;
const PII = /@|\d{7,}/;

function validate(input: Partial<MarketingAnnotationInput>, kind: MarketingAnnotationInput['kind']) {
  if (input.label !== undefined && PII.test(input.label)) {
    throw new ApiFixtureError(422, 'VALIDATION_ERROR', 'label no puede contener datos personales', { field: 'label' });
  }
  if (input.destino && PII.test(input.destino)) {
    throw new ApiFixtureError(422, 'VALIDATION_ERROR', 'destino no puede contener datos personales', { field: 'destino' });
  }
  if (input.destino && kind !== 'promocion') {
    throw new ApiFixtureError(422, 'VALIDATION_ERROR', 'destino solo aplica a kind=promocion', { field: 'destino' });
  }
}

export function mockListAnnotations(from?: string, to?: string): MarketingAnnotationDTO[] {
  requireMarketingRead();
  return annotations
    .filter((a) => (!from || a.date >= from) && (!to || a.date <= to))
    .sort((x, y) => x.date.localeCompare(y.date));
}
export function mockCreateAnnotation(input: MarketingAnnotationInput): MarketingAnnotationDTO {
  requireMarketingRead();
  validate(input, input.kind);
  const row: MarketingAnnotationDTO = {
    id: `ann-${++annSeq}`,
    date: input.date,
    kind: input.kind,
    label: input.label.trim(),
    destino: input.destino?.trim() || null,
    createdAt: new Date().toISOString(),
  };
  annotations = [...annotations, row];
  return row;
}
export function mockUpdateAnnotation(id: string, input: Partial<MarketingAnnotationInput>): MarketingAnnotationDTO {
  requireMarketingRead();
  const cur = annotations.find((a) => a.id === id);
  if (!cur) throw new ApiFixtureError(404, 'NOT_FOUND', 'Not found');
  const kind = input.kind ?? cur.kind;
  validate(input, kind);
  const next: MarketingAnnotationDTO = {
    ...cur,
    ...input,
    kind,
    destino: kind === 'promocion' ? input.destino?.trim() || null : null,
  };
  annotations = annotations.map((a) => (a.id === id ? next : a));
  return next;
}
export function mockDeleteAnnotation(id: string): void {
  requireMarketingRead();
  if (!annotations.some((a) => a.id === id)) throw new ApiFixtureError(404, 'NOT_FOUND', 'Not found');
  annotations = annotations.filter((a) => a.id !== id);
}

// ---------------------------------------------------------------- descargas (§MKT.E)

export function mockMarketingDownload(name: string, q: MockPeriodQuery): { text: string; filename: string } {
  requireMarketingRead();
  const p = resolvePeriod(q);
  return { text: 'Hoja,Info\n', filename: `tcghunt_${name}_${p.from}_${p.to}_corte-20261018-1200.xlsx` };
}

// ---------------------------------------------------------------- tokens (§MKT.G.6)

let tokens: MarketingApiTokenView[] = [];
let tokSeq = 0;

export function mockListTokens(): { items: MarketingApiTokenView[] } {
  requireSuperAdmin();
  return { items: [...tokens].reverse() };
}
export function mockIssueToken(label: string): MarketingApiTokenIssued {
  requireSuperAdmin();
  const clean = label.trim();
  if (!/^[A-Za-z0-9 ._-]{1,60}$/.test(clean) || /\d{7,}/.test(clean)) {
    throw new ApiFixtureError(422, 'VALIDATION_ERROR', 'label inválido');
  }
  const now = new Date();
  const view: MarketingApiTokenView = {
    id: `tok-${++tokSeq}`,
    label: clean,
    status: 'active',
    createdAt: now.toISOString(),
    createdByUserId: 'mock-super',
    expiresAt: new Date(now.getTime() + 365 * DAY).toISOString(),
    revokedAt: null,
    revokedByUserId: null,
    lastUsedAt: null,
  };
  tokens = [...tokens, view];
  const rand = Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('');
  return { id: view.id, label: view.label, token: `mkt_${rand}`, createdAt: view.createdAt, expiresAt: view.expiresAt };
}
export function mockRevokeToken(id: string): MarketingApiTokenView {
  requireSuperAdmin();
  const cur = tokens.find((t) => t.id === id);
  if (!cur) throw new ApiFixtureError(404, 'NOT_FOUND', 'Not found');
  if (cur.revokedAt) return cur;
  const next: MarketingApiTokenView = { ...cur, status: 'revoked', revokedAt: new Date().toISOString(), revokedByUserId: 'mock-super' };
  tokens = tokens.map((t) => (t.id === id ? next : t));
  return next;
}

// ---------------------------------------------------------------- evento de prueba de Meta (§MKT.H.12)

/** Versión de Graph de §MKT.H.1 (v1.112). El mock no la usa para nada más que devolverla. */
export const MOCK_META_VERSION = 'v26.0';
/** Píxel ficticio del modo demo (el ID es público en el contrato; este no es de nadie). */
export const MOCK_META_PIXEL_ID = '000000000000000';
const META_TEST_CODE_RE = /^TEST[0-9]{3,10}$/;
const META_TEST_LIMIT = 5;
const META_TEST_WINDOW_MS = 60 * 60_000;

/**
 * Códigos del modo demo que fuerzan cada salida (el resto ⇒ `accepted`). Con formato válido: el servidor falso no
 * puede contactar a Meta, así que el código elige el resultado. 422 = cualquier código fuera de `^TEST[0-9]{3,10}$`.
 */
export const MOCK_META_TEST_CODES = {
  rejected: 'TEST400',
  rejectedNoMessage: 'TEST401',
  unreachable: 'TEST503',
  notConfigured: 'TEST409',
  rateLimited: 'TEST429',
} as const;

let metaTestSends: number[] = [];

function mockUuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

/**
 * `POST /admin/measurement/meta-test-event`: super_admin (403); recorta y valida (422 `details.field`, ⛔ sin el valor);
 * 409 y 429 no cuentan; 5 envíos por 60 min móviles, global, como el servidor.
 */
export function mockMetaTestEvent(rawCode: unknown, now: number = Date.now()): MetaTestEventResult {
  requireSuperAdmin();
  const code = typeof rawCode === 'string' ? rawCode.trim() : '';
  if (!META_TEST_CODE_RE.test(code)) {
    throw new ApiFixtureError(422, 'VALIDATION_ERROR', 'Invalid testEventCode', { field: 'testEventCode' });
  }
  if (code === MOCK_META_TEST_CODES.notConfigured) {
    throw new ApiFixtureError(409, 'MEASUREMENT_META_NOT_CONFIGURED', 'Meta is not configured', { reason: 'missing_config' });
  }
  metaTestSends = metaTestSends.filter((t) => now - t < META_TEST_WINDOW_MS);
  if (code === MOCK_META_TEST_CODES.rateLimited || metaTestSends.length >= META_TEST_LIMIT) {
    const oldest = metaTestSends[0];
    const retryAfterSeconds = oldest === undefined ? 1500 : Math.max(1, Math.ceil((oldest + META_TEST_WINDOW_MS - now) / 1000));
    throw new ApiFixtureError(429, 'RATE_LIMITED', 'Too many test events', { retryAfterSeconds });
  }
  metaTestSends = [...metaTestSends, now];
  const base = {
    metaVersion: MOCK_META_VERSION,
    pixelId: MOCK_META_PIXEL_ID,
    testEventCode: code,
    eventName: 'PageView' as const,
    eventId: `test-${mockUuid()}`,
    sentAt: new Date(now).toISOString(),
    metaMessages: [] as string[],
  };
  if (code === MOCK_META_TEST_CODES.unreachable) {
    return { ...base, status: 'unreachable', httpStatus: null, eventsReceived: null, fbtraceId: null, metaError: null };
  }
  if (code === MOCK_META_TEST_CODES.rejected || code === MOCK_META_TEST_CODES.rejectedNoMessage) {
    const withMessage = code === MOCK_META_TEST_CODES.rejected;
    return {
      ...base,
      status: 'rejected',
      httpStatus: 400,
      eventsReceived: null,
      fbtraceId: 'AbCdEfGhIjKlMnO',
      metaError: {
        code: 100,
        subcode: withMessage ? 2804003 : null,
        type: 'OAuthException',
        message: withMessage ? 'Invalid parameter: the test_event_code is not valid for this pixel.' : null,
      },
    };
  }
  return { ...base, status: 'accepted', httpStatus: 200, eventsReceived: 1, fbtraceId: 'AzYxWvUtSrQpOnM', metaError: null };
}

/** Solo pruebas: vacía el estado del servidor falso. */
export function resetMarketingMock() {
  annotations = [];
  tokens = [];
  metaTestSends = [];
  annSeq = 0;
  tokSeq = 0;
}

// TL-DYN3R-2 · centinela PROPIO de este módulo: un literal, no un import (si el módulo escapara al alias de
// next.config.mjs, un `import './sentinel'` resolvería vacío y el literal no viajaría). Ver sentinel.ts.
(globalThis as { __thMockBundle?: string }).__thMockBundle = 'th-mock-bundle-sentinel-5c1e';
