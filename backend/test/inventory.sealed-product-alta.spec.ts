import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { PokemonTcgIoProvider } from '../src/modules/pricing/providers/pokemontcg-io.provider';
import {
  PokeTraceProvider,
  PokemonPriceTrackerProvider,
} from '../src/modules/pricing/providers/graded-sealed.providers';
import { AuditService } from '../src/modules/audit/audit.service';

/**
 * v1.39-sealed-product-module (M-39, P-38 · ARCHITECTURE §4.34d · API_CONTRACT §M1) — el alta de SELLADO
 * por `sealedProductId`: el backend DERIVA la identidad server-side (ancla del set + mapeo + imagen/nombre/
 * subtipo del SealedProduct) → la pieza nace «ETB …», NO anclada a Tropius. Cubre: identidad correcta,
 * SEALED_PRODUCT_NOT_FOUND (id inexistente/inactivo), fallback manual money-safe (vault_operator+, auditado,
 * 422 MANUAL_MARKET_NOT_ALLOWED SOLO por «mercado ya resuelto», ≤0 → VALIDATION_ERROR, sin override → PRICE_PENDING).
 */

function buildHarness(opts: { sourceOn?: boolean; withAudit?: boolean } = {}) {
  const created: any[] = [];
  const pendingStore: any[] = [];
  const priceRefs: any[] = [];
  const overrides: any[] = [];

  const SEALED_PRODUCT = {
    id: 'sp-etb',
    setId: 'set-1',
    tcgplayerProductId: 777,
    tcgplayerGroupId: 900,
    name: 'Prismatic Evolutions Elite Trainer Box',
    subtype: 'etb',
    imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/777.jpg',
    active: true,
  };

  const prisma: any = {
    // H-1 (SEC): el alta single/lote corre en $transaction; el mock ejecuta el callback con el mismo
    // prisma como cliente de tx (los writes usan los mismos jest.fn, incluido el override manual).
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    sealedProduct: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.id === SEALED_PRODUCT.id && SEALED_PRODUCT.active ? SEALED_PRODUCT : null,
      ),
    },
    card: {
      findUnique: jest.fn(async ({ where }: any) =>
        // La carta ancla del set (Tropius #1) + una carta cualquiera.
        where.id === 'card-tropius' ? { id: 'card-tropius', rarity: null, availableFinishes: ['normal'] } : null,
      ),
      findFirst: jest.fn(async ({ where }: any) =>
        where.setId === 'set-1' ? { id: 'card-tropius' } : null,
      ),
      // v2.1.1: `createRequest` carga las cartas EN LOTE (mata el N+1 que hacía un
      // `findUnique` por ítem). El mock delega en el MISMO `findUnique` del fixture
      // (`this` = este objeto `card`), para no duplicar datos ni criterios.
      findMany: jest.fn(async function (this: any, args: any) {
        const ids: string[] = args?.where?.id?.in ?? [];
        const rows = await Promise.all(ids.map((id) => this.findUnique({ where: { id } })));
        return rows.filter(Boolean);
      }),
    },
    inventoryItem: {
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `inv-${created.length + 1}`, status: 'in_stock', ...data };
        created.push(row);
        return row;
      }),
    },
    inventoryMovement: { create: jest.fn(async () => ({})) },
    priceReference: {
      findFirst: jest.fn(async ({ where }: any) =>
        priceRefs.find(
          (r) => r.cardId === where.cardId && r.productType === where.productType && r.gradeKey === where.gradeKey && r.finish === where.finish,
        ) ?? null,
      ),
      findMany: jest.fn(async ({ where }: any) =>
        priceRefs.filter(
          (r) => r.cardId === where.cardId && r.productType === where.productType && r.gradeKey === where.gradeKey && r.finish === where.finish,
        ),
      ),
      create: jest.fn(async ({ data }: any) => {
        overrides.push(data);
        priceRefs.push(data);
        return { id: `ref-${overrides.length}`, ...data };
      }),
      update: jest.fn(async ({ data }: any) => ({ id: 'ref-x', ...data })),
    },
    pendingPriceEntry: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `pend-${pendingStore.length + 1}`, ...data };
        pendingStore.push(row);
        return row;
      }),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    inventoryBatch: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
    },
    nextFolio: jest.fn(async () => `INV-00000${created.length + 1}`),
    nextFolios: jest.fn(async (n: number) =>
      Array.from({ length: n }, (_, i) => `INV-B${created.length + i + 1}`),
    ),
  };

  const settings = { getNumber: jest.fn(async () => 100) } as unknown as SettingsService;
  const pricing = new PricingService(
    prisma as PrismaService,
    settings,
    { getCurrent: async () => { throw new Error('no fx'); } } as unknown as FxService,
    {} as PokemonTcgIoProvider,
    {} as PokemonPriceTrackerProvider,
    {} as PokeTraceProvider,
  );
  jest.spyOn(pricing, 'loadSealedSpreads').mockResolvedValue({
    spreadPctBySubtype: {},
    fallbackPct: 25,
    sourceOn: opts.sourceOn ?? true,
  } as any);

  const auditLog = jest.fn(async () => {});
  const audit = opts.withAudit ? ({ log: auditLog } as unknown as AuditService) : undefined;
  const svc = new InventoryService(prisma as PrismaService, pricing, settings, audit);
  return { svc, prisma, created, pendingStore, priceRefs, overrides, auditLog };
}

function seedMarket(h: ReturnType<typeof buildHarness>, productId = 777, priceMxnCents = 250000) {
  h.priceRefs.push({
    cardId: 'card-tropius',
    productType: 'sealed',
    gradeKey: `sealed:tcg:${productId}`,
    finish: 'normal',
    priceMxnCents,
    priceUsdCents: null,
    isManualOverride: false,
    source: 'tcgcsv',
    capturedDate: new Date('2026-08-22'),
  });
}

const line = (over: any = {}) => ({
  productType: 'sealed' as const,
  sealedProductId: 'sp-etb',
  acquisitionType: 'aportacion_en_especie' as const,
  acquisitionPct: 100,
  ...over,
});

describe('alta por sealedProductId — IDENTIDAD correcta (no ancla-a-single)', () => {
  it('deriva cardId ancla + mapeo + imagen/nombre/subtipo del SealedProduct; nace «ETB», NO Tropius', async () => {
    const h = buildHarness({ sourceOn: true });
    seedMarket(h); // sealed:tcg:777 → MX$2500
    const res = await h.svc.createItem(line() as any, 'op-1');
    expect(res.acquisitionCostCents).toBe(250000); // mercado × 100%

    const item = h.created[0];
    expect(item).toMatchObject({
      cardId: 'card-tropius', // ancla del set derivada server-side
      productType: 'sealed',
      sealedSubtype: 'etb', // del SealedProduct, no del cliente
      tcgplayerProductId: 777,
      tcgplayerGroupId: 900,
      sealedProductName: 'Prismatic Evolutions Elite Trainer Box',
      sealedImageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/777.jpg',
      sealedProductId: 'sp-etb', // FK de identidad congelada
    });
  });

  it('el cliente NO puede pisar la identidad: campos M-37 sueltos se IGNORAN si viene sealedProductId', async () => {
    const h = buildHarness({ sourceOn: true });
    seedMarket(h);
    await h.svc.createItem(
      line({ tcgplayerProductId: 111, sealedImageUrl: 'https://evil.example.com/x.jpg', sealedProductName: 'FAKE', sealedSubtype: 'box' }) as any,
      'op-1',
    );
    // Manda el SealedProduct (777/etb/imagen confiable), no lo que mandó el cliente.
    expect(h.created[0]).toMatchObject({ tcgplayerProductId: 777, sealedSubtype: 'etb', sealedProductName: 'Prismatic Evolutions Elite Trainer Box' });
  });

  it('sealedProductId inexistente/inactivo → 422 SEALED_PRODUCT_NOT_FOUND (sin crear pieza)', async () => {
    const h = buildHarness({ sourceOn: true });
    await expect(h.svc.createItem(line({ sealedProductId: 'nope' }) as any, 'op-1')).rejects.toMatchObject({
      code: 'SEALED_PRODUCT_NOT_FOUND',
      status: 422,
    });
    expect(h.created).toHaveLength(0);
  });

  it('sin mercado ni override → 422 PRICE_PENDING (jamás 0 ni pieza)', async () => {
    const h = buildHarness({ sourceOn: true }); // sin seedMarket
    await expect(h.svc.createItem(line() as any, 'op-1')).rejects.toMatchObject({ code: 'PRICE_PENDING' });
    expect(h.created).toHaveLength(0);
    expect(h.pendingStore[0]).toMatchObject({ gradeKey: 'sealed:tcg:777', context: 'inventory' });
  });
});

describe('fallback MANUAL money-safe (v1.39.1 — vault_operator+, auditado, gate por mercado-resuelto)', () => {
  it('mercado null + manualMarketMxnCents>0 → usa el override, lo persiste (isManualOverride) y AUDITA', async () => {
    const h = buildHarness({ sourceOn: true, withAudit: true }); // sin mercado
    const res = await h.svc.createItem(line({ manualMarketMxnCents: 150000 }) as any, 'op-1');
    // Aportación valuada por el override manual (150000 × 100%).
    expect(res.acquisitionCostCents).toBe(150000);
    // Persistió PriceReference isManualOverride=true con la clave de mercado del sellado.
    expect(h.overrides.some((o) => o.isManualOverride === true && o.gradeKey === 'sealed:tcg:777')).toBe(true);
    // Auditado con la acción normativa.
    // H-1 (SEC): la auditoría corre DENTRO de la tx del alta → segundo arg = cliente transaccional.
    expect(h.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inventory.sealed_manual_market',
        after: expect.objectContaining({ tcgplayerProductId: 777, manualMarketMxnCents: 150000, isManualOverride: true }),
      }),
      expect.anything(),
    );
    expect(h.created[0].sealedProductId).toBe('sp-etb');
  });

  it('mercado YA resuelto + manualMarketMxnCents → 422 MANUAL_MARKET_NOT_ALLOWED (jamás pisa un mercado vivo)', async () => {
    const h = buildHarness({ sourceOn: true, withAudit: true });
    seedMarket(h); // mercado resuelto
    await expect(h.svc.createItem(line({ manualMarketMxnCents: 999 }) as any, 'op-1')).rejects.toMatchObject({
      code: 'MANUAL_MARKET_NOT_ALLOWED',
      status: 422,
    });
    expect(h.created).toHaveLength(0);
    expect(h.auditLog).not.toHaveBeenCalled();
  });

  it('manualMarketMxnCents ≤ 0 (con mercado null) → 422 VALIDATION_ERROR (nunca 0)', async () => {
    const h = buildHarness({ sourceOn: true });
    await expect(h.svc.createItem(line({ manualMarketMxnCents: 0 }) as any, 'op-1')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(h.svc.createItem(line({ manualMarketMxnCents: -5 }) as any, 'op-1')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('vault_operator puede fijar el precio manual (NO se restringe por rol — decisión del humano v1.39.1)', async () => {
    // El servicio no consulta rol para el override (la autorización vault_operator+ vive en el controller);
    // aquí se ejercita que el override procede sin ninguna barrera de rol en el servicio.
    const h = buildHarness({ sourceOn: true, withAudit: true });
    const res = await h.svc.createItem(line({ manualMarketMxnCents: 42000 }) as any, 'vault-op-user');
    expect(res.acquisitionCostCents).toBe(42000);
    expect(h.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 'vault-op-user', action: 'inventory.sealed_manual_market' }),
      expect.anything(),
    );
  });
});

/**
 * H-1 (SEC · ALTO) — ATOMICIDAD del override manual del sellado. El override (`PriceReference
 * isManualOverride=true` + `AuditLog`) se persiste DENTRO de la misma tx del alta y SOLO tras crear la
 * pieza. Un fallo de creación (o un rollback del `$transaction`) NO debe dejar un override huérfano
 * (precio de dinero pinneado sin pieza) — el envenenamiento de precio global que reportó el pentest.
 */
describe('H-1 — override manual atómico con el alta (no override huérfano)', () => {
  it('single: la creación de la pieza corre en $transaction y el override participa del MISMO cliente tx', async () => {
    const h = buildHarness({ sourceOn: true, withAudit: true }); // sin mercado → path override
    const mo = jest.spyOn((h.svc as any).pricing, 'manualOverride');
    await h.svc.createItem(line({ manualMarketMxnCents: 150000 }) as any, 'op-1');
    // El alta corrió en una transacción...
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    // ...y el override se escribió con el cliente transaccional (6º arg presente ⇒ participa de la tx;
    // un rollback lo revierte junto con la pieza).
    expect(mo).toHaveBeenCalledWith('card-tropius', 'sealed', 'sealed:tcg:777', 150000, 'normal', expect.anything());
    // La auditoría también corre con el cliente transaccional.
    expect(h.auditLog).toHaveBeenCalledWith(expect.anything(), expect.anything());
  });

  it('single: si la creación de la pieza FALLA, NO se persiste el override ni se audita (sin huérfano)', async () => {
    const h = buildHarness({ sourceOn: true, withAudit: true });
    h.prisma.inventoryItem.create.mockImplementationOnce(async () => {
      throw new Error('DB boom (post-resolución, pre-commit)');
    });
    await expect(h.svc.createItem(line({ manualMarketMxnCents: 150000 }) as any, 'op-1')).rejects.toThrow();
    // El override se aplica DESPUÉS de crear la pieza → si la creación revienta, jamás se escribe.
    expect(h.overrides.some((o) => o.isManualOverride === true)).toBe(false);
    expect(h.auditLog).not.toHaveBeenCalled();
    expect(h.created).toHaveLength(0);
  });

  it('batch: una línea cuya creación de pieza FALLA queda ok:false y NO deja override huérfano', async () => {
    const h = buildHarness({ sourceOn: true, withAudit: true });
    // La creación de la pieza revienta SOLO para esta línea (después de resolver/validar el override).
    h.prisma.inventoryItem.create.mockImplementationOnce(async () => {
      throw new Error('DB boom en la línea');
    });
    const res = await h.svc.batchCreate(
      { batchKey: 'bk-h1', items: [line({ manualMarketMxnCents: 150000 }) as any] },
      'op-1',
    );
    expect(res.results[0].ok).toBe(false);
    // El override NO se escribió (se aplica tras crear la pieza; la línea falló antes) → sin huérfano.
    expect(h.overrides.some((o) => o.isManualOverride === true)).toBe(false);
    expect(h.auditLog).not.toHaveBeenCalled();
  });

  it('batch: en el camino feliz el override se escribe con el cliente transaccional del lote', async () => {
    const h = buildHarness({ sourceOn: true, withAudit: true });
    const mo = jest.spyOn((h.svc as any).pricing, 'manualOverride');
    const res = await h.svc.batchCreate(
      { batchKey: 'bk-h1-ok', items: [line({ manualMarketMxnCents: 150000 }) as any] },
      'op-1',
    );
    expect(res.results[0].ok).toBe(true);
    // Override escrito con el 6º arg (tx) ⇒ atómico con la creación de la pieza (rollback lo revierte).
    expect(mo).toHaveBeenCalledWith('card-tropius', 'sealed', 'sealed:tcg:777', 150000, 'normal', expect.anything());
  });
});

/**
 * H-2 (SEC · ALTO) — el override manual (`manualMarketMxnCents`) SOLO se acepta cuando la identidad
 * viene de un `sealedProductId` VALIDADO (SealedProduct activo). Sin él —incluido el path legacy con el
 * `tcgplayerProductId`+`tcgplayerGroupId` que envía el cliente— se rechaza 422, sin anclar un override
 * de dinero a un productId arbitrario (que se saltaría SEALED_PRODUCT_NOT_FOUND / SEC-A1).
 */
describe('H-2 — manualMarketMxnCents exige sealedProductId validado', () => {
  const noSpid = (over: any = {}) => ({
    productType: 'sealed' as const,
    cardId: 'card-tropius',
    acquisitionType: 'compra' as const,
    ...over,
  });

  it('manualMarketMxnCents SIN sealedProductId → 422 MANUAL_MARKET_NOT_ALLOWED, sin override ni pieza', async () => {
    const h = buildHarness({ sourceOn: true, withAudit: true });
    await expect(
      h.svc.createItem(noSpid({ manualMarketMxnCents: 500000 }) as any, 'op-1'),
    ).rejects.toMatchObject({ code: 'MANUAL_MARKET_NOT_ALLOWED', status: 422 });
    expect(h.overrides.some((o) => o.isManualOverride === true)).toBe(false);
    expect(h.auditLog).not.toHaveBeenCalled();
    expect(h.created).toHaveLength(0);
  });

  it('manualMarketMxnCents por el path LEGACY (tcgplayerProductId del cliente, sin sealedProductId) → 422, sin override', async () => {
    const h = buildHarness({ sourceOn: true, withAudit: true });
    await expect(
      h.svc.createItem(
        noSpid({ tcgplayerProductId: 424242, tcgplayerGroupId: 900, manualMarketMxnCents: 999999 }) as any,
        'op-1',
      ),
    ).rejects.toMatchObject({ code: 'MANUAL_MARKET_NOT_ALLOWED', status: 422 });
    // NUNCA se ancló un override al productId 424242 arbitrario del cliente.
    expect(h.overrides.some((o) => o.gradeKey === 'sealed:tcg:424242')).toBe(false);
    expect(h.overrides.some((o) => o.isManualOverride === true)).toBe(false);
    expect(h.created).toHaveLength(0);
  });

  it('CON sealedProductId validado, el override SÍ procede (ancla derivada server-side, no del cliente)', async () => {
    const h = buildHarness({ sourceOn: true, withAudit: true }); // sin mercado
    const res = await h.svc.createItem(line({ manualMarketMxnCents: 150000 }) as any, 'op-1');
    expect(res.acquisitionCostCents).toBe(150000);
    // El override quedó anclado al productId DERIVADO del SealedProduct (777), no a uno del cliente.
    expect(h.overrides.some((o) => o.isManualOverride === true && o.gradeKey === 'sealed:tcg:777')).toBe(true);
  });
});
