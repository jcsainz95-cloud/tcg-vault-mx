/**
 * sdx-b1.guest-mail-link.spec.ts — 🔒 B-1 (`API_CONTRACT §M4-SHIP.19.35.1`, PS-87 reescrita, SDX-R14 de §19.35.6): el CUERPO
 * `orderMailLinkOf` y sus dos lectores. La conducta de punta a punta (bandeja, filas, `guest/track`, reenvío) vive en
 * `test/integration/sdx-b1-guest-mail-link.e2e-spec.ts`; aquí, la regla sin BD y los candados estáticos de DÓNDE se emite.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { MAIL_ACTOR, orderMailLinkOf } from '../src/modules/shipments/guest-mail-link';
import { refundNoticeTemplate } from '../src/modules/payments/refunds/mail/refund-notice.templates';

const SRC = join(__dirname, '..', 'src');
const D = 86_400_000;
const ORIGIN = 'https://tienda.b1.test';

describe('🔒 B-1 — orderMailLinkOf: la liga del cliente en los avisos de un pedido', () => {
  const saved = process.env.APP_PUBLIC_URL;
  beforeEach(() => {
    process.env.APP_PUBLIC_URL = ORIGIN;
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.APP_PUBLIC_URL;
    else process.env.APP_PUBLIC_URL = saved;
  });

  const deps = () => {
    const tokens = {
      issue: jest.fn().mockResolvedValue({ clear: 'CLARO-U', expiresAt: new Date(Date.now() + 90 * D) }),
      resendQuotaExceeded: jest.fn().mockResolvedValue(true),
      revokeAll: jest.fn(),
    };
    const prisma = { auditLog: { create: jest.fn().mockResolvedValue({}) } };
    const logger = { warn: jest.fn() } as unknown as Logger;
    return { tokens, prisma, logger, d: { tokens: tokens as never, prisma: prisma as never, logger } };
  };
  const guest = (over: Partial<{ userId: string | null; guestEmail: string | null; createdAt: Date }> = {}) => ({
    id: 'ord-9',
    userId: null,
    guestEmail: 'g@correo.mx',
    createdAt: new Date(),
    ...over,
  });

  it('invitado ⇒ `pedido?token=<claro>` con `issue(id, {rotate:false})`; bitácora `system:mail` `{notice, rotated:false}` sin claro; ⛔ NO consulta el cupo ni revoca', async () => {
    const x = deps();
    const url = await orderMailLinkOf(x.d, guest(), 'en', 'AV-19');
    expect(url).toBe(`${ORIGIN}/en/pedido?token=CLARO-U`);
    expect(x.tokens.issue).toHaveBeenCalledWith('ord-9', { rotate: false });
    expect(x.tokens.resendQuotaExceeded).not.toHaveBeenCalled();
    expect(x.tokens.revokeAll).not.toHaveBeenCalled();
    const data = x.prisma.auditLog.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ actorUserId: null, actorRole: null, action: 'order.tracking_link.reissue', entityType: 'Order', entityId: 'ord-9' });
    expect(data.after).toMatchObject({ actor: MAIL_ACTOR, notice: 'AV-19', rotated: false });
    expect(Object.keys(data.after).sort()).toEqual(['actor', 'expiresAt', 'notice', 'rotated']);
    expect(JSON.stringify(data)).not.toContain('CLARO-U');
  });

  it('`userId ≠ null` (registrado o RECLAMADO, aunque conserve `guestEmail`) ⇒ `orders/<id>` y ⛔ cero emisiones', async () => {
    for (const g of [guest({ userId: 'u-1' }), guest({ userId: 'u-1', guestEmail: null })]) {
      const x = deps();
      expect(await orderMailLinkOf(x.d, g, 'es', 'AV-5')).toBe(`${ORIGIN}/es/orders/ord-9`);
      expect(x.tokens.issue).not.toHaveBeenCalled();
      expect(x.prisma.auditLog.create).not.toHaveBeenCalled();
    }
  });

  it('más de 365 días, sin origen público, o sin correo ⇒ `null` y ⛔ cero emisiones', async () => {
    const cases: [string, () => void, ReturnType<typeof guest>][] = [
      ['366 días', () => undefined, guest({ createdAt: new Date(Date.now() - 366 * D) })],
      ['sin APP_PUBLIC_URL', () => delete process.env.APP_PUBLIC_URL, guest()],
      ['sin guestEmail ni userId', () => undefined, guest({ guestEmail: null })],
    ];
    for (const [name, arrange, g] of cases) {
      process.env.APP_PUBLIC_URL = ORIGIN;
      arrange();
      const x = deps();
      expect({ name, url: await orderMailLinkOf(x.d, g, 'es', 'AV-4') }).toEqual({ name, url: null });
      expect({ name, issued: x.tokens.issue.mock.calls.length }).toEqual({ name, issued: 0 });
    }
  });

  it('a 364 días todavía emite (el tope es 365)', async () => {
    const x = deps();
    expect(await orderMailLinkOf(x.d, guest({ createdAt: new Date(Date.now() - 364 * D) }), 'es', 'AV-4')).toContain('/pedido?token=');
  });

  it('la emisión o la bitácora fallan ⇒ `null` (sin CTA), ⛔ nunca lanza, y el aviso del log no trae el claro ni el mensaje crudo', async () => {
    for (const where of ['issue', 'audit'] as const) {
      const x = deps();
      if (where === 'issue') x.tokens.issue.mockRejectedValue(new Error('crudo CLARO-U'));
      else x.prisma.auditLog.create.mockRejectedValue(Object.assign(new Error('crudo CLARO-U'), { code: 'P2000' }));
      await expect(orderMailLinkOf(x.d, guest(), 'es', 'AV-6')).resolves.toBeNull();
      const logged = JSON.stringify((x.logger.warn as jest.Mock).mock.calls);
      expect(logged).toContain('AV-6');
      expect(logged).not.toContain('CLARO-U');
      expect(logged).not.toContain('crudo');
    }
  });
});

describe('🔒 B-1 — AV-12 pinta el enlace que le da el servicio (un cuerpo, ⛔ no una copia)', () => {
  const saved = process.env.APP_PUBLIC_URL;
  beforeAll(() => {
    process.env.APP_PUBLIC_URL = ORIGIN;
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.APP_PUBLIC_URL;
    else process.env.APP_PUBLIC_URL = saved;
  });
  const base = { reference: 'TCG-1', orderNumber: 'TCG-1', orderId: 'ord-9', cards: [], nothingShips: false, variant: 'item_missing' as const, totalCents: 100 };

  it('`customerUrl` string ⇒ ESE enlace; `null` ⇒ sin CTA; ausente ⇒ el de siempre (`orders/<id>`, retiro `vault`)', () => {
    const withToken = refundNoticeTemplate({ ...base, customerUrl: `${ORIGIN}/es/pedido?token=T1` }, 'es');
    expect(withToken.html).toContain(`${ORIGIN}/es/pedido?token=T1`);
    expect(withToken.html).not.toContain('/orders/');
    const none = refundNoticeTemplate({ ...base, customerUrl: null }, 'es');
    expect(none.html).not.toMatch(/\/orders\/|pedido\?token|VER MI PEDIDO/);
    expect(refundNoticeTemplate(base, 'es').html).toContain(`${ORIGIN}/es/orders/ord-9`);
    expect(refundNoticeTemplate({ ...base, orderNumber: null, orderId: null }, 'es').html).toContain(`${ORIGIN}/es/vault?tab=withdrawals`);
  });
});

describe('🔒 B-1 — candados estáticos: DÓNDE se emite la liga del invitado', () => {
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
  const bodyOf = (src: string, signature: string) => {
    const i = src.indexOf(signature);
    expect(i).toBeGreaterThan(-1);
    const j = src.indexOf('\n  }\n', i);
    return src.slice(i, j);
  };

  it('`orderMailLinkOf` tiene EXACTAMENTE dos lectores: el camino de envío de los avisos y el de AV-12', () => {
    const svc = read('modules/shipments/shipments.service.ts');
    const ledger = read('modules/payments/refunds/refund-ledger.service.ts');
    expect(svc.match(/orderMailLinkOf\(/g)).toHaveLength(1);
    expect(ledger.match(/orderMailLinkOf\(/g)).toHaveLength(1);
    // En los avisos de envío, solo desde `customerUrlFor`, y éste solo desde `claimAndNotify` DESPUÉS del sello.
    expect(bodyOf(svc, 'private async customerUrlFor(')).toContain('orderMailLinkOf(');
    const claim = bodyOf(svc, 'private async claimAndNotify(');
    const seal = claim.indexOf('sealed.count !== 1');
    const link = claim.indexOf('this.customerUrlFor(');
    expect(seal).toBeGreaterThan(-1);
    expect(link).toBeGreaterThan(seal);
    expect(svc.match(/this\.customerUrlFor\(/g)).toHaveLength(1);
    // En AV-12, después del reclamo del sello `customerNotifiedAt`.
    const notify = bodyOf(ledger, 'async notifyCustomer(');
    expect(notify.indexOf('orderMailLinkOf(')).toBeGreaterThan(notify.indexOf('claimed.count === 0'));
  });

  it('⛔ `resolveRecipient` (también lo usa `recipientEmailOf`, la compra de la guía) no emite nada', () => {
    const body = bodyOf(read('modules/shipments/shipments.service.ts'), 'private async resolveRecipient(').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(body).toContain("kind: 'order'"); // el cuerpo es el de verdad (no una firma vacía)
    expect(body).not.toMatch(/orderMailLinkOf|customerUrlFor|\.issue\(|orderTokens/);
  });

  it('⛔ el cuerpo no rota ni mira el cupo del reenvío', () => {
    const src = read('modules/shipments/guest-mail-link.ts').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(src).toContain('rotate: false');
    expect(src).not.toMatch(/rotate:\s*true|resendQuotaExceeded|revokeAll/);
  });
});
