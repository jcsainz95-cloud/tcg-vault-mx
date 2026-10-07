import { describe, it, expect } from 'vitest';
import { createTranslator } from 'next-intl';
import es from '../../../../../../messages/es.json';
import type { SpendAlertDTO } from '@/types/contract';
import { FACT_WHITELIST, alertText, alertTitle } from './alert-text';

/**
 * 💰 rev BSD-1 — AG-23 «Solicitud de venta sin guía» (DESIGN_SYSTEM §BSD-UX.3 · contrato §BSD.7.2/§BSD.8.3).
 * GAS-4: solo `facts = {sellRequestId, closesAt, offerGrossCents}`; GAS-2/UX-GAS-6: ⛔ PII del vendedor aunque el servidor
 * la colara; la fecha es la del servidor (⛔ «en N días»).
 */
const t = createTranslator({ locale: 'es', messages: es, namespace: 'admin.spendAlerts' }) as unknown as Parameters<typeof alertText>[0];
const ctx = { money: (c: number) => `MX$${(c / 100).toFixed(2)}`, dateTime: (iso: string) => `<${iso}>`, ownerSetting: (k: string) => k };

function ag23(facts: SpendAlertDTO['facts']): SpendAlertDTO {
  return {
    id: 'a1', code: 'AG-23', kind: 'buylist_guide_due', severity: 'immediate', subject: null, shipment: null, order: null, amountCents: null,
    facts, occurrenceCount: 1, firstOccurredAt: '2026-10-10T08:00:00Z', lastOccurredAt: '2026-10-10T08:00:00Z', resolvedAt: null, seen: null,
    mail: { status: 'sent', at: null },
  };
}

describe('AG-23 · texto y lista blanca', () => {
  it('título y frase con folio, fecha de cierre del servidor y bruto; ⛔ nombre/teléfono colados', () => {
    const a = ag23({ sellRequestId: 'sr-1', closesAt: '2026-10-12T14:00:00.000Z', offerGrossCents: 150_000, recipientName: 'Ana', phone: '555' });
    expect(alertTitle(t, a)).toBe('Solicitud de venta sin guía');
    const text = alertText(t, a, ctx);
    expect(text).toBe(
      'La solicitud de venta sr-1 sigue aceptada y sin guía: se cierra sola el <2026-10-12T14:00:00.000Z> si para entonces no tiene guía. Valor de sus cartas en la oferta: MX$1500.00.',
    );
    expect(text).not.toMatch(/Ana|555/);
  });
  it('la lista blanca del detalle gana exactamente sus tres claves', () => {
    for (const k of ['sellRequestId', 'closesAt', 'offerGrossCents']) expect(FACT_WHITELIST as readonly string[]).toContain(k);
    expect(FACT_WHITELIST as readonly string[]).not.toContain('recipientName');
    expect(FACT_WHITELIST as readonly string[]).not.toContain('phone');
  });
});
