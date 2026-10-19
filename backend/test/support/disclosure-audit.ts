/**
 * test/support/disclosure-audit.ts — ORÁCULOS de población del Panel de Marketing (API_CONTRACT §MKT.H.14, MKT-TL2).
 *
 * Un oráculo dice, SIN pasar por el servicio ni por `small-cells.ts`, qué sujetos tiene una población en un rango de días de
 * un mundo de prueba. Lo usa la prueba 1 (`marketing-populations.registry.spec.ts`: toda población del registro tiene oráculo)
 * y lo usará el auditor de cruces (prueba 3, `marketing-cross-table.audit.spec.ts`, pendiente: MKT-TL2 en docs/TECH_DEBT.md).
 * ⛔ No importa `small-cells.ts` ni el servicio: es la segunda implementación, independiente, de «qué cuenta cada tabla».
 */
import type { PopulationId } from '../../src/modules/marketing/marketing-populations';

/** Mediodía CDMX = 18:00 UTC; los rangos del oráculo son días civiles CDMX `YYYY-MM-DD`, ambos inclusive. */
export interface AuditRange {
  from: string;
  to: string;
}

export interface AuditOrder {
  id: string;
  settledAt: Date | null;
  status: string;
  firstUtmSource: string | null;
  firstUtmMedium: string | null;
  firstUtmContent: string | null;
  measurementConsentAnalytics: boolean | null;
  totalCents: number;
}
export interface AuditRequest {
  id: string;
  createdAt: Date;
  status: string;
  paidAt: Date | null;
  firstUtmSource: string | null;
  firstUtmMedium: string | null;
  firstUtmContent: string | null;
}
export interface AuditWish {
  cardId: string;
  userId: string;
  createdAt: Date;
}
/** Filas que el doble de GA4/Search Console devuelve por consulta: la unidad de la fuente es el sujeto. */
export interface AuditExternalRow {
  key: string;
  units: number;
}

export interface AuditWorld {
  orders: AuditOrder[];
  requests: AuditRequest[];
  wishes: AuditWish[];
  /** Cartas con piezas `listed` de plataforma HOY (las de WISH son las que NO están aquí). */
  listedCardIds: Set<string>;
  ga4: Partial<Record<'sources' | 'funnel' | 'pages' | 'devices' | 'items' | 'aiReferrals', AuditExternalRow[]>>;
  sc: AuditExternalRow[];
}

/** Un sujeto de una población: su id y, para fuentes externas, cuántas unidades representa la fila. */
export interface AuditSubject {
  id: string;
  units: number;
}

const SOLD = new Set(['settled', 'refunded', 'chargeback']);
/** Día civil CDMX (UTC−6, sin horario de verano desde 2022) de un instante. */
const mxDay = (d: Date): string => new Date(d.getTime() - 6 * 3600_000).toISOString().slice(0, 10);
const within = (d: Date | null, r: AuditRange): boolean => d !== null && mxDay(d) >= r.from && mxDay(d) <= r.to;

const paid = (w: AuditWorld, r: AuditRange) => w.orders.filter((o) => SOLD.has(o.status) && within(o.settledAt, r));
const req = (w: AuditWorld, r: AuditRange) => w.requests.filter((s) => within(s.createdAt, r));
const one = (id: string): AuditSubject => ({ id, units: 1 });
const ext = (rows: AuditExternalRow[] | undefined): AuditSubject[] => (rows ?? []).map((x) => ({ id: x.key, units: x.units }));

/** Un oráculo por población del registro (`MARKETING_POPULATIONS`). La prueba 1 exige que no falte ninguno. */
export const POPULATION_ORACLES: Record<PopulationId, (w: AuditWorld, r: AuditRange) => AuditSubject[]> = {
  PAID: (w, r) => paid(w, r).map((o) => one(o.id)),
  PAID_ORIGIN: (w, r) => paid(w, r).filter((o) => o.firstUtmSource !== null).map((o) => one(o.id)),
  REQ: (w, r) => req(w, r).map((s) => one(s.id)),
  REQ_ORIGIN: (w, r) => req(w, r).filter((s) => s.firstUtmSource !== null).map((s) => one(s.id)),
  REQ_PAID: (w, r) => w.requests.filter((s) => s.status === 'pagada' && within(s.paidAt, r)).map((s) => one(s.id)),
  // Sujeto = USUARIO (no alta): un usuario con 4 acabados de la misma carta es una persona.
  WISH: (w, r) => {
    const users = new Set(w.wishes.filter((x) => within(x.createdAt, r) && !w.listedCardIds.has(x.cardId)).map((x) => `${x.cardId}|${x.userId}`));
    return [...users].map(one);
  },
  'GA4:sources': (w) => ext(w.ga4.sources),
  'GA4:funnel': (w) => ext(w.ga4.funnel),
  'GA4:pages': (w) => ext(w.ga4.pages),
  'GA4:devices': (w) => ext(w.ga4.devices),
  'GA4:items': (w) => ext(w.ga4.items),
  'GA4:aiReferrals': (w) => ext(w.ga4.aiReferrals),
  SC: (w) => ext(w.sc),
};
