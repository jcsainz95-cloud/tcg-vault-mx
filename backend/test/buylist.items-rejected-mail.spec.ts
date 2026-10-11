import { sellItemsRejectedTemplate, SellItemsRejectedParams } from '../src/modules/buylist/buylist-mail.templates';
import { rejectDeadlines } from '../src/modules/buylist/buylist-reject.constants';
import { supportContact } from '../src/modules/mail/support-contact';

/**
 * v1.82 · PNL-4 — **ML-24** (DESIGN_SYSTEM §60.13) sobre el correo 29 (`sellItemsRejectedTemplate`, §60.6).
 *
 * ES/EN × `n = 1`/`n = 3` × abierta/cerrada: un solo mensaje; nombra cada carta; trae el motivo; trae «7 días» y
 * «30 días» **y** las dos fechas; que el envío de regreso lo paga el vendedor; el buzón de soporte; ⛔ ningún
 * importe ni CTA; y **los días escritos = `returnDeadlineAt − rejectedAt` / `abandonDeadlineAt − rejectedAt`** del
 * fixture (que sale de `rejectDeadlines`, el plazo real del servidor).
 * Canario de §60.13 («cambiar el plazo del servidor a +10 d sin tocar la plantilla»): el último caso mueve los
 * plazos y exige que el texto los siga — una plantilla con «7» escrito a mano lo pone rojo.
 */
const DAY = 24 * 3600 * 1000;
const REJECTED_AT = new Date('2026-09-09T18:00:00-06:00');
const CARDS = [
  { cardName: 'Snorlax V', setName: 'Sword & Shield', cardNumber: '141/202', finish: 'reverse_holo' as const },
  { cardName: 'Pikachu', setName: 'Base Set', cardNumber: '58/102', finish: 'normal' as const },
  { cardName: 'Charizard', setName: 'Darkness Ablaze', cardNumber: '020/189', finish: 'holofoil' as const },
];

function params(n: 1 | 3, requestClosed: boolean, over: Partial<SellItemsRejectedParams> = {}): SellItemsRejectedParams {
  const d = rejectDeadlines(REJECTED_AT);
  return {
    folio: 'SR-FOLIO-29',
    cards: CARDS.slice(0, n),
    reason: 'Llegaron con dobleces',
    rejectedAt: REJECTED_AT,
    returnDeadlineAt: d.returnDeadlineAt!,
    abandonDeadlineAt: d.abandonDeadlineAt!,
    requestClosed,
    ...over,
  };
}

const dias = (p: SellItemsRejectedParams) => ({
  ret: Math.round((p.returnDeadlineAt.getTime() - p.rejectedAt.getTime()) / DAY),
  aba: Math.round((p.abandonDeadlineAt.getTime() - p.rejectedAt.getTime()) / DAY),
});

const fecha = (d: Date, locale: 'es' | 'en') =>
  new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-MX', { dateStyle: 'long', timeZone: 'America/Mexico_City' }).format(d);

describe('ML-24 · correo 29 — cartas no aceptadas (un solo correo)', () => {
  for (const locale of ['es', 'en'] as const) {
    for (const n of [1, 3] as const) {
      for (const closed of [false, true]) {
        it(`[${locale}] n=${n} ${closed ? 'cerrada' : 'abierta'}: cartas, motivo, plazos con días y fechas, soporte, cierre; sin dinero ni CTA`, () => {
          const p = params(n, closed);
          const msg = sellItemsRejectedTemplate(p, 'Vendedora', locale);
          const { ret, aba } = dias(p);
          expect(ret).toBe(7);
          expect(aba).toBe(30);
          for (const surface of [msg.text, msg.html]) {
            for (const c of p.cards) {
              expect(surface).toContain(c.cardName);
              expect(surface).toContain(`#${c.cardNumber}`);
            }
            expect(surface).toContain(fecha(p.returnDeadlineAt, locale));
            expect(surface).toContain(fecha(p.abandonDeadlineAt, locale));
            expect(surface).toContain(supportContact());
            expect(surface).not.toMatch(/MX\$|\$\s?\d/);
          }
          for (const c of CARDS.slice(n)) expect(msg.text).not.toContain(c.cardName);
          // Una línea de carta por carta en el texto plano.
          expect(msg.text.match(/^- .+ · .+ · #.+ \((Acabado|Finish): .+\)$/gm)).toHaveLength(n);
          expect(msg.html).not.toContain('<a ');
          expect(msg.html).not.toContain('href=');
          if (locale === 'es') {
            expect(msg.text).toContain('Motivo: Llegaron con dobleces');
            expect(msg.text).toContain(`tienes ${ret} días, hasta el ${fecha(p.returnDeadlineAt, 'es')}`);
            expect(msg.text).toContain(`a los ${aba} días, el ${fecha(p.abandonDeadlineAt, 'es')}`);
            expect(msg.text).toContain('El envío de regreso corre por tu cuenta');
            expect(msg.text).toContain(n === 1 ? 'CARTA NO ACEPTADA · SR-FOLIO-29' : 'CARTAS NO ACEPTADAS · SR-FOLIO-29');
            expect(msg.subject).toBe(
              n === 1
                ? 'Una carta de tu solicitud de venta no fue aceptada'
                : '3 cartas de tu solicitud de venta no fueron aceptadas',
            );
            expect(msg.text).toContain(
              closed
                ? 'Como no aceptamos ninguna carta, tu solicitud queda cerrada y no hay pago.'
                : 'Las demás cartas de tu solicitud siguen en revisión; este correo no las cambia.',
            );
          } else {
            expect(msg.text).toContain('Reason: Llegaron con dobleces');
            expect(msg.text).toContain(`you have ${ret} days, until ${fecha(p.returnDeadlineAt, 'en')}`);
            expect(msg.text).toContain(`after ${aba} days, on ${fecha(p.abandonDeadlineAt, 'en')}`);
            expect(msg.text).toContain('Return shipping is at your cost');
            expect(msg.subject).toBe(
              n === 1 ? 'A card in your sell request was not accepted' : '3 cards in your sell request were not accepted',
            );
            expect(msg.text).toContain(closed ? 'your request is closed and there is no payment' : 'are still under review');
          }
        });
      }
    }
  }

  it('CANARIO de §60.13: con plazos de +10 d / +45 d el texto dice 10 y 45 — los días salen de las fechas, no de un literal', () => {
    const p = params(3, false, {
      returnDeadlineAt: new Date(REJECTED_AT.getTime() + 10 * DAY),
      abandonDeadlineAt: new Date(REJECTED_AT.getTime() + 45 * DAY),
    });
    const es = sellItemsRejectedTemplate(p, 'V', 'es').text;
    expect(es).toContain('tienes 10 días');
    expect(es).toContain('a los 45 días');
    expect(es).not.toContain('7 días');
    expect(es).not.toContain('30 días');
    const en = sellItemsRejectedTemplate(p, 'V', 'en').text;
    expect(en).toContain('you have 10 days');
    expect(en).toContain('after 45 days');
  });

  it('minimización §4.18c: el motivo y el nombre salen escapados en el HTML', () => {
    const msg = sellItemsRejectedTemplate(params(1, false, { reason: '<b>roto</b>' }), '"><script>x</script>', 'es');
    expect(msg.html).not.toContain('<script>');
    expect(msg.html).not.toContain('<b>roto</b>');
  });
});
