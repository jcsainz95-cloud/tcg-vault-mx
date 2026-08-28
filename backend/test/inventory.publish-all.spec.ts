import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';
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

/**
 * v1.28 (P-19, §4.26c / API_CONTRACT §M1) — POST /admin/inventory/publish-all.
 * Cubre las garantías NORMATIVAS del contrato:
 *  - selección SERVER-SIDE (`ownerType=platform` + `status ∈ {in_stock, listed}` ± setId/productType),
 *    sin cap — v2.1.1 (§4.36.5b-bis): incluye lo YA publicado, porque este endpoint es el paso 2 del
 *    cut-over y «re-resolver toda pieza» era falso mientras solo miraba `in_stock`;
 *  - TOLERANTE por-ítem: publicadas / ya listadas RE-VERIFICADAS / sin precio → PRICE_PENDING
 *    escalado (④) / fallidas con motivo — el lote JAMÁS revienta completo;
 *  - money-safe: una pieza sin precio resoluble NUNCA se publica; el sellOverride M-30 la vuelve
 *    publicable (precedencia v1.28, pipeline IDÉNTICO a bulk-publish);
 *  - idempotencia por `batchKey` (`InventoryBatch kind='publish_all'`; replay = resultado guardado
 *    + idempotentReplay:true, sin re-procesar; batchKey de otro kind → 409);
 *  - detalle de fallos CAPADO a 200 (el remanente vive en la cola M2 ?context=inventory).
 *
 * Wiring: PricingService REAL (escalatePending + dedupe + getVariantOverridesBatch reales) con
 * prisma en memoria; se stubean los reads izados una vez (loadSalesRules/loadSealedSpreads/
 * getReferencesBatch), patrón de test/inventory.bulk-publish-escalate.spec.ts.
 */

function buildHarness() {
  const items: any[] = [];
  const pendingStore: any[] = [];
  const batchStore = new Map<string, any>();
  const overrides: any[] = [];
  let pendSeq = 0;
  const hooks: { afterSelection?: () => void } = {};

  const prisma: any = {
    cardSet: {
      findUnique: jest.fn(async ({ where }: any) =>
        ['set-1', 'set-2'].includes(where.id) ? { id: where.id } : null,
      ),
    },
    inventoryItem: {
      findMany: jest.fn(async (args: any) => {
        if (args.where?.id?.in) {
          // Fetch del chunk (include card).
          return items.filter((i) => args.where.id.in.includes(i.id));
        }
        // Selección server-side (solo ids). v2.1.1: la allowlist llega como `status: { in: [...] }`.
        const wantStatus: string[] = args.where.status?.in ?? [args.where.status];
        const res = items
          .filter(
            (i) =>
              i.ownerType === args.where.ownerType &&
              wantStatus.includes(i.status) &&
              (args.where.productType ? i.productType === args.where.productType : true) &&
              (args.where.card?.setId ? i.card.setId === args.where.card.setId : true),
          )
          .map((i) => ({ id: i.id }));
        hooks.afterSelection?.();
        return res;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const it = items.find((i) => i.id === where.id);
        if (it && where.status.in.includes(it.status)) {
          Object.assign(it, data);
          return { count: 1 };
        }
        return { count: 0 };
      }),
    },
    inventoryBatch: {
      findUnique: jest.fn(async ({ where }: any) => batchStore.get(where.id) ?? null),
      create: jest.fn(async ({ data }: any) => {
        if (batchStore.has(data.id)) {
          const err: any = new Error('P2002');
          err.code = 'P2002';
          throw err;
        }
        batchStore.set(data.id, data);
        return data;
      }),
    },
    variantPriceOverride: {
      findMany: jest.fn(async ({ where }: any) =>
        overrides.filter((o) => where.cardId.in.includes(o.cardId)),
      ),
    },
    pendingPriceEntry: {
      findFirst: jest.fn(async ({ where }: any) =>
        pendingStore.find(
          (e) =>
            e.cardId === where.cardId &&
            e.productType === where.productType &&
            e.gradeKey === where.gradeKey &&
            e.finish === where.finish &&
            e.status === where.status,
        ) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `pend-${++pendSeq}`, ...data };
        pendingStore.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = pendingStore.find((e) => e.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
      // v2.0 (§4.36.5c): SALIDA simétrica de la cola — el mismo seam que escala CIERRA cuando el
      // precio vuelve a resolver. Antes de v2.0 el ingest no cerraba nada.
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const e of pendingStore) {
          if (
            e.cardId === where.cardId &&
            e.productType === where.productType &&
            e.gradeKey === where.gradeKey &&
            e.finish === where.finish &&
            e.status === where.status
          ) {
            Object.assign(e, data);
            count++;
          }
        }
        return { count };
      }),
    },
  };

  const settings = { getNumber: jest.fn(async () => 70) } as unknown as SettingsService;
  const pricing = new PricingService(
    prisma as PrismaService,
    settings,
    {} as FxService,
    {} as PokemonTcgIoProvider,
    {} as PokemonPriceTrackerProvider,
    {} as PokeTraceProvider,
  );
  jest.spyOn(pricing, 'loadPricingCurve').mockResolvedValue(DEFAULT_PRICING_CURVE);
  jest.spyOn(pricing, 'loadSealedSpreads').mockResolvedValue({
    spreadPctBySubtype: {},
    fallbackPct: 25,
    sourceOn: false,
  } as any);
  const refsBatch = jest.spyOn(pricing, 'getReferencesBatch').mockResolvedValue(new Map());

  const svc = new InventoryService(prisma as PrismaService, pricing, settings);
  return { svc, pricing, prisma, items, pendingStore, batchStore, overrides, refsBatch, hooks };
}

let seq = 0;
const rawItem = (over: any = {}) => ({
  id: `i${++seq}`,
  folio: `INV-${String(seq).padStart(6, '0')}`,
  cardId: `c${seq}`,
  productType: 'raw',
  finish: 'normal',
  rawCondition: 'NM',
  certNumber: null,
  ownerType: 'platform',
  status: 'in_stock',
  listPriceCents: null,
  sealedSubtype: null,
  tcgplayerProductId: null,
  card: { rarity: 'Illustration Rare', setId: 'set-1' }, // sin regla → pct fallback (pending sin market)
  ...over,
});

describe('publishAll (P-19) — tolerante por-ítem, money-safe', () => {
  it('publica lo preciable, reporta lo pendiente (escala ④) y lo fallido con motivo — sin reventar', async () => {
    const h = buildHarness();
    const manual = rawItem({ listPriceCents: 9900 }); // manual por pieza → publica
    const priced = rawItem({}); // fallback pct CON referencia → publica
    const priceless = rawItem({}); // fallback pct SIN referencia → PRICE_PENDING
    const badGraded = rawItem({
      productType: 'graded',
      gradingCompany: 'PSA',
      gradeValue: '10',
      certNumber: null, // sin cert → VALIDATION_ERROR (falla, no publica)
    });
    h.items.push(manual, priced, priceless, badGraded);
    h.refsBatch.mockResolvedValue(
      new Map([
        [`${priced.cardId}|raw|raw:NM|normal`, { status: 'priced', referenceMxnCents: 10000 } as any],
      ]),
    );

    const res = await h.svc.publishAll({}, 'admin');

    expect(res.summary).toEqual({
      selected: 4,
      published: 2,
      alreadyListed: 0,
      pendingPrice: 1,
      failed: 1,
      // Ninguna de las que escalaron estaba `listed` (todas venían de `in_stock`).
      listedNowPending: 0,
    });
    expect(res.idempotentReplay).toBe(false);
    // Publicadas transicionan; las demás conservan su status de origen (money-safe).
    expect(manual.status).toBe('listed');
    expect(priced.status).toBe('listed');
    expect(priceless.status).toBe('in_stock');
    expect(badGraded.status).toBe('in_stock');
    // Falla PRICE_PENDING con folio + deep-link a la cola escalada (context=inventory).
    const pend = res.failures.find((f) => f.inventoryItemId === priceless.id)!;
    expect(pend).toMatchObject({ folio: priceless.folio, error: { code: 'PRICE_PENDING' } });
    expect(pend.pendingPriceEntryId).toBe(h.pendingStore[0].id);
    expect(h.pendingStore[0]).toMatchObject({
      cardId: priceless.cardId,
      context: 'inventory',
      status: 'open',
    });
    // Falla de validación con su motivo.
    expect(res.failures.find((f) => f.inventoryItemId === badGraded.id)!.error.code).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('publish-all NO persiste el precio derivado (se resuelve en lectura; solo cambia status)', async () => {
    const h = buildHarness();
    const priced = rawItem({});
    h.items.push(priced);
    h.refsBatch.mockResolvedValue(
      new Map([
        [`${priced.cardId}|raw|raw:NM|normal`, { status: 'priced', referenceMxnCents: 10000 } as any],
      ]),
    );
    await h.svc.publishAll({}, 'admin');
    expect(priced.status).toBe('listed');
    expect(priced.listPriceCents).toBeNull(); // sin override manual: nada que persistir
  });

  it('el sellOverride M-30 vuelve publicable una variante sin mercado (precedencia v1.28)', async () => {
    const h = buildHarness();
    const item = rawItem({}); // pct fallback SIN referencia: sin override sería PRICE_PENDING
    h.items.push(item);
    h.overrides.push({
      cardId: item.cardId,
      productType: 'raw',
      gradeKey: 'raw:NM',
      finish: 'normal',
      sellOverrideCents: 12345,
      buyOverrideCents: null,
      bountyEnabled: false,
      bountyPriceCents: null,
    });
    const res = await h.svc.publishAll({}, 'admin');
    expect(res.summary).toMatchObject({ selected: 1, published: 1, pendingPrice: 0, failed: 0 });
    expect(item.status).toBe('listed');
    expect(h.pendingStore).toHaveLength(0);
  });

  it('una pieza que se volvió `listed` entre selección y proceso cuenta como alreadyListed (no-op)', async () => {
    const h = buildHarness();
    const item = rawItem({ listPriceCents: 5000 });
    h.items.push(item);
    // Simula la transición concurrente: tras la SELECCIÓN, otro flujo la publica.
    h.hooks.afterSelection = () => {
      item.status = 'listed';
    };
    const res = await h.svc.publishAll({}, 'admin');
    expect(res.summary).toMatchObject({ selected: 1, published: 0, alreadyListed: 1, failed: 0 });
    // No-op: no se re-escribe la pieza (updateMany solo se llamó 0 veces para publicar).
    expect(h.prisma.inventoryItem.updateMany).not.toHaveBeenCalled();
  });
});

/**
 * v2.1.1 (P-48, §4.36.5b-bis / E4-bis) — PUNTO CIEGO DEL INVENTARIO YA `listed`.
 *
 * `publishAll` seleccionaba solo `in_stock`, así que una pieza PUBLICADA nunca se re-evaluaba: si su
 * mercado se degradaba después, dejaba de venderse en SILENCIO y no entraba a la cola. Y ensanchar la
 * selección SIN tocar el corto-circuito de la rama `listed` habría sido peor que no hacer nada: cada
 * pieza degradada se habría contado como `alreadyListed`, que se lee como «ésta ya estaba bien».
 * Estos tests son el candado de LAS DOS COSAS: se selecciona `listed` **y** se re-resuelve.
 */
describe('publishAll — E4-bis: lo ya `listed` se RE-RESUELVE (§4.36.5b-bis)', () => {
  it('pieza `listed` DEGRADADA (premium en el piso): entra a la cola, SIGUE listed, cuenta en pendingPrice y listedNowPending — NO en alreadyListed', async () => {
    const h = buildHarness();
    // Illustration Rare (premium) con mercado ABSURDO ($10): la curva la manda al PISO ⇒ el
    // guardarraíl dispara `premium_at_floor`. Es el escenario exacto del reporte del dueño.
    const degradada = rawItem({ status: 'listed' });
    h.items.push(degradada);
    h.refsBatch.mockResolvedValue(
      new Map([
        [`${degradada.cardId}|raw|raw:NM|normal`, { status: 'priced', referenceMxnCents: 1000 } as any],
      ]),
    );

    const res = await h.svc.publishAll({}, 'admin');

    expect(res.summary).toEqual({
      selected: 1,
      published: 0,
      alreadyListed: 0, // ⛔ el bug disfrazado sería contarla aquí
      pendingPrice: 1,
      failed: 0,
      listedNowPending: 1,
    });
    // ESCALÓ con su motivo…
    expect(h.pendingStore).toHaveLength(1);
    expect(h.pendingStore[0]).toMatchObject({
      cardId: degradada.cardId,
      context: 'inventory',
      status: 'open',
      reason: 'premium_at_floor',
    });
    // …y NO se le tocó el status: sigue a la venta (no hay exposición que cerrar y un flip
    // `listed → in_stock` competiría con un checkout en vuelo).
    expect(degradada.status).toBe('listed');
    expect(h.prisma.inventoryItem.updateMany).not.toHaveBeenCalled();
    // El fallo sale con deep-link a la cola.
    expect(res.failures[0]).toMatchObject({
      inventoryItemId: degradada.id,
      error: { code: 'PRICE_PENDING' },
      pendingPriceEntryId: h.pendingStore[0].id,
    });
  });

  it('pieza `listed` SIN mercado (`no_market`) también entra a la cola y sigue listed', async () => {
    const h = buildHarness();
    const item = rawItem({ status: 'listed' });
    h.items.push(item);
    h.refsBatch.mockResolvedValue(new Map()); // el feed dejó de reportarla

    const res = await h.svc.publishAll({}, 'admin');

    expect(res.summary).toMatchObject({ pendingPrice: 1, listedNowPending: 1, alreadyListed: 0 });
    expect(h.pendingStore[0]).toMatchObject({ status: 'open', reason: 'no_market' });
    expect(item.status).toBe('listed');
  });

  it('RECÍPROCO — pieza `listed` SANA: cuenta en alreadyListed, no escala, no re-cobra ni re-escribe', async () => {
    const h = buildHarness();
    const sana = rawItem({ status: 'listed' });
    h.items.push(sana);
    h.refsBatch.mockResolvedValue(
      new Map([
        [`${sana.cardId}|raw|raw:NM|normal`, { status: 'priced', referenceMxnCents: 100000 } as any],
      ]),
    );

    const res = await h.svc.publishAll({}, 'admin');

    expect(res.summary).toEqual({
      selected: 1,
      published: 0,
      alreadyListed: 1, // v2.1.1: significa «re-verificada y SANA», no «no la toqué»
      pendingPrice: 0,
      failed: 0,
      listedNowPending: 0,
    });
    expect(h.pendingStore).toHaveLength(0);
    // No-op observable: ni se re-escribe la fila ni se persiste precio (se resuelve en lectura).
    expect(h.prisma.inventoryItem.updateMany).not.toHaveBeenCalled();
    expect(sana.listPriceCents).toBeNull();
    expect(sana.status).toBe('listed');
  });

  it('la PARTICIÓN se conserva: selected = published + alreadyListed + pendingPrice + failed (listedNowPending FUERA)', async () => {
    const h = buildHarness();
    const nueva = rawItem({}); // in_stock con mercado → publica
    const sana = rawItem({ status: 'listed' }); // listed con mercado → alreadyListed
    const degradada = rawItem({ status: 'listed' }); // listed sin mercado → pendingPrice + listedNowPending
    const nuevaSinMercado = rawItem({}); // in_stock sin mercado → pendingPrice (NO listedNowPending)
    const badGraded = rawItem({ productType: 'graded', gradingCompany: 'PSA', gradeValue: '10' }); // failed
    h.items.push(nueva, sana, degradada, nuevaSinMercado, badGraded);
    h.refsBatch.mockResolvedValue(
      new Map([
        [`${nueva.cardId}|raw|raw:NM|normal`, { status: 'priced', referenceMxnCents: 100000 } as any],
        [`${sana.cardId}|raw|raw:NM|normal`, { status: 'priced', referenceMxnCents: 100000 } as any],
      ]),
    );

    const { summary } = await h.svc.publishAll({}, 'admin');

    expect(summary).toEqual({
      selected: 5,
      published: 1,
      alreadyListed: 1,
      pendingPrice: 2,
      failed: 1,
      listedNowPending: 1,
    });
    expect(summary.published + summary.alreadyListed + summary.pendingPrice + summary.failed).toBe(
      summary.selected,
    );
    // El subcontador es SUBCONJUNTO de pendingPrice, no un quinto balde.
    expect(summary.listedNowPending).toBeLessThanOrEqual(summary.pendingPrice);
  });

  it('la selección incluye `listed` (antes solo `in_stock`) — sin esto el cut-over daba falso negativo', async () => {
    const h = buildHarness();
    h.items.push(rawItem({ status: 'listed' }), rawItem({}), rawItem({ status: 'reserved' }));
    const res = await h.svc.publishAll({}, 'admin');
    // Selecciona las DOS publicables (listed + in_stock) y NO la reservada.
    expect(res.summary.selected).toBe(2);
  });
});

describe('publishAll (P-19) — filtros server-side', () => {
  it('setId + productType REDUCEN la selección; lo demás ni se toca', async () => {
    const h = buildHarness();
    const inSet = rawItem({ listPriceCents: 100, card: { rarity: 'Common', setId: 'set-1' } });
    const otherSet = rawItem({ listPriceCents: 100, card: { rarity: 'Common', setId: 'set-2' } });
    const sealedInSet = rawItem({
      productType: 'sealed',
      listPriceCents: 15000,
      sealedSubtype: 'box',
      card: { rarity: null, setId: 'set-1' },
    });
    const notInStock = rawItem({ listPriceCents: 100, status: 'reserved' });
    const customerOwned = rawItem({ listPriceCents: 100, ownerType: 'customer' });
    h.items.push(inSet, otherSet, sealedInSet, notInStock, customerOwned);

    const res = await h.svc.publishAll({ setId: 'set-1', productType: 'raw' }, 'admin');
    expect(res.summary).toMatchObject({ selected: 1, published: 1 });
    expect(inSet.status).toBe('listed');
    expect(otherSet.status).toBe('in_stock');
    expect(sealedInSet.status).toBe('in_stock');
    expect(notInStock.status).toBe('reserved');
    expect(customerOwned.status).toBe('in_stock');
  });

  it('setId inexistente → 400 VALIDATION_ERROR (filtro inválido, contrato §M1)', async () => {
    const h = buildHarness();
    const err = await h.svc.publishAll({ setId: 'nope' }, 'admin').catch((e) => e);
    expect(err).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(err.getStatus()).toBe(400);
  });
});

describe('publishAll (P-19) — idempotencia por batchKey', () => {
  it('replay devuelve el resultado GUARDADO con idempotentReplay:true y NO re-procesa', async () => {
    const h = buildHarness();
    const item = rawItem({ listPriceCents: 5000 });
    h.items.push(item);
    const first = await h.svc.publishAll({ batchKey: 'pa-1' }, 'admin');
    expect(first).toMatchObject({ batchKey: 'pa-1', idempotentReplay: false });
    expect(first.summary.published).toBe(1);

    const callsAfterFirst = h.prisma.inventoryItem.updateMany.mock.calls.length;
    const replay = await h.svc.publishAll({ batchKey: 'pa-1' }, 'admin');
    expect(replay).toMatchObject({ batchKey: 'pa-1', idempotentReplay: true });
    expect(replay.summary).toEqual(first.summary);
    // Sin re-proceso: ni updates ni nueva selección de piezas.
    expect(h.prisma.inventoryItem.updateMany.mock.calls.length).toBe(callsAfterFirst);
  });

  it('batchKey ya usado por OTRO kind de lote → 409 CONFLICT (no replay con shape ajeno)', async () => {
    const h = buildHarness();
    h.batchStore.set('bk-create', { id: 'bk-create', kind: 'create', resultJson: {} });
    const err = await h.svc.publishAll({ batchKey: 'bk-create' }, 'admin').catch((e) => e);
    expect(err).toMatchObject({ code: 'CONFLICT' });
    expect(err.getStatus()).toBe(409);
  });
});

describe('publishAll (P-19) — cap del detalle de fallos', () => {
  it('failures se CAPA a 200 líneas; el summary cuenta TODAS (remanente → cola M2)', async () => {
    const h = buildHarness();
    for (let i = 0; i < 201; i++) h.items.push(rawItem({})); // 201 priceless
    const res = await h.svc.publishAll({}, 'admin');
    expect(res.summary).toMatchObject({ selected: 201, pendingPrice: 201, published: 0 });
    expect(res.failures).toHaveLength(200);
    // Cada variante escaló su pendiente (dedupe por clave; aquí 201 cartas distintas).
    expect(h.pendingStore).toHaveLength(201);
  });
});
