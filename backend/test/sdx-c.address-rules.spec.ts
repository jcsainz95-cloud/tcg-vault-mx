/**
 * sdx-c.address-rules.spec.ts — fase C (M-64): las piezas PURAS de la dirección (API_CONTRACT §M4-SHIP.19.5 y
 * §19.20.1). Sin BD: `PostalCodeService` real sobre una fuente en memoria (`fakePostalCodes`).
 */
import { normalizeColonia, PostalCodeService } from '../src/modules/shipping-provider/geo/postal-code';
import { addressMissing, isAddressComplete } from '../src/modules/users/address-rules';
import { labelSourceOf, parseCorrectAddressBody } from '../src/modules/shipments/shipment-address.service';
import { fakePostalCodes, MemoryPostalCodeSource } from './helpers/fake-postal-codes';

const err = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    if (typeof p === 'function') p();
    else await p;
  } catch (e) {
    return e as { code: string; getStatus(): number; details: Record<string, unknown> };
  }
  throw new Error('no lanzó');
};

describe('normalizeColonia (§19.5: trim + colapso de espacios + MAYÚSCULAS sin acentos)', () => {
  it.each([
    ['  san   ángel ', 'SAN ANGEL'],
    ['Juárez', 'JUAREZ'],
    ['juarez', 'JUAREZ'],
    ['Jardines\tde la\nMontaña', 'JARDINES DE LA MONTANA'],
  ])('%j ⇒ %j', (a, b) => expect(normalizeColonia(a)).toBe(b));
});

describe('PostalCodeService — EL cuerpo que sirve el GET y valida (C-SDX-3)', () => {
  const svc = fakePostalCodes();

  it('canonicalize: la colonia tecleada se guarda como el CANÓNICO, con city = municipio y state del CP', async () => {
    await expect(svc.canonicalize('01000', ' san angel ')).resolves.toEqual({
      postalCode: '01000',
      neighborhood: 'San Ángel',
      city: 'Álvaro Obregón',
      state: 'Ciudad de México',
    });
  });

  it('fuera de la lista ⇒ 422 NEIGHBORHOOD_NOT_IN_POSTAL_CODE {postalCode, allowed}', async () => {
    const e = await err(svc.canonicalize('06600', 'Polanco'));
    expect(e.code).toBe('NEIGHBORHOOD_NOT_IN_POSTAL_CODE');
    expect(e.getStatus()).toBe(422);
    expect(e.details).toEqual({ postalCode: '06600', allowed: ['Juárez', 'Roma Norte'] });
  });

  it('CP sin colonias ⇒ 422 POSTAL_CODE_UNKNOWN; CP mal formado ⇒ ni siquiera consulta la fuente', async () => {
    const e = await err(svc.canonicalize('99999', 'Centro'));
    expect({ code: e.code, status: e.getStatus(), details: e.details }).toEqual({ code: 'POSTAL_CODE_UNKNOWN', status: 422, details: { postalCode: '99999' } });
    const src = new MemoryPostalCodeSource();
    const s2 = new PostalCodeService([src]);
    await expect(s2.resolvePostalCode('0660')).resolves.toBeNull();
    expect(src.calls).toEqual([]);
  });

  it('describe (el GET): forma del contrato; 400 si no son 5 dígitos; 404 POSTAL_CODE_UNKNOWN si nadie lo conoce', async () => {
    await expect(svc.describe('06600')).resolves.toEqual({
      postalCode: '06600',
      state: 'Ciudad de México',
      municipality: 'Cuauhtémoc',
      neighborhoods: ['Juárez', 'Roma Norte'],
      source: 'local',
    });
    expect((await err(svc.describe('abcde'))).getStatus()).toBe(400);
    const e = await err(svc.describe('99999'));
    expect({ code: e.code, status: e.getStatus() }).toEqual({ code: 'POSTAL_CODE_UNKNOWN', status: 404 });
  });

  it('precedencia de fuentes: la primera que conoce el CP gana; la segunda solo si la primera no lo tiene', async () => {
    const a = new MemoryPostalCodeSource({ '06600': [{ neighborhood: 'Juárez', municipality: 'A', state: 'S' }] });
    const b = new MemoryPostalCodeSource({ '06600': [{ neighborhood: 'Otra', municipality: 'B', state: 'S' }], '44100': [{ neighborhood: 'Centro', municipality: 'GDL', state: 'JAL' }] });
    const s = new PostalCodeService([a, b]);
    expect((await s.describe('06600')).municipality).toBe('A');
    expect((await s.describe('44100')).municipality).toBe('GDL');
  });
});

describe('addressMissing / complete (§19.5)', () => {
  it('completa ⇔ colonia no vacía ∧ CP de 5 ∧ teléfono de 10; `missing` en orden del contrato', () => {
    expect(addressMissing({ neighborhood: 'Centro', postalCode: '01000', phone: '5512345678' })).toEqual([]);
    expect(isAddressComplete({ neighborhood: 'Centro', postalCode: '01000', phone: '5512345678' })).toBe(true);
    expect(addressMissing({ neighborhood: '  ', postalCode: '1000', phone: '55' })).toEqual(['neighborhood', 'postalCode', 'phone']);
    expect(addressMissing({ neighborhood: null, postalCode: '01000', phone: '5512345678' })).toEqual(['neighborhood']);
    expect(addressMissing({})).toEqual(['neighborhood', 'postalCode', 'phone']);
  });
});

describe('PUT …/address — el cuerpo (§19.20.1: `400 VALIDATION_ERROR {field}` desde el servidor)', () => {
  const ok = { expectedAddressVersion: 0, recipientName: ' Ana ', line1: ' Calle 1 ', line2: '', postalCode: '01000', neighborhood: 'Centro', references: '  ' };

  it('recorta; vacíos opcionales ⇒ null; ignora city/state/phone/country del cuerpo', () => {
    expect(parseCorrectAddressBody({ ...ok, city: 'X', state: 'Y', phone: '1', country: 'US' })).toEqual({
      expectedAddressVersion: 0,
      recipientName: 'Ana',
      line1: 'Calle 1',
      line2: null,
      postalCode: '01000',
      neighborhood: 'Centro',
      references: null,
    });
  });

  it.each([
    ['expectedAddressVersion', { expectedAddressVersion: -1 }],
    ['expectedAddressVersion', { expectedAddressVersion: '0' }],
    ['expectedAddressVersion', { expectedAddressVersion: 1.5 }],
    ['recipientName', { recipientName: '   ' }],
    ['recipientName', { recipientName: 'x'.repeat(121) }],
    ['line1', { line1: undefined }],
    ['line1', { line1: 'x'.repeat(201) }],
    ['line2', { line2: 'x'.repeat(201) }],
    ['postalCode', { postalCode: '0100' }],
    ['postalCode', { postalCode: 1000 }],
    ['neighborhood', { neighborhood: '' }],
    ['references', { references: 'x'.repeat(71) }],
    ['references', { references: 42 }],
  ])('%s inválido ⇒ 400 {field:%s}', async (field, over) => {
    const e = await err(() => parseCorrectAddressBody({ ...ok, ...over }));
    expect({ code: e.code, status: e.getStatus(), field: e.details.field }).toEqual({ code: 'VALIDATION_ERROR', status: 400, field });
  });

  it('las cotas son las de `GuestAddressInput` (line2 ≤ 200, references ≤ 70): 200 y 70 pasan', () => {
    expect(() => parseCorrectAddressBody({ ...ok, line2: 'x'.repeat(200), references: 'y'.repeat(70) })).not.toThrow();
  });
});

describe('labelSourceOf (§19.2, mitad derivada en fase C)', () => {
  it('trackingNumber ⇒ manual; sin él ⇒ null', () => {
    expect(labelSourceOf({ trackingNumber: 'T1' })).toBe('manual');
    expect(labelSourceOf({ trackingNumber: null })).toBeNull();
  });
});

describe('shipmentAddressMissing (v1.80.12.2, §M4-SHIP.19.22.2): recipientName, line1 y luego la regla de la libreta', () => {
  // import tardío para no tocar la cabecera del fichero
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { shipmentAddressMissing } = require('../src/modules/shipments/shipment-address-missing');
  it('completa ⇒ []; orden fijo; blanco cuenta como ausente; no-objeto ⇒ todo', () => {
    expect(shipmentAddressMissing({ recipientName: 'Ana', line1: 'C 1', neighborhood: 'Centro', postalCode: '01000', phone: '5512345678' })).toEqual([]);
    expect(shipmentAddressMissing({ recipientName: ' ', line1: '', neighborhood: 'Centro', postalCode: '01000', phone: '55' })).toEqual(['recipientName', 'line1', 'phone']);
    expect(shipmentAddressMissing(null)).toEqual(['recipientName', 'line1', 'neighborhood', 'postalCode', 'phone']);
    // snapshot legado de 8 campos (sin nombre)
    expect(shipmentAddressMissing({ line1: 'C 1', neighborhood: 'Centro', postalCode: '01000', phone: '5512345678' })).toEqual(['recipientName']);
  });
});
