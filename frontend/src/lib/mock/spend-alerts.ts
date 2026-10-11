/**
 * MOCK · SERVIDOR FALSO de los avisos de gasto (`docs/API_CONTRACT.md §M4-SHIP.19.29.9` v1.80.12.9 y §19.30 v1.80.12.10).
 * // MOCK: pendiente de backend real (`modules/spend-alerts/` se está construyendo, D2g).
 *
 * Replica la conducta OBSERVABLE: `403 MONEY_OUT_FORBIDDEN` para el operador (`@MoneyOut()` de clase), filtros por
 * `kind`/`severity`/`subjectUserId`/`unseen`/`muted`/`from`/`to` (día MX sobre `firstOccurredAt`), orden
 * `firstOccurredAt desc`, `seen` idempotente que NO marca avisos sobre uno mismo ni AG-21 si el actor no es el dueño
 * (`skipped`, §19.30.2 (4)), y ⛔ ningún verbo de borrado ni de «no visto».
 *
 * ⛔ Ningún dato del cliente en `facts` (GAS-2): solo nombres del personal, números de pedido y folios.
 * El resumen (`summary`) lo «calcula» este servidor falso; la pantalla lo pinta tal cual (GAS-4).
 */
import type {
  MarkSpendAlertsSeenRes,
  SpendAlertDTO,
  SpendAlertListFilters,
  SpendAlertListRes,
  SpendAlertSummaryDTO,
  SpendControlDTO,
} from '@/types/contract';
import { ApiFixtureError } from './fixtures';
import { mockCallerRole } from './m4-ship';

const OWNER = { userId: 'u-sa1', name: 'Dueño' };
const ANA = { userId: 'u-op1', name: 'Operador Bóveda' };
const LUIS = { userId: 'u-op2', name: 'Luis' };

/** Mock: el dueño es el súper-admin del selector «Ver como» salvo `localStorage['tcg.owner'] = 'false'`. */
export function mockIsOwner(): boolean {
  if (mockCallerRole() !== 'super_admin') return false;
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem('tcg.owner') !== 'false';
}

function iso(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function alert(over: Partial<SpendAlertDTO> & Pick<SpendAlertDTO, 'id' | 'code' | 'kind' | 'severity'>): SpendAlertDTO {
  const at = over.firstOccurredAt ?? iso(30);
  return {
    subject: null,
    shipment: null,
    order: null,
    amountCents: null,
    facts: {},
    occurrenceCount: 1,
    firstOccurredAt: at,
    lastOccurredAt: over.lastOccurredAt ?? at,
    resolvedAt: null,
    seen: null,
    mail: { status: over.severity === 'immediate' ? 'sent' : 'not_applicable', at: over.severity === 'immediate' ? at : null },
    muted: false,
    ...over,
  };
}

function seed(): SpendAlertDTO[] {
  return [
    alert({
      id: 'sa-1', code: 'AG-1', kind: 'label_after_address_fix', severity: 'immediate', subject: ANA,
      shipment: { id: 'shp-1', folio: 'ENV-000045', kind: 'guest_direct_ship' }, order: { id: 'ord-1', orderNumber: 'TCG-000123' },
      amountCents: 14850, firstOccurredAt: iso(20),
      facts: { changedKeys: ['line1', 'postalCode'], carrierName: '99minutos', chargedCents: 14850, correctionAt: iso(25), revisionCount: 1 },
    }),
    alert({
      id: 'sa-2', code: 'AG-3', kind: 'label_cap_blocked', severity: 'immediate', subject: LUIS,
      shipment: { id: 'shp-2', folio: 'ENV-000046', kind: 'guest_direct_ship' }, order: { id: 'ord-2', orderNumber: 'TCG-000124' },
      amountCents: 15000, firstOccurredAt: iso(45), occurrenceCount: 2, lastOccurredAt: iso(40),
      facts: { priceCents: 15000, usedCents: 240000, capCents: 250000 },
    }),
    alert({
      id: 'sa-3', code: 'AG-7', kind: 'provider_balance_low', severity: 'immediate', amountCents: 96516, firstOccurredAt: iso(90),
      facts: { balanceCents: 96516, thresholdCents: 100000 },
    }),
    alert({
      id: 'sa-4', code: 'AG-13', kind: 'label_costly_choice', severity: 'digest', subject: ANA,
      shipment: { id: 'shp-3', folio: 'ENV-000047', kind: 'vault_withdrawal' }, order: null,
      amountCents: 2300, firstOccurredAt: iso(180),
      facts: { marginCents: -1200, priceCents: 20300, recommendedPriceCents: 18000, overRecommendedCents: 2300 },
      seen: { at: iso(100), by: OWNER },
    }),
    alert({
      id: 'sa-5', code: 'AG-5', kind: 'label_charge_drift', severity: 'digest',
      shipment: { id: 'shp-4', folio: 'ENV-000048', kind: 'guest_direct_ship' }, order: { id: 'ord-4', orderNumber: 'TCG-000126' },
      amountCents: 500, firstOccurredAt: iso(240),
      facts: { quotedCents: 14850, chargedCents: 15350, diffCents: 500 },
    }),
  ];
}

let alerts: SpendAlertDTO[] = seed();

/** Reinicia el servidor falso (pruebas). */
export function resetMockSpendAlerts(next?: SpendAlertDTO[]): void {
  alerts = next ? next.map((a) => ({ ...a })) : seed();
}

function requireStaffMoneyOut(): void {
  if (mockCallerRole() !== 'super_admin') {
    throw new ApiFixtureError(403, 'MONEY_OUT_FORBIDDEN', 'Only super_admin may read spending alerts');
  }
}

/** Día `YYYY-MM-DD` en `America/Mexico_City`. */
function dayMx(isoStr: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(isoStr));
}

function filtered(f: SpendAlertListFilters): SpendAlertDTO[] {
  return alerts
    .filter((a) => (f.kind ? a.kind === f.kind : true))
    .filter((a) => (f.severity ? a.severity === f.severity : true))
    .filter((a) => (f.subjectUserId ? a.subject?.userId === f.subjectUserId : true))
    .filter((a) => (f.unseen ? a.seen === null : true))
    .filter((a) => (f.muted === undefined ? true : !!a.muted === f.muted))
    .filter((a) => (f.from ? dayMx(a.firstOccurredAt) >= f.from : true))
    .filter((a) => (f.to ? dayMx(a.firstOccurredAt) <= f.to : true))
    .sort((a, b) => b.firstOccurredAt.localeCompare(a.firstOccurredAt));
}

export function mockListSpendAlerts(f: SpendAlertListFilters): SpendAlertListRes {
  requireStaffMoneyOut();
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, f.pageSize ?? 25));
  const rows = filtered(f);
  return { data: rows.slice((page - 1) * pageSize, page * pageSize).map((a) => ({ ...a })), page, pageSize, total: rows.length };
}

export function mockGetSpendAlert(id: string): SpendAlertDTO {
  requireStaffMoneyOut();
  const a = alerts.find((x) => x.id === id);
  if (!a) throw new ApiFixtureError(404, 'NOT_FOUND', 'Spend alert not found');
  return { ...a };
}

export function mockMarkSpendAlertsSeen(ids: string[]): MarkSpendAlertsSeenRes {
  requireStaffMoneyOut();
  if (ids.length < 1 || ids.length > 200) throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'ids', { field: 'ids' });
  const owner = mockIsOwner();
  const me = OWNER; // el súper-admin del mock
  let updated = 0;
  let skipped = 0;
  alerts = alerts.map((a) => {
    if (!ids.includes(a.id) || a.seen) return a;
    if (!owner && (a.subject?.userId === me.userId || a.kind === 'owner_account_changed')) {
      skipped += 1;
      return a;
    }
    updated += 1;
    return { ...a, seen: { at: new Date().toISOString(), by: me } };
  });
  return { updated, skipped };
}

/** `GET …/summary?from&to` — el mismo cuerpo que el correo del resumen (§19.29.7). */
export function mockSpendAlertSummary(from: string, to: string): SpendAlertSummaryDTO {
  requireStaffMoneyOut();
  const rows = filtered({ from, to });
  const byCode = new Map<string, { immediate: number; digest: number; amountCents: number }>();
  for (const a of rows) {
    const cur = byCode.get(a.code) ?? { immediate: 0, digest: 0, amountCents: 0 };
    cur[a.severity] += 1;
    cur.amountCents += a.amountCents ?? 0;
    byCode.set(a.code, cur);
  }
  return {
    from,
    to,
    byKind: [...byCode.entries()].map(([code, v]) => ({ code: code as SpendAlertDTO['code'], ...v })),
    labelSpendByPerson: [
      { userId: ANA.userId, name: ANA.name, cents: 124000, labels: 8 },
      { userId: LUIS.userId, name: LUIS.name, cents: 31000, labels: 2 },
    ],
    costlyChoices: { count: 1, overRecommendedCents: 2300, byPerson: [{ userId: ANA.userId, name: ANA.name, count: 1 }] },
  };
}

const UNSEEN_EXCLUDED = new Set(['provider_balance_low', 'parcel_returned', 'parcel_problem']);

/** `workQueue.spendControl` (§19.29.9): `null` para el operador. */
export function mockSpendControl(): SpendControlDTO | null {
  if (mockCallerRole() !== 'super_admin') return null;
  const unseen = alerts.filter((a) => a.seen === null && !a.muted && !UNSEEN_EXCLUDED.has(a.kind));
  return {
    unseenImmediate: unseen.filter((a) => a.severity === 'immediate').length,
    unseenDigest: unseen.filter((a) => a.severity === 'digest').length,
    labelSpend24h: [
      { userId: ANA.userId, name: ANA.name, cents: 124000, capCents: 250000 },
      { userId: LUIS.userId, name: LUIS.name, cents: 31000, capCents: 250000 },
      { userId: OWNER.userId, name: 'Tú', cents: 82000, capCents: null },
    ],
  };
}

/** `picking-list/summary.spendAlertsUnseenImmediate` (S-GAS-3): el mismo predicado; `null` para el operador. */
export function mockSpendAlertsUnseenImmediate(): number | null {
  return mockSpendControl()?.unseenImmediate ?? null;
}
