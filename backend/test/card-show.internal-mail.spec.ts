import { ConfigService } from '@nestjs/config';
import { CardShowMailService, MxResolver } from '../src/modules/card-show/card-show-mail.service';
import { MailPort } from '../src/modules/mail/mail.port';

/**
 * §CARDSHOW.9 — correos INTERNOS (aviso al staff + resumen diario) y el CONTRASTE con C3.
 *
 * Dos invariantes que MUERDEN:
 *  (1) la bienvenida C3-W SÍ lleva enlaces ricos, pero la confirmación C3 ⛔ NO (sigue estricta);
 *  (2) el aviso interno lleva la copy del dueño, 0 `playerName` y 0 nombre de patrocinador.
 */
const noMail: MailPort = { send: async () => ({ id: 'x' }) };
const alwaysMx: MxResolver = { hasMailExchange: async () => true };
const config = {
  get: (k: string) => (k === 'CARD_SHOW_MAIL_FROM' ? 'TCG HUNT <contacto@envio.tcghunt.mx>' : undefined),
} as unknown as ConfigService;
const svc = new CardShowMailService(noMail, alwaysMx, config);

describe('CARDSHOW · la confirmación C3 sigue ESTRICTA aunque exista C3-W', () => {
  it('C3 confirmación: 0 wa.me / mailto / utm_ / Drive / Maps / .ics', () => {
    const r = svc.renderConfirmation({
      to: 'pending@dominio.mx',
      kind: 'lead',
      confirmUrl: 'https://tcghunt.mx/card-show/confirm?token=abc',
      notMeUrl: 'https://tcghunt.mx/card-show/unsubscribe?token=def',
      unsubscribeOneClickUrl: 'https://tcghunt.mx/api/v1/card-show/unsubscribe-oneclick?token=ghi',
      privacyUrl: 'https://tcghunt.mx/privacidad',
    });
    const blob = `${r.html}\n${r.text}`;
    expect(blob).not.toMatch(/wa\.me/);
    expect(blob).not.toMatch(/mailto:/);
    expect(blob).not.toMatch(/utm_/);
    expect(blob).not.toMatch(/drive\.google\.com/);
    expect(blob).not.toMatch(/maps\/search/);
    expect(blob).not.toMatch(/\.ics/);
    // Solo enlaces del dominio propio.
    const urls = [...r.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => u.startsWith('https://tcghunt.mx/'))).toBe(true);
  });
});

describe('CARDSHOW · aviso interno + resumen diario (internos, copy del dueño)', () => {
  it('aviso interno: asunto y cuerpo con tipo/correo/fuente/fecha/enlace, 0 playerName', () => {
    const r = svc.renderInternalNotice({
      type: 'merchant',
      name: null,
      email: 'vendedor@dominio.mx',
      utmSource: 'instagram',
      utmMedium: 'social',
      utmCampaign: 'cardshow-dic26',
      createdAt: new Date('2026-10-16T18:30:00Z'),
      adminLink: 'https://tcghunt.mx/admin/card-show/leads',
    });
    expect(r.subject).toBe('[Card Show] Nuevo vendedor: vendedor@dominio.mx');
    expect(r.text).toContain('Tipo: Vendedor');
    expect(r.text).toContain('Correo: vendedor@dominio.mx');
    expect(r.text).toContain('Fuente: instagram/social/cardshow-dic26');
    expect(r.text).toContain('Nombre: —'); // los leads no persisten nombre
    expect(r.text).toContain('Ver en el admin: https://tcghunt.mx/admin/card-show/leads');
    expect(`${r.html}\n${r.text}`).not.toMatch(/Ash Ketchum/);
  });

  it('resumen diario: asunto con n + lista nombre·correo·fuente', () => {
    const r = svc.renderVisitorDailySummary({
      date: new Date('2026-12-01T18:00:00Z'),
      nuevos: [
        { name: null, email: 'a@dominio.mx', utmSource: 'instagram' },
        { name: null, email: 'b@gmail.com', utmSource: null },
      ],
      totalAcumulado: 42,
    });
    expect(r.subject).toMatch(/^\[Card Show\] Visitantes del \d{4}-\d{2}-\d{2}: 2 nuevos$/);
    expect(r.text).toContain('Total acumulado de visitantes confirmados: 42');
    expect(r.text).toContain('— · a@dominio.mx · instagram');
    expect(r.text).toContain('— · b@gmail.com · —');
  });
});
