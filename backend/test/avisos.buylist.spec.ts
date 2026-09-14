import { BuylistService } from '../src/modules/buylist/buylist.service';
import { matchesWhere } from './helpers/prisma-where';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { MailMessage, MailPort } from '../src/modules/mail/mail.port';

/**
 * # §R — LOS TRES AVISOS DEL CICLO DE VENTA: `AV-7`, `AV-8`, `AV-9`
 *
 * Cubre: el **sello por VALOR** de la guía (§R.4.b), el **plazo con fecha y hora** del `C-AV-4`
 * (mitad del vendedor), el criterio **211** del acuse y la mitad de `C-AV-10` que toca a este módulo
 * (**el correo no puede tumbar el dinero**).
 */

const USER = { name: 'Ash', email: 'ash@pallet.mx', locale: 'es', anonymizedAt: null };

function buildHarness(opts: {
  request: Record<string, unknown>;
  mail?: 'ok' | 'throwing' | null;
  user?: Record<string, unknown> | null;
}) {
  const sent: MailMessage[] = [];
  const row: Record<string, unknown> = { ...opts.request };
  const client = {
    sellRequest: {
      findUnique: jest.fn().mockImplementation(async ({ select }: any) => {
        if (select?.user) return { user: opts.user === undefined ? USER : opts.user };
        return { ...row };
      }),
      // ⭐⭐ **EVALÚA EL `where` DE VERDAD** (`helpers/prisma-where`). Desde el 2026-09-14 por aquí
      // pasan DOS escrituras condicionales distintas: el sello (`… IS NULL`) y la de la ETIQUETA
      // (`shipmentCarrier IS NULL OR shipmentCarrier <> …`), que sustituyó al `if` sobre la lectura
      // previa. El fake anterior buscaba la clave del sello a mano y **no sabía leer un `OR`**:
      // habría devuelto un `count` inventado justo en la línea que decide si se manda un segundo
      // correo. ⚠️ `matchesWhere` respeta la semántica SQL de `NULL` en `not`.
      updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
        if (!matchesWhere(row, where)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
  };
  const prisma: any = {
    ...client,
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(client)),
  };
  const settings: any = { getNumber: jest.fn().mockResolvedValue(3) };
  const mail: MailPort | undefined =
    opts.mail === null
      ? undefined
      : {
          send: jest.fn().mockImplementation(async (m: MailMessage) => {
            if (opts.mail === 'throwing') throw new Error('resend is down');
            sent.push(m);
            return {};
          }),
        };
  const svc = new BuylistService(
    prisma as PrismaService,
    {} as PricingService,
    settings as SettingsService,
    {} as UsersService,
    {} as PiiCryptoService,
    mail,
  );
  return { svc, sent, row, prisma };
}

const ACEPTADA = {
  id: 'sr-1',
  status: 'aceptada',
  closedAt: null,
  shipDeadlineAt: new Date('2026-09-18T21:00:00Z'),
  shipmentCarrier: null,
  shipmentTrackingNumber: null,
  guideCancellationPendingAt: null,
  guideCancellationDoneAt: null,
  guideNoticeSentAt: null,
};

describe('AV-7 — la guía al VENDEDOR, y su sello por VALOR (§R.4.b)', () => {
  it('la primera captura avisa, con la etiqueta y el PLAZO con fecha y hora', async () => {
    const { svc, sent } = buildHarness({ request: { ...ACEPTADA }, mail: 'ok' });
    await svc.adminGuide('sr-1', 'Estafeta', 'EST-0001');
    expect(sent).toHaveLength(1);
    const cuerpo = [sent[0].subject, sent[0].html, sent[0].text].join('\n');
    expect(cuerpo).toContain('Estafeta');
    expect(cuerpo).toContain('EST-0001');
    // Criterio 154: fecha Y hora, ⛔ nunca «en 2 días». Y con el MISMO formateador de la pantalla.
    expect(cuerpo).toMatch(/2026/);
    expect(cuerpo).not.toMatch(/en \d+ d[íi]as/);
  });

  it('re-capturar el MISMO par ⇒ ⛔ no reenvía; corregir el número ⇒ SÍ avisa', async () => {
    const { svc, sent } = buildHarness({ request: { ...ACEPTADA }, mail: 'ok' });
    await svc.adminGuide('sr-1', 'Estafeta', 'EST-0001');
    expect(sent).toHaveLength(1);

    await svc.adminGuide('sr-1', 'Estafeta', 'EST-0001');
    expect(sent).toHaveLength(1); // idéntico ⇒ el sello no se limpia ⇒ la reclamación pierde

    await svc.adminGuide('sr-1', 'Estafeta', 'EST-0002');
    expect(sent).toHaveLength(2); // *un correo con un número que ya no existe es peor que ninguno*
    expect(sent[1].text).toContain('EST-0002');
    // ⚠️ Y este tercer correo **no rompe el criterio 210**: ese criterio recorre un envío con UNA
    // sola captura; una CORRECCIÓN es otro escenario y avisa a propósito (§R.4.b, escrito para que
    // QA no lo lea como un fallo por exceso).
  });

  it('⛔ el correo NO lleva el domicilio de recogida ni ningún monto', async () => {
    const { svc, sent } = buildHarness({
      request: { ...ACEPTADA, pickupAddressSnapshot: { line1: 'Av. E2E 123', city: 'CDMX' } },
      mail: 'ok',
    });
    await svc.adminGuide('sr-1', 'Estafeta', 'EST-0001');
    const cuerpo = [sent[0].subject, sent[0].html, sent[0].text].join('\n');
    expect(cuerpo).not.toContain('Av. E2E 123');
    expect(cuerpo).not.toMatch(/\$\s?\d/);
  });

  it('⛔ una captura RECHAZADA por la guarda de motor no avisa (y no quema el sello)', async () => {
    const { svc, sent, row } = buildHarness({
      request: { ...ACEPTADA, status: 'cotizada' },
      mail: 'ok',
    });
    await expect(svc.adminGuide('sr-1', 'Estafeta', 'EST-0001')).rejects.toThrow();
    expect(sent).toHaveLength(0);
    expect(row.guideNoticeSentAt).toBeNull();
  });

  it('CANARIO: la RECLAMACIÓN muerde — con el sello puesto, `count === 0` y no se manda', async () => {
    // Ablación del mecanismo, no del servicio: es la escritura condicional de `D-AVISO-2` tal cual.
    // Si esta reclamación devolviera `1` con el sello ya escrito, **todo** el «una sola vez» de §R
    // sería decorativo — y los tres tests de arriba pasarían por casualidad.
    const { row, prisma } = buildHarness({ request: { ...ACEPTADA }, mail: 'ok' });
    const primera = await prisma.sellRequest.updateMany({
      where: { id: 'sr-1', guideNoticeSentAt: null },
      data: { guideNoticeSentAt: new Date() },
    });
    expect(primera.count).toBe(1); // gana: se manda
    const segunda = await prisma.sellRequest.updateMany({
      where: { id: 'sr-1', guideNoticeSentAt: null },
      data: { guideNoticeSentAt: new Date() },
    });
    expect(segunda.count).toBe(0); // pierde: no se manda
    expect(row.guideNoticeSentAt).not.toBeNull();
  });
});

describe('C-AV-10 (mitad buylist) — el correo NO puede tumbar la captura de una guía', () => {
  it('con el puerto LANZANDO siempre, `adminGuide` transiciona y responde', async () => {
    const { svc, row } = buildHarness({ request: { ...ACEPTADA }, mail: 'throwing' });
    await expect(svc.adminGuide('sr-1', 'Estafeta', 'EST-0001')).resolves.toMatchObject({
      sellRequestId: 'sr-1',
    });
    expect(row.shipmentTrackingNumber).toBe('EST-0001');
  });

  it('sin puerto de correo (Noop ausente), tampoco falla', async () => {
    const { svc } = buildHarness({ request: { ...ACEPTADA }, mail: null });
    await expect(svc.adminGuide('sr-1', 'Estafeta', 'EST-0001')).resolves.toBeDefined();
  });

  it('⛔ sin destinatario (cuenta anonimizada) ⇒ cero correos y cero excepción', async () => {
    const { svc, sent } = buildHarness({
      request: { ...ACEPTADA },
      user: { ...USER, anonymizedAt: new Date() },
      mail: 'ok',
    });
    await expect(svc.adminGuide('sr-1', 'Estafeta', 'EST-0001')).resolves.toBeDefined();
    expect(sent).toHaveLength(0);
  });
});
