import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { MailMessage } from '../src/modules/mail/mail.port';
import * as accountTpl from '../src/modules/mail/mail.templates';
import * as guestTpl from '../src/modules/orders/mail/guest-order.templates';
import * as orderTpl from '../src/modules/orders/mail/order-notice.templates';
import * as buylistTpl from '../src/modules/buylist/buylist-mail.templates';
import * as buylistNoticeTpl from '../src/modules/buylist/buylist-notice.templates';
import * as refundTpl from '../src/modules/payments/refunds/mail/refund-notice.templates';
import * as shipmentTpl from '../src/modules/shipments/mail/shipment-notice.templates';
import * as disputeTpl from '../src/modules/disputes/mail/dispute-notice.templates';
import * as kycTpl from '../src/modules/admin/mail/kyc-notice.templates';
import { footerDescriptor, privacyNoticeUrl, spacerRow } from '../src/modules/buylist/mail-shell';
import { spendAlertBatchMail, spendAlertImmediateMail, spendDigestMail } from '../src/modules/spend-alerts/spend-alert.mail';
import { SpendAlertMailView } from '../src/modules/spend-alerts/spend-alert-text';
import { SealedRestockNotifyService } from '../src/modules/catalog/sealed-restock-notify.service';
import { stripComments } from './helpers/strip-comments';

/**
 * # v1.84.4 — el enlace «Aviso de privacidad» en el pie de todos los correos **a clientes**
 * (`API_CONTRACT §14.17` E4-5, criterio 507, `PROJECT §LEG.3`); los solo-staff (AVG-1/2/3) no lo llevan:
 * PRIV-5/6 (v1.84.5, `API_CONTRACT §14.18` E5-1…E5-3).
 *
 * PRIV-1 — render: cada plantilla exportada (`*Template`, las 31 del censo SRF-13 tras la fusión de `listo-real`) más el correo de
 *          reposición, en ES y EN, lleva `<a href="<origen>/es/privacidad">` con su etiqueta.
 *          **Exhaustivo por construcción:** si alguien exporta una plantilla nueva sin añadirla a
 *          `RENDERS`, PRIV-0 se pone rojo.
 * PRIV-2 — el origen: `APP_PUBLIC_URL`; si falta, el primer origen de `APP_BASE_URL` (lista de CORS).
 * PRIV-3 — sin ningún origen: el correo sale con la dirección como texto y ⛔ sin `href` a medias.
 * PRIV-4 — barrido de `src/`: todo fichero que arma HTML de correo pasa por `mailShell(` o
 *          `privacyNoticeHtml(` (un pie nuevo escrito a mano queda cubierto sin tocar este fichero).

 * PRIV-5 — (v1.84.5) los tres correos solo-staff de `spend-alert.mail.ts` NO llevan el aviso (con y sin origen),
 *          pero sí el pie en tinta (CONTROL: «no hay pie de privacidad» no es «no hay nada»).
 * PRIV-6 — (v1.84.5) barrido: `audience: 'staff'` aparece SOLO en `spend-alert.mail.ts`, exactamente 3 veces.
 */

const ORIGIN = 'https://tienda.example.test';
const PRIV_URL = `${ORIGIN}/es/privacidad`;
const LABEL = { es: 'Aviso de privacidad', en: 'Privacy notice' } as const;
const LOCALES = ['es', 'en'] as const;
type Locale = (typeof LOCALES)[number];
type Render = (l: Locale) => Pick<MailMessage, 'html'>;

const AT = new Date('2026-10-05T18:00:00-06:00');
const PORTAL = 'https://tienda.example.test/es/buylist/requests/sr-1';
const items = [{ name: 'Charizard VMAX', setName: 'Darkness Ablaze', number: '020/189' }];

const RENDERS: Record<string, Render> = {
  // Cuenta (verificación, restablecer contraseña) y el aviso de bloqueo, mismo pie.
  emailVerificationTemplate: (l) => accountTpl.emailVerificationTemplate('https://x.test/v?token=t', 'Ana', l),
  passwordResetTemplate: (l) => accountTpl.passwordResetTemplate('https://x.test/r?token=t', 'Ana', l),
  passwordLockAlertTemplate: (l) => accountTpl.passwordLockAlertTemplate('Ana', l),
  // Confirmación con cuenta (y su reembolso).
  orderSettledTemplate: (l) =>
    orderTpl.orderSettledTemplate({ orderNumber: 'TH-1', orderId: 'o1', items, totalCents: 12300 }, l),
  orderRefundedTemplate: (l) =>
    orderTpl.orderRefundedTemplate({ orderNumber: 'TH-1', orderId: 'o1', totalCents: 12300 }, l),
  // Confirmación de invitado (y el reenvío de su enlace).
  guestOrderConfirmationTemplate: (l) =>
    guestTpl.guestOrderConfirmationTemplate(
      { orderNumber: 'TH-1', items, totalCents: 12300, trackingUrl: 'https://x.test/t' },
      l,
    ),
  guestTrackingLinkTemplate: (l) =>
    guestTpl.guestTrackingLinkTemplate({ orderNumber: 'TH-1', trackingUrl: 'https://x.test/t' }, l),
  // Buylist.
  sellOfferTemplate: (l) =>
    buylistTpl.sellOfferTemplate(
      {
        folio: 'BL-1',
        lines: [
          { cardName: 'Charizard', setName: 'DA', cardNumber: '020/189', finish: 'holofoil', offeredPriceCents: 84000 },
        ],
        grossCents: 84000,
        shippingFeeCents: 0,
        netCents: 84000,
        acceptDeadlineAt: AT,
        portalUrl: PORTAL,
      },
      'Ana',
      l,
    ),
  sellOfferReminderTemplate: (l) =>
    buylistTpl.sellOfferReminderTemplate(
      { kind: 'accept', folio: 'BL-1', buyLineCount: 1, netCents: 84000, deadlineAt: AT, carrier: null, trackingNumber: null, portalUrl: PORTAL },
      'Ana',
      l,
    ),
  sellOfferCancelledTemplate: (l) =>
    buylistTpl.sellOfferCancelledTemplate({ folio: 'BL-1', offerSentAt: AT, portalUrl: PORTAL }, 'Ana', l),
  sellItemRejectedTemplate: (l) =>
    buylistTpl.sellItemRejectedTemplate(
      {
        folio: 'BL-1',
        cardName: 'Snorlax V',
        setName: 'SS',
        cardNumber: '141/202',
        finish: 'reverse_holo',
        reason: 'No llegó en Near Mint',
        returnDeadlineAt: AT,
        abandonDeadlineAt: AT,
      },
      'Ana',
      l,
    ),
  // v1.82 · PNL-4 — correo 29, rechazo por lote (rama `arreglos-panel`; registrado al fusionar).
  sellItemsRejectedTemplate: (l) =>
    buylistTpl.sellItemsRejectedTemplate(
      {
        folio: 'BL-1',
        cards: [{ cardName: 'Snorlax V', setName: 'SS', cardNumber: '141/202', finish: 'reverse_holo' }],
        reason: 'No llegó en Near Mint',
        rejectedAt: AT,
        returnDeadlineAt: AT,
        abandonDeadlineAt: AT,
        requestClosed: false,
      },
      'Ana',
      l,
    ),
  sellRequestExpiredTemplate: (l) =>
    buylistTpl.sellRequestExpiredTemplate({ kind: 'no_response', folio: 'BL-1', closedAt: AT, portalUrl: PORTAL }, 'Ana', l),
  sellRequestNotPursuedTemplate: (l) =>
    buylistTpl.sellRequestNotPursuedTemplate({ folio: 'BL-1', portalUrl: PORTAL }, 'Ana', l),
  sellGuideTemplate: (l) =>
    buylistNoticeTpl.sellGuideTemplate(
      { folio: 'BL-1', carrier: 'Estafeta', trackingNumber: '123', shipDeadlineAt: AT, portalUrl: PORTAL },
      'Ana',
      l,
    ),
  sellReceivedTemplate: (l) => buylistNoticeTpl.sellReceivedTemplate({ folio: 'BL-1', portalUrl: PORTAL }, 'Ana', l),
  sellPaidTemplate: (l) =>
    buylistNoticeTpl.sellPaidTemplate({ folio: 'BL-1', payoutNetCents: 84000, speiReference: 'R1', portalUrl: PORTAL }, 'Ana', l),
  // Centro de avisos.
  refundNoticeTemplate: (l) =>
    refundTpl.refundNoticeTemplate(
      {
        reference: 'RF-1',
        orderNumber: 'TH-1',
        orderId: 'o1',
        cards: [{ name: 'Pikachu', setName: 'Base', reason: 'not_found', amountCents: 5000 }],
        nothingShips: false,
        variant: 'item_missing',
        totalCents: 5000,
      },
      l,
    ),
  replacementPendingTemplate: (l) =>
    refundTpl.replacementPendingTemplate(
      { shipmentId: 's1', cards: [{ name: 'Pikachu', setName: 'Base', reason: 'damaged' }] },
      l,
    ),
  manualRefundAnnouncedTemplate: (l) =>
    refundTpl.manualRefundAnnouncedTemplate({ transferCents: 5000, cardCents: 0, clabeMasked: '•••• 1234' }, l),
  manualRefundPaidTemplate: (l) => refundTpl.manualRefundPaidTemplate({ transferCents: 5000, speiReference: 'R1' }, l),
  clabeChangedTemplate: (l) =>
    refundTpl.clabeChangedTemplate({ previousMasked: '•••• 1111', newMasked: '•••• 2222', changedAt: AT }, l),
  shipmentGuideTemplate: (l) =>
    shipmentTpl.shipmentGuideTemplate({ shipmentId: 's1', orderNumber: 'TH-1', carrier: 'Estafeta', trackingNumber: '123' }, l),
  shipmentShippedTemplate: (l) => shipmentTpl.shipmentShippedTemplate({ shipmentId: 's1', orderNumber: 'TH-1' }, l),
  shipmentCancelledTemplate: (l) => shipmentTpl.shipmentCancelledTemplate({ shipmentId: 's1', orderNumber: 'TH-1' }, l),
  // Skydropx D2 — AV-17/18/19, la palabra del transportista (rama `skydropx-d`; registrados al fusionar).
  shipmentDeliveredTemplate: (l) =>
    shipmentTpl.shipmentDeliveredTemplate({ shipmentId: 's1', orderNumber: 'TH-1', carrierStatusAt: AT }, l),
  shipmentAtBranchTemplate: (l) =>
    shipmentTpl.shipmentAtBranchTemplate({ shipmentId: 's1', orderNumber: 'TH-1', carrier: 'Estafeta', branchName: 'Centro' }, l),
  shipmentDeliveryAttemptTemplate: (l) =>
    shipmentTpl.shipmentDeliveryAttemptTemplate({ shipmentId: 's1', orderNumber: 'TH-1', carrier: 'Estafeta', attemptAt: AT }, l),
  disputeRepurchaseTemplate: (l) => disputeTpl.disputeRepurchaseTemplate({ folio: 'D-1', resolution: 'ok' }, l),
  disputeRejectedTemplate: (l) => disputeTpl.disputeRejectedTemplate({ folio: 'D-1', resolution: 'no' }, l),
  kycRejectedTemplate: (l) => kycTpl.kycRejectedTemplate({ reason: 'Ilegible' }, 'Ana', l),
};

/** El correo de reposición no es `*Template`: se arma dentro del servicio. Se captura el envío. */
async function restockHtml(): Promise<string> {
  const send = jest.fn(async (_m: MailMessage) => undefined);
  const svc = new SealedRestockNotifyService({} as never, {} as never, { send } as never);
  await (svc as unknown as { sendRestockEmail(e: string, n: string): Promise<void> }).sendRestockEmail(
    'a@example.test',
    'Caja',
  );
  return send.mock.calls[0][0].html;
}

const ENV_KEYS = ['APP_PUBLIC_URL', 'APP_BASE_URL'] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
function env(publicUrl: string | undefined, baseUrl: string | undefined): void {
  if (publicUrl === undefined) delete process.env.APP_PUBLIC_URL;
  else process.env.APP_PUBLIC_URL = publicUrl;
  if (baseUrl === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = baseUrl;
}

/** El enlace exacto: `href` al aviso Y la etiqueta como texto del ancla. */
function privacyAnchor(html: string): RegExpExecArray | null {
  return /<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g.exec(
    (html.match(/<a href="[^"]*\/privacidad"[^>]*>[^<]+<\/a>/) ?? [''])[0],
  );
}

describe('PRIV-0 — el censo: toda plantilla exportada tiene su render aquí', () => {
  it('RENDERS cubre exactamente los `*Template` de `src/` (una nueva sin render ⇒ rojo)', () => {
    const SRC = join(__dirname, '..', 'src');
    const names: string[] = [];
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts') && !p.endsWith('.spec.ts'))
          for (const m of stripComments(readFileSync(p, 'utf8')).matchAll(/export (?:async )?function (\w+Template)\b/g))
            names.push(m[1]);
      }
    };
    walk(SRC);
    expect(Object.keys(RENDERS).sort()).toEqual(names.sort());
  });
});

describe('PRIV-1 — todas las familias llevan «Aviso de privacidad» → /es/privacidad (criterio 507)', () => {
  for (const [name, render] of Object.entries(RENDERS)) {
    for (const l of LOCALES) {
      it(`${name} [${l}]`, () => {
        env(ORIGIN, undefined);
        const a = privacyAnchor(render(l).html);
        expect(a).not.toBeNull();
        expect(a?.[1]).toBe(PRIV_URL);
        expect(a?.[2]).toBe(LABEL[l]);
      });
    }
  }

  it('reposición de sellado (correo bilingüe, sin `*Template`)', async () => {
    env(ORIGIN, undefined);
    const a = privacyAnchor(await restockHtml());
    expect(a?.[1]).toBe(PRIV_URL);
    expect(a?.[2]).toBe(LABEL.es);
  });

  it('CONTROL: el enlace aparece UNA vez por correo (no se duplica entre pie y cuerpo)', () => {
    env(ORIGIN, undefined);
    for (const render of Object.values(RENDERS)) {
      expect(render('es').html.split(`href="${PRIV_URL}"`).length - 1).toBe(1);
    }
  });
});

describe('PRIV-2 — el origen', () => {
  it('APP_PUBLIC_URL manda (con barra final recortada)', () => {
    env(`${ORIGIN}/`, 'https://otro.example.test');
    expect(privacyNoticeUrl()).toBe(PRIV_URL);
  });

  it('sin APP_PUBLIC_URL ⇒ el PRIMER origen de APP_BASE_URL (la lista de CORS no se pega entera)', () => {
    env(undefined, `${ORIGIN}, https://b.example.test,https://c.example.test`);
    expect(privacyNoticeUrl()).toBe(PRIV_URL);
    const html = RENDERS.emailVerificationTemplate('es').html;
    expect(html).toContain(`href="${PRIV_URL}"`);
    expect(html).not.toContain('b.example.test');
  });

  it('APP_PUBLIC_URL en blanco cuenta como ausente', () => {
    env('   ', ORIGIN);
    expect(privacyNoticeUrl()).toBe(PRIV_URL);
  });

  it('⛔ un esquema no http(s) no se emite como href', () => {
    env('javascript:alert(1)//', undefined);
    expect(privacyNoticeUrl()).toBeUndefined();
  });
});

describe('PRIV-3 — sin origen configurado el correo sale igual, sin href a medias', () => {
  for (const l of LOCALES) {
    it(`[${l}] todas las familias: etiqueta + dirección en texto, sin href al aviso`, () => {
      env(undefined, undefined);
      for (const render of Object.values(RENDERS)) {
        const html = render(l).html;
        expect(html).toContain(`${LABEL[l]}: tcghunt.mx/es/privacidad`);
        expect(html).not.toMatch(/href="[^"]*privacidad"/);
        expect(html).not.toContain('href="undefined"');
        expect(html).not.toMatch(/href="\s*"/);
      }
    });
  }
});

describe('PRIV-4 — barrido: todo HTML de correo en `src/` pasa por el pie común', () => {
  it('los ficheros que arman HTML de correo llaman a `mailShell(` o a `privacyNoticeHtml(`', () => {
    const SRC = join(__dirname, '..', 'src');
    const offenders: string[] = [];
    const checked: string[] = [];
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!p.endsWith('.ts') || p.endsWith('.spec.ts')) continue;
        const src = stripComments(readFileSync(p, 'utf8'));
        // «Arma HTML de correo»: lleva `subject` y emite marcado HTML en un literal de plantilla.
        if (!/\bsubject\b/.test(src) || !/`[^`]*<(p|div|table|tr|td|h[1-6])\b/.test(src)) continue;
        const rel = relative(SRC, p);
        if (rel === join('modules', 'buylist', 'mail-shell.ts')) continue; // lo define
        checked.push(rel);
        if (!/\bmailShell\(|\bprivacyNoticeHtml\(/.test(src)) offenders.push(rel);
      }
    };
    walk(SRC);
    // CONTROL: el barrido ve los pies a mano (si no los viera, no mediría nada).
    expect(checked).toEqual(
      expect.arrayContaining([
        join('modules', 'mail', 'mail.templates.ts'),
        join('modules', 'orders', 'mail', 'guest-order.templates.ts'),
        join('modules', 'catalog', 'sealed-restock-notify.service.ts'),
      ]),
    );
    expect(offenders).toEqual([]);
  });
});

describe('PRIV-5 — (v1.84.5 §14.18) los correos solo-staff (AVG-1/2/3) no llevan el aviso de privacidad', () => {
  const view = (kind: SpendAlertMailView['kind'], facts: SpendAlertMailView['facts'] = {}): SpendAlertMailView => ({
    id: '11111111-2222-4333-8444-555555555555',
    kind,
    severity: 'immediate',
    facts,
    amountCents: 15000,
    subjectName: 'Luis',
    orderNumber: 'TCG-000123',
    folio: 'ENV-000045',
    firstOccurredAt: new Date('2031-03-10T16:05:00Z'),
  });
  const recipient = (locale: Locale) => ({ email: 'duena@x.mx', name: 'Dueña', nameSource: 'user' as const, locale });
  const mails = (l: Locale) => [
    // AVG-1 de un 🔴 de guías (AG-3, con «Frenar»).
    spendAlertImmediateMail(view('label_cap_blocked', { priceCents: 1, usedCents: 2, capCents: 3 }), recipient(l)),
    // AVG-2 (lote de la hora).
    spendAlertBatchMail([view('label_charged_unexplained', { cause: 'orphan_fuse' })], new Date('2031-03-10T16:00:00Z'), recipient(l)),
    // AVG-3 (resumen del día).
    spendDigestMail(
      '2031-03-09',
      { from: '2031-03-09', to: '2031-03-09', byKind: [{ code: 'AG-3', immediate: 1, digest: 0, amountCents: 15000 }], mutedCount: 0, labelSpendByPerson: [], costlyChoices: { count: 0, overRecommendedCents: 0, byPerson: [] } },
      [view('label_cap_blocked')],
      recipient(l),
      () => 'x',
    ),
  ];

  for (const [label, pub] of [
    ['con origen', ORIGIN],
    ['sin origen', undefined],
  ] as const) {
    for (const l of LOCALES) {
      it(`[${l}] ${label}: ni enlace, ni etiqueta, ni dirección del aviso; sí el pie en tinta`, () => {
        env(pub, undefined);
        const ms = mails(l);
        expect(ms).toHaveLength(3);
        for (const m of ms) {
          for (const body of [m.html, m.text]) {
            expect(body).not.toMatch(/privacidad/i);
            expect(body).not.toContain(LABEL.es);
            expect(body).not.toContain(LABEL.en);
          }
          // CONTROL: el correo tiene su pie (el shell corrió entero).
          expect(m.html).toContain(footerDescriptor(l));
          // E5-2.1: con `staff` el shell omite el `privacyRow` **y** su `spacerRow(16)`. Tras el último
          // `spacerRow(32)` (el que el shell pone tras `blocks`) solo queda el pie en tinta.
          expect(tailAfterLastSpacer32(m.html)).not.toContain(spacerRow(16));
        }
      });
    }
  }

  it('CONTROL del espaciador: un correo a cliente SÍ lleva `spacerRow(16)` tras el último `spacerRow(32)`', () => {
    // Sin este control, la aserción de arriba pasaría también si el recorte del final no encontrara nada.
    env(ORIGIN, undefined);
    for (const l of LOCALES) {
      const html = RENDERS.orderSettledTemplate(l).html; // cliente vía `mailShell` (las de cuenta no usan el shell)
      expect(tailAfterLastSpacer32(html)).toContain(spacerRow(16));
    }
  });
});

/** Lo que el shell emite tras su `spacerRow(32)` fijo: [`privacyRow` + `spacerRow(16)`] + pie. Falla si no hay `spacerRow(32)`. */
function tailAfterLastSpacer32(html: string): string {
  const at = html.lastIndexOf(spacerRow(32));
  expect(at).toBeGreaterThan(-1);
  return html.slice(at + spacerRow(32).length);
}

describe('PRIV-6 — (v1.84.5 §14.18 E5-2.3) `audience: \'staff\'` solo donde el contrato lo permite', () => {
  it('los ficheros de `src/` con `audience: \'staff\'` son exactamente `spend-alert.mail.ts`, con 3 apariciones', () => {
    const SRC = join(__dirname, '..', 'src');
    const hits: Record<string, number> = {};
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) {
          const c = (stripComments(readFileSync(p, 'utf8')).match(/audience:\s*['"]staff['"]/g) ?? []).length;
          if (c > 0) hits[relative(SRC, p)] = c;
        }
      }
    };
    walk(SRC);
    expect(hits).toEqual({ [join('modules', 'spend-alerts', 'spend-alert.mail.ts')]: 3 });
  });
});
