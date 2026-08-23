import { SealedPriceIngestService } from '../src/modules/pricing/sealed-price-ingest.service';
import { SealedPriceIngestJobService } from '../src/jobs/sealed-price-ingest.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { TcgcsvSealedBulkProvider } from '../src/modules/pricing/providers/tcgcsv-sealed.provider';
import { sealedMarketGradeKey } from '../src/modules/pricing/pricing.types';
import { SettingKey } from '../src/modules/settings/settings.constants';

/**
 * v1.19-sealed-tcgcsv (§4.19d/e) — Ingesta de la referencia de mercado del SELLADO:
 * gradeKey `sealed:tcg:<productId>`, FX UNA vez por corrida, dial off = no-op (fail-closed),
 * single-flight, respeto del override manual, pares (anchorCardId, productId) distintos.
 */

const FX = { rate: 20, bufferPct: 3 };

describe('sealedMarketGradeKey — gradeKey del sellado de MERCADO (§4.19d)', () => {
  it('produce sealed:tcg:<productId> (desambigua productos anclados a la misma Card)', () => {
    expect(sealedMarketGradeKey(610894)).toBe('sealed:tcg:610894');
    expect(sealedMarketGradeKey(1)).toBe('sealed:tcg:1');
  });
});

describe('PricingService.persistSealedMarketReference — hermano money-safe (§4.19d)', () => {
  function build(existing: { isManualOverride: boolean } | null) {
    const prisma = {
      priceReference: {
        // v1.29 (M-31): persistSealedMarketReference usa findFirst + create/update (cardProductId=null).
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaService;
    const svc = new PricingService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { svc, prisma };
  }

  it('upsertea con clave (anchorCardId, sealed, sealed:tcg:<pid>, normal, hoy), source tcgcsv y USD→MXN', async () => {
    const { svc, prisma } = build(null);
    // 23850¢ USD × 20 × 1.03 = 491,310¢ MXN (usdToMxnCents redondea).
    await svc.persistSealedMarketReference('card-1', 610894, { marketCents: 23850 }, FX);

    // v1.29 (M-31): findFirst identifica el renglón del día; al no existir, se crea con create.data.
    const ff = (prisma.priceReference.findFirst as jest.Mock).mock.calls[0][0];
    expect(ff.where).toMatchObject({
      cardId: 'card-1',
      productType: 'sealed',
      gradeKey: 'sealed:tcg:610894',
      finish: 'normal',
      cardProductId: null,
    });
    const create = (prisma.priceReference.create as jest.Mock).mock.calls[0][0];
    expect(create.data).toMatchObject({
      source: 'tcgcsv',
      priceUsdCents: 23850,
      fxRate: 20,
      fxBufferPct: 3,
      priceMxnCents: 491310,
      isManualOverride: false,
    });
  });

  it('NO clobbea el override manual del día (isManualOverride=true → skip)', async () => {
    const { svc, prisma } = build({ isManualOverride: true });
    await svc.persistSealedMarketReference('card-1', 610894, { marketCents: 100 }, FX);
    expect(prisma.priceReference.create).not.toHaveBeenCalled();
    expect(prisma.priceReference.update).not.toHaveBeenCalled();
  });
});

describe('SealedPriceIngestService — algoritmo normativo (§4.19d)', () => {
  function build(opts: {
    dial?: string;
    items?: { cardId: string; tcgplayerProductId: number | null }[];
    groups?: { tcgplayerGroupId: number | null }[];
    rows?: { tcgplayerProductId: number; marketCents: number; usedFallbackMid: boolean; currency: 'USD' }[];
    // v1.39 (M-39): SealedProduct ACTIVOS que el ingest también barre (además de los items mapeados).
    catalog?: { id: string; tcgplayerProductId: number; setId: string }[];
    catalogGroups?: { tcgplayerGroupId: number }[];
    anchorCardId?: string | null;
  }) {
    const findMany = jest.fn(async (args: { distinct?: string[] }) =>
      args.distinct?.includes('tcgplayerGroupId') ? (opts.groups ?? []) : (opts.items ?? []),
    );
    // v1.39: SealedProduct.findMany — distinct de grupos (listMappedGroupIds) vs por grupo (ingestGroup).
    const sealedFindMany = jest.fn(async (args: { distinct?: string[] }) =>
      args.distinct?.includes('tcgplayerGroupId') ? (opts.catalogGroups ?? []) : (opts.catalog ?? []),
    );
    const sealedUpdateMany = jest.fn(async () => ({ count: 1 }));
    const cardFindFirst = jest.fn(async () =>
      opts.anchorCardId === undefined ? null : opts.anchorCardId != null ? { id: opts.anchorCardId } : null,
    );
    const prisma = {
      inventoryItem: { findMany },
      sealedProduct: { findMany: sealedFindMany, updateMany: sealedUpdateMany },
      card: { findFirst: cardFindFirst },
    } as unknown as PrismaService;
    const settings = {
      getString: jest.fn().mockResolvedValue(opts.dial ?? 'tcgcsv'),
    } as unknown as SettingsService;
    const pricing = {
      persistSealedMarketReference: jest.fn().mockResolvedValue(undefined),
    } as unknown as PricingService;
    const provider = {
      fetchSealedPricesForGroup: jest
        .fn()
        .mockResolvedValue({ rows: opts.rows ?? [], fetchedRaw: (opts.rows ?? []).length, skipped: 0 }),
    } as unknown as TcgcsvSealedBulkProvider;
    const svc = new SealedPriceIngestService(prisma, settings, pricing, provider);
    return { svc, prisma, settings, pricing, provider, findMany, sealedFindMany, sealedUpdateMany, cardFindFirst };
  }

  it('isEnabled lee el dial sealed_price_source (tcgcsv=true, off=false)', async () => {
    const on = build({ dial: 'tcgcsv' });
    await expect(on.svc.isEnabled()).resolves.toBe(true);
    expect(on.settings.getString).toHaveBeenCalledWith(SettingKey.SEALED_PRICE_SOURCE);
    const off = build({ dial: 'off' });
    await expect(off.svc.isEnabled()).resolves.toBe(false);
  });

  it('sin groupId barre los grupos DISTINTOS de los items mapeados; upsertea por par (cardId, productId)', async () => {
    const { svc, pricing, provider } = build({
      groups: [{ tcgplayerGroupId: 23821 }],
      items: [
        { cardId: 'card-etb', tcgplayerProductId: 610903 },
        { cardId: 'card-box', tcgplayerProductId: 610894 },
      ],
      rows: [
        { tcgplayerProductId: 610903, marketCents: 5531, usedFallbackMid: false, currency: 'USD' },
        { tcgplayerProductId: 610894, marketCents: 23850, usedFallbackMid: true, currency: 'USD' },
      ],
    });
    const res = await svc.run(FX);

    expect(provider.fetchSealedPricesForGroup).toHaveBeenCalledWith(23821);
    expect(pricing.persistSealedMarketReference).toHaveBeenCalledTimes(2);
    expect(pricing.persistSealedMarketReference).toHaveBeenCalledWith(
      'card-etb',
      610903,
      { marketCents: 5531 },
      FX, // el MISMO snapshot para toda la corrida (FX una vez, §4.15f)
    );
    expect(res).toEqual({ groups: 1, priced: 2, usedFallbackMid: 1, skipped: 0, unmatched: 0 });
  });

  it('groupId explícito acota a UN grupo (verificación de esquema en staging, §4.19f)', async () => {
    const { svc, provider, findMany } = build({
      items: [{ cardId: 'card-1', tcgplayerProductId: 610894 }],
      rows: [{ tcgplayerProductId: 610894, marketCents: 100, usedFallbackMid: false, currency: 'USD' }],
    });
    const res = await svc.run(FX, 23821);
    expect(provider.fetchSealedPricesForGroup).toHaveBeenCalledWith(23821);
    // No consulta el DISTINCT de grupos (el alcance viene dado).
    const distinctCalls = findMany.mock.calls.filter((c) =>
      (c[0] as { distinct?: string[] }).distinct?.includes('tcgplayerGroupId'),
    );
    expect(distinctCalls).toHaveLength(0);
    expect(res.priced).toBe(1);
  });

  it('par mapeado SIN fila remota → unmatched (referencia queda null/stale, inocuo; nunca borra)', async () => {
    const { svc, pricing } = build({
      groups: [{ tcgplayerGroupId: 23821 }],
      items: [{ cardId: 'card-1', tcgplayerProductId: 12345 }],
      rows: [{ tcgplayerProductId: 610894, marketCents: 100, usedFallbackMid: false, currency: 'USD' }],
    });
    const res = await svc.run(FX);
    expect(pricing.persistSealedMarketReference).not.toHaveBeenCalled();
    expect(res.unmatched).toBe(1);
    expect(res.priced).toBe(0);
  });

  it('sin items mapeados → 0 grupos, 0 requests al remoto', async () => {
    const { svc, provider } = build({ groups: [], items: [] });
    const res = await svc.run(FX);
    expect(provider.fetchSealedPricesForGroup).not.toHaveBeenCalled();
    expect(res).toEqual({ groups: 0, priced: 0, usedFallbackMid: 0, skipped: 0, unmatched: 0 });
  });

  // v1.39 (M-39, §4.34a): el ingest gana los SealedProduct ACTIVOS como fuente extra de grupos/productos
  // — un producto del catálogo tiene precio AUNQUE aún no haya inventario (ancla = ancla del set).
  it('barre un SealedProduct ACTIVO sin inventario: precio contra el ancla del set + refresca marketUsdCents', async () => {
    const { svc, pricing, provider, sealedUpdateMany, cardFindFirst } = build({
      items: [], // sin inventario
      catalogGroups: [{ tcgplayerGroupId: 42 }],
      catalog: [{ id: 'sp-1', tcgplayerProductId: 999, setId: 'set-x' }],
      rows: [{ tcgplayerProductId: 999, marketCents: 12345, usedFallbackMid: false, currency: 'USD' }],
      anchorCardId: 'card-anchor',
    });
    const res = await svc.run(FX);
    expect(provider.fetchSealedPricesForGroup).toHaveBeenCalledWith(42);
    expect(cardFindFirst).toHaveBeenCalled(); // resolvió el ancla del set
    expect(pricing.persistSealedMarketReference).toHaveBeenCalledWith(
      'card-anchor',
      999,
      { marketCents: 12345 },
      FX,
    );
    // Refresca la CACHÉ de display SealedProduct.marketUsdCents (money-safe: sugerencia, no autoridad).
    expect(sealedUpdateMany).toHaveBeenCalledWith({
      where: { tcgplayerProductId: 999, active: true },
      data: expect.objectContaining({ marketUsdCents: 12345 }),
    });
    expect(res).toMatchObject({ groups: 1, priced: 1 });
  });

  it('un item mapeado GANA sobre el SealedProduct para el mismo productId (no duplica el upsert)', async () => {
    const { svc, pricing } = build({
      groups: [{ tcgplayerGroupId: 42 }],
      items: [{ cardId: 'card-inv', tcgplayerProductId: 999 }],
      catalogGroups: [{ tcgplayerGroupId: 42 }],
      catalog: [{ id: 'sp-1', tcgplayerProductId: 999, setId: 'set-x' }],
      rows: [{ tcgplayerProductId: 999, marketCents: 12345, usedFallbackMid: false, currency: 'USD' }],
      anchorCardId: 'card-anchor',
    });
    const res = await svc.run(FX);
    // Un solo upsert, con la cardId del ITEM (no la ancla del set): item gana el dedupe por productId.
    expect(pricing.persistSealedMarketReference).toHaveBeenCalledTimes(1);
    expect(pricing.persistSealedMarketReference).toHaveBeenCalledWith('card-inv', 999, { marketCents: 12345 }, FX);
    expect(res.priced).toBe(1);
  });
});

describe('SealedPriceIngestJobService — dial fail-closed + single-flight + FX una vez (§4.19d/e)', () => {
  function build(opts: { enabled: boolean; runImpl?: () => Promise<unknown> }) {
    const fx = {
      getCurrent: jest.fn().mockResolvedValue({ rate: 20, bufferPct: 3, source: 'banxico', effectiveDate: '2026-08-17' }),
    } as unknown as FxService;
    const ingest = {
      isEnabled: jest.fn().mockResolvedValue(opts.enabled),
      run: jest.fn(opts.runImpl ?? (async () => ({ groups: 0, priced: 0, usedFallbackMid: 0, skipped: 0, unmatched: 0 }))),
    } as unknown as SealedPriceIngestService;
    return { job: new SealedPriceIngestJobService(fx, ingest), fx, ingest };
  }

  it('dial off → no-op fail-closed: enqueued:false + reason, SIN leer FX ni correr el ingest', async () => {
    const { job, fx, ingest } = build({ enabled: false });
    const res = await job.run();
    expect(res).toEqual({
      job: 'sealed-price-ingest',
      enqueued: false,
      reason: 'SEALED_PRICE_SOURCE_OFF',
    });
    expect(fx.getCurrent).not.toHaveBeenCalled();
    expect(ingest.run).not.toHaveBeenCalled();
  });

  it('dial tcgcsv → carga FX UNA vez y corre el ingest AWAITED; res 202 del contrato', async () => {
    const { job, fx, ingest } = build({ enabled: true });
    const res = await job.run();
    expect(fx.getCurrent).toHaveBeenCalledTimes(1);
    expect(ingest.run).toHaveBeenCalledWith({ rate: 20, bufferPct: 3 }, undefined);
    expect(res).toEqual({ job: 'sealed-price-ingest', enqueued: true });
  });

  it('con groupId propaga el scope acotado al response (contrato §M10-ops)', async () => {
    const { job, ingest } = build({ enabled: true });
    const res = await job.run(23821);
    expect(ingest.run).toHaveBeenCalledWith({ rate: 20, bufferPct: 3 }, 23821);
    expect(res).toEqual({ job: 'sealed-price-ingest', enqueued: true, scope: 'group', groupId: 23821 });
  });

  it('single-flight: un segundo disparo mientras corre devuelve enqueued:false (no doble pase)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { job, ingest } = build({
      enabled: true,
      runImpl: async () => {
        await gate;
        return { groups: 0, priced: 0, usedFallbackMid: 0, skipped: 0, unmatched: 0 };
      },
    });
    const first = job.run();
    // Deja que el primer run pase el check del dial y tome el flag.
    await new Promise((r) => setImmediate(r));
    const second = await job.run();
    expect(second).toEqual({ job: 'sealed-price-ingest', enqueued: false });
    release();
    await expect(first).resolves.toEqual({ job: 'sealed-price-ingest', enqueued: true });
    expect(ingest.run).toHaveBeenCalledTimes(1);
    // Tras terminar, un nuevo disparo vuelve a correr (el flag se libera en finally).
    await job.run();
    expect(ingest.run).toHaveBeenCalledTimes(2);
  });
});
