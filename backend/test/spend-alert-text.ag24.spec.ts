/**
 * spend-alert-text.ag24.spec.ts — AG-24 (`psa_cycle_short`) con el texto FINAL de ux-ui (DESIGN_SYSTEM `## DYN-UX.`, claves
 * SA`.kind.AG-24.title` / `.projected` / `.overdue`), es y en. El literal se copia aquí a propósito: si cambia el texto de diseño,
 * esta prueba es la que obliga a mirarlo.
 */
import { spendAlertSentence, spendAlertTitle, SpendAlertMailView } from '../src/modules/spend-alerts/spend-alert-text';

const view = (facts: SpendAlertMailView['facts']): SpendAlertMailView => ({
  id: 'a1',
  kind: 'psa_cycle_short',
  severity: 'digest',
  facts,
  amountCents: null,
  subjectName: null,
  orderNumber: null,
  folio: null,
  firstOccurredAt: new Date('2026-10-29T12:00:00Z'),
});
const base = { publishedCards: 1200, cycleDays: 12, dailyCreditCap: 100, capToCoverWeek: 172, setsOverCap: 2 };

describe('AG-24 — texto de DYN-UX', () => {
  it('título es/en', () => {
    expect(spendAlertTitle({ kind: 'psa_cycle_short', facts: {} }, 'es')).toBe('Los créditos PSA no alcanzan para la semana');
    expect(spendAlertTitle({ kind: 'psa_cycle_short', facts: {} }, 'en')).toBe('The PSA credits do not cover the week');
  });

  it('`projected` es/en', () => {
    const v = view({ reason: 'projected', ...base });
    expect(spendAlertSentence(v, 'es')).toBe(
      'Con 100 créditos al día no alcanza para revisar tus 1,200 cartas cada semana: revisarlas todas tardaría 12 días. Para cubrir la semana, sube el tope a 172.',
    );
    expect(spendAlertSentence(v, 'en')).toBe(
      'With 100 credits a day there is not enough to check your 1,200 cards every week: checking them all would take 12 days. To cover the week, raise the cap to 172.',
    );
  });

  it('`overdue` es/en', () => {
    const v = view({ reason: 'overdue', ...base });
    expect(spendAlertSentence(v, 'es')).toBe(
      'Alguna colección lleva más de 8 días sin revisarse. Con 100 créditos al día, la vuelta a tus 1,200 cartas tarda 12 días; para cubrir la semana, sube el tope a 172. Colecciones que no caben en el tope de un día: 2.',
    );
    expect(spendAlertSentence(v, 'en')).toBe(
      'Some set has gone more than 8 days without a check. With 100 credits a day, a full round of your 1,200 cards takes 12 days; to cover the week, raise the cap to 172. Sets that do not fit in one day’s cap: 2.',
    );
  });
});
