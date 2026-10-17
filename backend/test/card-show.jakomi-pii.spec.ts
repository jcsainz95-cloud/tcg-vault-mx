import { ConfigService } from '@nestjs/config';
import { CardShowMailService, MxResolver } from '../src/modules/card-show/card-show-mail.service';
import { MailMessage, MailPort } from '../src/modules/mail/mail.port';

/**
 * ⭐M-89 (§CARDSHOW.9 (A), cierra L2-SEG-01) — CANDADO de privacidad: `cardshow@jakomi.mx` es un TERCERO
 * y SOLO puede recibir el resumen AGREGADO (tipo + conteo, 0 PII). El aviso interno CON PII
 * (nombre+teléfono+correo reales del vendedor/patrocinador) ⛔ NUNCA debe tenerlo como destinatario.
 *
 * Dos invariantes que MUERDEN si vuelve el defecto (Jakomi en el CC del aviso con PII):
 *  (A) todo correo cuyo destinatario (To/CC/BCC) incluya `cardshow@jakomi.mx` ⇒ 0 apariciones de
 *      nombre/teléfono/correo/playerName en asunto + cuerpo (html + text);
 *  (B) el aviso interno merchant/sponsor ⇒ Jakomi NO aparece en To/CC/BCC.
 */

const alwaysMx: MxResolver = { hasMailExchange: async () => true };
const config = {
  get: (k: string) =>
    k === 'CARD_SHOW_MAIL_FROM'
      ? 'TCG HUNT <contacto@envio.tcghunt.mx>'
      : k === 'CARD_SHOW_MAIL_REPLY_TO'
        ? 'jsainz@tcghunt.mx'
        : undefined,
} as unknown as ConfigService;

const JAKOMI = 'cardshow@jakomi.mx';

/** Destinatarios reales del mensaje (To + CC + BCC), aplanados y en minúsculas. */
function recipientsOf(m: MailMessage): string[] {
  const bcc = (m as unknown as { bcc?: string | string[] }).bcc;
  const flat = [m.to, ...([] as (string | string[] | undefined)[]).concat(m.cc, bcc)]
    .flat()
    .filter((x): x is string => typeof x === 'string' && x.length > 0);
  return flat.map((x) => x.toLowerCase());
}

/** PII concreta sembrada en los avisos de prueba (nombre, teléfono, correo); + marcador genérico playerName. */
const PII_NEEDLES = ['Tienda Pikachu', '5512345678', 'vendedor@dominio.mx', 'Ash Ketchum'];

/** Captura cada MailMessage que el servicio entrega al puerto. */
function captureService(): { svc: CardShowMailService; sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  const capture: MailPort = {
    send: async (m) => {
      sent.push(m);
      return { id: 'x' };
    },
  };
  return { svc: new CardShowMailService(capture, alwaysMx, config), sent };
}

describe('⭐M-89 · Jakomi (tercero) jamás recibe PII del aviso interno', () => {
  it('(B) aviso interno merchant: Jakomi NO está en To/CC/BCC', async () => {
    const { svc, sent } = captureService();
    await svc.sendInternalNotice({
      type: 'merchant',
      name: 'Tienda Pikachu',
      phone: '5512345678',
      email: 'vendedor@dominio.mx',
      utmSource: 'instagram',
      utmMedium: 'social',
      utmCampaign: 'cardshow-dic26',
      createdAt: new Date('2026-10-16T18:30:00Z'),
      adminLink: 'https://tcghunt.mx/es/admin/card-show?tab=leads',
    });
    expect(sent).toHaveLength(1);
    expect(recipientsOf(sent[0])).not.toContain(JAKOMI);
  });

  it('(B) aviso interno sponsor: Jakomi NO está en To/CC/BCC', async () => {
    const { svc, sent } = captureService();
    await svc.sendInternalNotice({
      type: 'sponsor',
      name: 'Tienda Pikachu',
      phone: '5512345678',
      email: 'vendedor@dominio.mx',
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      createdAt: new Date('2026-10-16T18:30:00Z'),
      adminLink: 'https://tcghunt.mx/es/admin/card-show?tab=leads',
    });
    expect(sent).toHaveLength(1);
    expect(recipientsOf(sent[0])).not.toContain(JAKOMI);
  });

  it('(A) TODO correo con Jakomi en To/CC/BCC ⇒ 0 PII en asunto + cuerpo (aviso + resúmenes)', async () => {
    const { svc, sent } = captureService();
    // Aviso interno CON PII (si Jakomi reaparece en el CC, este correo lo tendrá ⇒ la aserción MUERDE).
    await svc.sendInternalNotice({
      type: 'merchant',
      name: 'Tienda Pikachu',
      phone: '5512345678',
      email: 'vendedor@dominio.mx',
      utmSource: 'instagram',
      utmMedium: 'social',
      utmCampaign: 'cardshow-dic26',
      createdAt: new Date('2026-10-16T18:30:00Z'),
      adminLink: 'https://tcghunt.mx/es/admin/card-show?tab=leads',
    });
    // Resumen diario (interno) — Jakomi PODRÍA ser destinatario (lo cablea devops): debe ser 0 PII.
    await svc.sendVisitorDailySummary({
      date: new Date('2026-12-01T18:00:00Z'),
      nuevos: [{ name: null, email: 'a@dominio.mx', utmSource: 'instagram' }],
      totalAcumulado: 42,
    });
    // Resumen periódico agregado — mismo trato.
    const zero = { leadsByType: {}, gameInterest: {}, raffleOptIns: 0, playersByGame: {}, playersByDay: {}, leadsTotal: 0, playersTotal: 0 };
    await svc.sendLeadsSummary({
      generatedAt: new Date('2026-12-01T18:00:00Z'),
      today: zero,
      last7d: zero,
      total: zero,
      leadsCsvUrl: 'https://tcghunt.mx/api/v1/admin/card-show/leads/export.csv',
      playersCsvUrl: 'https://tcghunt.mx/api/v1/admin/card-show/players/export.csv',
    });

    expect(sent.length).toBeGreaterThan(0);
    for (const m of sent) {
      if (recipientsOf(m).includes(JAKOMI)) {
        const blob = `${m.subject}\n${m.html}\n${m.text}`;
        for (const needle of PII_NEEDLES) {
          expect(blob).not.toContain(needle);
        }
      }
    }
  });
});
