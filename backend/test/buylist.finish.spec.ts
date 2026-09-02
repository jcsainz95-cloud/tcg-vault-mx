import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
// v1.51.20 · BL-26: la puerta de `createRequest` (celular + dirección + mínimo) en un solo sitio.
import { GATE_ADDRESS_ID, buylistGateMocks, withMinimumOff } from './helpers/buylist-create-gate';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/**
 * v1.6-finish · ⛔ SUPERSEDED por v2.0 (P-48, ARCHITECTURE §4.36) — el acabado **deja de seleccionar
 * regla de precio**: no hay `finishRules`, ni claves sintéticas «Holo»/«Reverse Holo», ni gate premium
 * de pricing. Lo que este spec verifica ahora es lo que el acabado SÍ sigue haciendo (§4.36.10):
 *
 *  1. **elegir DE QUÉ VARIANTE se lee el mercado** (`getReference(..., finish)`),
 *  2. seguir siendo **identidad de variante** (se valida contra `Card.availableFinishes`, SEC-A1, y se
 *     snapshotea en `SellRequestItem.finish`),
 *
 * y lo que ya NO hace: **cambiar el monto**. Con el MISMO mercado, dos acabados cotizan IDÉNTICO
 * (criterio 83), porque el monto sale solo de la curva sobre el valor de mercado (criterio 84).
 */

const pii = new PiiCryptoService(new ConfigService({}));

function svcWith(opts: {
  referenceMxnCents?: number | null;
  cardRarity?: string | null;
  availableFinishes?: string[];
}): { svc: BuylistService; pricing: PricingService } {
  const prisma: any = {
    card: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'c1',
        rarity: opts.cardRarity ?? 'Common',
        availableFinishes: opts.availableFinishes ?? ['normal', 'reverse_holo', 'holofoil'],
      }),
      // v2.1.1: `createRequest` carga las cartas EN LOTE (mata el N+1 que hacía un
      // `findUnique` por ítem). El mock delega en el MISMO `findUnique` del fixture
      // (`this` = este objeto `card`), para no duplicar datos ni criterios.
      findMany: jest.fn(async function (this: any, args: any) {
        const ids: string[] = args?.where?.id?.in ?? [];
        const rows = await Promise.all(ids.map((id) => this.findUnique({ where: { id } })));
        return rows.filter(Boolean);
      }),
    },
  };
  const pricing = {
    gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    // v2.0 (§4.36.2): UN solo lector de configuración de dinero para los dos ejes.
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    // v2.1.1 (§4.36.5b): el seam de VENTA devuelve una DECISIÓN (monto + veredicto). El mock usa
    // el CUERPO REAL (`PricingService.prototype`): es puro y no toca `this`, así que el test no
    // puede divergir de producción ni reimplementar la matemática.
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    getReference: jest.fn().mockResolvedValue(
      opts.referenceMxnCents == null
        ? { status: 'pending' }
        : { status: 'priced', referenceMxnCents: opts.referenceMxnCents },
    ),
    // v2.0 (§4.36.5c): el MISMO seam escala Y cierra la cola.
    settlePendingForVariant: jest.fn(async () => undefined),
    escalatePending: jest.fn(),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getVariantOverride: jest.fn(async () => null),
  } as unknown as PricingService;
  const settings = { getRaw: jest.fn(), getNumber: jest.fn().mockResolvedValue(0) } as unknown as SettingsService;
  return {
    svc: new BuylistService(prisma as PrismaService, pricing, settings, {} as UsersService, pii),
    pricing,
  };
}

describe('BuylistService.publicQuote — el acabado elige la VARIANTE, no la regla (v2.0, §4.36.10)', () => {
  it('lee la referencia DEL ACABADO cotizado (es su único papel en el precio)', async () => {
    const { svc, pricing } = svcWith({ referenceMxnCents: 12500 });
    await svc.publicQuote('c1', 'raw', 'NM', 'reverse_holo');
    expect(pricing.getReference).toHaveBeenCalledWith('c1', 'raw', 'raw:NM', 'reverse_holo');
  });

  it('criterio 83: DOS acabados distintos con el MISMO mercado cotizan IDÉNTICO', async () => {
    const a = await svcWith({ referenceMxnCents: 12500 }).svc.publicQuote('c1', 'raw', 'NM', 'normal');
    const b = await svcWith({ referenceMxnCents: 12500 }).svc.publicQuote('c1', 'raw', 'NM', 'reverse_holo');
    const c = await svcWith({ referenceMxnCents: 12500 }).svc.publicQuote('c1', 'raw', 'NM', 'holofoil');
    // $125 ⇒ pct interpolado EXACTO entre 40 % ($100) y 50 % ($500): 4000 + 1000×2500/40000 = 4062.5 bp.
    // v2.1.2 (E0-bis): el bp NO se cuantiza — 12500 × 4062.5 / 10000 = 5078.125 ⇒ $50.78. (Antes se
    // redondeaba el bp a 4063 y salía 5078.75 ⇒ $50.79: un centavo inflado por el doble redondeo.)
    expect(a.quote.quotedPriceCents).toBe(5078);
    expect(b.quote.quotedPriceCents).toBe(a.quote.quotedPriceCents);
    expect(c.quote.quotedPriceCents).toBe(a.quote.quotedPriceCents);
    expect(a.priceBasis).toBe('market');
  });

  it('criterio 84: la RAREZA no cambia el monto (una Common y una Illustration Rare cotizan igual)', async () => {
    const common = await svcWith({ cardRarity: 'Common', referenceMxnCents: 40000 }).svc.publicQuote(
      'c1',
      'raw',
      'NM',
      'normal',
    );
    const chase = await svcWith({ cardRarity: 'Illustration Rare', referenceMxnCents: 40000 }).svc.publicQuote(
      'c1',
      'raw',
      'NM',
      'normal',
    );
    // $400 ⇒ pct interpolado 47.5 % ⇒ $190. La Common de cientos de pesos deja de recibir $0.50 (criterio 80).
    expect(common.quote.quotedPriceCents).toBe(19000);
    expect(chase.quote.quotedPriceCents).toBe(19000);
  });

  it('el BIN gana en bulk: mercado $0.50 ⇒ $1.00 con priceBasis="floor"', async () => {
    const { svc } = svcWith({ referenceMxnCents: 50 });
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'normal');
    expect(q.quote.quotedPriceCents).toBe(100);
    expect(q.priceBasis).toBe('floor');
  });

  it('SIN referencia del acabado ⇒ precio_pendiente (el BIN NO gana; jamás MX$0)', async () => {
    const { svc } = svcWith({ referenceMxnCents: null });
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'holofoil');
    expect(q.quote.status).toBe('precio_pendiente');
    expect(q.quote.quotedPriceCents).toBeNull();
    expect(q.priceBasis).toBe('pending');
  });

  it('`rarity` sigue viajando como dato INFORMATIVO del catálogo', async () => {
    const { svc } = svcWith({ cardRarity: 'Illustration Rare', referenceMxnCents: 12500 });
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'normal');
    expect(q.rarity).toBe('Illustration Rare');
  });

  it('acabado NO disponible en la carta → 422 FINISH_NOT_AVAILABLE (SEC-A1, sin cambio)', async () => {
    const { svc } = svcWith({ availableFinishes: ['normal'], referenceMxnCents: 10000 });
    await expect(svc.publicQuote('c1', 'raw', 'NM', 'reverse_holo')).rejects.toMatchObject({
      code: 'FINISH_NOT_AVAILABLE',
    });
  });

  it('sin finish explícito → default normal (sin cambio)', async () => {
    const { svc } = svcWith({ referenceMxnCents: null });
    const q = await svc.publicQuote('c1', 'raw', 'NM');
    expect(q.finish).toBe('normal');
  });
});

describe('BuylistService.createRequest — snapshot del acabado + del priceBasis (§4.36.7c)', () => {
  const VALID_CLABE = '012345678901234567';

  function prismaForCreate() {
    const prisma: any = {
      card: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'c1',
          rarity: 'Common',
          availableFinishes: ['normal', 'reverse_holo'],
        }),
        // v2.1.1: `createRequest` carga las cartas EN LOTE (mata el N+1 que hacía un
        // `findUnique` por ítem). El mock delega en el MISMO `findUnique` del fixture
        // (`this` = este objeto `card`), para no duplicar datos ni criterios.
        findMany: jest.fn(async function (this: any, args: any) {
          const ids: string[] = args?.where?.id?.in ?? [];
          const rows = await Promise.all(ids.map((id) => this.findUnique({ where: { id } })));
          return rows.filter(Boolean);
        }),
      },
      // v1.51.20 · BL-26: vendedor con celular y dirección propia (la puerta se prueba por HTTP).
      ...buylistGateMocks('user-1'),
      kycProfile: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
      sellRequest: {
        findMany: jest.fn(async () => []), // M-46 §4.39c: acumulado mensual = findMany+reduce (COALESCE de 2 columnas)
        create: jest.fn(async ({ data }: any) => ({
          id: 'sr-1',
          status: data.status,
          quotedTotalCents: data.quotedTotalCents,
          items: data.items.create.map((it: any, i: number) => ({
            id: `it-${i}`,
            cardId: it.cardId,
            card: { id: it.cardId, name: 'Pidgey', number: '16' },
            productType: it.productType,
            rawCondition: it.rawCondition ?? null,
            finish: it.finish,
            rarity: it.rarity,
            priceBasis: it.priceBasis,
            quotedPriceCents: it.quotedPriceCents,
            approvedPriceCents: null,
            itemStatus: it.itemStatus,
            inventoryItemId: null,
          })),
        })),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    return prisma;
  }

  function pricingFor(referenceMxnCents: number | null): PricingService {
    return {
      gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
      loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
      // v2.1.1 (§4.36.5b): el seam de VENTA devuelve una DECISIÓN (monto + veredicto). El mock usa
      // el CUERPO REAL (`PricingService.prototype`): es puro y no toca `this`, así que el test no
      // puede divergir de producción ni reimplementar la matemática.
      decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
      getReference: jest.fn().mockResolvedValue(
        referenceMxnCents == null
          ? { status: 'pending' }
          : { status: 'priced', referenceMxnCents },
      ),
      // v2.0 (§4.36.5c): el MISMO seam escala Y cierra la cola.
      settlePendingForVariant: jest.fn(async () => undefined),
      escalatePending: jest.fn(),
      getVariantOverridesBatch: jest.fn(async () => new Map()),
      getVariantOverride: jest.fn(async () => null),
    } as unknown as PricingService;
  }

  function settingsFor(): SettingsService {
    return {
      getRaw: jest.fn(),
      getNumber: jest.fn(async (key: string) => {
        if (key === 'buylist_cap_per_request_cents') return 100_000_000;
        if (key === 'buylist_cap_per_month_cents') return 100_000_000;
        if (key === 'ine_threshold_cents') return 100_000_000;
        return 0;
      }),
    } as unknown as SettingsService;
  }

  it('snapshotea el finish y el priceBasis; el monto sale de la CURVA (no de una regla por acabado)', async () => {
    const prisma = prismaForCreate();
    const svc = new BuylistService(
      prisma as PrismaService,
      pricingFor(12500),
      settingsFor(),
      {} as UsersService,
      pii,
    );

    const res = await svc.createRequest(
      'user-1',
      [{ cardId: 'c1', productType: 'raw' as any, rawCondition: 'NM' as any, finish: 'reverse_holo' as any }],
      VALID_CLABE,
      undefined,
      GATE_ADDRESS_ID,
    );
    expect(res.items[0].finish).toBe('reverse_holo');
    expect(res.items[0].quotedPriceCents).toBe(5078); // $125 × 40.625 % EXACTO (v2.1.2, sin cuantizar)
    expect(res.items[0].priceBasis).toBe('market');
    // El create persistió el finish y el basis; `ruleMode`/`ruleValue`/`ruleSource` quedan LEGACY.
    const created = prisma.sellRequest.create.mock.calls[0][0].data.items.create[0];
    expect(created.finish).toBe('reverse_holo');
    expect(created.priceBasis).toBe('market');
    expect(created.ruleMode).toBeUndefined();
    expect(created.ruleValue).toBeUndefined();
    expect(created.ruleSource).toBeUndefined();
  });

  it('rechaza un acabado fuera de availableFinishes con FINISH_NOT_AVAILABLE', async () => {
    const prisma = prismaForCreate();
    const svc = new BuylistService(
      prisma as PrismaService,
      pricingFor(null),
      settingsFor(),
      {} as UsersService,
      pii,
    );

    await expect(
      svc.createRequest(
        'user-1',
        [{ cardId: 'c1', productType: 'raw' as any, rawCondition: 'NM' as any, finish: 'holofoil' as any }],
        VALID_CLABE,
        undefined,
        GATE_ADDRESS_ID,
      ),
    ).rejects.toMatchObject({ code: 'FINISH_NOT_AVAILABLE' });
  });
});

/**
 * v2.1.1 (P-48, gate techlead — BLOQUEO 2) — **UN SOLO CUERPO en el eje de COMPRA**.
 *
 * `createRequest` reimplementaba la secuencia de `quoteCardForFinish` (rama `productId`, rama
 * `set_base`, `quoteAcquisitionFromCurve`, `resolvePendingReason` y la derivación de
 * `quotedPriceCents`/`priceBasis`/`itemStatus`). Los dos cuerpos daban el MISMO número, así que no era
 * un bug: era riesgo. Y la razón por la que la spec exige uno solo es concreta — la cotización pública
 * y la solicitud que se paga no pueden divergir: **el vendedor ve un número y firma otro**. Cualquier
 * matiz futuro (un tope, una condición, un segundo control por variante) entraría en uno de los dos y
 * la divergencia solo se descubriría por una queja.
 *
 * Estos tests son el candado: para el MISMO insumo, `POST /buylist/quote` y `POST /buylist/requests`
 * producen el MISMO monto, el MISMO `priceBasis` y el MISMO veredicto — incluido el guardarraíl.
 */
describe('BLOQUEO 2 — quote y createRequest cotizan por el MISMO cuerpo (§4.36.5b)', () => {
  const VALID_CLABE_2 = '032180000118359719';
  const INE_KEYS = { front: 'ine/front.jpg', back: 'ine/back.jpg' };

  function harness(referenceMxnCents: number | null, cardRarity = 'Common') {
    const card = { id: 'c1', rarity: cardRarity, availableFinishes: ['normal', 'reverse_holo'] };
    const prisma: any = {
      card: {
        findUnique: jest.fn(async () => card),
        findMany: jest.fn(async () => [card]),
      },
      // v1.51.20 · BL-26: vendedor con celular y dirección propia (la puerta se prueba por HTTP).
      ...buylistGateMocks('u1'),
      kycProfile: { findUnique: jest.fn(async () => null), upsert: jest.fn() },
      sellRequest: {
        findMany: jest.fn(async () => []), // M-46 §4.39c: acumulado mensual = findMany+reduce (COALESCE de 2 columnas)
        create: jest.fn(async ({ data }: any) => ({
          id: 'sr-1',
          status: data.status,
          quotedTotalCents: data.quotedTotalCents,
          items: data.items.create.map((it: any, i: number) => ({
            id: `it-${i}`,
            cardId: it.cardId,
            card: { id: it.cardId, name: 'Pidgey', number: '16' },
            productType: it.productType,
            rawCondition: it.rawCondition ?? null,
            finish: it.finish,
            rarity: it.rarity,
            priceBasis: it.priceBasis,
            quotedPriceCents: it.quotedPriceCents,
            approvedPriceCents: null,
            itemStatus: it.itemStatus,
            inventoryItemId: null,
          })),
        })),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const pricing = {
      gradeKeyFor: jest.fn(() => 'raw:NM'),
      loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
      getReference: jest.fn(async () =>
        referenceMxnCents == null ? { status: 'pending' } : { status: 'priced', referenceMxnCents },
      ),
      settlePendingForVariant: jest.fn(async () => undefined),
      escalatePending: jest.fn(),
      getVariantOverridesBatch: jest.fn(async () => new Map()),
      getVariantOverride: jest.fn(async () => null),
    } as unknown as PricingService;
    const settings = {
      getRaw: jest.fn(),
      getNumber: jest.fn(withMinimumOff(async () => 100_000_000)),
    } as unknown as SettingsService;
    return new BuylistService(prisma as PrismaService, pricing, settings, {} as UsersService, pii);
  }

  const line = { cardId: 'c1', productType: 'raw' as any, rawCondition: 'NM' as any, finish: 'normal' as any };

  it.each([
    ['mercado normal ($125)', 12500, 'Common'],
    ['bulk en el BIN ($0.50)', 50, 'Common'],
    ['sin mercado', null, 'Common'],
    ['PREMIUM en el bin (guardarraíl)', 100, 'Special Illustration Rare'],
    ['premium con mercado sano', 40000, 'Special Illustration Rare'],
  ])('%s: el monto y el basis de la cotización son EXACTAMENTE los que se firman', async (_n, ref, rarity) => {
    const quoted = await harness(ref as number | null, rarity as string).publicQuote('c1', 'raw', 'NM', 'normal');
    const created = await harness(ref as number | null, rarity as string).createRequest(
      'u1',
      [line],
      VALID_CLABE_2,
      // Fase 0.3 (compliance): una línea `precio_pendiente` EXIGE INE (el monto incierto se trata
      // como potencialmente por encima del umbral). Se aporta para poder comparar los DOS caminos.
      INE_KEYS,
      GATE_ADDRESS_ID,
    );

    // El DTO de la solicitud emite el monto ausente como `undefined` (`?? undefined`); el del quote
    // como `null`. Se normalizan para comparar LA DECISIÓN, no la serialización.
    expect(created.items[0].quotedPriceCents ?? null).toBe(quoted.quote.quotedPriceCents);
    expect(created.items[0].priceBasis).toBe(quoted.priceBasis);
    expect(created.items[0].itemStatus).toBe(quoted.quote.status);
  });

  it('el guardarraíl bloquea en AMBAS superficies (la solicitud no puede pagar lo que el quote no cotiza)', async () => {
    // Special Illustration Rare con mercado de $1: la curva la manda al BIN ⇒ `premium_at_floor`.
    const quoted = await harness(100, 'Special Illustration Rare').publicQuote('c1', 'raw', 'NM', 'normal');
    const created = await harness(100, 'Special Illustration Rare').createRequest(
      'u1', [line], VALID_CLABE_2, INE_KEYS, GATE_ADDRESS_ID,
    );
    expect(quoted.quote.quotedPriceCents).toBeNull();
    expect(quoted.priceBasis).toBe('pending');
    expect(created.items[0].quotedPriceCents ?? null).toBeNull();
    expect(created.items[0].itemStatus).toBe('precio_pendiente');
    expect(created.quotedTotalCents).toBe(0);
  });

  it('N+1 cerrado: `createRequest` carga las cartas EN LOTE (un findMany, cero findUnique por ítem)', async () => {
    const card = { id: 'c1', rarity: 'Common', availableFinishes: ['normal'] };
    const prisma: any = {
      card: { findUnique: jest.fn(async () => card), findMany: jest.fn(async () => [card]) },
      // v1.51.20 · BL-26: vendedor con celular y dirección propia (la puerta se prueba por HTTP).
      ...buylistGateMocks('u1'),
      kycProfile: { findUnique: jest.fn(async () => null), upsert: jest.fn() },
      sellRequest: {
        findMany: jest.fn(async () => []), // M-46 §4.39c: acumulado mensual = findMany+reduce (COALESCE de 2 columnas)
        create: jest.fn(async ({ data }: any) => ({
          id: 'sr-1', status: data.status, quotedTotalCents: data.quotedTotalCents,
          items: data.items.create.map((it: any, i: number) => ({
            id: `it-${i}`, cardId: it.cardId, card: { id: it.cardId, name: 'P', number: '1' },
            productType: it.productType, rawCondition: null, finish: it.finish, rarity: it.rarity,
            priceBasis: it.priceBasis, quotedPriceCents: it.quotedPriceCents, approvedPriceCents: null,
            itemStatus: it.itemStatus, inventoryItemId: null,
          })),
        })),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const pricing = {
      gradeKeyFor: jest.fn(() => 'raw:NM'),
      loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
      getReference: jest.fn(async () => ({ status: 'priced', referenceMxnCents: 12500 })),
      settlePendingForVariant: jest.fn(async () => undefined),
      getVariantOverridesBatch: jest.fn(async () => new Map()),
    } as unknown as PricingService;
    const settings = { getRaw: jest.fn(), getNumber: jest.fn(withMinimumOff(async () => 100_000_000)) } as unknown as SettingsService;
    const svc = new BuylistService(prisma as PrismaService, pricing, settings, {} as UsersService, pii);

    await svc.createRequest('u1', [line, line, line], VALID_CLABE_2, undefined, GATE_ADDRESS_ID);

    expect(prisma.card.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.card.findUnique).not.toHaveBeenCalled();
    // La curva y los overrides siguen izándose UNA vez por request (BE-25).
    expect(pricing.loadPricingCurve).toHaveBeenCalledTimes(1);
    expect(pricing.getVariantOverridesBatch).toHaveBeenCalledTimes(1);
  });
});
