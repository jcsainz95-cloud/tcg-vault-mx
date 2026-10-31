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
