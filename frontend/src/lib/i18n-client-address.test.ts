import { describe, it, expect } from 'vitest';
import es from '../../messages/es.json';
import en from '../../messages/en.json';

/**
 * UX-ADR-7 (`DESIGN_SYSTEM §43.18i`/§43.18k): la dirección del CLIENTE con colonia de lista (fase C).
 * Paridad ES/EN de las claves de §43.18i, los `{placeholders}` iguales en los dos idiomas, las claves que
 * se mudaron a `addresses.incomplete.*` (CA-5: una sola fuente de palabras) AUSENTES en `shipments.*`, y
 * `checkout.guest.phoneHelp` retirada (el invitado usa `addresses.phoneHint`).
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

const KEYS = [
  'addresses.line2',
  'addresses.line2TooLong',
  'addresses.references',
  'addresses.referencesHint',
  'addresses.referencesTooLong',
  'addresses.phoneHint',
  'addresses.postalCodeInvalid',
  'addresses.phoneInvalid',
  'addresses.geo.cpHint',
  'addresses.geo.cpFirst',
  'addresses.geo.loading',
  'addresses.geo.placeholder',
  'addresses.geo.failed',
  'addresses.geo.neighborhoodRequired',
  'addresses.geo.cityState',
  'addresses.geo.noData',
  // v4.19 (§43.18m.8): la colonia como Mercado Libre.
  'addresses.city',
  'addresses.state',
  'addresses.geo.notListedCta',
  'addresses.geo.typeInstead',
  'addresses.geo.backToList',
  'addresses.geo.manualHint',
  'addresses.geo.cpNotInCatalog',
  'addresses.geo.manualAllIntro',
  'addresses.geo.statePlaceholder',
  'addresses.geo.neighborhoodTypeRequired',
  'addresses.geo.cityRequired',
  'addresses.geo.stateRequired',
  'addresses.geo.tooLong',
  'admin.m4.tracking.sdx.address.manualMark',
  'admin.m4.tracking.sdx.address.manualCityStateMark',
  'admin.m4.tracking.sdx.address.manualReview.neighborhood',
  'admin.m4.tracking.sdx.address.manualReview.all',
  'admin.m4.tracking.sdx.address.notListedCta',
  'admin.m4.tracking.sdx.address.backToList',
  'admin.m4.tracking.sdx.address.neighborhoodManualLabel',
  'admin.m4.tracking.sdx.address.field.city',
  'admin.m4.tracking.sdx.address.field.state',
  'admin.m4.tracking.sdx.address.cpUnknown',
  'admin.m4.tracking.sdx.address.hint.postalCode',
  'addresses.incomplete.row',
  'addresses.incomplete.rowMissing',
  'addresses.incomplete.cta',
  'addresses.incomplete.missing.neighborhood',
  'addresses.incomplete.missing.postalCode',
  'addresses.incomplete.missing.phone',
  'addresses.incomplete.and',
  'addresses.incomplete.formIntro',
  'addresses.incomplete.formIntroGeneric',
  'shipments.addressIncomplete.required',
  'shipments.addressIncomplete.generic',
  'shipments.addressIncomplete.cta',
  'shipments.addressIncomplete.notCharged',
  'shipments.addressIncomplete.saved',
  'error.ADDRESS_INCOMPLETE',
];

const placeholders = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort();

describe('UX-ADR-7 · textos de la dirección del cliente (§43.18i)', () => {
  it.each(KEYS)('%s existe en ES y EN, con los mismos placeholders', (key) => {
    expect(ES[key], `es: ${key}`).toBeTruthy();
    expect(EN[key], `en: ${key}`).toBeTruthy();
    expect(placeholders(EN[key])).toEqual(placeholders(ES[key]));
  });

  /**
   * UX-ADR-7 (ampliado v4.19, `HECHOS.md:57`): el remedio de la colonia ya no es una persona sino escribirla.
   * Las copias de «Escríbenos» de la colonia y los textos de los `422` retirados (§M4-SHIP.19.25.1, C-2) no
   * existen; ningún valor bajo `addresses.geo.*` remite a `{contact}`.
   */
  it('UX-ADR-7 · sin «Escríbenos» en la colonia: claves retiradas ausentes y ningún `{contact}` en `addresses.geo.*`', () => {
    for (const d of [ES, EN]) {
      for (const gone of [
        'addresses.geo.cpUnknown',
        'addresses.geo.notListed',
        'addresses.geo.noNeighborhoods',
        'addresses.geo.notInCp',
        'error.NEIGHBORHOOD_NOT_IN_POSTAL_CODE',
        'error.POSTAL_CODE_UNKNOWN',
        'admin.m4.tracking.sdx.address.neighborhoodNotInCp',
      ]) {
        expect(d[gone], gone).toBeUndefined();
      }
      const geo = Object.entries(d).filter(([k]) => k.startsWith('addresses.geo.'));
      expect(geo.length).toBeGreaterThan(10);
      for (const [k, v] of geo) expect(v, k).not.toContain('{contact}');
    }
  });

  it('las palabras de lo que falta viven en UNA sola fuente: `shipments.addressIncomplete.missing`/`.and` no existen', () => {
    for (const d of [es, en] as Array<{ shipments: { addressIncomplete: Record<string, unknown> } }>) {
      expect(d.shipments.addressIncomplete).not.toHaveProperty('missing');
      expect(d.shipments.addressIncomplete).not.toHaveProperty('and');
    }
    for (const d of [ES, EN]) {
      expect(Object.keys(d).filter((k) => k.startsWith('shipments.addressIncomplete.missing'))).toEqual([]);
    }
  });

  it('`checkout.guest.phoneHelp` retirada (el invitado usa `addresses.phoneHint`)', () => {
    expect(ES['checkout.guest.phoneHelp']).toBeUndefined();
    expect(EN['checkout.guest.phoneHelp']).toBeUndefined();
  });

  it('el bloque del retiro ya no dice «no se cobró nada» (aparece antes de pagar, §43.18h.1)', () => {
    expect(ES['shipments.addressIncomplete.required']).not.toMatch(/cobr/);
    expect(ES['shipments.addressIncomplete.generic']).not.toMatch(/cobr/);
    expect(EN['shipments.addressIncomplete.required']).not.toMatch(/charged/);
    expect(EN['shipments.addressIncomplete.generic']).not.toMatch(/charged/);
  });
});
