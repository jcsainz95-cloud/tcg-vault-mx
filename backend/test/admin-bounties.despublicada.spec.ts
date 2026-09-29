import { AdminBountiesService } from '../src/modules/pricing/admin-bounties.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';
import { variantKey } from '../src/common/variant-key';

/**
 * `admin-bounties.despublicada.spec.ts` — **Q2 (§M2-B.0/.1/.9): el estado `despublicada` en la
 * consola.**
 *
 * `despublicada` = `bountyUnpublishedAt IS NOT NULL` (§M2-B.0, discrimina **primero**). Es el registro
 * archivado de un bounty **eliminado con historia**: sale del tablero por defecto, `counts` lo reporta
 * **siempre** (sexta cubeta, es selector), y reaparece solo con `?state=despublicada`.
 *
 * Cubre **B-18** (fuera del tablero por defecto, dentro con el filtro), **B-19** (no colapsa con
 * `apagada`/`completada`, discrimina primero) y la sexta cubeta de `counts`.
 */

const MARKET = 10000;
const SET = { id: 'set-1', name: 'E2E Set' };

interface RowSpec {
  id: string;
  enabled?: boolean;
  priceCents?: number | null;
  acquiredQty?: number;
  completedAt?: Date | null;
  unpublishedAt?: Date | null;
}

function row(spec: RowSpec) {
  const cardId = `card-${spec.id}`;
  return {
    id: spec.id,
    cardId,
    productType: 'raw' as const,
    gradeKey: 'raw:NM',
    finish: 'normal' as const,
    sellOverrideCents: null,
    buyOverrideCents: null,
    bountyEnabled: spec.enabled ?? false,
    bountyPriceCents: spec.priceCents === undefined ? 5000 : spec.priceCents,
    bountyTargetQty: 2,
    bountyAcquiredQty: spec.acquiredQty ?? 0,
    bountyCompletedAt: spec.completedAt ?? null,
    bountyUnpublishedAt: spec.unpublishedAt ?? null,
    updatedBy: 'admin-1',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    card: {
      id: cardId,
      setId: SET.id,
      name: `Carta ${spec.id}`,
      number: spec.id,
      rarity: 'Rare Holo',
      rarityCanonical: 'rara',
      imageSmallUrl: null,
      set: SET,
    },
  };
}

function svcOf(rows: ReturnType<typeof row>[]) {
  const findMany = jest.fn(async () => rows);
  const prisma = { variantPriceOverride: { findMany } } as unknown as PrismaService;
  const pricing = {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    getReferencesBatch: jest.fn(async (keys: any[]) => {
      const m = new Map<string, any>();
      for (const k of keys) m.set(variantKey(k), { status: 'priced', referenceMxnCents: MARKET });
      return m;
    }),
  } as unknown as PricingService;
  return { svc: new AdminBountiesService(prisma, pricing), findMany };
}

const query = (over: any = {}) => ({ page: 1, pageSize: 20, sort: 'attention_first' as const, ...over });

describe('§M2-B.0/.1 · Q2 — el estado `despublicada`', () => {
  it('B-19 ⭐ — `despublicada` DISCRIMINA PRIMERO: misma fila apagada vs con `unpublishedAt` dan estados distintos', async () => {
    // Dos filas idénticas (¬enabled, acquiredQty>0, completedAt=null) salvo `unpublishedAt`.
    const { svc } = svcOf([
      row({ id: 'apagada', enabled: false, acquiredQty: 1 }),
      row({ id: 'desp', enabled: false, acquiredQty: 1, unpublishedAt: new Date('2026-09-10T00:00:00Z') }),
    ]);
    // Pide AMBOS estados para que las dos filas salgan en `data`.
    const res = await svc.list(query({ states: ['apagada', 'despublicada'] as any }));
    const byCard = new Map(res.data.map((d) => [d.cardId, d.state]));
    expect(byCard.get('card-apagada')).toBe('apagada');
    expect(byCard.get('card-desp')).toBe('despublicada');
  });

  it('B-18 — `despublicada` sale del tablero POR DEFECTO (no está en `data` sin filtro)', async () => {
    const { svc } = svcOf([
      row({ id: 'activa', enabled: true, priceCents: 5000 }),
      row({ id: 'desp', enabled: false, acquiredQty: 1, unpublishedAt: new Date('2026-09-10T00:00:00Z') }),
    ]);
    const res = await svc.list(query());
    const states = res.data.map((d) => d.state);
    expect(states).not.toContain('despublicada');
    expect(res.data.map((d) => d.cardId)).toEqual(['card-activa']);
    // `total` (sin filtro `state`) NO cuenta la despublicada — es la suma de las CINCO de trabajo.
    expect(res.total).toBe(1);
  });

  it('B-18 — `despublicada` reaparece SOLO con `?state=despublicada`', async () => {
    const { svc } = svcOf([
      row({ id: 'activa', enabled: true, priceCents: 5000 }),
      row({ id: 'desp', enabled: false, acquiredQty: 1, unpublishedAt: new Date('2026-09-10T00:00:00Z') }),
    ]);
    const res = await svc.list(query({ states: ['despublicada'] as any }));
    expect(res.data.map((d) => d.cardId)).toEqual(['card-desp']);
    expect(res.data[0].state).toBe('despublicada');
  });

  it('`counts` SIEMPRE reporta la SEXTA cubeta `despublicada` (selector), aun sin filtro y aun fuera de `data`', async () => {
    const { svc } = svcOf([
      row({ id: 'activa', enabled: true, priceCents: 5000 }),
      row({ id: 'd1', enabled: false, acquiredQty: 1, unpublishedAt: new Date('2026-09-10T00:00:00Z') }),
      row({ id: 'd2', enabled: false, completedAt: new Date('2026-09-05T00:00:00Z'), unpublishedAt: new Date('2026-09-10T00:00:00Z') }),
    ]);
    const res = await svc.list(query());
    // `data` NO trae despublicadas, pero `counts` sí las cuenta: el dueño VE «hay 2 despublicadas».
    expect((res.counts as any).despublicada).toBe(2);
    expect(res.counts.activa).toBe(1);
    // El invariante de total se reexpresa: sin filtro, total == suma de las CINCO de trabajo.
    const { activa, rebasada, invalida, completada, apagada } = res.counts;
    expect(activa + rebasada + invalida + completada + apagada).toBe(res.total);
  });

  it('`attention_first` pone `despublicada` AL FINAL (cuando se pide con el filtro)', async () => {
    const { svc } = svcOf([
      row({ id: 'desp', enabled: false, acquiredQty: 1, unpublishedAt: new Date('2026-09-10T00:00:00Z') }),
      row({ id: 'reb', enabled: true, priceCents: 3000 }),
    ]);
    const res = await svc.list(query({ states: ['rebasada', 'despublicada'] as any }));
    expect(res.data.map((d) => d.state)).toEqual(['rebasada', 'despublicada']);
  });
});
