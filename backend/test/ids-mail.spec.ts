/**
 * ids-mail.spec.ts — v1.116⟨ids⟩ (API_CONTRACT §IDS.5 «correo», IDS-B21 parte correo). Propiedad: backend.
 * El correo de confirmación (invitado y cliente con cuenta) traduce la versión congelada de la línea en el idioma del pedido,
 * con los literales de IDS-UX.1 (los mismos de `frontend/messages/{es,en}.json` `version.*`). Inglés sin liga: la línea de
 * siempre. Determinista (N=1).
 */
import { guestOrderConfirmationTemplate } from '../src/modules/orders/mail/guest-order.templates';
import { orderMailLineOf, orderMailVersionTextOf, orderSettledTemplate } from '../src/modules/orders/mail/order-notice.templates';

const cosmosEs = { language: 'es' as const, stampType: 'prize_pack' as const, stampLabel: 'Cosmos Holo', finish: 'holofoil' as const };
const line = { name: 'Buddy-Buddy Poffin', setName: 'Temporal Forces', number: '144', productType: 'raw' as const };

describe('IDS-B21 — correo: la versión en el idioma del pedido', () => {
  it('línea Cosmos española: es «Español» y «Cosmos Holo»; en «Spanish» y «Cosmos Holo»', () => {
    expect(orderMailVersionTextOf(cosmosEs, 'es')).toBe('Español · De liga (Prize Pack) · Cosmos Holo');
    expect(orderMailVersionTextOf(cosmosEs, 'en')).toBe('Spanish · Prize Pack · Cosmos Holo');
  });
  it('inglés sin liga ⇒ sin texto de versión (el correo de siempre)', () => {
    const en = { language: 'en' as const, stampType: null, stampLabel: null, finish: 'normal' as const };
    expect(orderMailVersionTextOf(en, 'es')).toBeNull();
    expect(orderMailLineOf({ ...line, version: en }, 'es')).toBe(orderMailLineOf(line));
  });
  it('español sin liga y liga en inglés', () => {
    expect(orderMailVersionTextOf({ language: 'es', stampType: null, stampLabel: null, finish: 'normal' }, 'es')).toBe('Español · No holo');
    expect(orderMailVersionTextOf({ language: 'en', stampType: 'league', stampLabel: null, finish: 'reverse_holo' }, 'en')).toBe('League (League promo) · Reverse Holo');
  });
  it('las plantillas de invitado y de cuenta lo pintan en el locale del pedido (HTML y texto)', () => {
    const g = guestOrderConfirmationTemplate(
      { orderNumber: 'TCG-1', items: [{ ...line, version: cosmosEs }], totalCents: 1000, trackingUrl: 'https://x.test/t?token=a' },
      'en',
    );
    expect(g.text).toContain('Spanish · Prize Pack · Cosmos Holo');
    expect(g.html).toContain('Spanish · Prize Pack · Cosmos Holo');
    const s = orderSettledTemplate({ orderNumber: 'TCG-2', orderId: 'o', items: [{ ...line, version: cosmosEs }], totalCents: 1000 }, 'es');
    expect(s.text).toContain('Español · De liga (Prize Pack) · Cosmos Holo');
    expect(s.html).toContain('Español · De liga (Prize Pack) · Cosmos Holo');
  });
});
