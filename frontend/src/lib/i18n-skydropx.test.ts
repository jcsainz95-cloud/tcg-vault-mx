import { describe, it, expect } from 'vitest';
import es from '../../messages/es.json';
import en from '../../messages/en.json';

/**
 * UX-SDX-14 (`DESIGN_SYSTEM §43.13`/§43.15): paridad ES/EN de las claves de Skydropx, cero códigos de módulo
 * en el texto (P66-3), las claves retiradas por v4.16 ausentes y las del teléfono SIN añadir (P-ADR-1 abierta:
 * «una clave sin lector es ruido» — se añaden el día que `HECHOS.md` diga «sí»).
 */

function flat(obj: unknown, prefix = ''): Record<string, string> {
  if (typeof obj === 'string') return { [prefix]: obj };
  if (typeof obj !== 'object' || obj === null) return {};
  return Object.entries(obj as Record<string, unknown>).reduce(
    (acc, [k, v]) => ({ ...acc, ...flat(v, prefix ? `${prefix}.${k}` : k) }),
    {} as Record<string, string>,
  );
}
const ES = flat(es);
const EN = flat(en);

const ROOTS = [
  'admin.m4.tracking.sdx.',
  'admin.m4.labelAlert.',
  'admin.m4.carrierStatus.',
  'admin.m4.label.',
  'admin.m4.departure.',
  'admin.m10.shipping.',
  'status.timeline.',
];
const SINGLE = [
  'admin.m4.prep.ship.guide.processing',
  'admin.m4.prep.ship.guide.viewProcessing',
  'admin.m4.prep.ship.guide.inFlight',
  'admin.m4.prep.ship.guide.viewInFlight',
  'admin.m4.prep.ship.addressCorrected',
  'admin.m4.tabs.departure',
  'orders.shipment.trackingLink',
  'track.trackingLink',
];
/** Claves que §43.13 nombra una a una (muestra que cubre cada bloque de la tabla). */
const REQUIRED = [
  'admin.m4.tracking.sdx.step',
  'admin.m4.tracking.sdx.manual',
  'admin.m4.tracking.sdx.address.scopeNote',
  'admin.m4.tracking.sdx.address.auditNote',
  'admin.m4.tracking.sdx.address.conflict',
  'admin.m4.tracking.sdx.address.cpUnknown',
  'admin.m4.tracking.sdx.options.promo',
  'admin.m4.tracking.sdx.options.promoNote',
  'admin.m4.tracking.sdx.buy.cta',
  'admin.m4.tracking.sdx.buy.charge',
  'admin.m4.tracking.sdx.buy.chargeStore',
  'admin.m4.tracking.sdx.inFlight.body',
  'admin.m4.tracking.sdx.inFlight.nothingBought',
  'admin.m4.tracking.sdx.error.quoteExpiredAddress',
  'admin.m4.tracking.sdx.error.addressIncomplete',
  'admin.m4.labelAlert.unknown.superAdminOnly',
  'admin.m4.labelAlert.orphan.title',
  'admin.m4.labelAlert.stuck.body',
  'admin.m4.labelAlert.retryDialog.confirm',
  ...SINGLE,
];
const RETIRED = [
  'admin.m4.tracking.sdx.address.readOnly',
  'admin.m4.tracking.sdx.address.saveNeighborhood',
  'admin.m4.tracking.sdx.address.neighborhoodSaved',
  'admin.m4.tracking.sdx.error.inFlight',
  'admin.m4.tracking.sdx.error.postalCode',
  'admin.m4.tracking.sdx.error.postalCodeUnknown',
  'admin.m4.tracking.sdx.options.planNote',
  // v4.20 (§43.19.13, UX-GAS-7): «Solo el dueño…» era falso con `HECHOS.md:58`; «Volver a elegir» ⇒ `verify.requote`.
  'admin.m4.tracking.sdx.buy.ownerOnly',
  'admin.m4.tracking.sdx.error.ownerOnly',
  'admin.m4.tracking.sdx.inFlight.chooseAgain',
  'admin.m4.labelAlert.unknown.ownerOnly',
];

const ours = (cat: Record<string, string>) => Object.keys(cat).filter((k) => ROOTS.some((r) => k.startsWith(r)) || SINGLE.includes(k));

describe('UX-SDX-14 · i18n de Skydropx', () => {
  it('cada clave nueva existe en ES y en EN', () => {
    expect(ours(ES).sort()).toEqual(ours(EN).sort());
    for (const k of REQUIRED) {
      expect(ES[k], `ES ${k}`).toBeTruthy();
      expect(EN[k], `EN ${k}`).toBeTruthy();
    }
  });
  it('ningún texto nuevo nombra un módulo por su código (P66-3)', () => {
    const offenders = ours(ES)
      .concat(ours(EN))
      .filter((k) => /\bM1?[0-9]\b/.test(ES[k] ?? '') || /\bM1?[0-9]\b/.test(EN[k] ?? ''));
    expect(offenders).toEqual([]);
  });
  it('las claves que v4.16 retira no existen', () => {
    for (const k of RETIRED) {
      expect(ES[k], k).toBeUndefined();
      expect(EN[k], k).toBeUndefined();
    }
  });
  it('P-ADR-1 abierta ⇒ el teléfono NO tiene claves de campo', () => {
    for (const k of Object.keys(ES)) expect(k.startsWith('admin.m4.tracking.sdx.address.phone.')).toBe(false);
  });
});
