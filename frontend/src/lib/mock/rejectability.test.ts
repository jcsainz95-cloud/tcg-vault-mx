import { describe, it, expect } from 'vitest';
import { mockAdminBuylist, mockAdminBuylistDTO, type MockAdminBuylistRow } from './fixtures';
import { rejectBuylistRequest } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { CardDTO, SellItemDTO, SellRequestStatus } from '@/types/contract';

/**
 * v1.82.3 · contrato §PNL.12.1 (Regla C) y §PNL.12.3 — el servidor falso deriva `isRejectable` porque en modo mock no
 * hay backend que lo haga, y M5 enciende «Rechazar solicitud» con ese booleano.
 *
 * ```
 * Línea que CUENTA  :=  offerDecision IS NULL  OR  offerDecision <> 'skip'
 * Regla C           :=  ∃ ≥1 línea que cuenta  ∧  toda línea que cuenta tiene itemStatus = 'rechazada'
 * isRejectable      :=  isTerminal === false  ∧  Regla C
 * ```
 * Los casos son los de SKP-1/3/4/5 del backend traídos al mock, más los dos bordes (0 líneas que cuentan, terminal).
 * La guarda de `POST …/reject` del mock usa la MISMA regla (y el `details` de §PNL.12.1 b).
 */
const card: CardDTO = {
  id: 'c-r', externalId: 'c-r', name: 'Charizard', number: '4', rarity: 'Rare Holo', supertype: 'Pokémon', subtypes: [],
  setId: 'base1', setName: 'Base Set', setPtcgoCode: null, imageSmallUrl: '', imageLargeUrl: '', availableFinishes: ['normal'],
};
function line(id: string, offerDecision: 'buy' | 'skip' | null, itemStatus: SellItemDTO['itemStatus']): SellItemDTO {
  return { id, card, productType: 'raw', finish: 'normal', itemStatus, offerDecision };
}
function row(items: SellItemDTO[], status: SellRequestStatus = 'verificacion', id = 'sr-rejectability'): MockAdminBuylistRow {
  return {
    id, userId: 'u-r', status, quotedTotalCents: 30000, createdAt: '2026-09-01T09:00:00Z', items,
    receivedAt: '2026-09-02T00:00:00Z', verifiedAt: '2026-09-03T00:00:00Z', approvedTotalCents: null,
    offerSentAt: items.some((it) => it.offerDecision != null) ? '2026-09-01T10:00:00Z' : null,
  };
}
const isRejectable = (r: MockAdminBuylistRow) => mockAdminBuylistDTO(r).isRejectable;

describe('servidor falso · `isRejectable` (§PNL.12, Regla C)', () => {
  it('SKP-1/3 · `buy` todas rechazadas + `skip` viva ⇒ true (la `skip` no cuenta)', () => {
    expect(isRejectable(row([line('a', 'buy', 'rechazada'), line('b', 'buy', 'rechazada'), line('s', 'skip', 'recibida')]))).toBe(true);
  });
  it('SKP-4 · una `buy` aprobada ⇒ false aunque la otra esté rechazada y haya `skip`', () => {
    expect(isRejectable(row([line('a', 'buy', 'aprobada'), line('b', 'buy', 'rechazada'), line('s', 'skip', 'recibida')]))).toBe(false);
  });
  it('SKP-5 · pre-ciclo (`offerDecision` null) ⇒ las null CUENTAN: 1 de 2 rechazada ⇒ false; 2 de 2 ⇒ true', () => {
    expect(isRejectable(row([line('a', null, 'rechazada'), line('b', null, 'recibida')]))).toBe(false);
    expect(isRejectable(row([line('a', null, 'rechazada'), line('b', null, 'rechazada')]))).toBe(true);
  });
  it('0 líneas que cuentan (solo `skip`, o sin líneas) ⇒ false', () => {
    expect(isRejectable(row([line('s', 'skip', 'rechazada')]))).toBe(false);
    expect(isRejectable(row([]))).toBe(false);
  });
  it('terminal ⇒ false aunque cumpla la Regla C', () => {
    expect(isRejectable(row([line('a', 'buy', 'rechazada')], 'expirada'))).toBe(false);
    expect(isRejectable(row([line('a', 'buy', 'rechazada')], 'rechazada'))).toBe(false);
  });
});

describe('servidor falso · `POST /admin/buylist/:id/reject` usa la Regla C (§PNL.12.1 b)', () => {
  async function withRow<T>(r: MockAdminBuylistRow, fn: () => Promise<T>): Promise<T> {
    mockAdminBuylist.push(r);
    try {
      return await fn();
    } finally {
      mockAdminBuylist.splice(mockAdminBuylist.indexOf(r), 1);
    }
  }

  it('SKP-3 · fila atorada (`buy` rechazadas + `skip` viva) ⇒ cierra `rechazada`; la `skip` intacta', async () => {
    const r = row([line('a', 'buy', 'rechazada'), line('s', 'skip', 'recibida')], 'verificacion', 'sr-skp3');
    const dto = await withRow(r, () => rejectBuylistRequest('sr-skp3'));
    expect(dto.status).toBe('rechazada');
    expect(dto.isRejectable).toBe(false);
    expect(dto.items.find((it) => it.id === 's')).toMatchObject({ itemStatus: 'recibida' });
    expect(dto.items.find((it) => it.id === 's')?.rejectedAt).toBeUndefined();
  });

  it('SKP-4 · `422 REQUEST_HAS_NON_REJECTED_ITEMS` lista SOLO los estados de líneas que cuentan', async () => {
    const r = row([line('a', 'buy', 'aprobada'), line('b', 'buy', 'rechazada'), line('s', 'skip', 'recibida')], 'verificacion', 'sr-skp4');
    const err = await withRow(r, () => rejectBuylistRequest('sr-skp4').then(() => null, (e: unknown) => e));
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).status).toBe(422);
    expect((err as ApiClientError).code).toBe('REQUEST_HAS_NON_REJECTED_ITEMS');
    expect((err as ApiClientError).details).toEqual({ nonRejectedItemStatuses: ['aprobada'] });
    expect(r.status).toBe('verificacion');
  });

  it('0 líneas que cuentan ⇒ `422` con los estados de TODAS (fail-closed)', async () => {
    const r = row([line('s', 'skip', 'recibida')], 'verificacion', 'sr-skp0');
    const err = await withRow(r, () => rejectBuylistRequest('sr-skp0').then(() => null, (e: unknown) => e));
    expect((err as ApiClientError).status).toBe(422);
    expect((err as ApiClientError).details).toEqual({ nonRejectedItemStatuses: ['recibida'] });
    expect(r.status).toBe('verificacion');
  });
});
