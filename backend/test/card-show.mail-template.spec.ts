import { ConfigService } from '@nestjs/config';
import { CardShowMailService, MxResolver } from '../src/modules/card-show/card-show-mail.service';
import { MailPort } from '../src/modules/mail/mail.port';
import { CONFIRM_SUBJECT } from '../src/modules/card-show/card-show.constants';

const noMail: MailPort = { send: async () => ({ id: 'x' }) };
const alwaysMx: MxResolver = { hasMailExchange: async () => true };
const config = {
  get: (k: string) => (k === 'CARD_SHOW_MAIL_FROM' ? 'TCG HUNT <no-reply@envio.tcghunt.mx>' : undefined),
} as unknown as ConfigService;

const svc = new CardShowMailService(noMail, alwaysMx, config);

/** §CARDSHOW.9 (C3) — correo de confirmación de plantilla y asunto fijos. */
describe('CARDSHOW · plantilla de confirmación (C3)', () => {
  const base = {
    to: 'alguien@dominio.mx',
    confirmUrl: 'https://tcghunt.mx/card-show/confirm?token=abc',
    notMeUrl: 'https://tcghunt.mx/card-show/unsubscribe?token=def',
    unsubscribeOneClickUrl: 'https://tcghunt.mx/api/v1/card-show/unsubscribe-oneclick',
    privacyUrl: 'https://tcghunt.mx/privacidad',
  };

  it('asunto FIJO', () => {
    expect(svc.renderConfirmation({ ...base, kind: 'lead' }).subject).toBe(CONFIRM_SUBJECT);
  });

  it('⛔ ningún enlace de marketing: 0 wa.me / mailto / utm_ / tracking pixel', () => {
    const r = svc.renderConfirmation({ ...base, kind: 'lead' });
    const blob = `${r.html}\n${r.text}`;
    expect(blob).not.toMatch(/wa\.me/);
    expect(blob).not.toMatch(/mailto:/);
    expect(blob).not.toMatch(/utm_/);
    // ⚠️ El esqueleto de marca (`mailShell`, §31/PRIV-4) incluye UN logo del dominio propio; lo que ⛔ no
    // puede haber es un píxel de rastreo (1×1). Ver DISCREPANCIA C3↔§31 en BACKEND_NOTES.
    expect(blob).not.toMatch(/width="1"/);
  });

  it('solo enlaces (href) del dominio propio (confirmar / No fui yo / aviso)', () => {
    const r = svc.renderConfirmation({ ...base, kind: 'lead' });
    const urls = [...r.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => u.startsWith('https://tcghunt.mx/'))).toBe(true);
  });

  it('torneo: Player ID solo «terminado en NNNN»; ⛔ nunca el nombre ni el ID completo', () => {
    const r = svc.renderConfirmation({ ...base, kind: 'signup', playerIdLast4: '4567' });
    const blob = `${r.html}\n${r.text}`;
    expect(blob).toContain('4567');
    expect(blob).not.toContain('1234567'); // ⛔ ID completo
    expect(blob).not.toMatch(/Ash Ketchum/); // ⛔ playerName
  });

  it('cabeceras List-Unsubscribe + List-Unsubscribe-Post (RFC 8058)', () => {
    const r = svc.renderConfirmation({ ...base, kind: 'lead' });
    expect(r.headers['List-Unsubscribe']).toContain(base.unsubscribeOneClickUrl);
    expect(r.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('From sale de variable de entorno (subdominio de envío), ⛔ no hardcodeado', () => {
    expect(svc.from_()).toBe('TCG HUNT <no-reply@envio.tcghunt.mx>');
  });

  it('MX: dominio sin MX ni A ⇒ no puede recibir', async () => {
    const noMx = new CardShowMailService(noMail, { hasMailExchange: async () => false }, config);
    expect(await noMx.domainCanReceive('x@sin-mx.invalid')).toBe(false);
  });
});
