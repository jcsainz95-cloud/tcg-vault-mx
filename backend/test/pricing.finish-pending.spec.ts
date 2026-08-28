import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { PokemonTcgIoProvider } from '../src/modules/pricing/providers/pokemontcg-io.provider';
import {
  PokeTraceProvider,
  PokemonPriceTrackerProvider,
} from '../src/modules/pricing/providers/graded-sealed.providers';

/**
 * v1.8-ronda-c — Cola de precio pendiente + override POR ACABADO (M-19).
 * Bugs reales corregidos:
 *  (a) manualOverride: el updateMany que resuelve pendientes filtraba SIN `finish` → cerraba TODOS
 *      los acabados. Ahora incluye `finish` → resuelve SOLO el pendiente de ese acabado.
 *  (b) escalatePending: encolaba sin `finish` → `normal`/`holofoil` de la misma carta colapsaban en
 *      UNA entrada. Ahora `finish` entra a la clave de dedupe y a la fila creada.
 */
function build() {
  const updateManyCalls: any[] = [];
  const createCalls: any[] = [];
  const findFirstCalls: any[] = [];
  const findManyCalls: any[] = [];
  const prisma: any = {
    priceReference: {
      // v1.29 (M-31): manualOverride usa findFirst + create/update (cardProductId=null).
      findFirst: jest.fn(async () => null),
      create: jest.fn(async () => ({ id: 'ref-1' })),
      update: jest.fn(async () => ({ id: 'ref-1' })),
      upsert: jest.fn(async () => ({ id: 'ref-1' })),
    },
    pendingPriceEntry: {
      // v2.1 (§4.36.5c): `pendingQueue` agrega los counts por motivo en el MISMO snapshot.
      groupBy: jest.fn(async () => []),
      updateMany: jest.fn(async (args: any) => {
        updateManyCalls.push(args);
        return { count: 1 };
      }),
      findFirst: jest.fn(async (args: any) => {
        findFirstCalls.push(args);
        return null; // no hay pendiente abierto para ese acabado
      }),
      create: jest.fn(async (args: any) => {
        createCalls.push(args);
        return { id: 'pending-1' };
      }),
      findMany: jest.fn(async (args: any) => {
        findManyCalls.push(args);
        return [
          {
            id: 'p1',
            cardId: 'c1',
            productType: 'raw',
            gradeKey: 'raw:NM',
            finish: 'holofoil',
            context: 'inventory',
            refId: null,
            status: 'open',
            resolvedPriceRefId: null,
            createdAt: new Date('2026-08-17T00:00:00Z'),
            resolvedAt: null,
            card: {
              id: 'c1',
              name: 'Zapdos',
              number: '16',
              set: { id: 's1', name: 'Fossil' },
            },
          },
        ];
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
  return { svc, prisma, updateManyCalls, createCalls, findFirstCalls, findManyCalls };
}

describe('PricingService.manualOverride — resuelve SOLO el pendiente de su acabado', () => {
  it('el where del updateMany incluye `finish` (holofoil no cierra al de normal)', async () => {
    const { svc, updateManyCalls } = build();
    await svc.manualOverride('c1', 'raw', 'raw:NM', 12500, 'holofoil');
    expect(updateManyCalls).toHaveLength(1);
    expect(updateManyCalls[0].where).toMatchObject({
      cardId: 'c1',
      productType: 'raw',
      gradeKey: 'raw:NM',
      finish: 'holofoil',
      status: 'open',
    });
  });

  it('default `normal` cuando se omite el acabado (retrocompatible)', async () => {
    const { svc, updateManyCalls } = build();
    await svc.manualOverride('c1', 'raw', 'raw:NM', 12500);
    expect(updateManyCalls[0].where.finish).toBe('normal');
  });
});

describe('PricingService.escalatePending — cola POR acabado', () => {
  it('encola con `finish` en la clave de dedupe y en la fila creada', async () => {
    const { svc, findFirstCalls, createCalls } = build();
    await svc.escalatePending('c1', 'raw', 'raw:NM', 'buylist', undefined, 'holofoil');
    expect(findFirstCalls[0].where).toMatchObject({ finish: 'holofoil', status: 'open' });
    expect(createCalls[0].data).toMatchObject({ finish: 'holofoil', status: 'open' });
  });

  it('default `normal` cuando se omite el acabado', async () => {
    const { svc, createCalls } = build();
    await svc.escalatePending('c1', 'raw', 'raw:NM', 'catalog');
    expect(createCalls[0].data.finish).toBe('normal');
  });
});

/**
 * Tier 0 — `pendingQueue()` incluye la carta y expone `cardName` + `finish`.
 * Bug real corregido: el findMany no hacía `include: { card }` → el DTO llegaba sin
 * `cardName` y el frontend M2 pintaba el UUID de la carta en la cola.
 */
describe('PricingService.pendingQueue — trae la carta y propaga el finish', () => {
  it('hace include de card (con set) en el findMany', async () => {
    const { svc, findManyCalls } = build();
    await svc.pendingQueue();
    expect(findManyCalls).toHaveLength(1);
    expect(findManyCalls[0].where).toMatchObject({ status: 'open' });
    // v1.42 (BLOQ-2b): la cola incluye `sealedProduct` para resolver la identidad de display del sellado.
    expect(findManyCalls[0].include).toEqual({ card: { include: { set: true } }, sealedProduct: true });
  });

  it('cada entrada expone cardName, card{name,number,setName} y finish', async () => {
    const { svc } = build();
    const { data } = await svc.pendingQueue();
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      id: 'p1',
      cardId: 'c1',
      productType: 'raw',
      gradeKey: 'raw:NM',
      finish: 'holofoil',
      context: 'inventory',
      status: 'open',
      cardName: 'Zapdos',
      card: { id: 'c1', name: 'Zapdos', number: '16', setName: 'Fossil' },
    });
    // La relación cruda de Prisma no se filtra al DTO (el card anidado es la proyección plana).
    expect((data[0] as any).card.set).toBeUndefined();
  });
});
