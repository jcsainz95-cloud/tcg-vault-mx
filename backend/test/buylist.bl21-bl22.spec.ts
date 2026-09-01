import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { MailPort } from '../src/modules/mail/mail.port';
import { buylistPortalUrl } from '../src/modules/buylist/buylist-mail.templates';
import { SettingKey } from '../src/modules/settings/settings.constants';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/**
 * v1.51.13/14 — **BL-21 (la cadena del CTA)** y **BL-22 (una fila mala no tumba una cola)**.
 *
 * - **BL-21:** el enlace del correo era el **único del proyecto fuera del molde**, y estaba roto por
 *   tres razones independientes. La que más importa: **sin prefijo de idioma**, el vendedor que
 *   eligió inglés **aterriza en español en el correo donde acepta una oferta vinculante**.
 * - **BL-22:** las lecturas de días hábiles se capturan **por fila**; las **escrituras NO degradan**.
 *   *Se degrada lo que se muestra, nunca lo que se compromete.*
 */

const pii = new PiiCryptoService(new ConfigService({}));
const SUPER = { id: 'sa-1', role: 'super_admin' as const };

// =============================================================================================
describe('⚠️ BL-21/BL-23(1) — `{origen}/{locale}/buylist/requests/{id}`', () => {
  const OLD = process.env.APP_PUBLIC_URL;
  afterEach(() => {
    if (OLD === undefined) delete process.env.APP_PUBLIC_URL;
    else process.env.APP_PUBLIC_URL = OLD;
  });

  it('la forma canónica lleva el LOCALE como segmento y el path REAL de la pantalla', () => {
    process.env.APP_PUBLIC_URL = 'https://tcghunt.mx';
    // ⛔ v1.51.15 · BL-23(1): la forma de v1.51.13 (`/{locale}/buylist/{id}`) era MÍA y estaba mal —
    // la pantalla vive en `/[locale]/buylist/requests/[id]`, así que el enlace seguía roto **por
    // divergencia**. Manda la del frontend: `/buylist` es una SECCIÓN con pantalla propia, no una
    // colección a la que se le pueda colgar un `[id]`.
    expect(buylistPortalUrl('sr-1', 'en')).toBe('https://tcghunt.mx/en/buylist/requests/sr-1');
    expect(buylistPortalUrl('sr-1', 'es')).toBe('https://tcghunt.mx/es/buylist/requests/sr-1');
    // Sigue prohibido el ?query: el id no es secreto, así que la razón que obligó al query param en
    // el enlace de invitado no existe aquí y manda la regla normal (un recurso, un segmento).
    expect(buylistPortalUrl('sr-1', 'en')).not.toMatch(/\?/);
  });

  it('⚠️ el locale sale del MISMO normalizador que el cuerpo: nunca cae a `es` por su cuenta', () => {
    process.env.APP_PUBLIC_URL = 'https://tcghunt.mx';
    // Cualquier valor que el cuerpo renderizaría como `es`, la URL también.
    for (const l of [null, undefined, 'fr', 'es-MX', '']) {
      expect(buylistPortalUrl('sr-1', l)).toBe('https://tcghunt.mx/es/buylist/requests/sr-1');
    }
    // Y el único que el cuerpo renderiza en inglés, la URL también.
    expect(buylistPortalUrl('sr-1', 'en')).toBe('https://tcghunt.mx/en/buylist/requests/sr-1');
  });

  it('normaliza la barra final (un origen, sin path, sin barra)', () => {
    process.env.APP_PUBLIC_URL = 'https://tcghunt.mx///';
    expect(buylistPortalUrl('sr-1', 'es')).toBe('https://tcghunt.mx/es/buylist/requests/sr-1');
  });

  it('⚠️ sin origen ⇒ `undefined`, y el correo SALE IGUAL con instrucción de texto', () => {
    delete process.env.APP_PUBLIC_URL;
    expect(buylistPortalUrl('sr-1', 'es')).toBeUndefined();
    process.env.APP_PUBLIC_URL = '   ';
    // *Jamás un href a medias*: o el enlace es completo y correcto, o no hay enlace.
    expect(buylistPortalUrl('sr-1', 'es')).toBeUndefined();
  });
});

// =============================================================================================
describe('⚠️ BL-21 — el correo en inglés lleva el botón a la pantalla en inglés', () => {
  function build(locale: string) {
    const request: Record<string, unknown> = {
      id: 'sr-1',
      userId: 'u-1',
      user: { id: 'u-1', name: 'Ash', email: 'ash@e.mx', locale },
      status: 'cotizada',
      offerState: null,
      closedAt: null,
      quotedTotalCents: 90000,
      pickupAddressSnapshot: { line1: 'Av. Central 123' },
      offerSentAt: null,
      offerAcceptDeadlineAt: null,
      offerGrossCents: null,
      offerShippingFeeCents: null,
      offerNetCents: null,
      offerReissueCount: 0,
      offerIssueClockStartedAt: null,
      shipmentTrackingNumber: null,
      guideCancellationDoneAt: null,
      createdAt: new Date('2026-09-01T00:00:00Z'),
      items: [
        {
          id: 'it-1',
          sellRequestId: 'sr-1',
          cardId: 'card-1',
          card: {
            id: 'card-1',
            name: 'Charizard',
            number: '4',
            rarity: 'Rare',
            rarityCanonical: 'rare',
            subtypes: null,
            availableFinishes: ['normal'],
            set: { id: 's', name: 'Base' },
          },
          productType: 'raw',
          rawCondition: 'NM',
          finish: 'normal',
          cardProductId: null,
          quotedPriceCents: 90000,
          offerDecision: null,
          offeredPriceCents: null,
        },
      ],
    };
    const prisma: any = {
      sellRequest: {
        findUnique: jest.fn(async () => ({ ...request })),
        updateMany: jest.fn(async ({ data }: any) => {
          Object.assign(request, data);
          return { count: 1 };
        }),
      },
      sellRequestItem: {
        // ⚠️ v1.51.16 — el doble APLICA la escritura sobre los ítems, no la finge. La guarda de
        // proyección (BL-24) relee la fila dentro de la tx y exige `offerDecision` en toda línea:
        // un doble que dijera `count: 1` sin escribir nada haría fallar la emisión aquí… **y sería
        // el doble el que miente**. *Un fixture que no refleja la escritura oculta la guarda que la
        // protege.*
        updateMany: jest.fn(async ({ where, data }: any) => {
          const ids: string[] = where.id?.in ?? (where.id ? [where.id] : []);
          for (const it of request.items as Record<string, unknown>[]) {
            if (ids.includes(it.id as string)) Object.assign(it, data);
          }
          return { count: ids.length };
        }),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const pricing = {
      loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
      gradeKeyFor: jest.fn(() => 'raw:NM'),
      getVariantOverridesBatch: jest.fn(async () => new Map()),
      getReferencesBatch: jest.fn(async () => new Map()),
      findCardProductsByTcgIds: jest.fn(async () => new Map()),
      getReferencesByCardProductBatch: jest.fn(async () => new Map()),
    };
    const settings = {
      getNumber: jest.fn(async (k: any) =>
        ({
          [SettingKey.BUYLIST_SHIPPING_FEE_CENTS]: 18000,
          [SettingKey.BUYLIST_MINIMUM_OFFER_NET_CENTS]: 20000,
          [SettingKey.BUYLIST_OPERATOR_OFFER_CAP_CENTS]: 150000,
          [SettingKey.BUYLIST_OFFER_ACCEPT_DEADLINE_BUSINESS_DAYS]: 2,
        })[k as string] ?? 7,
      ),
    };
    const mail: MailPort = { send: jest.fn(async () => ({ id: 'm' })) };
    const svc = new BuylistService(
      prisma as PrismaService,
      pricing as unknown as PricingService,
      settings as unknown as SettingsService,
      {} as UsersService,
      pii,
      mail,
    );
    return { svc, mail };
  }

  it.each([
    ['en', '/en/buylist/requests/sr-1'],
    ['es', '/es/buylist/requests/sr-1'],
  ])('con `locale=%s` el href del CTA apunta a `%s`', async (locale, path) => {
    process.env.APP_PUBLIC_URL = 'https://tcghunt.mx';
    const { svc, mail } = build(locale);
    await svc.adminOffer('sr-1', SUPER, [
      { itemId: 'it-1', decision: 'buy', overridePriceCents: 90000, overrideReason: 'pactado' },
    ]);
    const msg = (mail.send as jest.Mock).mock.calls[0][0];
    expect(msg.html).toContain(`https://tcghunt.mx${path}`);
    delete process.env.APP_PUBLIC_URL;
  });
});

// =============================================================================================
describe('⚠️ BL-22 — la fila se degrada, la COLA SE PINTA', () => {
  /** Una fila fuera de la cobertura de `MX_HOLIDAYS` (que sigue LANZANDO, a propósito). */
  const FUERA = new Date('2019-05-01T00:00:00Z');
  const DENTRO = new Date('2026-08-20T00:00:00Z');

  function buildQueue(rows: Record<string, unknown>[]) {
    const prisma: any = {
      sellRequest: {
        findMany: jest.fn(async () => rows),
        count: jest.fn(async () => rows.length),
        groupBy: jest.fn(async () => []),
      },
      user: { findMany: jest.fn(async () => []) },
    };
    // Diales POR CLAVE: un mock que devolviera el mismo número para todo haría que el tope del
    // operador y el plazo de emisión fueran el mismo valor, y la aserción del exceso no diría nada.
    const settings = {
      getNumber: jest.fn(async (k: any) =>
        ({
          [SettingKey.BUYLIST_SHIPMENT_CONFIRM_ALERT_BUSINESS_DAYS]: 5,
          [SettingKey.BUYLIST_OPERATOR_OFFER_CAP_CENTS]: 150000,
          [SettingKey.BUYLIST_OFFER_ISSUE_DEADLINE_BUSINESS_DAYS]: 7,
        })[k as string] ?? 5,
      ),
    };
    const svc = new BuylistService(
      prisma as PrismaService,
      {} as PricingService,
      settings as unknown as SettingsService,
      {} as UsersService,
      pii,
    );
    return { svc };
  }

  const fila = (over: Record<string, unknown> = {}) => ({
    id: 'sr-1',
    user: { id: 'u-1', name: 'Ash', email: 'ash@e.mx' },
    sellerShippedDeclaredAt: DENTRO,
    shipDeadlineAt: null,
    shipmentCarrier: null,
    shipmentTrackingNumber: null,
    createdAt: DENTRO,
    offerIssueClockStartedAt: null,
    offerPreparedAt: DENTRO,
    offerPreparedBy: 'op-1',
    offerGrossCents: 200000,
    items: [{ offerDecision: 'buy' }],
    status: 'cotizada',
    ...over,
  });

  it('⚠️ UNA fila mala NO tumba la cola: las demás salen enteras', async () => {
    const { svc } = buildQueue([
      fila({ id: 'sr-buena' }),
      fila({ id: 'sr-mala', sellerShippedDeclaredAt: FUERA }),
      fila({ id: 'sr-otra' }),
    ]);
    // Antes esto era un `500` en TODA la cola — y un 500 de back-office se lee como «no hay nada
    // pendiente». *El fallo que no se ve.*
    const res = await svc.adminPendingShipmentConfirmation(1, 20);
    expect(res.data).toHaveLength(3);
    expect(res.data.map((r) => r.sellRequestId)).toEqual(['sr-buena', 'sr-mala', 'sr-otra']);
  });

  it('la fila mala se MARCA: `businessDaysWaiting: null` + `businessDaysUnavailable: true`', async () => {
    const { svc } = buildQueue([fila({ id: 'sr-mala', sellerShippedDeclaredAt: FUERA })]);
    const res = await svc.adminPendingShipmentConfirmation(1, 20);
    // Nunca un número inventado: es la forma de la mesa (`null` + flag), aplicada aquí.
    expect(res.data[0].businessDaysWaiting).toBeNull();
    expect(res.data[0].businessDaysWaiting).not.toBe(0);
    expect(res.data[0].businessDaysUnavailable).toBe(true);
  });

  it('⚠️ `alert` falla hacia TRUE, no hacia false — o la fila más rara sería la más escondida', async () => {
    const { svc } = buildQueue([fila({ id: 'sr-mala', sellerShippedDeclaredAt: FUERA })]);
    const res = await svc.adminPendingShipmentConfirmation(1, 20);
    // «Llevo demasiado esperando» y «no puedo saber cuánto llevo» piden la MISMA acción humana.
    expect(res.data[0].alert).toBe(true);
    // Y sobrevive al filtro de solo-alertas, que es la única vista donde alguien la encontraría.
    const soloAlertas = await buildQueue([
      fila({ id: 'sr-mala', sellerShippedDeclaredAt: FUERA }),
    ]).svc.adminPendingShipmentConfirmation(1, 20, true);
    expect(soloAlertas.data).toHaveLength(1);
  });

  it('la fila BUENA no se marca (la degradación es por fila, no por cola)', async () => {
    const { svc } = buildQueue([fila({ id: 'sr-buena' })]);
    const res = await svc.adminPendingShipmentConfirmation(1, 20);
    expect(typeof res.data[0].businessDaysWaiting).toBe('number');
    expect(res.data[0].businessDaysUnavailable).toBeUndefined();
  });

  it('`caducityAt` NACE con la regla: la cola de autorización se degrada igual', async () => {
    const { svc } = buildQueue([
      fila({ id: 'sr-ok' }),
      fila({ id: 'sr-mala', createdAt: FUERA }),
    ]);
    const res = await svc.adminPendingOfferAuthorization(1, 20);
    expect(res.data).toHaveLength(2);
    expect(res.data[0].caducityAt).toBeInstanceOf(Date);
    expect(res.data[1].caducityAt).toBeNull();
    expect(res.data[1].caducityUnavailable).toBe(true);
    // Y el exceso sobre el tope viaja calculado: la UI no hace aritmética de dinero.
    expect(res.data[0].excessCents).toBe(50000);
  });

  it('`offerIssueDeadlineAt` también, y su bandera NO es redundante', async () => {
    const { svc } = buildQueue([
      { ...fila({ id: 'sr-mala', createdAt: FUERA }), status: 'cotizada', quotedTotalCents: 1, items: [] },
    ]);
    const res = await svc.adminList(undefined, 1, 20);
    // ⚠️ El `null` de esta clave ya significa «no es cotizada»: sin bandera propia, un fallo de
    // calendario se leería como «esta fila no caduca».
    expect(res.data[0].offerIssueDeadlineAt).toBeNull();
    expect((res.data[0] as { offerIssueDeadlineUnavailable?: true }).offerIssueDeadlineUnavailable).toBe(
      true,
    );
  });

  it('en un estado que NO caduca, `offerIssueDeadlineAt` es null y SIN bandera', async () => {
    const { svc } = buildQueue([
      { ...fila({ id: 'sr-1' }), status: 'pagada', quotedTotalCents: 1, items: [] },
    ]);
    const res = await svc.adminList(undefined, 1, 20);
    expect(res.data[0].offerIssueDeadlineAt).toBeNull();
    expect((res.data[0] as { offerIssueDeadlineUnavailable?: true }).offerIssueDeadlineUnavailable).toBeUndefined();
  });
});

// =============================================================================================
describe('⚠️ BL-22 — LAS ESCRITURAS NO DEGRADAN', () => {
  /**
   * *Si no podemos calcular la fecha límite, NO emitimos la oferta.* Congelar un plazo equivocado es
   * exactamente lo que la doctrina de `business-days` prohíbe. **Se degrada lo que se MUESTRA, nunca
   * lo que se COMPROMETE.**
   */
  function buildWrite(status: string) {
    const request: Record<string, unknown> = {
      id: 'sr-1',
      userId: 'u-1',
      user: { id: 'u-1', name: 'Ash', email: 'ash@e.mx', locale: 'es' },
      status,
      offerState: status === 'cotizada' ? 'pending_authorization' : null,
      closedAt: null,
      shipDeadlineAt: null,
      shipmentCarrier: null,
      shipmentTrackingNumber: null,
      guideCancellationPendingAt: null,
      guideCancellationDoneAt: null,
    };
    const prisma: any = {
      sellRequest: {
        findUnique: jest.fn(async () => ({ ...request })),
        updateMany: jest.fn(async ({ data }: any) => {
          Object.assign(request, data);
          return { count: 1 };
        }),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    // ⚠️ Un dial ABSURDO no basta para forzar el fallo; lo que lo fuerza es una FECHA fuera de
    // cobertura. Se usa `now` en 2019 (fuera de `MX_HOLIDAYS`) al congelar.
    const settings = { getNumber: jest.fn(async () => 3) };
    const svc = new BuylistService(
      prisma as PrismaService,
      {} as PricingService,
      settings as unknown as SettingsService,
      {} as UsersService,
      pii,
      { send: jest.fn(async () => ({ id: 'm' })) } as MailPort,
    );
    return { svc, request, prisma };
  }

  it('`guide` con calendario fuera de cobertura ⇒ la petición FALLA y NO se escribe nada', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2019-05-01T12:00:00Z'));
    try {
      const { svc, request, prisma } = buildWrite('aceptada');
      await expect(svc.adminGuide('sr-1', 'Estafeta', 'GUIA-1')).rejects.toThrow(/tabla de festivos/);
      // No se congeló un plazo equivocado, y no quedó una guía a medias.
      expect(request.shipDeadlineAt).toBeNull();
      expect(prisma.sellRequest.updateMany).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('`offer/authorize` con calendario fuera de cobertura ⇒ FALLA, sin mandar el correo', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2019-05-01T12:00:00Z'));
    try {
      const { svc, request } = buildWrite('cotizada');
      await expect(svc.adminOfferAuthorize('sr-1', SUPER)).rejects.toThrow(/tabla de festivos/);
      // La oferta NO salió: no se comunica un plazo que no se pudo calcular.
      expect(request.offerState).toBe('pending_authorization');
      expect(request.status).toBe('cotizada');
    } finally {
      jest.useRealTimers();
    }
  });
});

// =============================================================================================
describe('`GET /admin/buylist/live-sellers` (D12) — a quién le debemos una respuesta', () => {
  function build(groups: Record<string, unknown>[], users: Record<string, unknown>[], latest: Record<string, unknown>[]) {
    const prisma: any = {
      sellRequest: {
        groupBy: jest.fn(async () => groups),
        findMany: jest.fn(async () => latest),
      },
      user: { findMany: jest.fn(async () => users) },
    };
    const svc = new BuylistService(
      prisma as PrismaService,
      {} as PricingService,
      { getNumber: jest.fn(async () => 7) } as unknown as SettingsService,
      {} as UsersService,
      pii,
    );
    return { svc, prisma };
  }

  it('agrupa por vendedor, con el TELÉFONO en la fila y la más antigua primero', async () => {
    const { svc, prisma } = build(
      [{ userId: 'u-1', _count: { _all: 3 }, _min: { createdAt: new Date('2026-08-01T00:00:00Z') } }],
      [{ id: 'u-1', name: 'Ash', email: 'ash@e.mx', phone: '+52 55 1234 5678' }],
      [{ userId: 'u-1', status: 'ofertada', createdAt: new Date('2026-08-20T00:00:00Z') }],
    );
    const res = await svc.adminLiveSellers(1, 20);
    expect(res.data[0]).toMatchObject({
      seller: { id: 'u-1', phone: '+52 55 1234 5678' },
      liveCount: 3,
      latestStatus: 'ofertada',
    });
    // «Viva» POR EXCLUSIÓN: un estado nuevo del enum entra SOLO.
    const where = prisma.sellRequest.groupBy.mock.calls[0][0].where;
    expect(where.status.in).not.toContain('pagada');
    expect(where.status.in).toContain('cotizada');
    // Y el orden por defecto: la más antigua primero (es una cola de trabajo).
    expect(prisma.sellRequest.groupBy.mock.calls[0][0].orderBy).toEqual({ _min: { createdAt: 'asc' } });
  });

  it('`phone` nulo (Google / cuentas viejas) no rompe la fila', async () => {
    const { svc } = build(
      [{ userId: 'u-2', _count: { _all: 1 }, _min: { createdAt: new Date('2026-08-02T00:00:00Z') } }],
      [{ id: 'u-2', name: 'Misty', email: 'm@e.mx', phone: null }],
      [],
    );
    const res = await svc.adminLiveSellers(1, 20);
    expect(res.data[0].seller.phone).toBeNull();
    expect(res.data[0].latestStatus).toBeNull();
  });

  it('sin vendedores vivos devuelve vacío sin consultar usuarios', async () => {
    const { svc, prisma } = build([], [], []);
    const res = await svc.adminLiveSellers(1, 20);
    expect(res.data).toEqual([]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
