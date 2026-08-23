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
 * SEC N-3 (money-safe) — `manualOverride` resuelve SOLO la entrada pendiente CORRESPONDIENTE.
 *
 * Bug latente: el `updateMany` de resolución filtraba por (cardId, productType, gradeKey, finish, status)
 * SIN `sealedProductId`. Para sellado LEGACY (gradeKey='sealed' COMPARTIDO por varias identidades) un
 * override cerraba TODAS las entradas que compartían (cardId,'sealed',finish) — resolviendo pendientes
 * ajenos (ETB cerraba también el blíster). El fix añade `sealedProductId`/`cardProductId` al where
 * cuando el caller aporta la identidad (paridad con la clave de dedupe de `escalatePending`).
 *
 * El prisma en memoria HONRA el filtro `sealedProductId` del where (a diferencia de un mock laxo) para
 * que el test detecte una regresión real de Prisma.
 */
function build() {
  const pendingStore: any[] = [];
  const priceRefs: any[] = [];
  let refSeq = 0;

  const prisma: any = {
    priceReference: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `ref-${++refSeq}`, ...data };
        priceRefs.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const r = priceRefs.find((x) => x.id === where.id);
        Object.assign(r, data);
        return r;
      }),
    },
    pendingPriceEntry: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const e of pendingStore) {
          const match =
            e.cardId === where.cardId &&
            e.productType === where.productType &&
            e.gradeKey === where.gradeKey &&
            e.finish === where.finish &&
            e.status === where.status &&
            // El filtro SOLO se aplica cuando la clave está presente en el where (paridad Prisma).
            (!('sealedProductId' in where) || (e.sealedProductId ?? null) === where.sealedProductId) &&
            (!('cardProductId' in where) || (e.cardProductId ?? null) === where.cardProductId);
          if (match) {
            Object.assign(e, data);
            count++;
          }
        }
        return { count };
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
  return { svc, prisma, pendingStore };
}

const legacyPending = (id: string, sealedProductId: string | null) => ({
  id,
  cardId: 'c1',
  productType: 'sealed',
  gradeKey: 'sealed', // LEGACY: compartido por varias identidades
  finish: 'normal',
  cardProductId: null,
  sealedProductId,
  status: 'open',
  resolvedPriceRefId: null,
  resolvedAt: null,
});

describe('SEC N-3 — manualOverride resuelve SOLO la entrada de su sealedProductId', () => {
  it('dos pendientes legacy con distinto sealedProductId bajo (c1,sealed,normal): un override cierra SOLO el suyo', async () => {
    const { svc, pendingStore } = build();
    pendingStore.push(legacyPending('p-etb', 'sp-etb'));
    pendingStore.push(legacyPending('p-blister', 'sp-blister'));

    const ref = await svc.manualOverride('c1', 'sealed' as any, 'sealed', 200000, 'normal', undefined, {
      sealedProductId: 'sp-etb',
    });

    const etb = pendingStore.find((e) => e.id === 'p-etb');
    const blister = pendingStore.find((e) => e.id === 'p-blister');
    // Solo el ETB queda resuelto; el blíster sigue OPEN (no lo cerró un override ajeno).
    expect(etb.status).toBe('resolved');
    expect(etb.resolvedPriceRefId).toBe(ref.id);
    expect(blister.status).toBe('open');
    expect(blister.resolvedPriceRefId).toBeNull();
  });

  it('sin identidad (override standalone / raw/graded): retrocompat — NO restringe por sealedProductId', async () => {
    const { svc, prisma, pendingStore } = build();
    pendingStore.push(legacyPending('p-etb', 'sp-etb'));

    await svc.manualOverride('c1', 'sealed' as any, 'sealed', 200000, 'normal');

    // El where NO trae sealedProductId (comportamiento previo intacto: resuelve por gradeKey/finish).
    const whereArg = (prisma.pendingPriceEntry.updateMany as jest.Mock).mock.calls[0][0].where;
    expect('sealedProductId' in whereArg).toBe(false);
    expect(pendingStore.find((e) => e.id === 'p-etb').status).toBe('resolved');
  });

  it('caso MAPEADO (gradeKey=sealed:tcg:<id>) sigue segregado por gradeKey aunque el override no pase identidad', async () => {
    const { svc, pendingStore } = build();
    pendingStore.push({ ...legacyPending('p-777', 'sp-etb'), gradeKey: 'sealed:tcg:777' });
    pendingStore.push({ ...legacyPending('p-888', 'sp-blister'), gradeKey: 'sealed:tcg:888' });

    await svc.manualOverride('c1', 'sealed' as any, 'sealed:tcg:777', 200000, 'normal');

    // gradeKey ya distingue: solo el 777 se resuelve; el 888 sigue abierto.
    expect(pendingStore.find((e) => e.id === 'p-777').status).toBe('resolved');
    expect(pendingStore.find((e) => e.id === 'p-888').status).toBe('open');
  });
});
