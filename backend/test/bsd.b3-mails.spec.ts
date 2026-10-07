/**
 * bsd.b3-mails.spec.ts — 💰 rev BSD-1, paso B-3 (API_CONTRACT §BSD.8.1, §BSD.8.3, §BSD.15 C-2; DESIGN_SYSTEM §BSD-UX.1,
 * §BSD-UX.3). Propiedad: backend. Unitaria: los dos correos nuevos de B-3.
 *
 *  - **BSD-B21** — BSD-M1 «no continuamos» es/en: `mailShell` (marca, pie VENTA, aviso de privacidad: `audience` cliente), los
 *    textos de ux-ui, y ⛔ NADA de: número de guía, paquetería, motivo, domicilio, teléfono, CLABE, ni las palabras
 *    `guía|guia|plazo|demora|label|deadline|delay` (ni «días»). Se busca en el asunto, en el texto plano y en el TEXTO VISIBLE
 *    del HTML (sin etiquetas ni atributos: el marcado no lo lee nadie).
 *  - **AG-23** (`AVG-1`) — título y frase con la FECHA de cierre (⛔ «lleva N días aceptada»), filas solicitud · valor de las
 *    cartas en la oferta · se cierra, remedio, CTA bermellón a `<origen>/<locale>/admin/m5` ⛔ sin `?` ni `#` (C-2, PS-153),
 *    sin «Frenar», y ⛔ ninguna PII del vendedor (no está en `facts`).
 */
import { sellRequestNotContinuedTemplate } from '../src/modules/buylist/buylist-mail.templates';
import { privacyNoticeLabel } from '../src/modules/buylist/mail-shell';
import { spendAlertImmediateMail } from '../src/modules/spend-alerts/spend-alert.mail';
import { spendAlertSentence, spendAlertTitle, SpendAlertMailView } from '../src/modules/spend-alerts/spend-alert-text';

const ORIGIN = 'https://panel.bsd-b3.test';
const saved = process.env.APP_PUBLIC_URL;
beforeAll(() => {
  process.env.APP_PUBLIC_URL = ORIGIN;
});
afterAll(() => {
  if (saved === undefined) delete process.env.APP_PUBLIC_URL;
  else process.env.APP_PUBLIC_URL = saved;
});

/** El texto que un lector VE: sin `<head>`, sin etiquetas, sin atributos, con las entidades básicas resueltas. */
function visible(html: string): string {
  return html
    .replace(/<head>[\s\S]*?<\/head>/i, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');
}

const FOLIO = 'sr-bsd-b3-folio';
const PORTAL = `${ORIGIN}/es/buylist/requests/${FOLIO}`;
// Lo que el correo NO puede decir aunque el llamador lo tuviera en la mano (no está en la firma: el candado mira el texto).
const PROHIBIDO = /gu[ií]a|plazo|demora|label|deadline|delay|d[ií]as|days|paqueter|carrier|estafeta|99minutos|clabe|tel[eé]fono|phone/i;

describe('💰 BSD-B21 — BSD-M1 «no continuamos» (vendedor)', () => {
  it.each(['es', 'en'] as const)('%s: los textos de ux-ui, el esqueleto y el pie VENTA con aviso de privacidad', (l) => {
    const m = sellRequestNotContinuedTemplate({ folio: FOLIO, portalUrl: l === 'es' ? PORTAL : PORTAL.replace('/es/', '/en/') }, 'Ana', l);
    const v = visible(m.html);
    if (l === 'es') {
      expect(m.subject).toBe('No continuaremos con tu solicitud de venta');
      expect(v).toContain('SOLICITUD CERRADA');
      expect(v).toContain('Decidimos no continuar con esta venta');
      expect(v).toContain('Hola Ana:');
      expect(v).toContain(`Tras una revisión adicional, decidimos no continuar con el proceso de venta de tu solicitud ${FOLIO}.`);
      expect(v).toContain('La solicitud queda cerrada y no se compró ninguna carta. Por favor, no nos envíes tus cartas.');
      expect(v).toContain('Gracias por considerarnos. Si más adelante quieres vender, puedes cotizar de nuevo cuando quieras.');
      expect(v).toContain('VER MI SOLICITUD');
      expect(v).toContain('Si ya las habías enviado, escríbenos a');
      expect(v).toContain('Recibes este correo porque tienes una solicitud de venta con nosotros.');
      expect(m.text).toContain('Hola Ana:');
    } else {
      expect(m.subject).toBe("We won't be continuing with your sell request");
      expect(v).toContain("We've decided not to continue with this sale");
      expect(v).toContain('Hi Ana,');
      expect(v).toContain('The request is closed and no card was purchased. Please don\'t send us your cards.');
      expect(v).toContain('VIEW MY REQUEST');
      expect(v).toContain('You are receiving this email because you have a sell request with us.');
    }
    // `audience` CLIENTE ⇒ el enlace legal va (criterio 507); idioma en `lang`; el folio en el eyebrow.
    expect(v).toContain(privacyNoticeLabel(l));
    expect(m.html).toContain(`<html lang="${l}"`);
    expect(m.text).toContain(FOLIO);
    // El CTA va al portal (TINTA) y la URL de respaldo también.
    expect(m.html).toContain(l === 'es' ? PORTAL : PORTAL.replace('/es/', '/en/'));
  });

  it.each(['es', 'en'] as const)('%s: ⛔ ni guía, ni paquetería, ni plazo, ni días, ni montos, ni PII (asunto, texto y HTML visible)', (l) => {
    const m = sellRequestNotContinuedTemplate({ folio: FOLIO, portalUrl: PORTAL }, 'Ana', l);
    for (const [where, s] of [
      ['asunto', m.subject],
      ['texto', m.text],
      ['html', visible(m.html)],
    ] as const) {
      expect([where, s.match(PROHIBIDO)?.[0] ?? null]).toEqual([where, null]);
      expect([where, /MX\$|\$\s?\d/.test(s)]).toEqual([where, false]);
    }
  });

  it('sin nombre ⇒ saludo neutro; sin origen ⇒ sale igual, sin enlace', () => {
    const m = sellRequestNotContinuedTemplate({ folio: FOLIO }, '  ', 'es');
    expect(visible(m.html)).toContain('Hola:');
    expect(m.html).not.toContain('/buylist/requests/');
  });
});

describe('💰 AG-23 — «Solicitud de venta sin guía» al dueño (AVG-1)', () => {
  const CLOSES = '2026-10-12T14:00:00.000Z'; // 08:00 en CDMX
  const view = (over: Partial<SpendAlertMailView> = {}): SpendAlertMailView => ({
    id: 'alert-ag23',
    kind: 'buylist_guide_due',
    severity: 'immediate',
    facts: { sellRequestId: FOLIO, closesAt: CLOSES, offerGrossCents: 150000 },
    amountCents: null,
    subjectName: null,
    orderNumber: null,
    folio: null,
    firstOccurredAt: new Date('2026-10-10T14:00:00.000Z'),
    ...over,
  });
  const owner = { email: 'duena@e2e.local', name: 'Dueña', locale: 'es' };

  it('título y frase con la FECHA de cierre (⛔ «lleva N días aceptada»)', () => {
    expect(spendAlertTitle(view(), 'es')).toBe('Solicitud de venta sin guía');
    expect(spendAlertTitle(view(), 'en')).toBe('Sell request without a label');
    expect(spendAlertSentence(view(), 'es')).toBe(
      `La solicitud de venta ${FOLIO} sigue aceptada y sin guía: se cierra sola el 12 de octubre a las 08:00 si para entonces no tiene guía. Valor de sus cartas en la oferta: MX$1,500.00.`,
    );
    expect(spendAlertSentence(view(), 'en')).toBe(
      `Sell request ${FOLIO} is still accepted and has no label: it closes on its own on October 12 at 08:00 if it still has no label by then. Value of its cards in the offer: MX$1,500.00.`,
    );
    expect(spendAlertSentence(view(), 'es')).not.toMatch(/lleva|aceptada hace|\d+ d[ií]as/);
  });

  it('el correo: asunto con la fecha corta, filas, remedio, CTA bermellón a /admin/m5 sin `?` ni `#`, sin «Frenar»', () => {
    const m = spendAlertImmediateMail(view(), owner);
    expect(m.subject).toBe('Solicitud de venta sin guía: se cierra sola el 12 de octubre');
    const v = visible(m.html);
    expect(v).toContain(`Solicitud de venta: ${FOLIO}`);
    expect(v).toContain('Valor de las cartas en la oferta: MX$1,500.00');
    expect(v).toContain('Se cierra: 12 de octubre a las 08:00');
    expect(v).toContain('Para que no se cierre, genera su guía con Skydropx (o captúrala a mano) en «Solicitudes de venta»');
    expect(v).toContain('IR A SOLICITUDES DE VENTA');
    const hrefs = [...m.html.matchAll(/href="([^"]+)"/g)].map((x) => x[1]).filter((u) => u.startsWith(ORIGIN));
    expect(hrefs).toContain(`${ORIGIN}/es/admin/m5`);
    expect(hrefs.filter((u) => /[?#]/.test(u))).toEqual([]);
    expect(m.html).not.toContain('/admin/spend-alerts/'); // ⛔ «VER EL AVISO»: el dueño tiene que ACTUAR en M5
    expect(v).not.toContain('frenar');
    expect(m.text).toContain(`IR A SOLICITUDES DE VENTA: ${ORIGIN}/es/admin/m5`);
  });

  it('en inglés', () => {
    const m = spendAlertImmediateMail(view(), { ...owner, locale: 'en' });
    expect(m.subject).toBe('Sell request without a label: closes on its own on October 12');
    expect(visible(m.html)).toContain('GO TO SELL REQUESTS');
    expect(m.html).toContain(`${ORIGIN}/en/admin/m5`);
  });

  it('⛔ ninguna PII del vendedor: el correo solo dice lo que hay en `facts`', () => {
    const m = spendAlertImmediateMail(view(), owner);
    const all = `${m.subject}\n${m.text}\n${visible(m.html)}`;
    // Ni nombre, ni correo, ni dirección del vendedor existen en la vista: un `@` solo puede ser del dueño o de soporte.
    expect(all).not.toMatch(/Calle|Colonia|\b\d{5}\b(?!\.)|\b55\d{8}\b/);
  });
});
