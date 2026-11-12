import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config';
import * as client from '../api-client';
import { REOFFER_STATUSES, conditionsAtLeast, paySupplyPurchase, searchSupplyCards } from './suppliers';

afterEach(() => {
  vi.restoreAllMocks();
  config.useMocks = true;
});

describe('§PROV · cliente de proveedores', () => {
  it('B2: el buscador de carta usa /buylist/cards (todo el catálogo, no solo con stock)', async () => {
    config.useMocks = false;
    const req = vi.spyOn(client, 'apiRequest').mockResolvedValue({
      data: [{ id: 'c1', name: 'Erika', number: '6', setName: 'ASC', imageSmallUrl: 'u', availableFinishes: ['holofoil'] }],
    });
    const hits = await searchSupplyCards(' Erika ');
    expect(req).toHaveBeenCalledWith('/buylist/cards', { query: { q: 'Erika', page: 1, pageSize: 12 } });
    expect(hits).toEqual([{ cardId: 'c1', name: 'Erika', number: '6', setName: 'ASC', imageUrl: 'u', finishes: ['holofoil'] }]);
  });

  it('no busca con menos de 2 letras', async () => {
    config.useMocks = false;
    const req = vi.spyOn(client, 'apiRequest');
    expect(await searchSupplyCards('e')).toEqual([]);
    expect(req).not.toHaveBeenCalled();
  });

  it('un reintento reutiliza la misma Idempotency-Key y otra acción usa otra', async () => {
    config.useMocks = false;
    const req = vi.spyOn(client, 'apiRequest').mockResolvedValue({});
    await paySupplyPurchase('p1', { method: 'cash' }, 'k-1');
    await paySupplyPurchase('p1', { method: 'cash' }, 'k-1');
    await paySupplyPurchase('p2', { method: 'cash' });
    const keys = req.mock.calls.map((c) => (c[1] as { headers: Record<string, string> }).headers['Idempotency-Key']);
    expect(keys[0]).toBe('k-1');
    expect(keys[1]).toBe('k-1');
    expect(keys[2]).not.toBe('k-1');
  });

  it('solo se ofrecen estados iguales o mejores que el mínimo', () => {
    expect(conditionsAtLeast('NM')).toEqual(['NM']);
    expect(conditionsAtLeast('MP')).toEqual(['NM', 'LP', 'MP']);
  });

  it('IMP3: se puede ofrecer de nuevo tras retirar, rechazo o vencimiento, no con oferta viva', () => {
    expect([...REOFFER_STATUSES].sort()).toEqual(['expired', 'rejected', 'withdrawn']);
  });
});
