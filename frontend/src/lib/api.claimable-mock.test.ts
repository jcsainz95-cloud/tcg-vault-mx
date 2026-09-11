import { describe, it, expect, beforeEach } from 'vitest';
import { claimGuestOrders, getClaimableOrders } from './api';
import { mockClaimableOrders } from './mock/fixtures';

/**
 * Rama MOCK de `GET /orders/claimable` / `POST /orders/claim` (v1.67, zona `lib/` de A1):
 * - Por defecto `[]` — es lo que el candado CA-4 (§33.16 R10) mide en los E2E de fixtures.
 * - Con `localStorage['tcg.mock.claimable']='1'` sirve el fixture; reclamar vacía el pool y la
 *   siguiente consulta (aun tras recargar: se anota en `tcg.mock.claimed`) ya no los trae.
 * - Parcial-tolerante como el contrato: un id fuera del pool vuelve en `failed` con `NOT_FOUND`.
 */
describe('api · mocks de pedidos reclamables', () => {
  beforeEach(() => window.localStorage.clear());

  it('sin bandera devuelve [] (CA-4: cero nodos)', async () => {
    expect(await getClaimableOrders()).toEqual([]);
  });

  it('con bandera devuelve el fixture; reclamar uno lo saca del pool y persiste entre "recargas"', async () => {
    window.localStorage.setItem('tcg.mock.claimable', '1');
    const before = await getClaimableOrders();
    expect(before.map((o) => o.orderId)).toEqual(mockClaimableOrders.map((o) => o.orderId));

    const res = await claimGuestOrders([before[0].orderId, 'ord-inexistente']);
    expect(res).toEqual({ claimed: [before[0].orderId], failed: [{ orderId: 'ord-inexistente', code: 'NOT_FOUND' }] });

    const after = await getClaimableOrders();
    expect(after.map((o) => o.orderId)).toEqual(mockClaimableOrders.slice(1).map((o) => o.orderId));
    // «Recarga»: el pool se reconstruye desde localStorage, sin el reclamado.
    expect(JSON.parse(window.localStorage.getItem('tcg.mock.claimed')!)).toEqual([before[0].orderId]);

    await claimGuestOrders(after.map((o) => o.orderId));
    expect(await getClaimableOrders()).toEqual([]);
  });

  it('el fixture no se muta al servir ni al reclamar', async () => {
    window.localStorage.setItem('tcg.mock.claimable', '1');
    const n = mockClaimableOrders.length;
    await claimGuestOrders(mockClaimableOrders.map((o) => o.orderId));
    expect(mockClaimableOrders).toHaveLength(n);
  });
});
