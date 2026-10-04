import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PriceSyncJobService, VQ_SWEEP_LOG_ID_CAP } from '../src/jobs/price-sync.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { PokemonTcgIoProvider } from '../src/modules/pricing/providers/pokemontcg-io.provider';
import {
  PokeTraceProvider,
  PokemonPriceTrackerProvider,
} from '../src/modules/pricing/providers/graded-sealed.providers';
import { stripComments } from './helpers/strip-comments';
import { callArgCounts, identCensus, methodBody } from './helpers/ident-census';
import { DEFAULT_SALE_PREMIUM_FLOOR_POLICY, PremiumFloorPolicy } from '../src/common/pricing-curve';

/**
 * v1.80.8.4 — API_CONTRACT §M2 `M2-VQ` (VQ-1…VQ-5, VQ-7, VQ-8; VQ-6 vive en
 * `inventory.pending-reason-writers.spec.ts` y VQ-9 en `test/integration/sale-queue-vq.e2e-spec.ts`).
 *
 * La cola de VENTA la escribe SOLO quien decide un precio de venta de plataforma, siempre con motivo.
 * `price-sync` (vía `syncCardPrice`) refresca referencias y ⛔ no escribe la cola; al final de una corrida
 * completa, el barrido VQ cierra las filas `reason IS NULL` que ninguna pieza vendible necesita.
 */

/** Prisma en memoria: piezas, referencias y la cola (con `where` de verdad para el barrido). */
function buildPrisma(items: any[], pending: any[] = []) {
  const refs: any[] = [];
  const matches = (row: any, where: any): boolean =>
    Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if ('in' in v) return v.in.includes(row[k]);
        if ('notIn' in v) return !v.notIn.includes(row[k]);
      }
      return (row[k] ?? null) === (v ?? null);
    });
  const prisma: any = {
    inventoryItem: {
      findMany: jest.fn(async ({ where }: any) => {
        const w = { ...where };
        const rows = items.filter((i) => matches(i, w));
        return rows.map((i) => ({ ...i, card: { id: i.cardId, externalId: `ext-${i.cardId}` } }));
      }),
    },
    priceReference: {
      findFirst: jest.fn(
        async ({ where }: any) =>
          refs.find(
            (r) =>
              r.cardId === where.cardId &&
              r.gradeKey === where.gradeKey &&
              r.finish === where.finish,
          ) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `ref-${refs.length + 1}`, ...data };
        refs.push(row);
        return row;
      }),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    pendingPriceEntry: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => {
        pending.push({ id: `p-${pending.length + 1}`, ...data });
        return pending[pending.length - 1];
      }),
      update: jest.fn(),
      findMany: jest.fn(async ({ where }: any) => pending.filter((p) => matches(p, where))),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const p of pending) {
          if (matches(p, where)) {
            Object.assign(p, data);
            count++;
          }
        }
        return { count };
      }),
    },
  };
  return { prisma, refs, pending };
}

function buildPricing(
  prisma: any,
  rawQuote: (cardId: string) => any = () => null,
  // v1.80.8.5 (`M2-PF`): el barrido lee el dial de VENTA al empezar. Por defecto, su seed (sin fila).
  premiumFloorPolicy: PremiumFloorPolicy = DEFAULT_SALE_PREMIUM_FLOOR_POLICY,
) {
  const settings = {
    getString: jest.fn(async (k: string) =>
      k === 'pricing_provider_raw' ? 'pokemontcg_io' : 'pokemonpricetracker',
    ),
  } as unknown as SettingsService;
  const tcgIo = {
    source: 'pokemontcg_io',
    supports: (pt: string) => pt === 'raw',
    fetchPrice: jest.fn(async ({ card }: any) => rawQuote(card.id)),
  } as unknown as PokemonTcgIoProvider;
  // Los stubs REALES de graded/sellado (sin API key ⇒ `null`): exactamente lo que corre en prod.
  const config = { get: () => undefined } as any;
  const pricing = new PricingService(
    prisma as PrismaService,
    settings,
    {} as FxService,
    tcgIo,
    new PokemonPriceTrackerProvider(config),
    new PokeTraceProvider(config),
  );
  jest.spyOn(pricing, 'loadSalePremiumFloorPolicy').mockResolvedValue(premiumFloorPolicy);
  return pricing;
}

const piece = (over: any) => ({
  folio: `F-${over.id}`,
  productType: 'raw',
  rawCondition: 'NM',
  finish: 'normal',
  ownerType: 'platform',
  status: 'in_stock',
  listPriceCents: null,
  cardProductId: null,
  sealedProductId: null,
  tcgplayerProductId: null,
  gradingCompany: null,
  gradeValue: null,
  ...over,
});

describe('VQ-1…VQ-4 — `price-sync` refresca referencias y NO escribe la cola', () => {
  it('VQ-1: raw de plataforma `in_stock` cuyo proveedor devuelve `null` ⇒ 0 filas, `pending`', async () => {
    const { prisma, pending } = buildPrisma([piece({ id: 'i1', cardId: 'c1' })]);
    const pricing = buildPricing(prisma);
    const info = await pricing.syncCardPrice({ id: 'c1' } as any, 'raw', 'raw:NM', 'normal');
    expect(info).toEqual({ status: 'pending' });
    await new PriceSyncJobService(prisma, pricing).run(['c1']);
    expect(prisma.pendingPriceEntry.create).not.toHaveBeenCalled();
    expect(prisma.pendingPriceEntry.update).not.toHaveBeenCalled();
    expect(pending).toHaveLength(0);
  });

  it('VQ-2: graded y sellado (stubs reales `null`) ⇒ 0 filas', async () => {
    const items = [
      piece({
        id: 'g1',
        cardId: 'cg',
        productType: 'graded',
        rawCondition: null,
        gradingCompany: 'PSA',
        gradeValue: '9',
      }),
      piece({
        id: 's1',
        cardId: 'cs',
        productType: 'sealed',
        rawCondition: null,
        tcgplayerProductId: 777,
        sealedProductId: 'sp',
      }),
    ];
    const { prisma, pending } = buildPrisma(items);
    const processed = await new PriceSyncJobService(prisma, buildPricing(prisma)).run(['cg', 'cs']);
    expect(processed).toBe(2);
    expect(prisma.pendingPriceEntry.create).not.toHaveBeenCalled();
    expect(pending).toHaveLength(0);
  });

  it('VQ-3: pieza de CLIENTE `in_custody` y pieza VENDIDA ⇒ 0 filas; con cotización la referencia del día SÍ se escribe', async () => {
    const items = [
      piece({ id: 'cu', cardId: 'c-cust', ownerType: 'customer', status: 'in_custody' }),
      piece({ id: 'so', cardId: 'c-sold', status: 'delivered' }),
    ];
    const { prisma, pending, refs } = buildPrisma(items);
    // Sin cotización para la vendida; CON cotización (MXN directo) para la del cliente.
    const pricing = buildPricing(prisma, (cardId) =>
      cardId === 'c-cust' ? { priceMxnCents: 12345, source: 'pokemontcg_io' } : null,
    );
    await new PriceSyncJobService(prisma, pricing).run(['c-cust', 'c-sold']);
    expect(prisma.pendingPriceEntry.create).not.toHaveBeenCalled();
    expect(pending).toHaveLength(0);
    // Valuación intacta: la referencia de la pieza del cliente se escribió.
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ cardId: 'c-cust', priceMxnCents: 12345, refKind: 'market' });
  });

  it('VQ-4: rama M-43 (fila del día `graded_estimate`) ⇒ no escala y no pisa la fila', async () => {
    const { prisma, pending } = buildPrisma([]);
    prisma.priceReference.findFirst.mockResolvedValue({
      id: 'est',
      refKind: 'graded_estimate',
      priceMxnCents: 9,
    });
    const pricing = buildPricing(prisma, () => ({ priceMxnCents: 500, source: 'pokemontcg_io' }));
    const info = await pricing.syncCardPrice({ id: 'c1' } as any, 'raw', 'raw:NM', 'normal');
    expect(info).toEqual({ status: 'pending' });
    expect(prisma.priceReference.create).not.toHaveBeenCalled();
    expect(prisma.priceReference.update).not.toHaveBeenCalled();
    expect(prisma.pendingPriceEntry.create).not.toHaveBeenCalled();
    expect(pending).toHaveLength(0);
  });
});

describe('VQ-5 — candado: lista CERRADA de escritores de la cola y `syncCardPrice` sin escalada', () => {
  const SRC = join(__dirname, '..', 'src');

  it('`escalatePending`/`settlePendingForVariant` solo aparecen en los escritores (a)–(c), la definición y `buylist.createRequest`', () => {
    expect(identCensus(SRC, /\b(?:escalatePending|settlePendingForVariant)\b/g)).toEqual({
      // Alta (helper del sellado + aportación) y publicación (cierre, sellado, raw/graded).
      'modules/inventory/inventory.service.ts': 5,
      // Reconciliación de raw `listed` (§4.36.5 b-ter).
      'modules/pricing/price-ingest.service.ts': 1,
      // Definiciones + `settlePendingForVariant → escalatePending`.
      'modules/pricing/pricing.service.ts': 3,
      // Eje COMPRA (`createRequest`).
      'modules/buylist/buylist.service.ts': 1,
    });
    const buylist = stripComments(
      readFileSync(join(SRC, 'modules/buylist/buylist.service.ts'), 'utf8'),
    );
    expect(methodBody(buylist, 'async createRequest(')).toMatch(/\bsettlePendingForVariant\(/);
  });

  it('techlead D-2/D-6: TODA escritura cruda de `pendingPriceEntry` vive en `PricingService` (el barrido incluido)', () => {
    // Las escrituras: `escalatePending` (update de motivo + create), `closePendingForVariant`,
    // `applyManualOverride` (updateMany del cierre por override) y `closeUnreasonedSaleQueueRows` (barrido VQ).
    // Cualquier `prisma|tx|db.pendingPriceEntry.<escritura>` en otro fichero ⇒ rojo.
    expect(
      identCensus(
        SRC,
        /\bpendingPriceEntry\s*\.\s*(?:create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany)\b/g,
      ),
    ).toEqual({ 'modules/pricing/pricing.service.ts': 6 });
    // Ni SQL crudo sobre la tabla (la puerta lateral del censo anterior).
    expect(identCensus(SRC, /"PendingPriceEntry"/g)).toEqual({});
    // El barrido delega la escritura; la usa SOLO `price-sync`.
    expect(identCensus(SRC, /\bcloseUnreasonedSaleQueueRows\b/g)).toEqual({
      'jobs/price-sync.service.ts': 1,
      'modules/pricing/pricing.service.ts': 1,
    });
    // v1.80.8.5 (`M2-PF`): la rama nueva del barrido también delega su escritura (sexta escritura).
    expect(identCensus(SRC, /\bcloseStalePremiumFloorSaleRows\b/g)).toEqual({
      'jobs/price-sync.service.ts': 1,
      'modules/pricing/pricing.service.ts': 1,
    });
    const pricing = stripComments(
      readFileSync(join(SRC, 'modules/pricing/pricing.service.ts'), 'utf8'),
    );
    const body = methodBody(pricing, 'async closeUnreasonedSaleQueueRows(');
    // El `where` repite el predicado del barrido (una fila con motivo nunca se cierra aquí).
    for (const frag of ["status: 'open'", "context: 'inventory'", 'reason: null', 'resolvedPriceRefId: null']) {
      expect({ frag, presente: body.includes(frag) }).toEqual({ frag, presente: true });
    }
  });

  it('`syncCardPrice` no toca la cola y no tiene parámetro de escalada; sus llamadores pasan 4 argumentos', () => {
    const pricing = stripComments(
      readFileSync(join(SRC, 'modules/pricing/pricing.service.ts'), 'utf8'),
    );
    const body = methodBody(pricing, 'async syncCardPrice(');
    expect(body.length).toBeGreaterThan(200);
    expect(body).not.toMatch(/\b(?:escalatePending|settlePendingForVariant|pendingPriceEntry)\b/);
    expect(body).not.toMatch(/\bescalate\b/);
    expect(identCensus(SRC, /\bsyncCardPrice\b/g)).toEqual({
      'jobs/price-sync.service.ts': 1,
      'jobs/set-price-sync.service.ts': 1,
      'modules/pricing/pricing.service.ts': 1,
    });
    for (const f of ['jobs/price-sync.service.ts', 'jobs/set-price-sync.service.ts']) {
      const code = stripComments(readFileSync(join(SRC, f), 'utf8'));
      expect({ f, args: callArgCounts(code, 'syncCardPrice') }).toEqual({ f, args: [4] });
    }
  });
});

describe('VQ-7 / VQ-8 — barrido VQ al final de un `price-sync` COMPLETO', () => {
  const row = (over: any) => ({
    productType: 'raw',
    gradeKey: 'raw:NM',
    finish: 'normal',
    cardProductId: null,
    sealedProductId: null,
    context: 'inventory',
    status: 'open',
    reason: null,
    ...over,
  });

  it('VQ-7: fila `null` de cliente, de vendida, clave `sealed` sin pieza y de plataforma con `listPriceCents` ⇒ todas `resolved`', async () => {
    const items = [
      piece({ id: 'cu', cardId: 'c-cust', ownerType: 'customer', status: 'in_custody' }),
      piece({ id: 'so', cardId: 'c-sold', status: 'delivered' }),
      piece({ id: 'mp', cardId: 'c-man', status: 'listed', listPriceCents: 5000 }),
      // Borde que fija el predicado `ownerType=platform` (no solo el de status): una pieza de cliente
      // con status `in_stock` NO hace «vendible» la clave.
      piece({ id: 'cu2', cardId: 'c-cust2', ownerType: 'customer', status: 'in_stock' }),
    ];
    const pending = [
      row({ id: 'r-cust', cardId: 'c-cust' }),
      row({ id: 'r-cust2', cardId: 'c-cust2' }),
      row({ id: 'r-sold', cardId: 'c-sold' }),
      row({ id: 'r-seal', cardId: 'c-none', productType: 'sealed', gradeKey: 'sealed' }),
      row({ id: 'r-man', cardId: 'c-man' }),
    ];
    const { prisma } = buildPrisma(items, pending);
    const res = await new PriceSyncJobService(
      prisma,
      buildPricing(prisma),
    ).sweepUnreasonedSaleQueue();
    expect(res).toEqual({ closed: 5, kept: 0, premiumFloorClosed: 0 });
    for (const p of pending) {
      expect({ id: p.id, status: p.status, priceRef: p.resolvedPriceRefId }).toEqual({
        id: p.id,
        status: 'resolved',
        priceRef: null,
      });
      expect(p.resolvedAt).toBeInstanceOf(Date);
    }
  });

  // v1.80.8.5 (`M2-PF`): VQ-8 corre con el dial en `none` (la rama nueva del barrido es no-op) y conserva
  // su aserción original. La rama nueva la cubre PF-6 (`pricing.premium-floor-sale.spec.ts`).
  it('VQ-8 (dial `none`): `null` de plataforma vendible sin mercado, `no_market`/`premium_at_floor` sin pieza y `null` de COMPRA ⇒ las cuatro siguen `open` con su motivo', async () => {
    const items = [
      piece({ id: 'pv', cardId: 'c-plat', status: 'in_stock' }),
      piece({
        id: 'ps',
        cardId: 'c-seal',
        productType: 'sealed',
        rawCondition: null,
        tcgplayerProductId: 777,
        sealedProductId: 'sp',
        status: 'listed',
      }),
    ];
    const pending = [
      row({ id: 'r-plat', cardId: 'c-plat' }),
      // Sellado vendible: misma clave que la publicación (`sealed:tcg:777`, `normal`, `sealedProductId`).
      row({
        id: 'r-seal',
        cardId: 'c-seal',
        productType: 'sealed',
        gradeKey: 'sealed:tcg:777',
        sealedProductId: 'sp',
      }),
      row({ id: 'r-nm', cardId: 'c-x', reason: 'no_market' }),
      row({ id: 'r-paf', cardId: 'c-y', reason: 'premium_at_floor' }),
      row({ id: 'r-buy', cardId: 'c-z', context: 'buylist' }),
    ];
    const { prisma } = buildPrisma(items, pending);
    const res = await new PriceSyncJobService(
      prisma,
      buildPricing(prisma, undefined, { mode: 'none', rarities: [] }),
    ).sweepUnreasonedSaleQueue();
    expect(res).toEqual({ closed: 0, kept: 2, premiumFloorClosed: 0 });
    expect(pending.map((p) => [p.id, p.status, p.reason])).toEqual([
      ['r-plat', 'open', null],
      ['r-seal', 'open', null],
      ['r-nm', 'open', 'no_market'],
      ['r-paf', 'open', 'premium_at_floor'],
      ['r-buy', 'open', null],
    ]);
  });

  it('idempotente: una segunda corrida no cierra nada', async () => {
    const pending = [row({ id: 'r1', cardId: 'c-gone' })];
    const { prisma } = buildPrisma([], pending);
    const job = new PriceSyncJobService(prisma, buildPricing(prisma));
    expect(await job.sweepUnreasonedSaleQueue()).toEqual({ closed: 1, kept: 0, premiumFloorClosed: 0 });
    expect(await job.sweepUnreasonedSaleQueue()).toEqual({ closed: 0, kept: 0, premiumFloorClosed: 0 });
  });

  it('D-6: el log del barrido enumera como mucho VQ_SWEEP_LOG_ID_CAP ids y resume el resto', async () => {
    const pending = Array.from({ length: VQ_SWEEP_LOG_ID_CAP + 7 }, (_, i) =>
      row({ id: `r${i}`, cardId: `c-gone-${i}` }),
    );
    const { prisma } = buildPrisma([], pending);
    const job = new PriceSyncJobService(prisma, buildPricing(prisma));
    const log = jest.spyOn((job as any).logger, 'log').mockImplementation(() => undefined);
    expect(await job.sweepUnreasonedSaleQueue()).toEqual({
      closed: VQ_SWEEP_LOG_ID_CAP + 7,
      kept: 0,
      premiumFloorClosed: 0,
    });
    const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes('cerradas'))!;
    expect(line).toContain(`r${VQ_SWEEP_LOG_ID_CAP - 1}`);
    expect(line).not.toContain(`r${VQ_SWEEP_LOG_ID_CAP},`);
    expect(line).not.toMatch(new RegExp(`\\br${VQ_SWEEP_LOG_ID_CAP}\\b`));
    expect(line).toContain('(+7 más)');
  });

  it('QA (gate `8a10153e`): `cardIds` VACÍO no es «todas»: no-op, sin refrescar y SIN barrido', async () => {
    const items = [piece({ id: 'i1', cardId: 'c1' })];
    const pending = [row({ id: 'r1', cardId: 'c-gone' })];
    const { prisma } = buildPrisma(items, pending);
    const pricing = buildPricing(prisma);
    const sync = jest.spyOn(pricing, 'syncCardPrice');
    const job = new PriceSyncJobService(prisma, pricing);
    const sweep = jest.spyOn(job, 'sweepUnreasonedSaleQueue');
    // Por el endpoint: `scope="cardIds"` con `[]` y con `cardIds` omitido.
    expect(await job.enqueue('cardIds', [])).toMatchObject({ queued: 0 });
    expect(await job.enqueue('cardIds', undefined)).toMatchObject({ queued: 0 });
    expect(await job.run([])).toBe(0);
    expect(sync).not.toHaveBeenCalled();
    expect(sweep).not.toHaveBeenCalled();
    expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled();
    expect(pending[0].status).toBe('open');
    // Y `all_vault` (o el scheduler, `run()`) SÍ es la corrida completa con barrido.
    await job.enqueue('all_vault', ['c1']);
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(pending[0].status).toBe('resolved');
  });

  it('el barrido corre SOLO en corrida completa (no con `cardIds`)', async () => {
    const pending = [row({ id: 'r1', cardId: 'c-gone' })];
    const { prisma } = buildPrisma([], pending);
    const job = new PriceSyncJobService(prisma, buildPricing(prisma));
    await job.run(['c-other']);
    expect(pending[0].status).toBe('open');
    await job.run();
    expect(pending[0].status).toBe('resolved');
  });
});
