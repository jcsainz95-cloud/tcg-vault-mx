/**
 * ⭐ v1.80.7 (§3): `withdrawableReason` sale del MISMO cuerpo que `withdrawable`. Cinco motivos, el orden y el
 * invariante `withdrawable === (withdrawableReason === null)` — sobre la función pura, sobre los fixtures y sobre
 * lo que el servidor falso devuelve por `GET /vault/holdings`.
 */
import { describe, expect, it } from 'vitest';
import { withdrawabilityOf, withdrawableReasonOf, type WithdrawabilityInput } from './holding-withdrawable';
import { mockHoldings } from './fixtures';
import { getHoldings } from '@/lib/api';

const OK: WithdrawabilityInput = {
  ownershipStatus: 'settled',
  status: 'in_custody',
  shipmentState: null,
  replacementOpen: false,
  originRefunded: false,
};

describe('withdrawableReasonOf · los cinco motivos, en el orden del contrato', () => {
  it('retirable ⇒ null', () => expect(withdrawableReasonOf(OK)).toBeNull());
  it('`pending` ⇔ no liquidada (y manda sobre todo lo demás)', () => {
    expect(withdrawableReasonOf({ ...OK, ownershipStatus: 'pending' })).toBe('pending');
    expect(withdrawableReasonOf({ ...OK, ownershipStatus: 'pending', shipmentState: 'picking', originRefunded: true })).toBe('pending');
  });
  it('`replacing` ⇔ fuera de custodia CON caso abierto', () => {
    expect(withdrawableReasonOf({ ...OK, status: 'lost', replacementOpen: true })).toBe('replacing');
  });
  it('`not_in_custody` ⇔ fuera de custodia SIN caso', () => {
    expect(withdrawableReasonOf({ ...OK, status: 'lost' })).toBe('not_in_custody');
  });
  it('`in_withdrawal` ⇔ envío activo (antes que `origin_refunded`)', () => {
    expect(withdrawableReasonOf({ ...OK, shipmentState: 'guia' })).toBe('in_withdrawal');
    expect(withdrawableReasonOf({ ...OK, shipmentState: 'guia', originRefunded: true })).toBe('in_withdrawal');
  });
  it('`origin_refunded` ⇔ la compra de origen se está reembolsando', () => {
    expect(withdrawableReasonOf({ ...OK, originRefunded: true })).toBe('origin_refunded');
  });
});

describe('invariante `withdrawable === (withdrawableReason === null)`', () => {
  const cases: WithdrawabilityInput[] = [
    OK,
    { ...OK, ownershipStatus: 'pending' },
    { ...OK, status: 'lost', replacementOpen: true },
    { ...OK, status: 'damaged' },
    { ...OK, shipmentState: 'enviado' },
    { ...OK, originRefunded: true },
  ];
  it.each(cases.map((c, i) => [i, c] as const))('caso %i', (_i, c) => {
    const w = withdrawabilityOf(c);
    expect(w.withdrawable).toBe(w.withdrawableReason === null);
  });
  it('los fixtures estáticos de «Mi bóveda» lo cumplen', () => {
    for (const h of mockHoldings) expect(h.withdrawable).toBe(h.withdrawableReason === null);
  });
  it('lo que el servidor falso devuelve por GET /vault/holdings lo cumple, holding a holding', async () => {
    const { data } = await getHoldings();
    expect(data.length).toBeGreaterThan(0);
    for (const h of data) {
      expect(h).toHaveProperty('withdrawableReason'); // clave SIEMPRE presente
      expect(h.withdrawable).toBe(h.withdrawableReason === null);
    }
  });
});
