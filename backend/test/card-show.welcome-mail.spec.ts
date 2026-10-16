import { ConfigService } from '@nestjs/config';
import { CardShowMailService, MxResolver } from '../src/modules/card-show/card-show-mail.service';
import { MailMessage, MailPort } from '../src/modules/mail/mail.port';

/**
 * §CARDSHOW.9 (C3-W) — correo(s) de BIENVENIDA RICO, 3 variantes por tipo de lead.
 *
 * El invariante que estas pruebas MUERDEN: C3-W va a un buzón YA confirmado ⇒ SÍ puede llevar
 * `wa.me`/`utm_*`/Drive/`mailto:`/`.ics`/Maps (lo que C3 confirmación ⛔ prohíbe), sigue con From del
 * remitente + `Reply-To` + `List-Unsubscribe(+Post)` tokenizado y ⛔ nunca `playerName`.
 */
const noMail: MailPort = { send: async () => ({ id: 'x' }) };
const alwaysMx: MxResolver = { hasMailExchange: async () => true };
const config = {
  get: (k: string) =>
    k === 'CARD_SHOW_MAIL_FROM'
      ? 'TCG HUNT <contacto@envio.tcghunt.mx>'
      : k === 'CARD_SHOW_MAIL_REPLY_TO'
        ? 'jsainz@tcghunt.mx'
        : undefined,
} as unknown as ConfigService;

const svc = new CardShowMailService(noMail, alwaysMx, config);

const base = {
  to: 'ya-confirmado@dominio.mx',
  unsubscribeOneClickUrl: 'https://tcghunt.mx/api/v1/card-show/unsubscribe-oneclick?token=abc',
  base: 'https://tcghunt.mx',
};

describe('CARDSHOW · bienvenida C3-W (RICA, tras confirmar un lead)', () => {
  it('merchant: asunto del dueño + wa.me (con utm) + plano, y 0 playerName', () => {
    const r = svc.renderWelcome({ ...base, type: 'merchant' });
    expect(r.subject).toBe('Tu mesa en el Card Show CDMX · 5 y 6 de diciembre');
    const blob = `${r.html}\n${r.text}`;
    expect(blob).toMatch(/wa\.me\/525564893921/);
    expect(blob).toMatch(/utm_source=email/);
    expect(blob).toMatch(/tcghunt\.mx\/card-show#plano/);
    expect(blob).not.toMatch(/Ash Ketchum/);
    // wa.me va como <a href> real (buzón confirmado ⇒ C3-W es rico).
    expect(r.html).toMatch(/href="https:\/\/wa\.me\/525564893921/);
  });

  it('sponsor: asunto del dueño + Drive + mailto como enlace REAL (href)', () => {
    const r = svc.renderWelcome({ ...base, type: 'sponsor' });
    expect(r.subject).toBe('Patrocinio Card Show CDMX · te mandamos el deck');
    const blob = `${r.html}\n${r.text}`;
    expect(blob).toMatch(/drive\.google\.com\/file\/d\//);
    expect(blob).toMatch(/mailto:jsainz@tcghunt\.mx/);
    // El mailto DEBE ser un href real (C3 lo prohibiría; C3-W lo permite).
    expect(r.html).toMatch(/href="mailto:jsainz@tcghunt\.mx/);
  });

  it('visitor: asunto del dueño + .ics del dominio propio + Maps', () => {
    const r = svc.renderWelcome({ ...base, type: 'visitor' });
    expect(r.subject).toBe('¡Nos vemos en el Card Show CDMX! · 5 y 6 de diciembre');
    const blob = `${r.html}\n${r.text}`;
    expect(blob).toMatch(/card-show-cdmx\.ics/);
    expect(blob).toMatch(/www\.google\.com\/maps\/search/);
    expect(r.html).toMatch(/href="https:\/\/www\.google\.com\/maps\/search/);
  });

  it('todas las variantes: List-Unsubscribe(+Post) con token, y el saludo sin nombre es «Hola:»', () => {
    for (const type of ['merchant', 'sponsor', 'visitor'] as const) {
      const r = svc.renderWelcome({ ...base, type });
      expect(r.headers['List-Unsubscribe']).toContain(base.unsubscribeOneClickUrl);
      expect(r.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
      expect(r.text.startsWith('Hola:')).toBe(true);
    }
  });

  it('sendWelcome usa From del remitente y añade Reply-To por cabecera', async () => {
    let sent: MailMessage | undefined;
    const spy: MailPort = {
      send: async (m) => {
        sent = m;
        return { id: 'y' };
      },
    };
    const s = new CardShowMailService(spy, alwaysMx, config);
    await s.sendWelcome({ ...base, type: 'merchant' });
    expect(sent?.from).toBe('TCG HUNT <contacto@envio.tcghunt.mx>');
    expect(sent?.headers?.['Reply-To']).toBe('jsainz@tcghunt.mx');
    expect(sent?.headers?.['List-Unsubscribe']).toContain(base.unsubscribeOneClickUrl);
  });
});
