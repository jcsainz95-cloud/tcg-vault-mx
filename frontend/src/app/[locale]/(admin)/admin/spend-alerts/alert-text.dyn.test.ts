import { describe, it, expect } from 'vitest';
import { createTranslator } from 'next-intl';
import es from '../../../../../../messages/es.json';
import en from '../../../../../../messages/en.json';
import type { SpendAlertDTO } from '@/types/contract';
import { SPEND_ALERT_CODE_BY_KIND, SPEND_ALERT_SWITCHABLE_CODES } from '@/types/contract';
import { FACT_WHITELIST, alertText, alertTitle } from './alert-text';
import { FILTER_KINDS } from './filters';

/**
 * v1.113⟨portada⟩ — AG-24 `psa_cycle_short` (API_CONTRACT §DYN.4.5, criterio 933/939 d): «con el tope de créditos PSA
 * la vuelta tarda más de 7 días». Solo panel, sin correo y ⛔ no se apaga. `facts` (lista blanca):
 * `{ reason, publishedCards, cycleDays, dailyCreditCap, capToCoverWeek, setsOverCap }`; las cifras salen del servidor
 * tal cual (GAS-4). Mutación que lo pone rojo: quitar el `case 'AG-24'` (cae a la frase genérica) o el kind del filtro.
 */
const tEs = createTranslator({ locale: 'es', messages: es, namespace: 'admin.spendAlerts' }) as unknown as Parameters<typeof alertText>[0];
const tEn = createTranslator({ locale: 'en', messages: en, namespace: 'admin.spendAlerts' }) as unknown as Parameters<typeof alertText>[0];
const ctx = { money: (c: number) => `MX$${c}`, dateTime: (iso: string) => iso, ownerSetting: (k: string) => k, count: (n: number) => n.toLocaleString('en-US') };

function ag24(facts: SpendAlertDTO['facts']): SpendAlertDTO {
  return {
    id: 'a24', code: 'AG-24', kind: 'psa_cycle_short', severity: 'digest', subject: null, shipment: null, order: null, amountCents: null,
    facts, occurrenceCount: 3, firstOccurredAt: '2026-10-29T08:00:00Z', lastOccurredAt: '2026-10-29T20:00:00Z', resolvedAt: null, seen: null,
    mail: { status: 'not_applicable', at: null },
  };
}

const PROJECTED = { reason: 'projected', publishedCards: 11200, cycleDays: 8, dailyCreditCap: 3000, capToCoverWeek: 3200, setsOverCap: 0 };

describe('AG-24 · psa_cycle_short (§DYN.4.5)', () => {
  it('kind ⇔ código AG-24, y NO se apaga', () => {
    expect(SPEND_ALERT_CODE_BY_KIND.psa_cycle_short).toBe('AG-24');
    expect(SPEND_ALERT_SWITCHABLE_CODES).not.toContain('AG-24');
  });

  it('se puede filtrar en la lista («Tipo»)', () => {
    expect(FILTER_KINDS).toContain('psa_cycle_short');
  });

  it('`projected`: título y la frase del ejemplo de PROJECT §DYN.2 con las cifras del servidor', () => {
    const a = ag24(PROJECTED);
    expect(alertTitle(tEs, a)).toBe('Los créditos PSA no alcanzan para la semana');
    expect(alertText(tEs, a, ctx)).toBe(
      'Con 3,000 créditos al día no alcanza para revisar tus 11,200 cartas cada semana: revisarlas todas tardaría 8 días. Para cubrir la semana, sube el tope a 3,200.',
    );
    expect(alertText(tEn, a, ctx)).toMatch(/With 3,000 credits a day .* 11,200 cards .* 8 days\. .* raise the cap to 3,200\./);
  });

  it('`overdue`: otra frase, que dice que una colección lleva más de 8 días', () => {
    const text = alertText(tEs, ag24({ ...PROJECTED, reason: 'overdue', cycleDays: 4, setsOverCap: 2 }), ctx);
    expect(text).toMatch(/más de 8 días sin revisarse/);
    expect(text).toMatch(/tarda 4 días/);
    expect(text).toMatch(/no caben en el tope de un día: 2\./);
  });

  it('`reason` desconocido ⇒ frase genérica (no inventa)', () => {
    expect(alertText(tEs, ag24({ ...PROJECTED, reason: 'banana' }), ctx)).toBe(tEs('kind.generic.text'));
  });

  it('la lista blanca del detalle gana sus seis claves', () => {
    for (const k of ['reason', 'publishedCards', 'cycleDays', 'dailyCreditCap', 'capToCoverWeek', 'setsOverCap']) {
      expect(FACT_WHITELIST as readonly string[]).toContain(k);
    }
  });
});

describe('AG-25 · in_person_with_fee (§PERSONA)', () => {
  const ag25: SpendAlertDTO = {
    id: 'a25', code: 'AG-25', kind: 'in_person_with_fee', severity: 'immediate', subject: { name: 'Ash', role: 'staff' } as never, shipment: { folio: 'ENV-000045' } as never,
    order: null, amountCents: 9900, facts: { shippingFeeChargedCents: 9900, folio: 'ENV-000045', actorUserId: 'u-9', deliveredAt: '2026-11-18T18:00:00Z', fulfillment: 'direct_ship' }, occurrenceCount: 1, firstOccurredAt: '2026-11-18T18:00:00Z',
    lastOccurredAt: '2026-11-18T18:00:00Z', resolvedAt: null, seen: null, mail: { status: 'sent', at: null },
  };
  it('kind ⇔ AG-25, NO se apaga, y se filtra', () => {
    expect(SPEND_ALERT_CODE_BY_KIND.in_person_with_fee).toBe('AG-25');
    expect(SPEND_ALERT_SWITCHABLE_CODES).not.toContain('AG-25');
    expect(FILTER_KINDS).toContain('in_person_with_fee');
  });
  it('título y texto es/en con el flete del servidor, sin datos del cliente', () => {
    expect(alertTitle(tEs, ag25)).toBe('Entrega en persona con envío cobrado');
    expect(alertTitle(tEn, ag25)).toBe('In-person hand-over with shipping charged');
    expect(alertText(tEs, ag25, ctx)).toBe('Ash marcó el envío ENV-000045 como entregado en persona. El cliente pagó MX$9900 de envío; el sistema no lo reembolsa. Si hay que devolverlo, decídelo desde Ventas.');
    expect(alertText(tEn, ag25, ctx)).toBe('Ash marked shipment ENV-000045 as handed over in person. The customer paid MX$9900 for shipping; the system does not refund it. If it should be refunded, decide it from Sales.');
  });
  it('sin folio en facts usa la referencia de siempre', () => {
    expect(alertText(tEs, { ...ag25, facts: { shippingFeeChargedCents: 9900 } }, ctx)).toMatch(/marcó el envío ENV-000045 como/);
  });
});

describe('AG-26 · label_over_customer_quote (§ENV3.8)', () => {
  const ag26: SpendAlertDTO = {
    id: 'a26', code: 'AG-26', kind: 'label_over_customer_quote', severity: 'immediate', subject: null, shipment: { folio: 'ENV-000046' } as never,
    order: null, amountCents: 3500, facts: { costQuotedCents: 21000, costRealCents: 24500, differenceCents: 3500, quotedService: 'FedEx Standard Overnight', boughtService: 'FedEx Express Saver', recipientName: 'No debe verse' }, occurrenceCount: 1, firstOccurredAt: '2026-11-19T18:00:00Z',
    lastOccurredAt: '2026-11-19T18:00:00Z', resolvedAt: null, seen: null, mail: { status: 'sent', at: null },
  };
  it('kind ⇔ AG-26, NO se apaga, y se filtra', () => {
    expect(SPEND_ALERT_CODE_BY_KIND.label_over_customer_quote).toBe('AG-26');
    expect(SPEND_ALERT_SWITCHABLE_CODES).not.toContain('AG-26');
    expect(FILTER_KINDS).toContain('label_over_customer_quote');
  });
  it('título y texto es/en con las cifras del servidor tal cual', () => {
    expect(alertTitle(tEs, ag26)).toBe('Guía más cara que lo cotizado al cliente');
    expect(alertTitle(tEn, ag26)).toBe('Label costs more than quoted to the customer');
    expect(alertText(tEs, ag26, ctx)).toBe('La guía del envío ENV-000046 costó MX$24500 y al cliente se le cotizó MX$21000 (FedEx Standard Overnight); compraste FedEx Express Saver. Diferencia: MX$3500. Es solo un aviso: nada se bloqueó.');
    expect(alertText(tEn, ag26, ctx)).toMatch(/cost MX\$24500 and the customer was quoted MX\$21000 \(FedEx Standard Overnight\); you bought FedEx Express Saver\. Difference: MX\$3500\./);
  });
  it('la lista blanca del detalle gana sus claves y NO la del cliente', () => {
    for (const k of ['costQuotedCents', 'costRealCents', 'differenceCents', 'quotedService', 'boughtService']) {
      expect(FACT_WHITELIST as readonly string[]).toContain(k);
    }
    expect(FACT_WHITELIST as readonly string[]).not.toContain('recipientName');
  });
});

describe('AG-27 / AG-28 (§RETIRO-SALIDA)', () => {
  const base = { subject: null, order: null, amountCents: null, occurrenceCount: 1, firstOccurredAt: '2026-11-19T18:00:00Z', lastOccurredAt: '2026-11-19T18:00:00Z', resolvedAt: null, seen: null, mail: { status: 'not_applicable', at: null } } as const;
  const ag27 = { ...base, id: 'a27', code: 'AG-27', kind: 'manual_label_unshipped', severity: 'digest', shipment: { folio: 'ENV-000050' }, facts: { folio: 'ENV-000050', capturedAt: '2026-11-18T10:00:00Z', hoursSinceCapture: 30, recipientName: 'No debe verse' } } as unknown as SpendAlertDTO;
  const ag28 = { ...base, id: 'a28', code: 'AG-28', kind: 'retiro_parcel_returned', severity: 'immediate', shipment: { folio: 'ENV-000051' }, facts: { folio: 'ENV-000051', carrierStatus: 'in_return', observedAt: '2026-11-19T10:00:00Z', pieceCount: 4 } } as unknown as SpendAlertDTO;
  it('kind ⇔ código, sin interruptor y con filtro', () => {
    expect(SPEND_ALERT_CODE_BY_KIND.manual_label_unshipped).toBe('AG-27');
    expect(SPEND_ALERT_CODE_BY_KIND.retiro_parcel_returned).toBe('AG-28');
    expect(SPEND_ALERT_SWITCHABLE_CODES).not.toContain('AG-27');
    expect(SPEND_ALERT_SWITCHABLE_CODES).not.toContain('AG-28');
    expect(FILTER_KINDS).toContain('manual_label_unshipped');
    expect(FILTER_KINDS).toContain('retiro_parcel_returned');
  });
  it('título y cuerpo es/en con los facts', () => {
    expect(alertTitle(tEs, ag27)).toBe('Guía capturada sin marcar enviado');
    expect(alertTitle(tEn, ag28)).toBe('Vault withdrawal parcel returned');
    expect(alertText(tEs, ag27, ctx)).toMatch(/ENV-000050 tiene guía capturada a mano desde hace 30 h/);
    expect(alertText(tEn, ag27, ctx)).toMatch(/Shipment ENV-000050 has had a hand-entered label for 30 h/);
    expect(alertText(tEs, ag28, ctx)).toMatch(/ENV-000051 viene de regreso \(in_return\).*las 4 cartas/);
    expect(alertText(tEn, ag28, ctx)).toMatch(/Shipment ENV-000051 is on its way back \(in_return\).*the 4 cards/);
  });
  it('AG-29: kind, sin interruptor, filtro y texto es/en', () => {
    const ag29 = { ...base, id: 'a29', code: 'AG-29', kind: 'return_received_by_non_owner', severity: 'immediate', shipment: { folio: 'ENV-000052' }, facts: { folio: 'ENV-000052', actorUserId: 'u1', restored: 3, returnedAt: '2026-11-19T10:00:00Z' } } as unknown as SpendAlertDTO;
    expect(SPEND_ALERT_CODE_BY_KIND.return_received_by_non_owner).toBe('AG-29');
    expect(SPEND_ALERT_SWITCHABLE_CODES).not.toContain('AG-29');
    expect(FILTER_KINDS).toContain('return_received_by_non_owner');
    expect(alertTitle(tEs, ag29)).toBe('Personal confirmó la devolución de un retiro');
    expect(alertText(tEs, ag29, ctx)).toMatch(/ENV-000052: personal confirmó la devolución de un retiro y 3 cartas volvieron/);
    expect(alertText(tEn, ag29, ctx)).toMatch(/ENV-000052: staff confirmed a returned withdrawal; 3 cards went back/);
    expect(alertText(tEn, ag28, ctx)).toMatch(/press «We received the return»/);
  });
  it('lista blanca: sin PII', () => {
    for (const k of ['hoursSinceCapture', 'capturedAt', 'carrierStatus', 'observedAt', 'pieceCount']) expect(FACT_WHITELIST as readonly string[]).toContain(k);
  });
});
