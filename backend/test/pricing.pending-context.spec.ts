import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { PokemonTcgIoProvider } from '../src/modules/pricing/providers/pokemontcg-io.provider';
import {
  PokeTraceProvider,
  PokemonPriceTrackerProvider,
} from '../src/modules/pricing/providers/graded-sealed.providers';
import { PricingController } from '../src/modules/pricing/pricing.controller';
import { BusinessException } from '../src/common/business.exception';

/**
 * P-6 (§M2) — DOS BUCKETS en `GET /admin/pricing/pending`: `pendingQueue()` gana un filtro
 * opcional `context` (VENTA=`inventory`, COMPRA=`buylist` read-only) SIN cambiar el shape de
 * salida ni el resto de la lógica. Además:
 *  - `escalatePending` devuelve el id de la entrada open (creada o dedupe) para el deep-link ④.
 *  - dedupe idempotente: dos escaladas de la misma variante → UNA sola fila, mismo id.
 */

function buildPricing() {
  const store = [
    { id: 'p-inv', context: 'inventory', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' },
    { id: 'p-buy', context: 'buylist', productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil' },
    { id: 'p-cat', context: 'catalog', productType: 'sealed', gradeKey: 'sealed', finish: 'normal' },
  ].map((r) => ({
    cardId: 'c1',
    refId: null,
    status: 'open',
    resolvedPriceRefId: null,
    resolvedAt: null,
    createdAt: new Date('2026-08-20T00:00:00Z'),
    ...r,
  }));

  const createdCount = { n: 0 };
  const prisma: any = {
    pendingPriceEntry: {
      findMany: jest.fn(async ({ where }: any) =>
        store
          .filter((e) => e.status === where.status && (where.context ? e.context === where.context : true))
          .map((e) => ({ ...e, card: { id: e.cardId, name: 'Zapdos', number: '16', set: { name: 'Fossil' } } })),
      ),
      findFirst: jest.fn(async ({ where }: any) =>
        store.find(
          (e) =>
            e.cardId === where.cardId &&
            e.productType === where.productType &&
            e.gradeKey === where.gradeKey &&
            e.finish === where.finish &&
            e.status === where.status,
        ) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        createdCount.n++;
        const row = { id: `p-new-${createdCount.n}`, ...data };
        store.push(row as any);
        return row;
      }),
    },
  };
  const svc = new PricingService(
    prisma as PrismaService,
    {} as SettingsService,
    {} as FxService,
    {} as PokemonTcgIoProvider,
    {} as PokemonPriceTrackerProvider,
    {} as PokeTraceProvider,
  );
  return { svc, prisma, createdCount };
}

describe('PricingService.pendingQueue(context) — dos buckets (P-6)', () => {
  it('pendingQueue("inventory") → SOLO filas de VENTA (context=inventory)', async () => {
    const { svc, prisma } = buildPricing();
    const { data } = await svc.pendingQueue('inventory');
    expect(prisma.pendingPriceEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'open', context: 'inventory' } }),
    );
    expect(data.map((d: any) => d.id)).toEqual(['p-inv']);
  });

  it('pendingQueue("buylist") → SOLO filas de COMPRA (context=buylist)', async () => {
    const { svc } = buildPricing();
    const { data } = await svc.pendingQueue('buylist');
    expect(data.map((d: any) => d.id)).toEqual(['p-buy']);
  });

  it('pendingQueue() sin arg → TODAS las filas open (back-compat)', async () => {
    const { svc, prisma } = buildPricing();
    const { data } = await svc.pendingQueue();
    // Sin `context` en el where (no se filtra).
    expect(prisma.pendingPriceEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'open' } }),
    );
    expect(data.map((d: any) => d.id).sort()).toEqual(['p-buy', 'p-cat', 'p-inv']);
  });

  it('el shape por entrada NO cambia (cardName + card{...} + finish)', async () => {
    const { svc } = buildPricing();
    const { data } = await svc.pendingQueue('inventory');
    expect(data[0]).toMatchObject({
      id: 'p-inv',
      context: 'inventory',
      finish: 'normal',
      cardName: 'Zapdos',
      card: { id: 'c1', name: 'Zapdos', number: '16', setName: 'Fossil' },
    });
  });
});

describe('PricingService.escalatePending — devuelve id + idempotente (④)', () => {
  it('devuelve el id de una fila NUEVA', async () => {
    const { svc } = buildPricing();
    const id = await svc.escalatePending('c9', 'raw' as any, 'raw:NM', 'inventory', undefined, 'normal');
    expect(id).toBe('p-new-1');
  });

  it('re-escalar la MISMA variante NO crea otra fila y devuelve el id preexistente', async () => {
    const { svc, prisma, createdCount } = buildPricing();
    // (c1, raw, raw:NM, normal) YA existe abierto como p-inv.
    const id = await svc.escalatePending('c1', 'raw' as any, 'raw:NM', 'inventory', undefined, 'normal');
    expect(id).toBe('p-inv');
    expect(prisma.pendingPriceEntry.create).not.toHaveBeenCalled();
    expect(createdCount.n).toBe(0);
  });
});

describe('PricingController.pending — passthrough del query ?context= (P-6)', () => {
  function buildController(pendingQueue = jest.fn(async () => ({ data: [] }))) {
    const pricing = { pendingQueue } as any;
    return new PricingController(pricing, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  }

  it('pasa el context válido a pendingQueue', async () => {
    const pendingQueue = jest.fn(async () => ({ data: [] }));
    const ctrl = buildController(pendingQueue);
    await ctrl.pending('inventory');
    expect(pendingQueue).toHaveBeenCalledWith('inventory');
    await ctrl.pending('buylist');
    expect(pendingQueue).toHaveBeenCalledWith('buylist');
  });

  it('sin query → pendingQueue() sin arg (back-compat)', async () => {
    const pendingQueue = jest.fn(async () => ({ data: [] }));
    const ctrl = buildController(pendingQueue);
    await ctrl.pending(undefined);
    expect(pendingQueue).toHaveBeenCalledWith(undefined);
  });

  it('context inválido → 422 VALIDATION_ERROR (no llega al servicio)', () => {
    const pendingQueue = jest.fn(async () => ({ data: [] }));
    const ctrl = buildController(pendingQueue);
    // Validación síncrona (mismo estilo que el resto del controller): lanza BusinessException.
    expect(() => ctrl.pending('bogus')).toThrow(BusinessException);
    try {
      ctrl.pending('bogus');
    } catch (e) {
      expect((e as BusinessException).code).toBe('VALIDATION_ERROR');
    }
    expect(pendingQueue).not.toHaveBeenCalled();
  });
});
