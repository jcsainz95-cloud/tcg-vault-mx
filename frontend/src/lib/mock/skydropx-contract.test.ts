import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as api from '@/lib/api';
import { config } from '@/lib/config';
import { mockAdminShipments } from './fixtures';
import { mockDecorateAdminShipment, mockPutShippingPackages, mockSearchConsignmentNotes, mockShippingPackages, resetMockSkydropx } from './skydropx';
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
