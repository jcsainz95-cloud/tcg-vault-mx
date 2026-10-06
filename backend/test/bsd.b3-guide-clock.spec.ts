/**
 * bsd.b3-guide-clock.spec.ts — 💰 rev BSD-1, paso B-3 (API_CONTRACT §BSD.7 reglas 8 y 9, §BSD.5, §BSD.9, §BSD.15 C-7/C-8).
 * Propiedad: backend. Unitaria (sin BD): el reloj del cierre sin guía (`guide-clock.ts`) y sus diales.
 *
 *  - **BSD-B17 (mitad pura)** — días NATURALES en milisegundos: 6 d 23 h abierta; 7 d vence aunque cruce fin de semana; dial
 *    10 ⇒ a los 8 d sigue abierta; guía manual, guía de Skydropx viva, reclamo vivo y «en proceso» ⇒ el reloj NO corre.
 *    (La mitad del barrido, contra Postgres, vive en `integration/bsd-b3.e2e-spec.ts`.)
 *  - **Paridad JS ↔ Prisma** — `guideClockRunning`/`guideDueSoonOf` (lo que pinta el DTO) y `guideClockRunningWhere`/
 *    `guideCloseDueWhere`/`guideWarnDueWhere`/`guideDueSoonWhere` (lo que leen y escriben el barrido y el tablero) dicen lo
 *    mismo sobre la MISMA tabla de casos. Sin esto, M5 podría marcar «se cierra sola» una solicitud que el barrido no cierra.
 *  - **BSD-B20 (mitad pura)** — el día 5 `guideDueSoon` y `guideDueInDays = 2` (C-8); el día 4, no.
 *  - **Diales (§BSD.9)** y **C-7** (AG-23 apagable; AG-21/22 no).
 */
import { SellRequestStatus } from '@prisma/client';
import {
  GUIDE_DAY_MS,
  GuideClockInbound,
  GuideClockSellRequest,
  effectiveWarnDays,
  guideAnchorOf,
  guideClockRunning,
  guideClockRunningWhere,
  guideCloseDueWhere,
  guideDueAtOf,
  guideDueFieldsOf,
  guideDueInDaysOf,
  guideDueSoonOf,
  guideDueSoonWhere,
  guideWarnDueWhere,
} from '../src/modules/buylist/guide-clock';
import { SETTING_DEFAULTS, SETTING_DTO_MAP, SETTING_VALIDATORS, SettingKey } from '../src/modules/settings/settings.constants';
import { SPEND_ALERT_CODES, validateSpendAlertsDisabled } from '../src/modules/settings/shipping-dials';

const H = 3600 * 1000;
// Viernes 4-sep-2026 12:00 CDMX: a +7 d naturales cae el viernes siguiente (cruza un fin de semana; en hábiles serían 5).
const ANCLA = new Date('2026-09-04T18:00:00.000Z');
const D7 = { closeDays: 7, warnDays: 2 };

const sr = (over: Partial<GuideClockSellRequest> = {}): GuideClockSellRequest => ({
  status: 'aceptada',
  closedAt: null,
  guideSentAt: null,
  shipmentTrackingNumber: null,
  sellerShippedDeclaredAt: null,
  shipmentConfirmedAt: null,
  inboundGuideClockStartedAt: null,
  acceptedAt: ANCLA,
  ...over,
});
const fila = (over: Partial<GuideClockInbound> = {}): GuideClockInbound => ({
  labelProcessingSince: null,
  providerShipmentId: null,
  providerCanceledAt: null,
  ...over,
});

/** ¿Vence (regla 8) a `now`? — la forma JS. */
const venceJs = (s: GuideClockSellRequest, f: GuideClockInbound | null, now: Date, d = D7) => {
  const due = guideDueAtOf(s, f, d);
  return due != null && now.getTime() >= due.getTime();
};

// ============================================================ un evaluador MÍNIMO del subconjunto de Prisma que usa el reloj
type Row = Record<string, unknown> & { inboundShipment: Record<string, unknown> | null };
function cond(value: unknown, c: unknown): boolean {
  if (c === null) return value === null || value === undefined;
  if (c instanceof Date) return value instanceof Date && value.getTime() === c.getTime();
  if (typeof c !== 'object') return value === c;
  const o = c as Record<string, unknown>;
  let ok = true;
  for (const [k, v] of Object.entries(o)) {
    if (k === 'not') ok = ok && (v === null ? value !== null && value !== undefined : value !== v);
    else if (k === 'lte') ok = ok && value instanceof Date && value.getTime() <= (v as Date).getTime();
    else if (k === 'gt') ok = ok && value instanceof Date && value.getTime() > (v as Date).getTime();
    else throw new Error(`operador no soportado por el evaluador: ${k}`);
  }
  return ok;
}
function evalWhere(row: Record<string, unknown> | null, w: Record<string, unknown>): boolean {
  if (row === null) throw new Error('fila nula');
  return Object.entries(w).every(([k, v]) => {
    if (k === 'AND') return (v as Record<string, unknown>[]).every((x) => evalWhere(row, x));
    if (k === 'OR') return (v as Record<string, unknown>[]).some((x) => evalWhere(row, x));
    if (k === 'inboundShipment') {
      const rel = v as { is: Record<string, unknown> | null };
      const target = row.inboundShipment as Record<string, unknown> | null;
      if (rel.is === null) return target === null;
      return target !== null && evalWhere(target, rel.is);
    }
    return cond(row[k], v);
  });
}
const asRow = (s: GuideClockSellRequest, f: GuideClockInbound | null): Row => ({ ...s, inboundShipment: f ? { ...f } : null });

// La tabla de casos: cada uno con lo que el reloj debe decir (corre o no).
const CASOS: [string, GuideClockSellRequest, GuideClockInbound | null, boolean][] = [
  ['aceptada sin fila de entrada', sr(), null, true],
  ['aceptada con fila de entrada inerte (solicitado, sin reclamo)', sr(), fila(), true],
  ['re-anclada (inboundGuideClockStartedAt manda sobre acceptedAt)', sr({ inboundGuideClockStartedAt: new Date(ANCLA.getTime() + 2 * GUIDE_DAY_MS) }), fila(), true],
  ['guía de Skydropx CANCELADA (re-emisión pendiente) ⇒ vuelve a correr', sr(), fila({ providerShipmentId: 'p1', providerCanceledAt: ANCLA }), true],
  ['guía manual (guideSentAt + número)', sr({ guideSentAt: ANCLA, shipmentTrackingNumber: 'X1' }), null, false],
  ['número sin guideSentAt (corrección de domicilio en curso)', sr({ shipmentTrackingNumber: 'X1' }), null, false],
  ['guía de Skydropx VIVA', sr(), fila({ providerShipmentId: 'p1' }), false],
  ['reclamo vivo («en vuelo», sin id)', sr(), fila({ labelProcessingSince: ANCLA }), false],
  ['«en proceso» (id sin número)', sr(), fila({ labelProcessingSince: ANCLA, providerShipmentId: 'p1' }), false],
  ['«ya lo mandé» del vendedor', sr({ sellerShippedDeclaredAt: ANCLA }), null, false],
  ['confirmada por el operador', sr({ shipmentConfirmedAt: ANCLA }), null, false],
  ['cerrada (closedAt)', sr({ closedAt: ANCLA }), null, false],
  ...(['cotizada', 'ofertada', 'en_transito', 'recibida', 'expirada', 'pagada'] as SellRequestStatus[]).map(
    (s) => [`status ${s}`, sr({ status: s }), null, false] as [string, GuideClockSellRequest, GuideClockInbound | null, boolean],
  ),
  ['ancla NULA (ni re-ancla ni aceptación) ⇒ fail-closed', sr({ acceptedAt: null }), null, false],
];

describe('💰 BSD-B17 (pura) — días NATURALES, en milisegundos', () => {
  it('el ancla es `coalesce(inboundGuideClockStartedAt, acceptedAt)`', () => {
    expect(guideAnchorOf(sr())).toEqual(ANCLA);
    const re = new Date(ANCLA.getTime() + 3 * GUIDE_DAY_MS);
    expect(guideAnchorOf(sr({ inboundGuideClockStartedAt: re }))).toEqual(re);
    expect(guideAnchorOf(sr({ acceptedAt: null }))).toBeNull();
  });

  it('`guideDueAt` = ancla + 7 × 24 h EXACTAS (cruza el fin de semana: ⛔ días hábiles)', () => {
    expect(guideDueAtOf(sr(), null, D7)?.toISOString()).toBe('2026-09-11T18:00:00.000Z');
  });

  it('6 d 23 h ⇒ abierta; 7 d ⇒ vence; dial 10 ⇒ a los 8 d sigue abierta', () => {
    expect(venceJs(sr(), null, new Date(ANCLA.getTime() + 6 * GUIDE_DAY_MS + 23 * H))).toBe(false);
    expect(venceJs(sr(), null, new Date(ANCLA.getTime() + 7 * GUIDE_DAY_MS))).toBe(true);
    expect(venceJs(sr(), null, new Date(ANCLA.getTime() + 8 * GUIDE_DAY_MS), { closeDays: 10, warnDays: 2 })).toBe(false);
    expect(venceJs(sr(), null, new Date(ANCLA.getTime() + 10 * GUIDE_DAY_MS), { closeDays: 10, warnDays: 2 })).toBe(true);
  });

  it.each(CASOS)('el reloj corre ⇔ «sin guía»: %s', (_n, s, f, corre) => {
    expect(guideClockRunning(s, f)).toBe(corre);
    expect(guideDueAtOf(s, f, D7) !== null).toBe(corre);
  });
});

describe('💰 Paridad JS ↔ Prisma (la marca de M5 y el barrido dicen lo mismo)', () => {
  // `guideClockRunningWhere` es «sin guía» SIN la parte de tiempo: el ancla nula la excluye la ventana (`guideAnchorWindowWhere`,
  // `{ not: null, lte }`), que la tabla de abajo cubre. Por eso aquí la fila de ancla nula no entra.
  it.each(CASOS.filter(([, s]) => guideAnchorOf(s) !== null))('`guideClockRunningWhere` ≡ `guideClockRunning`: %s', (_n, s, f, corre) => {
    expect(evalWhere(asRow(s, f), guideClockRunningWhere() as Record<string, unknown>)).toBe(corre);
  });

  const MOMENTOS = [0, 4.9, 5, 5.5, 6.99, 7, 7.5, 30].map((d) => d * GUIDE_DAY_MS);
  const DIALES = [D7, { closeDays: 7, warnDays: 0 }, { closeDays: 3, warnDays: 10 }, { closeDays: 1, warnDays: 2 }, { closeDays: 10, warnDays: 2 }];
  it('regla 8 (`guideCloseDueWhere`), regla 9 (`guideWarnDueWhere`) y tablero (`guideDueSoonWhere`) ≡ JS, en toda la tabla × momentos × diales', () => {
    const diffs: string[] = [];
    for (const [n, s, f] of CASOS) {
      for (const dt of MOMENTOS) {
        for (const d of DIALES) {
          const now = new Date(ANCLA.getTime() + dt);
          const due = guideDueAtOf(s, f, d);
          const soonJs = guideDueSoonOf(due, now, d);
          const closeJs = due != null && now.getTime() >= due.getTime();
          const warnJs = soonJs && !closeJs && effectiveWarnDays(d) > 0;
          const row = asRow(s, f);
          const closePr = evalWhere(row, guideCloseDueWhere(now, d) as Record<string, unknown>);
          const warnW = guideWarnDueWhere(now, d);
          const warnPr = warnW ? evalWhere(row, warnW as Record<string, unknown>) : false;
          const soonPr = evalWhere(row, guideDueSoonWhere(now, d) as Record<string, unknown>);
          if (closePr !== closeJs || warnPr !== warnJs || soonPr !== soonJs) {
            diffs.push(`${n} @${dt / GUIDE_DAY_MS}d ${JSON.stringify(d)}: close ${closePr}/${closeJs} warn ${warnPr}/${warnJs} soon ${soonPr}/${soonJs}`);
          }
        }
      }
    }
    expect(diffs).toEqual([]);
  });

  it('CONTROL: el evaluador SÍ distingue (un predicado sin la exclusión del reclamo daría otra respuesta)', () => {
    const sinReclamo = { ...guideClockRunningWhere(), AND: [] };
    expect(evalWhere(asRow(sr(), fila({ labelProcessingSince: ANCLA })), sinReclamo)).toBe(true);
    expect(evalWhere(asRow(sr(), fila({ labelProcessingSince: ANCLA })), guideClockRunningWhere() as Record<string, unknown>)).toBe(false);
  });
});

describe('💰 BSD-B20 (pura) + C-8 — `guideDueSoon` y `guideDueInDays`', () => {
  it('día 5 (aviso de 2) ⇒ `guideDueSoon` y `guideDueInDays = 2`; día 4 ⇒ ni una ni otra', () => {
    const d5 = guideDueFieldsOf(sr(), null, new Date(ANCLA.getTime() + 5 * GUIDE_DAY_MS), D7);
    expect(d5).toEqual({ guideDueAt: new Date('2026-09-11T18:00:00.000Z'), guideDueSoon: true, guideDueInDays: 2 });
    const d4 = guideDueFieldsOf(sr(), null, new Date(ANCLA.getTime() + 4 * GUIDE_DAY_MS + 23 * H), D7);
    expect(d4.guideDueSoon).toBe(false);
    expect(d4.guideDueInDays).toBeNull();
  });

  it('`ceil`, mínimo 0: 5 d 1 h ⇒ 2; 6 d 1 h ⇒ 1; vencida ⇒ 0', () => {
    const due = guideDueAtOf(sr(), null, D7);
    expect(guideDueInDaysOf(due, new Date(ANCLA.getTime() + 5 * GUIDE_DAY_MS + H), true)).toBe(2);
    expect(guideDueInDaysOf(due, new Date(ANCLA.getTime() + 6 * GUIDE_DAY_MS + H), true)).toBe(1);
    expect(guideDueInDaysOf(due, new Date(ANCLA.getTime() + 9 * GUIDE_DAY_MS), true)).toBe(0);
    expect(guideDueInDaysOf(due, new Date(ANCLA.getTime() + 5 * GUIDE_DAY_MS), false)).toBeNull();
  });

  it('con guía ⇒ todo null/false (la marca desaparece sola)', () => {
    const f = guideDueFieldsOf(sr({ guideSentAt: ANCLA, shipmentTrackingNumber: 'X' }), null, new Date(ANCLA.getTime() + 5 * GUIDE_DAY_MS), D7);
    expect(f).toEqual({ guideDueAt: null, guideDueSoon: false, guideDueInDays: null });
  });

  it('aviso efectivo = `min(warn, close − 1)`; `0` ⇒ sin regla 9', () => {
    expect(effectiveWarnDays({ closeDays: 7, warnDays: 2 })).toBe(2);
    expect(effectiveWarnDays({ closeDays: 3, warnDays: 10 })).toBe(2);
    expect(effectiveWarnDays({ closeDays: 1, warnDays: 2 })).toBe(0);
    expect(guideWarnDueWhere(ANCLA, { closeDays: 7, warnDays: 0 })).toBeNull();
  });
});

describe('💰 §BSD.9 — los dos diales, y BSD-1.1 C-7 (AG-23 apagable)', () => {
  it('defaults 7 y 2; nombres públicos de M10', () => {
    expect(SETTING_DEFAULTS[SettingKey.BUYLIST_GUIDE_CLOSE_CALENDAR_DAYS]).toBe(7);
    expect(SETTING_DEFAULTS[SettingKey.BUYLIST_GUIDE_WARN_DAYS_BEFORE_CLOSE]).toBe(2);
    expect(SETTING_DTO_MAP.buylistGuideCloseCalendarDays).toBe('buylist_guide_close_calendar_days');
    expect(SETTING_DTO_MAP.buylistGuideWarnDaysBeforeClose).toBe('buylist_guide_warn_days_before_close');
  });

  it('validación: close 1..60, warn 0..30 (enteros)', () => {
    const vc = SETTING_VALIDATORS[SettingKey.BUYLIST_GUIDE_CLOSE_CALENDAR_DAYS]!;
    const vw = SETTING_VALIDATORS[SettingKey.BUYLIST_GUIDE_WARN_DAYS_BEFORE_CLOSE]!;
    expect([1, 7, 60].map(vc)).toEqual([null, null, null]);
    expect([0, 61, 7.5, '7'].map(vc).every((e) => typeof e === 'string')).toBe(true);
    expect([0, 2, 30].map(vw)).toEqual([null, null, null]);
    expect([-1, 31, 1.5].map(vw).every((e) => typeof e === 'string')).toBe(true);
  });

  it('C-7: `spend_alerts_disabled` acepta AG-23 (y sigue negando AG-21/AG-22)', () => {
    expect(SPEND_ALERT_CODES).toContain('AG-23');
    expect(validateSpendAlertsDisabled(['AG-23'])).toBeNull();
    expect(validateSpendAlertsDisabled(['AG-21'])).not.toBeNull();
    expect(validateSpendAlertsDisabled(['AG-22'])).not.toBeNull();
  });
});
