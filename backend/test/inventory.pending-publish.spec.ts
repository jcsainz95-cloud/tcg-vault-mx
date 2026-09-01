import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UpdateItemDto } from '../src/modules/inventory/dto/inventory.dto';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';
import { BusinessException } from '../src/common/business.exception';

/**
 * v1.51 — **FASE 8: PUBLICAR.** *«Me gustaría saber también cómo la subimos a inventario, porque ahí
 * ya tenemos para publicar.»*
 *
 * El defecto que cierra: una pieza convertida nace `in_stock` **sin ubicación y sin precio**, y nada
 * la empujaba a la venta **ni la señalaba**. Peor, **sin dato de mercado quedaba invisible por
 * partida doble**: ni a la venta, ni en la cola de precio pendiente —porque esa escalada solo ocurría
 * *cuando alguien intentaba publicarla*—. *Una carta comprada y pagada podía quedarse quieta para
 * siempre sin que nada lo señalara.*
 *
 * Lo que estos tests fijan:
 *  1. **La cola dice QUÉ LE FALTA** y **no miente en el total**.
 *  2. **La cola NO ESCRIBE.** Un `GET` que abriera y cerrara entradas de la cola de precio de M2 por
 *     el hecho de que alguien mire la pantalla sería un efecto invisible sobre dinero.
 *  3. **El bypass del `PATCH` está cerrado**: publicar sin precio resoluble ⇒ `422 PRICE_PENDING`
 *     **y la pieza entra a la cola**, en vez de quedar descartada en silencio por el storefront.
 *  4. **Auto-publicación al fijar ubicación**, sin botón — y **el fallo no tumba el `move`**.
 *  5. **El piso NO gana** (decisión LOCKED §4.36.0): sin `PriceReference` no se publica. *Eso es
 *     correcto y la cola existe precisamente para que esa pieza SE VEA.*
 */

const settings = { getNumber: jest.fn() } as unknown as SettingsService;

interface ItemOpts {
  id: string;
  locationId?: string | null;
  listPriceCents?: number | null;
  status?: string;
  acquisitionType?: string;
  createdAt?: Date;
  /** `true` ⇒ la variante tiene referencia de mercado (precio derivable). */
  priced?: boolean;
}

function item(o: ItemOpts) {
  return {
    id: o.id,
    folio: `INV-${o.id}`,
    cardId: `card-${o.id}`,
    card: {
      id: `card-${o.id}`,
      name: 'Charizard',
      number: '4',
      rarity: 'Rare',
      rarityCanonical: 'rare',
      subtypes: null,
      availableFinishes: ['normal'],
      set: { id: 's1', name: 'Base' },
    },
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    ownerType: 'platform',
    status: o.status ?? 'in_stock',
    locationId: o.locationId === undefined ? null : o.locationId,
    listPriceCents: o.listPriceCents ?? null,
    cardProductId: null,
    sealedProductId: null,
    sealedSubtype: null,
    tcgplayerProductId: null,
    acquisitionType: o.acquisitionType ?? 'buylist',
    acquisitionCostCents: 40000,
    sourceSellRequestItemId: `sri-${o.id}`,
    certNumber: null,
    createdAt: o.createdAt ?? new Date('2026-09-01T00:00:00Z'),
    __priced: o.priced === true,
  };
}

function build(items: ReturnType<typeof item>[], openPending: any[] = []) {
  const writes: string[] = [];
  const rows = items;
  const prisma: any = {
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    inventoryItem: {
      findMany: jest.fn(async ({ where, select }: any) => {
        let out = rows;
        if (where?.id?.in) out = out.filter((r) => where.id.in.includes(r.id));
        if (where?.status) out = out.filter((r) => r.status === where.status);
        if (where?.ownerType) out = out.filter((r) => r.ownerType === where.ownerType);
        if (where?.acquisitionType) out = out.filter((r) => r.acquisitionType === where.acquisitionType);
        if (where && 'locationId' in where && where.locationId === null) {
          out = out.filter((r) => r.locationId == null);
        }
        return select?.id ? out.map((r) => ({ id: r.id })) : out;
      }),
      findUnique: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        writes.push('update');
        const r = rows.find((x) => x.id === where.id) as Record<string, unknown>;
        Object.assign(r, data);
        return r;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        writes.push('updateMany');
        const r = rows.find((x) => x.id === where.id);
        if (!r) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      }),
    },
    inventoryMovement: { create: jest.fn(async () => ({})) },
    pendingPriceEntry: {
      findMany: jest.fn(async () => {
        writes.push('pendingPriceEntry.findMany');
        return openPending;
      }),
    },
  };
  const pricing = {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    loadSealedSpreads: jest.fn(async () => ({ spreadPctBySubtype: {}, fallbackPct: 0, sourceOn: false })),
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    gradeKeyFor: jest.fn(() => 'raw:NM'),
    getReferencesBatch: jest.fn(async (list: any[]) => {
      const m = new Map();
      for (const d of list) {
        const row = rows.find((r) => r.cardId === d.cardId);
        if (row?.__priced) {
          m.set(`${d.cardId}|${d.productType}|${d.gradeKey}|${d.finish}`, {
            status: 'priced',
            referenceMxnCents: 200000,
          });
        }
      }
      return m;
    }),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getPricedRawFinishesBatch: jest.fn(async () => new Map()),
    settlePendingForVariant: jest.fn(async (reason: unknown) => {
      writes.push(reason == null ? 'pending.close' : 'pending.escalate');
      return reason == null ? undefined : 'ppe-new';
    }),
    escalatePending: jest.fn(async () => 'ppe-new'),
  } as unknown as PricingService;
  const svc = new InventoryService(prisma as PrismaService, pricing, settings);
  return { svc, prisma, pricing, writes, rows };
}

// =============================================================================================
describe('⚠️ (1) la cola dice QUÉ LE FALTA', () => {
  it('sin ubicación y sin precio ⇒ `missing: ["location","price"]`', async () => {
    const { svc } = build([item({ id: 'a' })]);
    const res: any = await svc.pendingPublish({ page: 1, pageSize: 20 });
    expect(res.total).toBe(1);
    expect(res.data[0].missing).toEqual(['location', 'price']);
    expect(res.data[0].resolvedSalePriceCents).toBeNull();
    expect(res.data[0].priceBasis).toBe('pending');
  });

  it('con precio pero sin ubicación ⇒ solo `location`, y ENSEÑA el precio resuelto', async () => {
    const { svc } = build([item({ id: 'a', priced: true })]);
    const res: any = await svc.pendingPublish({ page: 1, pageSize: 20 });
    expect(res.data[0].missing).toEqual(['location']);
    expect(res.data[0].resolvedSalePriceCents).toBeGreaterThan(0);
    expect(res.data[0].priceBasis).not.toBe('pending');
  });

  it('con ubicación pero sin precio ⇒ solo `price`', async () => {
    const { svc } = build([item({ id: 'a', locationId: 'loc-1' })]);
    const res: any = await svc.pendingPublish({ page: 1, pageSize: 20 });
    expect(res.data[0].missing).toEqual(['price']);
  });

  it('⚠️ con las dos cosas NO ENTRA a la cola: una cola con filas sin pendiente enseña a ignorarla', async () => {
    const { svc } = build([item({ id: 'a', locationId: 'loc-1', priced: true })]);
    const res: any = await svc.pendingPublish({ page: 1, pageSize: 20 });
    expect(res.total).toBe(0);
    expect(res.data).toEqual([]);
  });

  it('un `listPriceCents` manual cuenta como precio (D10 no retira la perilla de M1)', async () => {
    const { svc } = build([item({ id: 'a', locationId: 'loc-1', listPriceCents: 99900 })]);
    const res: any = await svc.pendingPublish({ page: 1, pageSize: 20 });
    expect(res.total).toBe(0);
  });

  it('trae el origen de la pieza para poder distinguir buylist de alta manual', async () => {
    const { svc } = build([item({ id: 'a', acquisitionType: 'buylist' })]);
    const res: any = await svc.pendingPublish({ page: 1, pageSize: 20 });
    expect(res.data[0].acquisitionType).toBe('buylist');
    expect(res.data[0].sourceSellRequestItemId).toBe('sri-a');
  });
});

// =============================================================================================
describe('⚠️ (2) el `total` es el de la COLA, no el del superconjunto', () => {
  const mixed = [
    item({ id: 'a' }),
    item({ id: 'b', locationId: 'loc-1', priced: true }), // no entra
    item({ id: 'c', locationId: 'loc-1' }),
    item({ id: 'd', priced: true }),
  ];

  it('cuenta SOLO las pendientes', async () => {
    const { svc } = build(mixed);
    const res: any = await svc.pendingPublish({ page: 1, pageSize: 20 });
    // *Una cola que dijera 4 cuando hay 3 sería peor que no tener cola.*
    expect(res.total).toBe(3);
    expect(res.data.map((r: any) => r.inventoryItemId)).toEqual(['a', 'c', 'd']);
  });

  it('pagina sobre la cola REAL y el total no cambia entre páginas', async () => {
    const { svc } = build(mixed);
    const p1: any = await svc.pendingPublish({ page: 1, pageSize: 2 });
    const p2: any = await svc.pendingPublish({ page: 2, pageSize: 2 });
    expect(p1.total).toBe(3);
    expect(p2.total).toBe(3);
    expect(p1.data).toHaveLength(2);
    expect(p2.data).toHaveLength(1);
    // Sin solape: el orden es estable, así que ninguna fila se ve dos veces ni se pierde.
    const seen = [...p1.data, ...p2.data].map((r: any) => r.inventoryItemId);
    expect(new Set(seen).size).toBe(3);
  });

  it('`?missing=price` no cuenta las que solo esperan ubicación', async () => {
    const { svc } = build(mixed);
    const res: any = await svc.pendingPublish({ page: 1, pageSize: 20, missing: 'price' });
    expect(res.data.map((r: any) => r.inventoryItemId)).toEqual(['a', 'c']);
    expect(res.total).toBe(2);
  });

  it('`?missing=location` no cuenta las que solo esperan precio', async () => {
    const { svc } = build(mixed);
    const res: any = await svc.pendingPublish({ page: 1, pageSize: 20, missing: 'location' });
    expect(res.data.map((r: any) => r.inventoryItemId)).toEqual(['a', 'd']);
  });
});

// =============================================================================================
describe('⚠️⚠️ (3) la cola NO ESCRIBE: un GET no toca la cola de precio de M2', () => {
  it('mirar la cola no escala ni cierra ni una sola entrada', async () => {
    const { svc, pricing, writes } = build([
      item({ id: 'a' }),
      item({ id: 'b', locationId: 'loc-1', priced: true }),
      item({ id: 'c', locationId: 'loc-1' }),
    ]);
    await svc.pendingPublish({ page: 1, pageSize: 20 });
    // ⚠️ Ni escalada ni cierre. `pendingPublishStateOf` usa `derivePublishSalePrice` (sin efectos),
    // no `resolvePublishSalePrice`. Si alguien los cambiara, este test cae.
    expect(pricing.settlePendingForVariant).not.toHaveBeenCalled();
    expect(pricing.escalatePending).not.toHaveBeenCalled();
    expect(writes.filter((w) => w === 'update' || w === 'updateMany')).toEqual([]);
  });

  it('el deep-link `pendingPriceEntryId` sale de la entrada ABIERTA que ya existe', async () => {
    const { svc } = build(
      [item({ id: 'a', locationId: 'loc-1' })],
      [
        {
          id: 'ppe-1',
          cardId: 'card-a',
          productType: 'raw',
          gradeKey: 'raw:NM',
          finish: 'normal',
          sealedProductId: null,
        },
      ],
    );
    const res: any = await svc.pendingPublish({ page: 1, pageSize: 20 });
    expect(res.data[0].pendingPriceEntryId).toBe('ppe-1');
  });

  it('sin entrada abierta el deep-link es `null` — no se inventa un id', async () => {
    const { svc } = build([item({ id: 'a', locationId: 'loc-1' })]);
    const res: any = await svc.pendingPublish({ page: 1, pageSize: 20 });
    expect(res.data[0].pendingPriceEntryId).toBeNull();
  });

  it('una entrada abierta de OTRA variante no se empareja con esta pieza', async () => {
    const { svc } = build(
      [item({ id: 'a', locationId: 'loc-1' })],
      [
        {
          id: 'ppe-otra',
          cardId: 'card-a',
          productType: 'raw',
          gradeKey: 'raw:NM',
          // Otro acabado ⇒ otra entrada (la cola es POR acabado, M-19).
          finish: 'holofoil',
          sealedProductId: null,
        },
      ],
    );
    const res: any = await svc.pendingPublish({ page: 1, pageSize: 20 });
    expect(res.data[0].pendingPriceEntryId).toBeNull();
  });
});

// =============================================================================================
describe('⚠️⚠️ (4) el bypass del PATCH, CERRADO', () => {
  it('publicar SIN precio resoluble ⇒ `422 PRICE_PENDING` (antes pasaba y se descartaba en silencio)', async () => {
    const { svc } = build([item({ id: 'a', locationId: 'loc-1' })]);
    const err = (await svc
      .updateItem('a', { status: 'listed' } as UpdateItemDto)
      .catch((e) => e)) as BusinessException;
    expect(err).toBeInstanceOf(BusinessException);
    expect(err.code).toBe('PRICE_PENDING');
  });

  it('⚠️ y la pieza ENTRA A LA COLA de M2: es un pendiente visible, no una carta perdida', async () => {
    const { svc, pricing } = build([item({ id: 'a', locationId: 'loc-1' })]);
    await svc.updateItem('a', { status: 'listed' } as UpdateItemDto).catch(() => undefined);
    expect(pricing.settlePendingForVariant).toHaveBeenCalledWith(
      'no_market',
      expect.objectContaining({ cardId: 'card-a', gradeKey: 'raw:NM', finish: 'normal' }),
      'inventory',
    );
  });

  it('⚠️ y NO SE PUBLICA: el status sigue `in_stock`', async () => {
    const { svc, rows } = build([item({ id: 'a', locationId: 'loc-1' })]);
    await svc.updateItem('a', { status: 'listed' } as UpdateItemDto).catch(() => undefined);
    expect(rows[0].status).toBe('in_stock');
  });

  it('⚠️ un fallo de publicación NO deja los demás campos a medias', async () => {
    const { svc, prisma } = build([item({ id: 'a', locationId: 'loc-1' })]);
    await svc
      .updateItem('a', { status: 'listed', certNumber: 'X-1' } as UpdateItemDto)
      .catch(() => undefined);
    // Las guardas corren ANTES de escribir: el `certNumber` no se persiste si la pieza no se publica.
    expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
  });

  it('con precio resoluble SÍ publica, y por la guarda ATÓMICA (anti-double-sell)', async () => {
    const { svc, prisma, rows } = build([item({ id: 'a', locationId: 'loc-1', priced: true })]);
    const res: any = await svc.updateItem('a', { status: 'listed' } as UpdateItemDto);
    expect(res.status).toBe('listed');
    expect(rows[0].status).toBe('listed');
    expect(prisma.inventoryItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['in_stock', 'listed'] } }),
      }),
    );
  });

  it('⚠️ una pieza en status NO publicable ⇒ `ITEM_NOT_PUBLISHABLE`, igual que en el lote', async () => {
    const { svc } = build([
      item({ id: 'a', locationId: 'loc-1', priced: true, status: 'reserved' }),
    ]);
    const err = (await svc
      .updateItem('a', { status: 'listed' } as UpdateItemDto)
      .catch((e) => e)) as BusinessException;
    expect(err.code).toBe('ITEM_NOT_PUBLISHABLE');
  });

  it('un PATCH que NO publica sigue siendo un update plano (no se le añade ceremonia)', async () => {
    const { svc, prisma } = build([item({ id: 'a', locationId: 'loc-1' })]);
    await svc.updateItem('a', { gradeValue: '9' } as UpdateItemDto);
    expect(prisma.inventoryItem.update).toHaveBeenCalled();
    expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalled();
  });

  it('una pieza YA `listed` no vuelve a pasar por el pipeline (previo era `listed`)', async () => {
    const { svc, prisma } = build([
      item({ id: 'a', locationId: 'loc-1', priced: true, status: 'listed' }),
    ]);
    await svc.updateItem('a', { status: 'listed', gradeValue: '9' } as UpdateItemDto);
    expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalled();
  });
});

// =============================================================================================
describe('⚠️ (5) auto-publicación al fijar ubicación, SIN BOTÓN', () => {
  it('mover una pieza con precio a su caja la publica sola', async () => {
    const { svc, rows } = build([item({ id: 'a', priced: true })]);
    const res: any = await svc.moveItem('a', { toLocationId: 'loc-1' }, 'op-1');
    expect(rows[0].locationId).toBe('loc-1');
    expect(rows[0].status).toBe('listed');
    expect(res.status).toBe('listed');
  });

  it('⚠️ y SALE de la cola: el drenaje no depende de que alguien apriete nada', async () => {
    const { svc } = build([item({ id: 'a', priced: true })]);
    expect((await svc.pendingPublish({ page: 1, pageSize: 20 })).total).toBe(1);
    await svc.moveItem('a', { toLocationId: 'loc-1' }, 'op-1');
    expect((await svc.pendingPublish({ page: 1, pageSize: 20 })).total).toBe(0);
  });

  it('⚠️⚠️ sin precio: el `move` NO FALLA — la ubicación es un hecho, publicar es la consecuencia', async () => {
    const { svc, rows } = build([item({ id: 'a' })]);
    const res: any = await svc.moveItem('a', { toLocationId: 'loc-1' }, 'op-1');
    // Si el intento tumbara el move, el operador **no podría ni guardar la ubicación** de una carta
    // sin precio de mercado — y ésa es justo la que más falta hace localizar.
    expect(rows[0].locationId).toBe('loc-1');
    expect(res.status).toBe('in_stock');
  });

  it('⚠️ y el fallo NO es silencioso: escala a la cola de M2 y la pieza SIGUE en `pending-publish`', async () => {
    const { svc, pricing } = build([item({ id: 'a' })]);
    await svc.moveItem('a', { toLocationId: 'loc-1' }, 'op-1');
    expect(pricing.settlePendingForVariant).toHaveBeenCalledWith(
      'no_market',
      expect.objectContaining({ cardId: 'card-a' }),
      'inventory',
    );
    const res: any = await svc.pendingPublish({ page: 1, pageSize: 20 });
    expect(res.data[0].missing).toEqual(['price']);
  });

  it('⚠️⚠️ PIEZA DE CUSTODIA: mover la carta de un cliente NO puede fallar por un intento de publicar', async () => {
    // La encontré mutando: quitar el `try/catch` de `tryAutoPublish` **no rompía ningún test**, y
    // el caso que discrimina no es el de «sin precio» (ése no lanza, devuelve `ok:false`) sino éste.
    // `assertPublishableGuards` lanza `VALIDATION_ERROR` en inventario que **no es de plataforma**, y
    // las piezas de custodia **se mueven de caja todos los días**. Sin el catch, la bóveda no podría
    // reubicar la carta de un cliente. *Nunca se publica lo ajeno; tampoco se bloquea moverlo.*
    const { svc, rows } = build([item({ id: 'a', priced: true })]);
    (rows[0] as Record<string, unknown>).ownerType = 'customer';
    (rows[0] as Record<string, unknown>).status = 'in_custody';
    await expect(svc.moveItem('a', { toLocationId: 'loc-9' }, 'op-1')).resolves.toBeDefined();
    expect(rows[0].locationId).toBe('loc-9');
    expect(rows[0].status).toBe('in_custody');
  });

  it('⚠️ CARRERA: si un checkout reserva la pieza entre el move y el claim, el move sobrevive', async () => {
    // `claimListed` lanza `ITEM_NOT_PUBLISHABLE` cuando su guarda atómica devuelve `count: 0`. Eso
    // es **correcto** (anti-double-sell) y **no es motivo para perder la ubicación** que el operador
    // acaba de capturar. El intento se degrada; el hecho físico no.
    const { svc, prisma, rows } = build([item({ id: 'a', priced: true })]);
    (prisma.inventoryItem.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });
    await expect(svc.moveItem('a', { toLocationId: 'loc-1' }, 'op-1')).resolves.toBeDefined();
    expect(rows[0].locationId).toBe('loc-1');
    expect(rows[0].status).toBe('in_stock');
  });

  it('el movimiento físico se registra SIEMPRE, publique o no', async () => {
    const { svc, prisma } = build([item({ id: 'a' })]);
    await svc.moveItem('a', { toLocationId: 'loc-1' }, 'op-1');
    expect(prisma.inventoryMovement.create).toHaveBeenCalled();
  });
});

// =============================================================================================
describe('⚠️ (6) el PISO NO GANA — decisión LOCKED §4.36.0, y no se toca', () => {
  it('sin `PriceReference` la pieza NO se publica ni con ubicación', async () => {
    const { svc, rows } = build([item({ id: 'a' })]);
    await svc.moveItem('a', { toLocationId: 'loc-1' }, 'op-1');
    // El piso de la curva **no rellena** un precio que no existe: money-safe. Lo que cambia con la
    // fase 8 no es esa regla — es que la pieza deja de ser invisible mientras espera.
    expect(rows[0].status).not.toBe('listed');
    expect(rows[0].listPriceCents).toBeNull();
  });

  it('y aparece en la cola con `priceBasis: "pending"`, que es el veredicto, no un «no sé»', async () => {
    const { svc } = build([item({ id: 'a', locationId: 'loc-1' })]);
    const res: any = await svc.pendingPublish({ page: 1, pageSize: 20 });
    expect(res.data[0].priceBasis).toBe('pending');
    expect(res.data[0].resolvedSalePriceCents).toBeNull();
  });
});
