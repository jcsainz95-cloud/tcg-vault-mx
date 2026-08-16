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
  const prisma: any = {
    priceReference: {
      upsert: jest.fn(async () => ({ id: 'ref-1' })),
    },
    pendingPriceEntry: {
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
  return { svc, prisma, updateManyCalls, createCalls, findFirstCalls };
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
