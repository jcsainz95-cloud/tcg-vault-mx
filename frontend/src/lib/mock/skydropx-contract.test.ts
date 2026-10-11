import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as api from '@/lib/api';
import { config } from '@/lib/config';
import { mockAdminShipments } from './fixtures';
import { mockCorrectAddress, mockDecorateAdminShipment, mockPutShippingPackages, mockSearchConsignmentNotes, mockShippingPackages, resetMockSkydropx } from './skydropx';
import { ApiFixtureError } from './fixtures';

/** El servidor falso y la rama real hablan las formas de `API_CONTRACT §M4-SHIP.19.22` (v1.80.12.2). */

beforeEach(() => {
  vi.restoreAllMocks();
  resetMockSkydropx();
});

describe('§19.22.2 · `address.missing` siempre presente y en orden fijo', () => {
  it('completa ⇒ `[]` y `complete:true`; incompleta ⇒ la lista en el orden del contrato', () => {
    const base = { ...mockAdminShipments[1], addressSnapshot: { recipientName: 'A', line1: 'C', neighborhood: 'N', city: 'c', state: 's', postalCode: '03100', country: 'MX', phone: '5551234567' } };
    expect(mockDecorateAdminShipment(base).address).toMatchObject({ complete: true, missing: [] });
    const bad = { ...base, addressSnapshot: { ...base.addressSnapshot, recipientName: '', neighborhood: null, phone: '123' } };
    expect(mockDecorateAdminShipment(bad).address).toMatchObject({ complete: false, missing: ['recipientName', 'neighborhood', 'phone'] });
  });
});

describe('§19.22.3 · formas de respuesta', () => {
  it('consignment-notes ⇒ `{ consignmentNotes, hasMore }`; descripción fuera de 3..60 ⇒ 400 {field:description}', () => {
    expect(mockSearchConsignmentNotes('colecc')).toEqual({ consignmentNotes: [{ code: '49101600', description: 'Coleccionables' }], hasMore: false });
    expect(() => mockSearchConsignmentNotes('ab')).toThrow(ApiFixtureError);
    try {
      mockSearchConsignmentNotes('ab');
    } catch (e) {
      expect(e).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', details: { field: 'description' } });
    }
  });
  it('PUT packages sin activo con código ⇒ 400 (⛔ no 422) {field:packages, reason:no_active_package}', () => {
    const all = mockShippingPackages().map((p) => ({ ...p, active: false }));
    try {
      mockPutShippingPackages(all);
      expect.unreachable();
    } catch (e) {
      expect(e).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', details: { field: 'packages', reason: 'no_active_package' } });
    }
  });
  it('rama real: `searchConsignmentNotes` devuelve el objeto del servidor tal cual', async () => {
    const original = config.useMocks;
    config.useMocks = false;
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ consignmentNotes: [], hasMore: true }) } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(api.searchConsignmentNotes('cartas')).resolves.toEqual({ consignmentNotes: [], hasMore: true });
      expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/admin\/shipping\/catalogs\/consignment-notes\?description=cartas$/);
    } finally {
      config.useMocks = original;
      vi.unstubAllGlobals();
    }
  });
});

describe('§19.23.4 (errata v1.80.12.3) · `line2` 0..200 en «Capturar guía»', () => {
  it('el doble acepta 200 y rechaza 201 con `400 {field:line2}` — la cota del validador compartido', () => {
    const row = mockAdminShipments.find((r) => r.status === 'picking')!;
    const body = {
      expectedAddressVersion: 0,
      recipientName: 'Ana',
      line1: 'Calle 1',
      postalCode: '03100',
      neighborhood: 'Del Valle',
      city: 'Benito Juárez',
      state: 'Ciudad de México',
      references: null,
    };
    try {
      mockCorrectAddress(row, { ...body, line2: 'x'.repeat(201) });
      expect.unreachable();
    } catch (e) {
      expect(e).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', details: { field: 'line2' } });
    }
    const ok = mockCorrectAddress(row, { ...body, line2: 'x'.repeat(200) });
    expect(ok.shipment.addressSnapshot?.line2).toBe('x'.repeat(200));
  });
});

/**
 * §M4-SHIP.19.25 (v1.80.12.5) en el doble del servidor: `PUT …/address` con `resolveAddressGeo` (⛔ nunca
 * `422` por geografía) y `address.neighborhoodCheck` calculado AL LEER. El modo mock de Playwright corre contra
 * este doble: si volviera a lanzar `422`, el E2E de «colonia escrita» no mediría nada.
 */
describe('§19.25 · el doble resuelve la colonia sin rechazar y calcula `neighborhoodCheck` al leer', () => {
  const base = { expectedAddressVersion: 0, recipientName: 'Ana', line1: 'Calle 1', line2: null, references: null };
  it('(a) colonia de la lista en minúsculas ⇒ canónica, y municipio/estado del CP aunque el cuerpo traiga otros', () => {
    resetMockSkydropx();
    const row = mockAdminShipments.find((r) => r.status === 'picking')!;
    const res = mockCorrectAddress(row, { ...base, postalCode: '44100', neighborhood: 'americana', city: 'Otra', state: 'Otro' });
    expect(res.shipment.addressSnapshot).toMatchObject({ neighborhood: 'Americana', city: 'Guadalajara', state: 'Jalisco' });
    expect(res.shipment.address?.neighborhoodCheck).toBe('in_catalog');
  });
  it('(b) CP del catálogo + colonia que no está ⇒ `corrected`, colonia tal cual (trim), municipio/estado del CP', () => {
    resetMockSkydropx();
    const row = mockAdminShipments.find((r) => r.status === 'picking')!;
    const res = mockCorrectAddress(row, { ...base, postalCode: '44100', neighborhood: '  Fracc. Los Pinos ', city: 'X', state: 'Y' });
    expect(res.outcome).toBe('corrected');
    expect(res.shipment.addressSnapshot).toMatchObject({ neighborhood: 'Fracc. Los Pinos', city: 'Guadalajara', state: 'Jalisco' });
    expect(res.shipment.address?.neighborhoodCheck).toBe('not_in_postal_code_list');
  });
  it('(c) CP fuera del catálogo ⇒ `corrected` con colonia, municipio y estado del cuerpo', () => {
    resetMockSkydropx();
    const row = mockAdminShipments.find((r) => r.status === 'picking')!;
    const res = mockCorrectAddress(row, { ...base, postalCode: '20000', neighborhood: 'Zona Centro', city: 'Aguascalientes', state: 'Aguascalientes' });
    expect(res.outcome).toBe('corrected');
    expect(res.shipment.addressSnapshot).toMatchObject({ postalCode: '20000', neighborhood: 'Zona Centro', city: 'Aguascalientes', state: 'Aguascalientes' });
    expect(res.shipment.address?.neighborhoodCheck).toBe('postal_code_not_in_catalog');
  });
  it('(d) `city` o `state` vacíos ⇒ `400 {field}` y versión intacta', () => {
    resetMockSkydropx();
    const row = mockAdminShipments.find((r) => r.status === 'picking')!;
    for (const field of ['city', 'state'] as const) {
      try {
        mockCorrectAddress(row, { ...base, postalCode: '20000', neighborhood: 'Zona Centro', city: 'A', state: 'B', [field]: '  ' });
        expect.unreachable();
      } catch (e) {
        expect(e).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', details: { field } });
      }
    }
    expect(mockDecorateAdminShipment(row).address?.version).toBe(0);
  });
});
