/**
 * graded-turns-double.ts — v1.113⟨portada⟩ (§DYN.4): las tablas del turno PSA EN MEMORIA para los dobles de Prisma de las
 * unitarias del ingest graded (`GradedEstimateSetScan`, `GradedEstimateCardScan`, `card.groupBy`, y
 * `configSetting.findUnique` para el tope del día). AÑADE lo que falte al doble; ⛔ no reemplaza nada de lo que ya tiene.
 *
 * Por defecto: ningún set consultado nunca, tope 3000 (seed), catálogo de 1 carta por set (⇒ estimado 2 créditos). Así las
 * pruebas anteriores a §DYN siguen viendo «se pide el set» igual que antes.
 */
export interface GradedTurnsWorld {
  setScans: {
    id: string;
    setId: string;
    businessDate: Date;
    startedAt: Date;
    outcome: string;
    creditsEstimated: number;
    creditsMeasured: number | null;
    creditsCharged: number;
    cardsInScope: number;
    cardsReturned: number;
  }[];
  cardScans: Map<string, { cardId: string; lastScannedAt: Date; lastOutcome: string; lastSetScanId: string }>;
  /** cartas del set en catálogo (default 1). */
  catalogCards: Map<string, number>;
}

export function withGradedTurns<T extends object>(
  prismaDouble: T,
  opts: { catalogCards?: Record<string, number>; world?: GradedTurnsWorld; clock?: () => Date } = {},
): { prisma: T; world: GradedTurnsWorld } {
  const world: GradedTurnsWorld = opts.world ?? {
    setScans: [],
    cardScans: new Map(),
    catalogCards: new Map(Object.entries(opts.catalogCards ?? {})),
  };
  const clock = opts.clock ?? (() => new Date());
  const p = prismaDouble as unknown as Record<string, Record<string, unknown>>;
  let seq = 0;
  p.gradedEstimateSetScan ??= {};
  Object.assign(p.gradedEstimateSetScan, {
    findMany: jest.fn(async ({ where }: { where: { setId?: { in: string[] }; outcome?: string } }) => {
      const rows = world.setScans
        .filter((r) => (!where.setId || where.setId.in.includes(r.setId)) && (!where.outcome || r.outcome === where.outcome))
        .sort((a, b) => (a.setId < b.setId ? -1 : a.setId > b.setId ? 1 : b.startedAt.getTime() - a.startedAt.getTime()));
      const seen = new Set<string>();
      return rows.filter((r) => (seen.has(r.setId) ? false : (seen.add(r.setId), true)));
    }),
    // errata v1.113.2 (§DYN.4.5): `inicio` = la fila con MENOR `businessDate` (cualquier resultado).
    findFirst: jest.fn(async () => {
      const sorted = [...world.setScans].sort((a, b) => a.businessDate.getTime() - b.businessDate.getTime());
      return sorted[0] ? { businessDate: sorted[0].businessDate } : null;
    }),
    aggregate: jest.fn(async ({ where }: { where: { businessDate: Date } }) => ({
      _sum: {
        creditsCharged: world.setScans
          .filter((r) => r.businessDate.getTime() === where.businessDate.getTime())
          .reduce((a, r) => a + r.creditsCharged, 0),
      },
    })),
    create: jest.fn(async ({ data }: { data: Omit<GradedTurnsWorld['setScans'][number], 'id' | 'startedAt'> }) => {
      const row = { id: `scan-${++seq}`, startedAt: new Date(clock().getTime() + seq), ...data };
      world.setScans.push(row);
      return { id: row.id };
    }),
  });
  p.gradedEstimateCardScan ??= {};
  Object.assign(p.gradedEstimateCardScan, {
    findMany: jest.fn(async ({ where }: { where?: { cardId?: { in: string[] } } } = {}) =>
      [...world.cardScans.values()].filter((r) => !where?.cardId || where.cardId.in.includes(r.cardId)),
    ),
    upsert: jest.fn(
      async ({ where, create }: { where: { cardId: string }; create: { lastScannedAt: Date; lastOutcome: string; lastSetScanId: string } }) => {
        world.cardScans.set(where.cardId, { cardId: where.cardId, ...create });
      },
    ),
  });
  p.card ??= {};
  if (!p.card.groupBy) {
    p.card.groupBy = jest.fn(async ({ where }: { where: { setId: { in: string[] } } }) =>
      where.setId.in.map((setId) => ({ setId, _count: { _all: world.catalogCards.get(setId) ?? 1 } })),
    );
  }
  const cs = p.configSetting as Record<string, unknown> | undefined;
  if (cs && !cs.findUnique && typeof cs.findMany === 'function') {
    // La IMPLEMENTACIÓN del `findMany` del doble (no el mock): leer el tope no debe sumar llamadas que otras pruebas cuentan.
    const fm = cs.findMany as jest.Mock;
    const findMany = (fm.getMockImplementation?.() ?? fm) as (a: unknown) => Promise<{ key: string; valueJson: unknown }[]>;
    cs.findUnique = jest.fn(async ({ where }: { where: { key: string } }) => {
      const rows = await findMany({ where: { key: { in: [where.key] } } });
      return rows[0] ?? null;
    });
  }
  return { prisma: prismaDouble, world };
}
