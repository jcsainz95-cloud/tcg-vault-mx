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

describe('PostalCodeService — EL cuerpo que sirve el GET y resuelve (C-SDX-3); v1.80.12.5: nunca rechaza por geografía', () => {
  const svc = fakePostalCodes();

  // ⭐ v1.80.12.5 (§M4-SHIP.19.25.1, `HECHOS.md:57`): `resolveAddressGeo` sustituye a `canonicalize`; los cuatro
  // casos, y ⛔ ninguno lanza.
  it('caso 3 · CP en catálogo + colonia que casa (minúsculas, sin acentos, espacios) ⇒ canónico + municipio/estado DE ESA colonia, aunque el cuerpo traiga otros', async () => {
    await expect(svc.resolveAddressGeo('01000', ' san angel ', 'Otra Ciudad', 'Otro Estado')).resolves.toEqual({
      postalCode: '01000',
      neighborhood: 'San Ángel',
      city: 'Álvaro Obregón',
      state: 'Ciudad de México',
      check: 'in_catalog',
    });
  });

  it('caso 4 · CP en catálogo + colonia que NO casa ⇒ la escrita (trim) + municipio/estado DEL CP (los del GET), sin 422', async () => {
    await expect(svc.resolveAddressGeo('06600', '  Polanco  ', 'Miguel Hidalgo', 'Edomex')).resolves.toEqual({
      postalCode: '06600',
      neighborhood: 'Polanco',
      city: 'Cuauhtémoc',
      state: 'Ciudad de México',
      check: 'not_in_postal_code_list',
    });
    // «del CP» = `mostCommon`, lo mismo que pinta `describe` (pantalla y servidor no divergen).
    const mixed = new PostalCodeService([
      new MemoryPostalCodeSource({
        '50000': [
          // el más frecuente (Toluca) no es ni el primero ni el último: una implementación que tome una entrada
          // cualquiera en vez de `mostCommon` sale roja
          { neighborhood: 'A', municipality: 'Metepec', state: 'México' },
          { neighborhood: 'B', municipality: 'Toluca', state: 'México' },
          { neighborhood: 'C', municipality: 'Toluca', state: 'México' },
          { neighborhood: 'D', municipality: 'Zinacantepec', state: 'México' },
        ],
      }),
    ]);
    const d = await mixed.describe('50000');
    const r = await mixed.resolveAddressGeo('50000', 'Nueva', 'X', 'Y');
    expect({ city: r.city, state: r.state }).toEqual({ city: d.municipality, state: d.state });
    expect(r.city).toBe('Toluca');
  });

  it('caso 2 · CP fuera del catálogo ⇒ colonia, city y state tal como vinieron (trim), sin 422', async () => {
    await expect(svc.resolveAddressGeo('20000', ' Zona Centro ', ' Aguascalientes ', ' Aguascalientes ')).resolves.toEqual({
      postalCode: '20000',
      neighborhood: 'Zona Centro',
      city: 'Aguascalientes',
      state: 'Aguascalientes',
      check: 'postal_code_not_in_catalog',
    });
  });

  it('catálogo VACÍO ⇒ todo CP cae en el caso 2 (la tienda vende); CP mal formado ⇒ ni siquiera consulta la fuente', async () => {
    const empty = new PostalCodeService([new MemoryPostalCodeSource({})]);
    await expect(empty.resolveAddressGeo('06600', 'Roma Norte', 'Cuauhtémoc', 'CDMX')).resolves.toMatchObject({
      neighborhood: 'Roma Norte',
      city: 'Cuauhtémoc',
      state: 'CDMX',
      check: 'postal_code_not_in_catalog',
    });
    const src = new MemoryPostalCodeSource();
    const s2 = new PostalCodeService([src]);
    await expect(s2.resolvePostalCode('0660')).resolves.toBeNull();
    expect(src.calls).toEqual([]);
  });

  it('neighborhoodCheckOf (§19.25.3): los tres valores; sin colonia o CP mal formado ⇒ postal_code_not_in_catalog sin consultar', async () => {
    await expect(svc.neighborhoodCheckOf('01000', 'SAN ANGEL')).resolves.toBe('in_catalog');
    await expect(svc.neighborhoodCheckOf('06600', 'Polanco')).resolves.toBe('not_in_postal_code_list');
    await expect(svc.neighborhoodCheckOf('20000', 'Zona Centro')).resolves.toBe('postal_code_not_in_catalog');
    const src = new MemoryPostalCodeSource();
    const s2 = new PostalCodeService([src]);
    await expect(s2.neighborhoodCheckOf('06600', null)).resolves.toBe('postal_code_not_in_catalog');
    await expect(s2.neighborhoodCheckOf('06600', '  ')).resolves.toBe('postal_code_not_in_catalog');
    await expect(s2.neighborhoodCheckOf(undefined, 'Juárez')).resolves.toBe('postal_code_not_in_catalog');
    await expect(s2.neighborhoodCheckOf('0660', 'Juárez')).resolves.toBe('postal_code_not_in_catalog');
    expect(src.calls).toEqual([]);
  });

  it('`canonicalize` ya no existe (una sola función, §19.25.1)', () => {
    expect((svc as unknown as Record<string, unknown>).canonicalize).toBeUndefined();
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
  const ok = { expectedAddressVersion: 0, recipientName: ' Ana ', line1: ' Calle 1 ', line2: '', postalCode: '01000', neighborhood: 'Centro', city: ' Álvaro Obregón ', state: ' CDMX ', references: '  ' };

  it('recorta; vacíos opcionales ⇒ null; ⭐ v1.80.12.5: city/state entran al cuerpo; ignora phone/country', () => {
    expect(parseCorrectAddressBody({ ...ok, phone: '1', country: 'US' })).toEqual({
      expectedAddressVersion: 0,
      recipientName: 'Ana',
      line1: 'Calle 1',
      line2: null,
      postalCode: '01000',
      neighborhood: 'Centro',
      city: 'Álvaro Obregón',
      state: 'CDMX',
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
    ['city', { city: undefined }],
    ['city', { city: '   ' }],
    ['city', { city: 'x'.repeat(121) }],
    ['state', { state: undefined }],
    ['state', { state: '' }],
    ['state', { state: 'x'.repeat(121) }],
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
