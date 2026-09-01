import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import {
  BuylistService,
  offerProjectionGaps,
} from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { BusinessException } from '../src/common/business.exception';
import { MailPort } from '../src/modules/mail/mail.port';
import { SettingKey } from '../src/modules/settings/settings.constants';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';
import {
  offerTermsCopy,
  sellOfferTemplate,
} from '../src/modules/buylist/buylist-mail.templates';
import { deriveRejectedReason } from '../src/modules/buylist/buylist-reject.constants';

/**
 * v1.51.15/v1.51.16 — **BL-23 (lo que el portal necesita) y BL-24 (la guarda de emisión).**
 *
 * BL-24 es la importante y es de **dinero y de justicia**: si una oferta llega **inmostrable** al
 * portal, el vendedor **no puede aceptar**, el barrido **sigue contando sus 2 días hábiles** y acaba
 * recibiendo un correo diciéndole que **no respondió**. *Falló nuestra proyección y la factura le
 * llegaba a él.* La guarda lo hace **imposible por construcción**: si la proyección de cliente no
 * está completa, **la oferta no se emite** — y entonces la solicitud se queda `cotizada`, que es
 * donde la mira **NUESTRO** plazo (regla 7) y no el suyo (regla 1).
 */

const pii = new PiiCryptoService(new ConfigService({}));
const SUPER = { id: 'sa-1', role: 'super_admin' as const };
const OPERATOR = { id: 'op-1', role: 'vault_operator' as const };

const DIALS: Record<string, number> = {
  [SettingKey.BUYLIST_SHIPPING_FEE_CENTS]: 18000,
  [SettingKey.BUYLIST_MINIMUM_OFFER_NET_CENTS]: 20000,
  [SettingKey.BUYLIST_OPERATOR_OFFER_CAP_CENTS]: 150000,
  [SettingKey.BUYLIST_OFFER_ACCEPT_DEADLINE_BUSINESS_DAYS]: 2,
};

interface Opts {
  /** ⚠️ `true` = el doble de BD **no escribe `offerDecision`** ⇒ proyección inmostrable. */
  dropItemWrites?: boolean;
  itemCount?: number;
  locale?: string | null;
  actor?: { id: string; role: 'super_admin' | 'vault_operator' };
}

function build(opts: Opts = {}) {
  const items = Array.from({ length: opts.itemCount ?? 1 }, (_, n) => ({
    id: `it-${n + 1}`,
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
    itemStatus: 'cotizada',
    approvedPriceCents: null,
    inventoryItemId: null,
    offerDecision: null as string | null,
    offeredPriceCents: null as number | null,
  }));

  const request: Record<string, unknown> = {
    id: 'sr-1',
    userId: 'u-1',
    user: { id: 'u-1', name: 'Ash', email: 'ash@e.mx', locale: opts.locale ?? 'es' },
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
    guideSentAt: null,
    shipDeadlineAt: null,
    acceptedAt: null,
    sellerShippedDeclaredAt: null,
    shipmentCarrier: null,
    shipmentTrackingNumber: null,
    guideCancellationDoneAt: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    items,
  };

  const prisma: any = {
    sellRequest: {
      findUnique: jest.fn(async () => ({ ...request, items: request.items })),
      findMany: jest.fn(async () => [{ ...request, items: request.items }]),
      updateMany: jest.fn(async ({ data }: any) => {
        Object.assign(request, data);
        return { count: 1 };
      }),
    },
    sellRequestItem: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        const ids: string[] = where.id?.in ?? (where.id ? [where.id] : []);
        // ⚠️ El interruptor del test: con `dropItemWrites` la escritura se PIERDE en silencio —
        // exactamente el defecto que BL-24 existe para atrapar.
        if (!opts.dropItemWrites) {
          for (const it of items) if (ids.includes(it.id)) Object.assign(it, data);
        }
        return { count: ids.length };
      }),
    },
    // Doble FIEL de la transacción: si el callback lanza, **se deshace todo** (que es la propiedad
    // de la que depende «no se persiste, no se congela plazo»).
    $transaction: jest.fn(async (cb: any) => {
      const snapReq = { ...request };
      const snapItems = items.map((i) => ({ ...i }));
      try {
        return await cb(prisma);
      } catch (e) {
        for (const k of Object.keys(request)) delete (request as Record<string, unknown>)[k];
        Object.assign(request, snapReq);
        items.forEach((it, n) => Object.assign(it, snapItems[n]));
        throw e;
      }
    }),
  };
  const pricing = {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    gradeKeyFor: jest.fn(() => 'raw:NM'),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getReferencesBatch: jest.fn(async () => new Map()),
    findCardProductsByTcgIds: jest.fn(async () => new Map()),
    getReferencesByCardProductBatch: jest.fn(async () => new Map()),
  };
  const settings = { getNumber: jest.fn(async (k: any) => DIALS[k as string] ?? 7) };
  const mail: MailPort = { send: jest.fn(async () => ({ id: 'm' })) };
  const svc = new BuylistService(
    prisma as PrismaService,
    pricing as unknown as PricingService,
    settings as unknown as SettingsService,
    {} as UsersService,
    pii,
    mail,
  );
  const lines = items.map((i) => ({
    itemId: i.id,
    decision: 'buy' as const,
    overridePriceCents: 90000,
    overrideReason: 'pactado con el vendedor',
  }));
  return { svc, prisma, request, items, mail, lines, actor: opts.actor ?? SUPER };
}

// =============================================================================================
describe('⚠️⚠️ BL-24 — una oferta inmostrable NO SE EMITE', () => {
  it('camino feliz: con la proyección completa la oferta SALE y sella `offerSentAt`', async () => {
    const { svc, request, mail, lines, actor } = build();
    const res = await svc.adminOffer('sr-1', actor, lines);
    expect(res.response.status).toBe('ofertada');
    expect(request.offerSentAt).toBeInstanceOf(Date);
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it('⚠️ una línea sin `offerDecision` ⇒ `500 OFFER_PROJECTION_INCOMPLETE`', async () => {
    const { svc, lines, actor } = build({ dropItemWrites: true, itemCount: 2 });
    const err = await svc.adminOffer('sr-1', actor, lines).catch((e) => e);
    expect(err).toBeInstanceOf(BusinessException);
    expect((err as BusinessException).code).toBe('OFFER_PROJECTION_INCOMPLETE');
    // ⚠️ 500, NO 422: el operador no hizo nada mal y no puede corregir nada en esa pantalla.
    expect((err as BusinessException).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  it('`details.missing` NOMBRA lo que falta, con el itemId (accionable para quien arregle el bug)', async () => {
    const { svc, lines, actor } = build({ dropItemWrites: true, itemCount: 2 });
    const err = (await svc.adminOffer('sr-1', actor, lines).catch((e) => e)) as BusinessException;
    expect(err.details.missing).toEqual([
      'lines[it-1].offerDecision',
      'lines[it-2].offerDecision',
    ]);
    expect(err.details.sellRequestId).toBe('sr-1');
  });

  it('⚠️ NO SE PERSISTE: `offerSentAt` no se sella y la solicitud se queda `cotizada`', async () => {
    // Ésta es LA propiedad que hace justa la vía elegida: sin `offerSentAt` no hay plazo del
    // vendedor congelado, así que la mira la **regla 7 del barrido (NUESTRO plazo)** y él recibe el
    // correo 4 —«no procederemos», que es VERDAD— en vez del 3 —«no respondiste», que sería mentira.
    const { svc, request, lines, actor } = build({ dropItemWrites: true });
    await svc.adminOffer('sr-1', actor, lines).catch(() => undefined);
    expect(request.offerSentAt).toBeNull();
    expect(request.offerAcceptDeadlineAt).toBeNull();
    expect(request.status).toBe('cotizada');
    expect(request.offerState).toBeNull();
  });

  it('⚠️ NO SALE CORREO: no se le promete nada a un vendedor que no podrá aceptar', async () => {
    const { svc, mail, lines, actor } = build({ dropItemWrites: true });
    await svc.adminOffer('sr-1', actor, lines).catch(() => undefined);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('⚠️ el camino `202` TAMBIÉN pasa por la guarda: `authorize` no revalida', async () => {
    // Sin esto, una oferta inmostrable entraría a la cola de autorización y **saldría inmostrable
    // al autorizarla** — el gate no habría servido de nada.
    const { svc, lines } = build({ dropItemWrites: true, itemCount: 1 });
    const over = lines.map((l) => ({ ...l, overridePriceCents: 200000 }));
    const err = (await svc.adminOffer('sr-1', OPERATOR, over).catch((e) => e)) as BusinessException;
    expect(err.code).toBe('OFFER_PROJECTION_INCOMPLETE');
  });

  it('y una oferta `202` COMPLETA sí entra a la cola (la guarda no la estorba)', async () => {
    const { svc, request, mail, lines } = build();
    const over = lines.map((l) => ({ ...l, overridePriceCents: 200000 }));
    const res = await svc.adminOffer('sr-1', OPERATOR, over);
    expect(res.response.requiresAuthorization).toBe(true);
    expect(request.offerState).toBe('pending_authorization');
    // El plazo NO se congela aquí (lo hace `authorize`), y la guarda **no lo exige**: confundir
    // «incompleto para mostrar» con «incompleto para pagar» sería una segunda regla de negocio.
    expect(request.offerAcceptDeadlineAt).toBeNull();
    expect(mail.send).not.toHaveBeenCalled();
  });
});

// =============================================================================================
describe('⚠️ BL-24 — `offerProjectionGaps`: la regla, rama por rama', () => {
  const ok = () => ({
    terms: offerTermsCopy('es', { shippingFeeCents: 18000, netCents: 24000 }),
    lines: [{ id: 'it-1', offerDecision: 'buy' as const }],
  });

  it('una proyección completa no tiene huecos', () => {
    expect(offerProjectionGaps(ok())).toEqual([]);
  });

  it('⚠️ `null` (el portal no pinta NADA) es el hueco más grande posible', () => {
    expect(offerProjectionGaps(null)).toEqual(['offer']);
  });

  it.each([['perLineConditionLabel'], ['consequence'], ['rule']])(
    '`terms.%s` vacío ⇒ se nombra',
    (key) => {
      const p = ok();
      (p.terms as Record<string, string>)[key] = '   ';
      expect(offerProjectionGaps(p)).toEqual([`terms.${key}`]);
    },
  );

  it.each([['perLineConditionLabel'], ['consequence'], ['rule']])(
    '`terms.%s` ausente ⇒ se nombra (no basta con que la clave exista)',
    (key) => {
      const p = ok();
      delete (p.terms as Record<string, unknown>)[key];
      expect(offerProjectionGaps(p as never)).toEqual([`terms.${key}`]);
    },
  );

  it('un desglose vacío es inmostrable por la misma R2 del portal', () => {
    expect(offerProjectionGaps({ ...ok(), lines: [] })).toEqual(['lines']);
  });

  it('nombra TODAS las líneas sin decidir, no solo la primera', () => {
    expect(
      offerProjectionGaps({
        ...ok(),
        lines: [
          { id: 'a', offerDecision: 'buy' as const },
          { id: 'b', offerDecision: null },
          { id: 'c', offerDecision: null },
        ],
      }),
    ).toEqual(['lines[b].offerDecision', 'lines[c].offerDecision']);
  });

  it('⚠️ una línea `skip` está COMPLETA: `skip` es una decisión, no una ausencia', () => {
    expect(
      offerProjectionGaps({ ...ok(), lines: [{ id: 'a', offerDecision: 'skip' as const }] }),
    ).toEqual([]);
  });

  it('⚠️ NO exige montos ni plazos: eso es «incompleto para pagar», otra regla', () => {
    // La proyección real de un `202` no lleva `acceptDeadlineAt`, y aun así es MOSTRABLE.
    expect(offerProjectionGaps(ok())).toEqual([]);
  });
});

// =============================================================================================
describe('⚠️ BL-23(2) — `terms.rule`: la prosa del descuento con los montos interpolados', () => {
  function offerOf(locale: string) {
    const { svc, lines, actor } = build({ locale });
    return svc.adminOffer('sr-1', actor, lines).then(() => svc.getMine('u-1', 'sr-1'));
  }

  it.each([['es'], ['en']])('locale=%s: `rule` viaja y NO está vacía', async (locale) => {
    const res: any = await offerOf(locale);
    expect(typeof res.offer.terms.rule).toBe('string');
    expect(res.offer.terms.rule.trim().length).toBeGreaterThan(0);
  });

  it('⚠️ los montos de la prosa son LOS MISMOS del desglose, no una segunda lectura', async () => {
    const res: any = await offerOf('es');
    const { shippingFeeCents, netCents, rule } = {
      ...res.offer,
      rule: res.offer.terms.rule,
    };
    expect(shippingFeeCents).toBe(18000);
    expect(netCents).toBe(72000);
    // La prosa dice «se te depositan X» y el desglose dice `netCents`: si salieran de dos
    // expresiones distintas, la pantalla se contradiría sobre una cifra VINCULANTE.
    expect(rule).toContain('$180.00');
    expect(rule).toContain('$720.00');
  });

  it('⚠️ `rule` es EL MISMO texto que el correo — se acabó la copia del i18n del front', async () => {
    for (const locale of ['es', 'en']) {
      const res: any = await offerOf(locale);
      const msg = sellOfferTemplate(
        {
          folio: 'sr-1',
          lines: [
            {
              cardName: 'Charizard',
              setName: 'Base',
              cardNumber: '4',
              finish: 'normal',
              offeredPriceCents: 90000,
            },
          ],
          grossCents: res.offer.grossCents,
          shippingFeeCents: res.offer.shippingFeeCents,
          netCents: res.offer.netCents,
          acceptDeadlineAt: new Date('2026-09-03T15:00:00Z'),
          pickupAddressLine: null,
        },
        'Ash',
        locale,
      );
      expect(msg.text).toContain(res.offer.terms.rule);
    }
  });
});

// =============================================================================================
describe('⚠️ BL-23(5) — `guideSentAt` viaja, y NO era derivable del carrier', () => {
  async function withOffer(mutate: (r: Record<string, unknown>) => void) {
    const { svc, request, lines, actor } = build();
    await svc.adminOffer('sr-1', actor, lines);
    mutate(request);
    return (await svc.getMine('u-1', 'sr-1')) as any;
  }

  it('sin guía ⇒ `guideSentAt: null`', async () => {
    const res = await withOffer(() => undefined);
    expect(res.offer.guideSentAt).toBeNull();
  });

  it('con guía viva ⇒ la fecha, y con el carrier', async () => {
    const res = await withOffer((r) => {
      r.guideSentAt = new Date('2026-09-05T10:00:00Z');
      r.shipmentCarrier = 'Estafeta';
      r.shipmentTrackingNumber = 'ES-1';
    });
    expect(res.offer.guideSentAt).toEqual(new Date('2026-09-05T10:00:00Z'));
    expect(res.offer.carrier).toBe('Estafeta');
  });

  it('⚠️ TRAS CORREGIR LA DIRECCIÓN: carrier SIGUE, `guideSentAt` se limpió ⇒ el DTO dice `null`', async () => {
    // §4.39t **conserva** carrier/tracking (son lo que hay que cancelar) y **limpia**
    // `guideSentAt`/`shipDeadlineAt`. Un cliente que dedujera «hay guía» de `carrier != null`
    // pintaría **instrucciones de envío para una etiqueta ANULADA**.
    const res = await withOffer((r) => {
      r.guideSentAt = null;
      r.shipDeadlineAt = null;
      r.shipmentCarrier = 'Estafeta';
      r.shipmentTrackingNumber = 'ES-1';
    });
    expect(res.offer.carrier).toBe('Estafeta');
    expect(res.offer.trackingNumber).toBe('ES-1');
    expect(res.offer.guideSentAt).toBeNull();
  });
});

// =============================================================================================
describe('⚠️ BL-23(3) — `rejectedReason`: derivado, cero DDL', () => {
  const deadline = new Date('2026-09-10T18:00:00Z');
  const cotizada = [{ itemStatus: 'cotizada' }];

  it('él pulsó rechazar (ANTES del plazo) ⇒ `declined_by_seller`', () => {
    expect(
      deriveRejectedReason(
        {
          status: 'rechazada',
          offerSentAt: new Date('2026-09-08T00:00:00Z'),
          offerAcceptDeadlineAt: deadline,
          closedAt: new Date('2026-09-09T00:00:00Z'),
        },
        cotizada,
      ),
    ).toBe('declined_by_seller');
  });

  it('⚠️ el BORDE es del vendedor: cerrar EXACTAMENTE en el plazo es su acto, no el barrido', () => {
    expect(
      deriveRejectedReason(
        {
          status: 'rechazada',
          offerSentAt: new Date('2026-09-08T00:00:00Z'),
          offerAcceptDeadlineAt: deadline,
          closedAt: deadline,
        },
        cotizada,
      ),
    ).toBe('declined_by_seller');
  });

  it('no contestó y cerró el barrido (DESPUÉS del plazo) ⇒ `accept_deadline_passed`', () => {
    expect(
      deriveRejectedReason(
        {
          status: 'rechazada',
          offerSentAt: new Date('2026-09-08T00:00:00Z'),
          offerAcceptDeadlineAt: deadline,
          closedAt: new Date('2026-09-10T18:00:01Z'),
        },
        cotizada,
      ),
    ).toBe('accept_deadline_passed');
  });

  it('⚠️ ORDEN: todas las cartas rechazadas GANA a la fecha — él sí respondió y sí mandó', () => {
    // Una solicitud que llegó a verificación fue ofertada, aceptada y ENVIADA, así que su
    // `closedAt` cae mucho después del plazo. Evaluar la fecha primero le diría «no respondiste» a
    // quien respondió y mandó el paquete: la mentira exacta que este campo borra.
    expect(
      deriveRejectedReason(
        {
          status: 'rechazada',
          offerSentAt: new Date('2026-09-08T00:00:00Z'),
          offerAcceptDeadlineAt: deadline,
          closedAt: new Date('2026-09-30T00:00:00Z'),
        },
        [{ itemStatus: 'rechazada' }, { itemStatus: 'rechazada' }],
      ),
    ).toBe('all_items_rejected');
  });

  it('⚠️⚠️ `all_items_rejected` NO DEPENDE DE LA OFERTA: sin `offerSentAt` sigue siendo esa causa', () => {
    // ⚠️ Este test es el que fija **el ORDEN**, y lo encontré mutando el código: el test de arriba
    // sobrevivía a mover la regla debajo de las guardas de nulos, porque ahí las tres fechas
    // existían. El caso que SÍ discrimina es la cohorte legacy —ninguna carta pasó la verificación
    // y **nunca hubo oferta**—: con la regla abajo, la guarda `offerSentAt == null` devolvería
    // `null` y **perderíamos la única causa honesta que teníamos**. La tabla del contrato define
    // esta causa **solo** por los ítems; no menciona la oferta, y por eso va primero.
    for (const offer of [
      { offerSentAt: null, offerAcceptDeadlineAt: null, closedAt: new Date('2026-09-30T00:00:00Z') },
      { offerSentAt: new Date('2026-09-08T00:00:00Z'), offerAcceptDeadlineAt: deadline, closedAt: null },
    ]) {
      expect(
        deriveRejectedReason({ status: 'rechazada', ...offer }, [{ itemStatus: 'rechazada' }]),
      ).toBe('all_items_rejected');
    }
  });

  it('una sola carta viva ya NO es `all_items_rejected`', () => {
    expect(
      deriveRejectedReason(
        {
          status: 'rechazada',
          offerSentAt: new Date('2026-09-08T00:00:00Z'),
          offerAcceptDeadlineAt: deadline,
          closedAt: new Date('2026-09-30T00:00:00Z'),
        },
        [{ itemStatus: 'rechazada' }, { itemStatus: 'aprobada' }],
      ),
    ).toBe('accept_deadline_passed');
  });

  it('fila pre-M-46 (sin `offerSentAt`) ⇒ `null`: no hay dato honesto que dar', () => {
    expect(
      deriveRejectedReason(
        { status: 'rechazada', offerSentAt: null, offerAcceptDeadlineAt: null, closedAt: new Date() },
        cotizada,
      ),
    ).toBeNull();
  });

  it('⚠️ en cualquier estado que NO sea `rechazada` ⇒ `null`', () => {
    for (const status of ['cotizada', 'ofertada', 'aceptada', 'pagada', 'expirada', 'abandonada']) {
      expect(
        deriveRejectedReason(
          {
            status,
            offerSentAt: new Date('2026-09-08T00:00:00Z'),
            offerAcceptDeadlineAt: deadline,
            closedAt: new Date('2026-09-09T00:00:00Z'),
          },
          [{ itemStatus: 'rechazada' }],
        ),
      ).toBeNull();
    }
  });

  it('viaja en el DETALLE del cliente y NO en la lista (como `expiredReason`)', async () => {
    const { svc } = build();
    const detail: any = await svc.getMine('u-1', 'sr-1');
    expect(Object.keys(detail)).toContain('rejectedReason');
    const list: any = await svc.listMine('u-1');
    expect(Object.keys(list.data[0])).not.toContain('rejectedReason');
  });
});

// =============================================================================================
describe('⚠️ BL-23(6) — `paidAt`/`speiReference` viajan; `paidBy` NO', () => {
  it('el vendedor ve la fecha y la referencia de SU depósito, no quién lo ejecutó', async () => {
    const { svc, request } = build();
    request.status = 'pagada';
    request.paidAt = new Date('2026-09-20T12:00:00Z');
    request.speiReference = 'SPEI-XYZ';
    request.paidBy = 'sa-1';
    const res: any = await svc.getMine('u-1', 'sr-1');
    expect(res.paidAt).toEqual(new Date('2026-09-20T12:00:00Z'));
    expect(res.speiReference).toBe('SPEI-XYZ');
    expect(Object.keys(res)).not.toContain('paidBy');
  });
});
