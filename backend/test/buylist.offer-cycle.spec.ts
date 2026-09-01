import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { MailPort } from '../src/modules/mail/mail.port';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';
import { SettingKey } from '../src/modules/settings/settings.constants';
import { variantKey } from '../src/common/variant-key';
import { addBusinessDays, isBusinessDay } from '../src/common/business-days';

/**
 * v1.51 — **EL CICLO DE ADQUISICIÓN: LA OFERTA.** `POST /admin/buylist/:id/offer`,
 * `…/offer/authorize`, `…/offer/cancel` y la respuesta del vendedor (`offer-response`).
 *
 * Es literalmente lo que pidió el humano: *«ahí mandamos el correo al cliente diciendo que estamos
 * dispuestos a comprar y a cuánto»*. Lo que estos tests protegen son las cinco propiedades sin las
 * cuales el ciclo **pierde dinero o miente**:
 *  1. **`ofertada` + `accept` ⇒ `aceptada`, JAMÁS `aprobada`** — si saltara, la solicitud caería en la
 *     cola de SPEI **sin envío, sin recepción y sin verificación**.
 *  2. **Por encima del tope: `202` y NINGÚN correo** — se asevera la **ausencia de la llamada**.
 *  3. **El neto se topa en CERO** — jamás un cargo al vendedor.
 *  4. **Override**: rebasar el tope no es puerta trasera; el válido queda **en bitácora**.
 *  5. **Los plazos son DÍAS HÁBILES**: una oferta de viernes **no vence el domingo**.
 */

const pii = new PiiCryptoService(new ConfigService({}));

const DIALS: Record<string, number> = {
  [SettingKey.BUYLIST_SHIPPING_FEE_CENTS]: 18000,
  [SettingKey.BUYLIST_MINIMUM_OFFER_NET_CENTS]: 20000,
  [SettingKey.BUYLIST_OPERATOR_OFFER_CAP_CENTS]: 150000,
  [SettingKey.BUYLIST_OFFER_ACCEPT_DEADLINE_BUSINESS_DAYS]: 2,
};

const OPERATOR = { id: 'op-1', role: 'vault_operator' as const };
const SUPER = { id: 'sa-1', role: 'super_admin' as const };

interface FakeItem {
  id: string;
  cardId?: string;
  quotedPriceCents?: number | null;
}

interface Opts {
  items?: FakeItem[];
  /** Referencia de mercado por acabado `normal` (MXN centavos). Ausente ⇒ `precio_pendiente`. */
  refCents?: number | null;
  status?: string;
  offerState?: string | null;
  pickupAddressSnapshot?: unknown;
  offerSentAt?: Date | null;
  offerAcceptDeadlineAt?: Date | null;
  shipmentTrackingNumber?: string | null;
  offerReissueCount?: number;
  now?: Date;
}

function build(opts: Opts = {}) {
  const items = (opts.items ?? [{ id: 'it-1' }]).map((i) => ({
    id: i.id,
    sellRequestId: 'sr-1',
    cardId: i.cardId ?? 'card-1',
    card: {
      id: i.cardId ?? 'card-1',
      name: 'Charizard VMAX',
      number: '020',
      rarity: 'Rare Holo',
      rarityCanonical: 'rare',
      subtypes: null,
      availableFinishes: ['normal'],
      set: { id: 's1', name: 'Darkness Ablaze' },
    },
    productType: 'raw' as const,
    rawCondition: 'NM' as const,
    finish: 'normal' as const,
    cardProductId: null,
    quotedPriceCents: i.quotedPriceCents === undefined ? 90000 : i.quotedPriceCents,
    approvedPriceCents: null,
    itemStatus: 'cotizada',
    inventoryItemId: null,
    offerDecision: null as string | null,
    offeredPriceCents: null as number | null,
    offerDerivedPriceCents: null as number | null,
    offerOverrideReason: null as string | null,
  }));

  const request: Record<string, unknown> = {
    id: 'sr-1',
    userId: 'u-1',
    user: { id: 'u-1', name: 'Ash Ketchum', email: 'ash@example.mx', locale: 'es' },
    status: opts.status ?? 'cotizada',
    offerState: opts.offerState === undefined ? null : opts.offerState,
    closedAt: null,
    quotedTotalCents: 90000,
    approvedTotalCents: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    pickupAddressSnapshot:
      'pickupAddressSnapshot' in opts ? opts.pickupAddressSnapshot : { line1: 'Av. Central 123' },
    offerSentAt: opts.offerSentAt ?? null,
    offerAcceptDeadlineAt: opts.offerAcceptDeadlineAt ?? null,
    offerGrossCents: null,
    offerShippingFeeCents: null,
    offerNetCents: null,
    offerIssueClockStartedAt: null,
    offerReissueCount: opts.offerReissueCount ?? 0,
    offerCancelledAt: null,
    acceptedAt: null,
    shipDeadlineAt: null,
    sellerShippedDeclaredAt: null,
    shipmentCarrier: null,
    shipmentTrackingNumber: opts.shipmentTrackingNumber ?? null,
    guideCancellationPendingAt: null,
    guideCancellationDoneAt: null,
    ineRequired: false,
    ineProvided: false,
  };

  const callOrder: string[] = [];
  /** Evalúa una condición Prisma de mentira. */
  const matches = (value: unknown, cond: unknown): boolean => {
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if ('in' in c) return (c.in as unknown[]).includes(value);
      if ('notIn' in c) return !(c.notIn as unknown[]).includes(value);
      if ('not' in c) return !matches(value, c.not);
      if ('gt' in c) return value instanceof Date && value.getTime() > (c.gt as Date).getTime();
      if ('increment' in c) return true;
      throw new Error(`condición no soportada: ${JSON.stringify(cond)}`);
    }
    if (value instanceof Date && cond instanceof Date) return value.getTime() === cond.getTime();
    return value === cond;
  };
  const whereHits = (where: Record<string, unknown>, row: Record<string, unknown>): boolean =>
    Object.entries(where).every(([k, cond]) => {
      if (k === 'OR') return (cond as Record<string, unknown>[]).some((c) => whereHits(c, row));
      return matches(row[k], cond);
    });
  const applyData = (target: Record<string, unknown>, data: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(data)) {
      if (v !== null && typeof v === 'object' && !(v instanceof Date) && 'increment' in v) {
        target[k] = ((target[k] as number) ?? 0) + ((v as { increment: number }).increment ?? 0);
      } else {
        target[k] = v;
      }
    }
  };

  const prisma: any = {
    sellRequest: {
      findUnique: jest.fn(async () => ({ ...request, items: items.map((i) => ({ ...i })) })),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const { id: _id, ...rest } = where;
        if (!whereHits(rest, request)) return { count: 0 };
        callOrder.push('sellRequest.updateMany');
        applyData(request, data);
        return { count: 1 };
      }),
      update: jest.fn(async () => {
        throw new Error('el ciclo de oferta NO transiciona con `update`: la guarda es el updateMany');
      }),
      findMany: jest.fn(async () => []),
    },
    sellRequestItem: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        callOrder.push('item.updateMany');
        const ids: string[] = where.id?.in ?? (where.id ? [where.id] : items.map((i) => i.id));
        for (const it of items) if (ids.includes(it.id)) applyData(it as never, data);
        return { count: ids.length };
      }),
      findMany: jest.fn(async () => []),
      aggregate: jest.fn(async () => ({
        _sum: { approvedPriceCents: null },
        _count: { approvedPriceCents: 0 },
      })),
    },
    kycProfile: { findUnique: jest.fn(async () => null) },
    inventoryItem: { groupBy: jest.fn(async () => []) },
    $transaction: jest.fn(async (cb: any) => {
      callOrder.push('tx.begin');
      const r = await cb(prisma);
      callOrder.push('tx.commit');
      return r;
    }),
  };

  const pricing = {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    gradeKeyFor: jest.fn(PricingService.prototype.gradeKeyFor),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getReferencesBatch: jest.fn(async (list: any[]) => {
      const m = new Map();
      if (opts.refCents != null) {
        for (const i of list) m.set(variantKey(i), { status: 'priced', referenceMxnCents: opts.refCents });
      }
      return m;
    }),
    findCardProductsByTcgIds: jest.fn(async () => new Map()),
    getReferencesByCardProductBatch: jest.fn(async () => new Map()),
  };
  const settings = { getNumber: jest.fn(async (k: any) => DIALS[k as string] ?? 0) };
  const mail: MailPort = {
    send: jest.fn(async () => {
      callOrder.push('mail.send');
      return { id: 'm1' };
    }),
  };
  const svc = new BuylistService(
    prisma as PrismaService,
    pricing as unknown as PricingService,
    settings as unknown as SettingsService,
    {} as UsersService,
    pii,
    mail,
  );
  return { svc, prisma, request, items, mail, callOrder };
}

/** `refCents` que produce un derivado ≈ el 40% de la curva. Se lee del resultado, no se adivina. */
async function derivedOf(refCents: number): Promise<number> {
  const { svc } = build({ refCents });
  const res = await svc.adminOffer('sr-1', SUPER, [{ itemId: 'it-1', decision: 'buy' }]);
  return res.response.offerGrossCents as number;
}

// =============================================================================================
describe('⚠️ (1) `ofertada` + `accept` ⇒ `aceptada`, JAMÁS `aprobada`', () => {
  const vivo = {
    status: 'ofertada',
    offerState: 'sent',
    offerSentAt: new Date('2026-08-10T00:00:00Z'),
    offerAcceptDeadlineAt: new Date('2100-01-01T00:00:00Z'),
  };

  it('acepta ⇒ `aceptada` + `acceptedAt`, y **NUNCA** `aprobada`', async () => {
    const { svc, request } = build(vivo);
    const res = await svc.offerResponse('u-1', 'sr-1', 'accept');
    expect(res.status).toBe('aceptada');
    // ⚠️ La aseveración que importa, dicha por lo negativo: si esto fuera `aprobada`, la solicitud
    // caería en la cola de SPEI sin envío, sin recepción y sin verificación.
    expect(res.status).not.toBe('aprobada');
    expect(request.status).toBe('aceptada');
    expect(request.status).not.toBe('aprobada');
    expect(request.acceptedAt).toBeInstanceOf(Date);
  });

  it('aceptar NO produce ninguna transición de dinero: ni montos ni ítems se tocan', async () => {
    const { svc, request, items, prisma } = build(vivo);
    const antes = JSON.stringify(items);
    await svc.offerResponse('u-1', 'sr-1', 'accept');
    // No habilita el pago: `verifiedAt` sigue nulo y `approvedTotalCents` no se inventa.
    expect(request.verifiedAt).toBeUndefined();
    expect(request.approvedTotalCents).toBeNull();
    expect(JSON.stringify(items)).toBe(antes);
    expect(prisma.sellRequestItem.updateMany).not.toHaveBeenCalled();
  });

  it('rechaza ⇒ `rechazada` + `closedAt` (terminal)', async () => {
    const { svc, request } = build(vivo);
    const res = await svc.offerResponse('u-1', 'sr-1', 'reject');
    expect(res.status).toBe('rechazada');
    expect(res.isTerminal).toBe(true);
    expect(request.closedAt).toBeInstanceOf(Date);
  });

  it('plazo vencido ⇒ `409 OFFER_EXPIRED`, y NADA se mueve', async () => {
    const { svc, request } = build({
      ...vivo,
      offerAcceptDeadlineAt: new Date('2020-01-01T00:00:00Z'),
    });
    await expect(svc.offerResponse('u-1', 'sr-1', 'accept')).rejects.toMatchObject({
      code: 'OFFER_EXPIRED',
      status: 409,
    });
    expect(request.status).toBe('ofertada');
  });

  it('sobre una solicitud que no está `ofertada` ⇒ `409 OFFER_NOT_PENDING`', async () => {
    const { svc } = build({ status: 'cotizada', offerState: null });
    await expect(svc.offerResponse('u-1', 'sr-1', 'accept')).rejects.toMatchObject({
      code: 'OFFER_NOT_PENDING',
      details: { status: 'cotizada' },
    });
  });

  it('un TERCERO con sesión propia ⇒ 404 (no 403: no se confirma la existencia)', async () => {
    const { svc, request } = build(vivo);
    await expect(svc.offerResponse('otro-user', 'sr-1', 'accept')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(request.status).toBe('ofertada');
  });

  it('la guarda vive en el `where` (incluido el PLAZO), no en un `if` de aplicación', async () => {
    const { svc, prisma } = build(vivo);
    await svc.offerResponse('u-1', 'sr-1', 'accept');
    const where = prisma.sellRequest.updateMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ userId: 'u-1', status: 'ofertada', offerState: 'sent' });
    expect(where.offerAcceptDeadlineAt).toHaveProperty('gt');
  });
});

// =============================================================================================
describe('⚠️ (2) Por encima del tope del operador: `202` y NINGÚN correo', () => {
  it('operador con bruto > tope ⇒ `pending_authorization`, `status` sigue `cotizada`, y el correo NO sale', async () => {
    // Bruto muy por encima del tope de MX$1,500.
    const { svc, request, mail } = build({ refCents: 900000 });
    const res = await svc.adminOffer('sr-1', OPERATOR, [{ itemId: 'it-1', decision: 'buy' }]);
    expect(res.audit.requiresAuthorization).toBe(true);
    expect(res.response.requiresAuthorization).toBe(true);
    expect(res.response.offerState).toBe('pending_authorization');
    // ⚠️ El cliente NO debe enterarse de que existe.
    expect(res.response.status).toBe('cotizada');
    expect(request.status).toBe('cotizada');
    expect(request.offerSentAt).toBeNull();
    expect(res.response.offerAcceptDeadlineAt).toBeNull();
    // ⚠️ AUSENCIA de la llamada, no solo el código: mandarlo le filtraría el orden de magnitud de
    // nuestro tope interno.
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('el súper-admin oferta SIN tope: `sent` + `ofertada` + el correo SALE', async () => {
    const { svc, request, mail } = build({ refCents: 900000 });
    const res = await svc.adminOffer('sr-1', SUPER, [{ itemId: 'it-1', decision: 'buy' }]);
    expect(res.response.offerState).toBe('sent');
    expect(res.response.status).toBe('ofertada');
    expect(request.offerSentAt).toBeInstanceOf(Date);
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  /**
   * ⚠️ **LOS TRES BORDES DEL CICLO SON INCLUSIVOS, y significan lo mismo: *el número exacto PASA*.**
   * Se escriben con comparadores distintos porque miden en direcciones distintas, **pero el error a
   * evitar es idéntico en los tres: implementar uno estricto y rechazar exactamente la cifra que
   * prometimos.** Aquí se fija el bruto con un **override** en vez de barrer la curva: el borde es
   * una propiedad del comparador, no de la curva, y una búsqueda por aproximación haría que el test
   * dependiera de una tabla de precios que se edita sin redeploy.
   */
  it.each([
    [149900, false, '$1,499 sale sola'],
    [150000, false, '⭐ $1,500 — el borde INCLUSIVO: sale sola'],
    [150100, true, '$1,501 espera autorización'],
  ])('tope del operador con bruto %i ⇒ requiresAuthorization=%s (%s)', async (gross, esperado) => {
    const { svc, mail } = build({ refCents: 300000 });
    const res = await svc.adminOffer('sr-1', OPERATOR, [
      { itemId: 'it-1', decision: 'buy', overridePriceCents: gross, overrideReason: 'borde del tope' },
    ]);
    expect(res.response.offerGrossCents).toBe(gross);
    expect(res.audit.requiresAuthorization).toBe(esperado);
    expect((mail.send as jest.Mock).mock.calls.length).toBe(esperado ? 0 : 1);
  });

  it('`authorize` saca la oferta guardada: `sent` + `ofertada` + correo, y congela el plazo AHORA', async () => {
    const { svc, request, mail } = build({ status: 'cotizada', offerState: 'pending_authorization' });
    const res = await svc.adminOfferAuthorize('sr-1', SUPER);
    expect(res.response.offerState).toBe('sent');
    expect(res.response.status).toBe('ofertada');
    expect(request.offerAuthorizedBy).toBe('sa-1');
    // Los dos actores quedan por SEPARADO (criterio 147).
    expect(request.offerPreparedBy).not.toBe(request.offerAuthorizedBy);
    expect(res.response.offerAcceptDeadlineAt).toBeInstanceOf(Date);
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it('⚠️ `authorize` tiene DOS candados: una `cotizada` que ya caducó NO se resucita', async () => {
    // El barrido dejó la solicitud `expirada` sin anular la oferta (el refactor que el segundo
    // candado existe para cubrir). Sin él, el súper-admin resucitaría una TERMINAL con un correo
    // vinculante.
    const { svc, mail } = build({ status: 'expirada', offerState: 'pending_authorization' });
    await expect(svc.adminOfferAuthorize('sr-1', SUPER)).rejects.toMatchObject({
      code: 'OFFER_NOT_PENDING_AUTHORIZATION',
      details: { status: 'expirada', offerState: 'pending_authorization' },
    });
    expect(mail.send).not.toHaveBeenCalled();
  });
});

// =============================================================================================
describe('⚠️ (3) El NETO nunca es negativo: se topa en CERO', () => {
  it('bruto por debajo de la tarifa ⇒ neto 0, jamás un cargo — y el piso lo frena', async () => {
    // Oferta ~$100 con tarifa $180. `max(0,…)` no es una defensa: es la DEFINICIÓN.
    const { svc } = build({ refCents: 25000 });
    let capturado: Record<string, number> | null = null;
    await svc
      .adminOffer('sr-1', SUPER, [{ itemId: 'it-1', decision: 'buy' }])
      .catch((e: { code: string; getResponse(): { details?: Record<string, number> } }) => {
        expect(e.code).toBe('OFFER_NET_BELOW_MINIMUM');
        capturado = (e.getResponse().details ?? null) as Record<string, number> | null;
      });
    expect(capturado).not.toBeNull();
    const d = capturado as unknown as Record<string, number>;
    expect(d.grossCents).toBeLessThan(18000);
    // ⚠️ El neto se topa en CERO — nunca negativo, nunca una deuda del vendedor (criterio 152).
    expect(d.netCents).toBe(0);
    expect(d.netCents).toBeGreaterThanOrEqual(0);
    // El `max(0,…)` NO enmascara nada: el faltante se calcula sobre el bruto y es el completo.
    expect(d.requiredGrossCents).toBe(38000);
    expect(d.grossShortfallCents).toBe(38000 - d.grossCents);
  });

  /** Los bordes NORMATIVOS del piso, tal como los tabula el contrato (D40). */
  it.each([
    [37999, 19999, true, 1, 'un centavo por debajo NO sale'],
    [38000, 20000, false, 0, '⭐ el borde INCLUSIVO: neto IGUAL al piso es legal'],
    [38001, 20001, false, 0, 'por encima, obviamente sale'],
    [18000, 0, true, 20000, 'el max(0,…) NO enmascara nada'],
  ])(
    'piso de neto con bruto %i ⇒ neto %i · ¿422? %s (%s)',
    async (gross, net, dispara, shortfall) => {
      const { svc, mail } = build({ refCents: 300000 });
      const emitir = () =>
        svc.adminOffer('sr-1', SUPER, [
          { itemId: 'it-1', decision: 'buy', overridePriceCents: gross, overrideReason: 'borde del piso' },
        ]);
      if (dispara) {
        await expect(emitir()).rejects.toMatchObject({
          code: 'OFFER_NET_BELOW_MINIMUM',
          details: { netCents: net, grossShortfallCents: shortfall },
        });
        expect(mail.send).not.toHaveBeenCalled();
      } else {
        const res = await emitir();
        expect(res.response.offerNetCents).toBe(net);
        expect(mail.send).toHaveBeenCalledTimes(1);
      }
    },
  );

  it('ninguna línea `buy` ⇒ no hay oferta que emitir (bruto 0 ⇒ el piso frena)', async () => {
    const { svc, mail } = build({ refCents: 300000 });
    await expect(
      svc.adminOffer('sr-1', SUPER, [{ itemId: 'it-1', decision: 'skip' }]),
    ).rejects.toMatchObject({ code: 'OFFER_NET_BELOW_MINIMUM' });
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('el piso se evalúa ANTES del tope: nada inofertable llega a la cola de autorización', async () => {
    const { svc, request } = build({ refCents: 25000 });
    await expect(
      svc.adminOffer('sr-1', OPERATOR, [{ itemId: 'it-1', decision: 'buy' }]),
    ).rejects.toMatchObject({ code: 'OFFER_NET_BELOW_MINIMUM' });
    expect(request.offerState).toBeNull();
  });

  it('la tarifa se CONGELA en la fila, no se relee del dial al pagar', async () => {
    const { svc, request } = build({ refCents: 900000 });
    await svc.adminOffer('sr-1', SUPER, [{ itemId: 'it-1', decision: 'buy' }]);
    expect(request.offerShippingFeeCents).toBe(18000);
    expect(request.offerNetCents).toBe((request.offerGrossCents as number) - 18000);
  });
});

// =============================================================================================
describe('⚠️ (4) Override — motivo obligatorio, sin puerta trasera al tope, y en bitácora', () => {
  it('override que difiere del derivado SIN motivo ⇒ `422 OVERRIDE_REASON_REQUIRED`', async () => {
    const { svc, request } = build({ refCents: 300000 });
    await expect(
      svc.adminOffer('sr-1', SUPER, [
        { itemId: 'it-1', decision: 'buy', overridePriceCents: 99000 },
      ]),
    ).rejects.toMatchObject({ code: 'OVERRIDE_REASON_REQUIRED', details: { itemIds: ['it-1'] } });
    expect(request.offerState).toBeNull();
  });

  it('⚠️ el override NO es puerta trasera al tope: se juzga el bruto RESULTANTE', async () => {
    // Derivado pequeño (bajo el tope), override que lo rebasa ⇒ requiere autorización igual.
    const { svc, mail } = build({ refCents: 120000 });
    const res = await svc.adminOffer('sr-1', OPERATOR, [
      {
        itemId: 'it-1',
        decision: 'buy',
        overridePriceCents: 900000,
        overrideReason: 'carta firmada por el ilustrador, vale más que la curva',
      },
    ]);
    expect(res.response.offerGrossCents).toBe(900000);
    expect(res.audit.requiresAuthorization).toBe(true);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('override válido ⇒ persiste LOS TRES datos y sale en la bitácora con actor, monto y motivo', async () => {
    const { svc, items } = build({ refCents: 300000 });
    const res = await svc.adminOffer('sr-1', SUPER, [
      {
        itemId: 'it-1',
        decision: 'buy',
        overridePriceCents: 111000,
        overrideReason: 'lote pactado con el vendedor por teléfono',
      },
    ]);
    // Los TRES datos, para que el delta sea visible SIN leer la bitácora (criterio 148b).
    expect(items[0].offeredPriceCents).toBe(111000);
    expect(items[0].offerDerivedPriceCents).toBeGreaterThan(0);
    expect(items[0].offerDerivedPriceCents).not.toBe(111000);
    expect(items[0].offerOverrideReason).toBe('lote pactado con el vendedor por teléfono');
    // Y el asiento de bitácora, con quién / derivado / fijado / por qué (el actor lo pone el
    // controller, que es quien lo tiene).
    expect(res.audit.overrides).toEqual([
      {
        itemId: 'it-1',
        derivedPriceCents: items[0].offerDerivedPriceCents,
        offeredPriceCents: 111000,
        reason: 'lote pactado con el vendedor por teléfono',
      },
    ]);
  });

  it('reenviar EXACTAMENTE el derivado no es override: no exige motivo ni se audita', async () => {
    const derived = await derivedOf(300000);
    const { svc, items } = build({ refCents: 300000 });
    const res = await svc.adminOffer('sr-1', SUPER, [
      { itemId: 'it-1', decision: 'buy', overridePriceCents: derived },
    ]);
    expect(res.audit.overrides).toEqual([]);
    expect(items[0].offerOverrideReason).toBeNull();
  });

  it('el override es lo ÚNICO que rescata una línea en «precio pendiente»', async () => {
    // Sin mercado, `decideBuyLine` no da monto: sin override ⇒ 422; con override ⇒ sale.
    const sinRescate = build({ refCents: null });
    await expect(
      sinRescate.svc.adminOffer('sr-1', SUPER, [{ itemId: 'it-1', decision: 'buy' }]),
    ).rejects.toMatchObject({ code: 'OFFER_LINE_NOT_PRICEABLE', details: { itemIds: ['it-1'] } });

    const conRescate = build({ refCents: null });
    const res = await conRescate.svc.adminOffer('sr-1', SUPER, [
      { itemId: 'it-1', decision: 'buy', overridePriceCents: 90000, overrideReason: 'precio pactado' },
    ]);
    expect(res.response.offerGrossCents).toBe(90000);
    // `null` derivado: la línea estaba en `precio_pendiente` y el rescate queda `override`.
    expect(conRescate.items[0].offerDerivedPriceCents).toBeNull();
    expect(conRescate.items[0].offerDecision).toBe('buy');
  });

  it('la otra salida legítima de una línea sin precio es `skip`', async () => {
    const { svc, items } = build({ refCents: null, items: [{ id: 'it-1' }, { id: 'it-2' }] });
    // it-2 se rescata para que la oferta pase el piso; it-1 se descarta.
    await svc.adminOffer('sr-1', SUPER, [
      { itemId: 'it-1', decision: 'skip' },
      { itemId: 'it-2', decision: 'buy', overridePriceCents: 90000, overrideReason: 'pactado' },
    ]);
    expect(items[0].offerDecision).toBe('skip');
    expect(items[0].offeredPriceCents).toBeNull();
  });
});

// =============================================================================================
describe('⚠️ (5) Los plazos son DÍAS HÁBILES: una oferta de viernes NO vence el domingo', () => {
  it('viernes + 2 días hábiles ⇒ martes (no domingo), y el día resultante es hábil', async () => {
    // 2026-09-04 es viernes. Con 2 días hábiles el plazo NO puede caer en sábado ni domingo.
    const viernes = new Date('2026-09-04T18:00:00Z');
    const plazo = addBusinessDays(viernes, 2);
    expect(isBusinessDay(plazo)).toBe(true);
    // Ni sábado (5) ni domingo (6) de ese mismo fin de semana.
    expect(plazo.getTime()).toBeGreaterThan(new Date('2026-09-06T23:59:59Z').getTime());
  });

  it('la oferta emitida CONGELA el plazo, y cae en día hábil', async () => {
    const { svc, request } = build({ refCents: 900000 });
    const res = await svc.adminOffer('sr-1', SUPER, [{ itemId: 'it-1', decision: 'buy' }]);
    const plazo = res.response.offerAcceptDeadlineAt as Date;
    expect(plazo).toBeInstanceOf(Date);
    expect(isBusinessDay(plazo)).toBe(true);
    // Congelado en columna: mover el dial en M10 no toca esta solicitud (criterio 157).
    expect(request.offerAcceptDeadlineAt).toEqual(plazo);
  });
});

// =============================================================================================
describe('Precondiciones y guardas de la emisión', () => {
  it('⚠️ sin dirección de origen NO se oferta (D36), y se evalúa AL PRINCIPIO', async () => {
    const { svc, prisma } = build({ refCents: 900000, pickupAddressSnapshot: null });
    await expect(
      svc.adminOffer('sr-1', SUPER, [{ itemId: 'it-1', decision: 'buy' }]),
    ).rejects.toMatchObject({ code: 'PICKUP_ADDRESS_MISSING', details: { sellRequestId: 'sr-1' } });
    // Ni siquiera se miraron las líneas: no se leyó la curva ni se escribió nada.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('sobre una oferta YA ENVIADA ⇒ `409 OFFER_ALREADY_SENT` (se cancela y se emite otra)', async () => {
    const { svc } = build({ status: 'ofertada', offerState: 'sent', refCents: 900000 });
    await expect(
      svc.adminOffer('sr-1', SUPER, [{ itemId: 'it-1', decision: 'buy' }]),
    ).rejects.toMatchObject({ code: 'OFFER_ALREADY_SENT' });
  });

  it('sobre una solicitud que no está `cotizada` ⇒ `409 OFFER_NOT_ALLOWED`', async () => {
    const { svc } = build({ status: 'recibida', refCents: 900000 });
    await expect(
      svc.adminOffer('sr-1', SUPER, [{ itemId: 'it-1', decision: 'buy' }]),
    ).rejects.toMatchObject({ code: 'OFFER_NOT_ALLOWED', details: { status: 'recibida' } });
  });

  it('las líneas deben cubrir EXACTAMENTE los ítems (ni faltar ni sobrar)', async () => {
    const dos = build({ refCents: 900000, items: [{ id: 'it-1' }, { id: 'it-2' }] });
    await expect(
      dos.svc.adminOffer('sr-1', SUPER, [{ itemId: 'it-1', decision: 'buy' }]),
    ).rejects.toMatchObject({
      code: 'OFFER_LINES_MISMATCH',
      details: { missingItemIds: ['it-2'], unknownItemIds: [] },
    });
    const sobra = build({ refCents: 900000 });
    await expect(
      sobra.svc.adminOffer('sr-1', SUPER, [
        { itemId: 'it-1', decision: 'buy' },
        { itemId: 'fantasma', decision: 'buy' },
      ]),
    ).rejects.toMatchObject({ details: { unknownItemIds: ['fantasma'] } });
  });

  it('⚠️ INVARIANTE `offerDecision=buy ⇒ offeredPriceCents IS NOT NULL`, en la MISMA transacción', async () => {
    const { svc, items, callOrder } = build({
      refCents: 900000,
      items: [{ id: 'it-1' }, { id: 'it-2' }],
    });
    await svc.adminOffer('sr-1', SUPER, [
      { itemId: 'it-1', decision: 'buy' },
      { itemId: 'it-2', decision: 'skip' },
    ]);
    for (const it of items) {
      if (it.offerDecision === 'buy') expect(it.offeredPriceCents).not.toBeNull();
      if (it.offerDecision === 'skip') expect(it.offeredPriceCents).toBeNull();
    }
    // Sin esto, `convertToInventory` capitalizaría el precio COTIZADO de una pieza comprada a otro
    // precio, sin fallar y sin avisar (§4.39i.5).
    expect(items[0].offeredPriceCents).toBeGreaterThan(0);
    // Encabezado y líneas dentro del MISMO boundary.
    const begin = callOrder.indexOf('tx.begin');
    const commit = callOrder.indexOf('tx.commit');
    expect(callOrder.indexOf('sellRequest.updateMany')).toBeGreaterThan(begin);
    expect(callOrder.lastIndexOf('item.updateMany')).toBeLessThan(commit);
  });

  it('⚠️ el correo sale DESPUÉS del commit y su fallo NO revierte la oferta', async () => {
    const { svc, request, callOrder, mail } = build({ refCents: 900000 });
    (mail.send as jest.Mock).mockImplementation(async () => {
      callOrder.push('mail.send');
      throw new Error('resend caído');
    });
    const res = await svc.adminOffer('sr-1', SUPER, [{ itemId: 'it-1', decision: 'buy' }]);
    // La oferta quedó emitida pese al fallo del correo.
    expect(res.response.offerState).toBe('sent');
    expect(request.status).toBe('ofertada');
    // Y el envío ocurrió DESPUÉS del commit — nunca dentro de la transacción.
    expect(callOrder.indexOf('mail.send')).toBeGreaterThan(callOrder.indexOf('tx.commit'));
  });

  it('el correo lleva los TRES montos y NADA de PII bancaria ni cifras internas', async () => {
    const { svc, mail } = build({ refCents: 900000 });
    await svc.adminOffer('sr-1', SUPER, [{ itemId: 'it-1', decision: 'buy' }]);
    const msg = (mail.send as jest.Mock).mock.calls[0][0];
    expect(msg.to).toBe('ash@example.mx');
    // «La resta se ENSEÑA, no se esconde»: valor, envío y lo que se deposita.
    expect(msg.text).toMatch(/Valor de las cartas/);
    expect(msg.text).toMatch(/Env[íi]o que ponemos nosotros/);
    expect(msg.text).toMatch(/SE TE DEPOSITAN/);
    expect(msg.text).toMatch(/Near Mint/);
    // Minimización: nada de CLABE, de la mesa ni del tope interno.
    expect(JSON.stringify(msg)).not.toMatch(/clabe/i);
    expect(JSON.stringify(msg)).not.toMatch(/posici[óo]n|tope|bounty/i);
  });

  it('S15-B1: el nombre del vendedor se ESCAPA en el HTML del correo', async () => {
    const { svc, mail, request } = build({ refCents: 900000 });
    (request.user as Record<string, unknown>).name = '<script>alert(1)</script>';
    await svc.adminOffer('sr-1', SUPER, [{ itemId: 'it-1', decision: 'buy' }]);
    const msg = (mail.send as jest.Mock).mock.calls[0][0];
    expect(msg.html).not.toContain('<script>');
    expect(msg.html).toContain('&lt;script&gt;');
  });
});

// =============================================================================================
describe('Cancelar la oferta (criterio 145, D38, v1.51.4)', () => {
  const enviada = {
    status: 'ofertada',
    offerState: 'sent',
    offerSentAt: new Date('2026-08-10T00:00:00Z'),
    offerAcceptDeadlineAt: new Date('2026-08-12T00:00:00Z'),
  };

  it('cancelar una ENVIADA: vuelve a `cotizada`, limpia lo congelado y **manda el correo 5**', async () => {
    const { svc, request, items, mail } = build(enviada);
    items[0].offerDecision = 'buy';
    items[0].offeredPriceCents = 90000;
    await svc.adminOfferCancel('sr-1', OPERATOR, 'me equivoqué en un número');
    expect(request.status).toBe('cotizada');
    expect(request.offerState).toBe('cancelled');
    expect(request.offerGrossCents).toBeNull();
    expect(request.offerAcceptDeadlineAt).toBeNull();
    expect(items[0].offerDecision).toBeNull();
    expect(items[0].offeredPriceCents).toBeNull();
    expect(mail.send).toHaveBeenCalledTimes(1);
    const msg = (mail.send as jest.Mock).mock.calls[0][0];
    // Prohibido: «venció», plazos del vendedor y CUALQUIER monto (se limpiaron y no se resucitan).
    expect(msg.text).not.toMatch(/venci[óo]|vence/i);
    expect(msg.text).not.toMatch(/MX\$/);
    expect(msg.text).toMatch(/la cancelamos nosotros/i);
  });

  it('⚠️ D38 — cancelar una ENVIADA REINICIA el reloj y cuenta la re-emisión', async () => {
    const { svc, request } = build(enviada);
    await svc.adminOfferCancel('sr-1', OPERATOR);
    // El vendedor vuelve a la fila con los 7 días hábiles ÍNTEGROS: no paga por una corrección
    // nuestra.
    expect(request.offerIssueClockStartedAt).toBeInstanceOf(Date);
    expect(request.offerReissueCount).toBe(1);
  });

  it('⚠️ EL CANDADO — cancelar una `pending_authorization` NO reinicia, NO cuenta y NO manda correo', async () => {
    const { svc, request, mail } = build({ status: 'cotizada', offerState: 'pending_authorization' });
    await svc.adminOfferCancel('sr-1', OPERATOR);
    expect(request.offerState).toBe('cancelled');
    // Esa oferta NUNCA existió para el vendedor: escribirle le filtraría que preparamos algo por
    // encima del tope del operador.
    expect(mail.send).not.toHaveBeenCalled();
    expect(request.offerIssueClockStartedAt).toBeNull();
    expect(request.offerReissueCount).toBe(0);
    // Y así el bucle SILENCIOSO (preparar→cancelar→preparar) no puede reiniciar nada:
    // *el reinicio no ocurre sin que al vendedor le llegue un correo.*
  });

  it('los TRES efectos cuelgan del MISMO `if`: o van los tres, o no va ninguno', async () => {
    for (const [offerState, esperado] of [
      ['sent', true],
      ['pending_authorization', false],
    ] as const) {
      const { svc, request, mail } = build({
        ...enviada,
        status: offerState === 'sent' ? 'ofertada' : 'cotizada',
        offerState,
      });
      await svc.adminOfferCancel('sr-1', OPERATOR);
      const reloj = request.offerIssueClockStartedAt != null;
      const conteo = (request.offerReissueCount as number) > 0;
      const correo = (mail.send as jest.Mock).mock.calls.length > 0;
      expect({ reloj, conteo, correo }).toEqual({
        reloj: esperado,
        conteo: esperado,
        correo: esperado,
      });
    }
  });

  it('una `aceptada` NO se cancela por esta vía ⇒ `409 OFFER_NOT_CANCELLABLE`', async () => {
    const { svc, mail } = build({ status: 'aceptada', offerState: 'sent' });
    await expect(svc.adminOfferCancel('sr-1', OPERATOR)).rejects.toMatchObject({
      code: 'OFFER_NOT_CANCELLABLE',
      status: 409,
    });
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('sin oferta viva ⇒ `409 OFFER_NOT_CANCELLABLE`', async () => {
    const { svc } = build({ status: 'cotizada', offerState: null });
    await expect(svc.adminOfferCancel('sr-1', OPERATOR)).rejects.toMatchObject({
      code: 'OFFER_NOT_CANCELLABLE',
    });
  });

  it('la oferta cancelada sobrevive ÍNTEGRA en el payload de bitácora', async () => {
    const { svc, request, items } = build(enviada);
    request.offerGrossCents = 90000;
    request.offerNetCents = 72000;
    items[0].offerDecision = 'buy';
    items[0].offeredPriceCents = 90000;
    const { audit } = await svc.adminOfferCancel('sr-1', OPERATOR, 'número mal puesto');
    expect(audit.before.offerGrossCents).toBe(90000);
    expect(audit.before.offerNetCents).toBe(72000);
    expect(audit.before.lines).toEqual([
      expect.objectContaining({ itemId: 'it-1', offerDecision: 'buy', offeredPriceCents: 90000 }),
    ]);
    expect(audit.reason).toBe('número mal puesto');
  });

  it('con guía emitida, cancelar abre la tarea «cancelar guía no usada» (D22)', async () => {
    const { svc, request } = build({ ...enviada, shipmentTrackingNumber: 'GUIA-1' });
    await svc.adminOfferCancel('sr-1', OPERATOR);
    expect(request.guideCancellationPendingAt).toBeInstanceOf(Date);
  });

  it('tras cancelar se puede EMITIR OTRA (el estado `cancelled` es re-ofertable)', async () => {
    const { svc, request, mail } = build({ offerState: 'cancelled', refCents: 900000 });
    const res = await svc.adminOffer('sr-1', SUPER, [{ itemId: 'it-1', decision: 'buy' }]);
    expect(res.response.offerState).toBe('sent');
    expect(request.status).toBe('ofertada');
    expect(mail.send).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================================
describe('La oferta como la ve el VENDEDOR (`SellOfferPublicDTO`)', () => {
  const vivo = {
    status: 'ofertada',
    offerState: 'sent',
    offerSentAt: new Date('2026-08-10T00:00:00Z'),
    offerAcceptDeadlineAt: new Date('2100-01-01T00:00:00Z'),
  };

  it('⚠️ NUNCA lleva `offerState` ni ninguna cifra interna de la mesa', async () => {
    const { svc, request } = build(vivo);
    request.offerGrossCents = 90000;
    request.offerShippingFeeCents = 18000;
    request.offerNetCents = 72000;
    const res = await svc.offerResponse('u-1', 'sr-1', 'accept');
    expect(res.offer).not.toBeNull();
    // `offerState` le filtraría la existencia y el orden de magnitud de nuestro tope interno.
    expect(res.offer).not.toHaveProperty('offerState');
    const json = JSON.stringify(res);
    expect(json).not.toMatch(/pending_authorization/);
    expect(json).not.toMatch(/operatorCap|position|suggestion/i);
    expect(json).not.toMatch(/clabe/i);
  });

  it('lleva LOS TRES montos y los `terms` RENDERIZADOS por el backend', async () => {
    const { svc, request } = build(vivo);
    request.offerGrossCents = 90000;
    request.offerShippingFeeCents = 18000;
    request.offerNetCents = 72000;
    const res = await svc.offerResponse('u-1', 'sr-1', 'accept');
    expect(res.offer).toMatchObject({ grossCents: 90000, shippingFeeCents: 18000, netCents: 72000 });
    // El front NO redacta el texto legal ni recalcula plazos: los recibe.
    expect(res.offer?.terms.perLineConditionLabel).toMatch(/Near Mint/);
    expect(res.offer?.terms.consequence).toMatch(/NO cancela la compra de las demás/);
    expect(res.offer?.acceptDeadlineAt).toBeInstanceOf(Date);
  });

  it('`offer` es `null` mientras la oferta NO esté enviada (p. ej. esperando autorización)', async () => {
    const { svc } = build({ status: 'cotizada', offerState: 'pending_authorization' });
    const res: any = await svc.getMine('u-1', 'sr-1');
    expect(res.offer).toBeNull();
  });

  it('el detalle del vendedor SÍ trae la oferta enviada (el correo lleva a una pantalla que la muestra)', async () => {
    const { svc, request } = build(vivo);
    request.offerGrossCents = 90000;
    request.offerShippingFeeCents = 18000;
    request.offerNetCents = 72000;
    const res: any = await svc.getMine('u-1', 'sr-1');
    expect(res.offer).toMatchObject({ netCents: 72000 });
    expect(res.offer.lines).toHaveLength(1);
  });
});
