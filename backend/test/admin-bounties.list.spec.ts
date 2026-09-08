import { AdminBountiesService, ADMIN_BOUNTY_SERVER_CAP } from '../src/modules/pricing/admin-bounties.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';
import { variantKey } from '../src/common/variant-key';

/**
 * `admin-bounties.list.spec.ts` — **la CONSOLA DE BOUNTIES por dentro**
 * (`GET /admin/pricing/bounties`, API_CONTRACT §M2-B.0/.1, PROJECT criterio 184/D52).
 *
 * Cubre las mutaciones de §M2-B.6 que se matan **sin infra**: el orden de operaciones
 * (**B-3**), el techo declarado (**B-4**), `completada` ≠ `apagada` (**B-8**), los conteos sobre el
 * TOTAL (**B-9** ⭐), los conteos que ignoran `state` y no colapsan `invalida` (**B-10**), y la tarifa
 * vigente en filas apagadas (**B-12**).
 *
 * ⛔ **Lo que NO se re-asierta aquí, a propósito** (§M2-B.6): `BOUNTY_PRICE_REQUIRED`,
 * `BOUNTY_TARGET_REQUIRED`, el default 2 y el `raw`-only **ya están cerrados** en
 * `pricing.variant-controls.spec.ts` — esta pantalla **reusa** ese endpoint y no lo toca. *La
 * cobertura de un endpoint reusado vive donde vive el endpoint; dos candados sobre la misma regla se
 * tapan entre sí.*
 *
 * El veredicto contra la curva **no se reimplementa en el test**: los fixtures fijan el MERCADO y la
 * curva es la real (`DEFAULT_PRICING_CURVE`), así que `curveQuoteCents` sale del mismo cuerpo que
 * corre en producción. Mercado $100 ⇒ la curva de compra paga **$40** (`CURVE_BUY_AT_100`).
 */

/** Mercado de referencia de los fixtures y lo que la CURVA REAL paga por él (30/40/50 % por tramo). */
const MARKET = 10000;
const CURVE_BUY_AT_100 = 4000;

const SET = { id: 'set-1', name: 'E2E Set' };

interface RowSpec {
  id: string;
  cardId?: string;
  enabled?: boolean;
  priceCents?: number | null;
  targetQty?: number | null;
  acquiredQty?: number;
  completedAt?: Date | null;
  updatedAt?: Date;
  finish?: string;
  /** `false` ⇒ la variante no tiene mercado resoluble (la curva no cotiza). */
  priced?: boolean;
}

/** Fila M-30 con su carta y su set, tal como la trae el `include` del servicio. */
function row(spec: RowSpec) {
  const cardId = spec.cardId ?? `card-${spec.id}`;
  return {
    id: spec.id,
    cardId,
    productType: 'raw' as const,
    gradeKey: 'raw:NM',
    finish: (spec.finish ?? 'normal') as 'normal',
    sellOverrideCents: null,
    buyOverrideCents: null,
    bountyEnabled: spec.enabled ?? false,
    bountyPriceCents: spec.priceCents === undefined ? null : spec.priceCents,
    bountyTargetQty: spec.targetQty === undefined ? 2 : spec.targetQty,
    bountyAcquiredQty: spec.acquiredQty ?? 0,
    bountyCompletedAt: spec.completedAt ?? null,
    updatedBy: 'admin-1',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: spec.updatedAt ?? new Date('2026-09-01T00:00:00.000Z'),
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
    __priced: spec.priced !== false,
  };
}

/** Servicio con prisma/pricing dobles: `findMany` devuelve las filas dadas; el mercado sale de `__priced`. */
function svcOf(rows: ReturnType<typeof row>[]) {
  const findMany = jest.fn(async (_args: any) => rows);
  const prisma = { variantPriceOverride: { findMany } } as unknown as PrismaService;
  const pricing = {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    getReferencesBatch: jest.fn(async (keys: { cardId: string; productType: any; gradeKey: string; finish: any }[]) => {
      const m = new Map<string, { status: 'priced' | 'pending'; referenceMxnCents?: number }>();
      for (const k of keys) {
        const r = rows.find(
          (x) => x.cardId === k.cardId && x.gradeKey === k.gradeKey && x.finish === k.finish,
        );
        if (r?.__priced) m.set(variantKey(k), { status: 'priced', referenceMxnCents: MARKET });
      }
      return m;
    }),
  } as unknown as PricingService;
  return { svc: new AdminBountiesService(prisma, pricing), findMany };
}

const query = (over: Partial<Parameters<AdminBountiesService['list']>[0]> = {}) => ({
  page: 1,
  pageSize: 20,
  sort: 'attention_first' as const,
  ...over,
});

/** Las cinco suertes de §M2-B.0, una de cada una, con el MISMO mercado ($100 ⇒ curva $40). */
const CINCO = [
  row({ id: 'a', enabled: true, priceCents: 5000 }), // activa   ($50 > $40)
  row({ id: 'r', enabled: true, priceCents: 3000 }), // rebasada ($30 < $40) — LA fila de la pantalla
  row({ id: 'i', enabled: true, priceCents: null }), // invalida (encendida SIN precio utilizable)
  row({ id: 'c', enabled: false, priceCents: 5000, completedAt: new Date('2026-09-02T00:00:00.000Z') }), // completada
  row({ id: 'o', enabled: false, priceCents: 5000 }), // apagada (la apagó una persona)
];

describe('§M2-B.0 — las CINCO suertes se distinguen, y ninguna se cae de la lista', () => {
  it('B-1/B-8 — cada fila trae su `state`, y `completada` NO se colapsa con `apagada`', async () => {
    const { svc } = svcOf(CINCO);
    const res = await svc.list(query());
    const byCard = new Map(res.data.map((d) => [d.cardId, d]));
    expect(byCard.get('card-a')!.state).toBe('activa');
    // ⭐ EL candado de la feature: encendida y NO efectiva ⇒ `rebasada` y **presente** en `data`.
    expect(byCard.get('card-r')!.state).toBe('rebasada');
    expect(byCard.get('card-i')!.state).toBe('invalida');
    expect(byCard.get('card-c')!.state).toBe('completada');
    expect(byCard.get('card-o')!.state).toBe('apagada');
    expect(res.total).toBe(5);
  });

  it('la fila reusa el `VariantPricingDTO` COMPLETO: precio, tarifa vigente y veredicto, sin campos nuevos', async () => {
    const { svc } = svcOf([CINCO[1]]); // la rebasada
    const [fila] = (await svc.list(query())).data;
    expect(fila.pricing.bounty).toMatchObject({
      priceCents: 3000,
      curveQuoteCents: CURVE_BUY_AT_100,
      effective: false,
    });
    // La misma cifra por el otro lado (§M2-B.1): el sugerido de compra ES la tarifa vigente.
    expect(fila.pricing.buy.suggestedCents).toBe(CURVE_BUY_AT_100);
    // Identidad de la variante + cupo, sin inventar la posición de inventario.
    expect(fila).toMatchObject({
      setId: SET.id,
      setName: SET.name,
      productType: 'raw',
      gradeKey: 'raw:NM',
      progress: { targetQty: 2, acquiredQty: 0, remainingQty: 2 },
    });
  });

  it('B-12 — una fila APAGADA trae igual su `curveQuoteCents` (null ⇔ la curva no resuelve, no «está apagado»)', async () => {
    const { svc } = svcOf([
      row({ id: 'o', enabled: false, priceCents: 5000 }),
      row({ id: 'n', enabled: false, priceCents: 5000, priced: false }),
    ]);
    const res = await svc.list(query());
    const byCard = new Map(res.data.map((d) => [d.cardId, d]));
    expect(byCard.get('card-o')!.pricing.bounty!.curveQuoteCents).toBe(CURVE_BUY_AT_100);
    // Sin mercado resoluble la columna sale `null` — y ése es el ÚNICO significado de `null`.
    expect(byCard.get('card-n')!.pricing.bounty!.curveQuoteCents).toBeNull();
  });

  it('`progress.remainingQty` = max(0, target − acquired), `null` sin objetivo (helper compartido con la vitrina)', async () => {
    const { svc } = svcOf([
      row({ id: 'x', enabled: true, priceCents: 5000, targetQty: 2, acquiredQty: 7 }),
      row({ id: 'y', enabled: true, priceCents: 5000, targetQty: null, acquiredQty: 3 }),
    ]);
    const byCard = new Map((await svc.list(query())).data.map((d) => [d.cardId, d.progress]));
    expect(byCard.get('card-x')).toEqual({ targetQty: 2, acquiredQty: 7, remainingQty: 0 });
    expect(byCard.get('card-y')).toEqual({ targetQty: null, acquiredQty: 3, remainingQty: null });
  });
});

describe('§M2-B.1 — el ORDEN DE OPERACIONES: clasificar ANTES de filtrar, contar y paginar', () => {
  it('B-3 ⭐ — con más de una página, un `rebasada` ordena PRIMERO y viene en `page=1`', async () => {
    // Diez activas caras + una rebasada barata: por precio, la rebasada sería la última de todas.
    const activas = Array.from({ length: 10 }, (_, i) =>
      row({ id: `a${i}`, enabled: true, priceCents: 9000 + i }),
    );
    const { svc } = svcOf([...activas, row({ id: 'r', enabled: true, priceCents: 3000 })]);
    const res = await svc.list(query({ page: 1, pageSize: 5 }));
    expect(res.data[0]).toMatchObject({ cardId: 'card-r', state: 'rebasada' });
    expect(res.total).toBe(11);
  });

  it('el `where` lleva el predicado de ALCANCE y los filtros de IDENTIDAD — y NADA del `state`', async () => {
    const { svc, findMany } = svcOf(CINCO);
    await svc.list(query({ setId: 'set-1', finish: 'reverse_holo' as any, q: 'pika', states: ['rebasada'] }));
    const args = findMany.mock.calls[0][0] as any;
    expect(args.where).toMatchObject({
      productType: 'raw',
      gradeKey: 'raw:NM',
      finish: 'reverse_holo',
      card: { setId: 'set-1' },
    });
    // Alcance = historia de bounty (§M2-B.0), en un `AND` para no pisar el `OR` de `q`.
    expect(args.where.AND[0].OR).toEqual([
      { bountyEnabled: true },
      { bountyPriceCents: { not: null } },
      { bountyCompletedAt: { not: null } },
      { bountyAcquiredQty: { gt: 0 } },
    ]);
    // `q` busca por nombre O número de la carta; el `state` NO viaja al motor (no es SQL-calculable).
    expect(args.where.card.OR).toHaveLength(2);
    expect(JSON.stringify(args.where)).not.toContain('rebasada');
  });

  it('B-4 — por encima del TECHO de servidor la respuesta lo DECLARA (`truncated: true`), no lo calla', async () => {
    const muchas = Array.from({ length: ADMIN_BOUNTY_SERVER_CAP + 1 }, (_, i) =>
      row({ id: `m${i}`, enabled: true, priceCents: 5000 }),
    );
    const { svc, findMany } = svcOf(muchas);
    const res = await svc.list(query());
    expect(res.truncated).toBe(true);
    // El `+1` es SOLO para detectar el rebase: la fila extra no se clasifica ni se cuenta.
    expect((findMany.mock.calls[0][0] as any).take).toBe(ADMIN_BOUNTY_SERVER_CAP + 1);
    expect(res.total).toBe(ADMIN_BOUNTY_SERVER_CAP);
    expect(res.counts.activa).toBe(ADMIN_BOUNTY_SERVER_CAP);
  });

  it('dentro del techo, `truncated` es `false` (un booleano que siempre dice lo mismo no dice nada)', async () => {
    const { svc } = svcOf(CINCO);
    expect((await svc.list(query())).truncated).toBe(false);
  });
});

describe('§M2-B.1 — `counts`: la DISTRIBUCIÓN sobre el conjunto, no sobre la página', () => {
  it('B-9 ⭐ — un `rebasada` FUERA de la página 1 sigue contando en `counts.rebasada`', async () => {
    // Tres activas caras + una rebasada barata, `pageSize: 1` y orden por precio: la rebasada cae en
    // la página 4. Derivar los conteos de `data` diría «cero rebasados» EXACTAMENTE donde la pantalla
    // existe para no decirlo.
    const rows = [
      row({ id: 'a1', enabled: true, priceCents: 9000 }),
      row({ id: 'a2', enabled: true, priceCents: 8000 }),
      row({ id: 'a3', enabled: true, priceCents: 7000 }),
      row({ id: 'r1', enabled: true, priceCents: 3000 }),
    ];
    const { svc } = svcOf(rows);
    const res = await svc.list(query({ page: 1, pageSize: 1, sort: 'price_desc' }));
    expect(res.data).toHaveLength(1);
    expect(res.data[0].state).toBe('activa'); // la rebasada NO está en esta página…
    expect(res.counts.rebasada).toBe(1); // …y aun así se cuenta
    expect(res.counts.activa).toBe(3);
    // Y no es «el conteo de `data`» con otro nombre.
    expect(res.counts.activa).not.toBe(res.data.length);
  });

  it('B-10 — `counts` IGNORA el filtro `state` (si no, el mapa se borra justo al usarlo)', async () => {
    const { svc } = svcOf(CINCO);
    const res = await svc.list(query({ states: ['rebasada'] }));
    expect(res.data.map((d) => d.state)).toEqual(['rebasada']);
    expect(res.total).toBe(1); // `total` SÍ obedece a todos los filtros
    expect(res.counts).toEqual({ activa: 1, rebasada: 1, invalida: 1, completada: 1, apagada: 1 });
  });

  it('B-10 — `invalida` tiene su PROPIA cubeta: no se funde en `activa`', async () => {
    const { svc } = svcOf([row({ id: 'i', enabled: true, priceCents: null })]);
    const res = await svc.list(query());
    expect(res.counts.invalida).toBe(1);
    // Fundirla pintaría «está pagando» sobre un bounty encendido que no puede pagar nada.
    expect(res.counts.activa).toBe(0);
  });

  it('B-10 — INVARIANTE: sin filtro `state`, `total` == la suma de las CINCO claves', async () => {
    const { svc } = svcOf(CINCO);
    const res = await svc.list(query());
    const { activa, rebasada, invalida, completada, apagada } = res.counts;
    expect(Object.keys(res.counts).sort()).toEqual(
      ['activa', 'apagada', 'completada', 'invalida', 'rebasada'],
    );
    expect(activa + rebasada + invalida + completada + apagada).toBe(res.total);
  });

  it('los conteos RESPETAN la identidad: lo que filtra el `where` no llega a contarse', async () => {
    // El filtro de identidad vive en SQL, así que el doble devuelve ya el subconjunto: lo que se
    // comprueba es que los conteos se calculan sobre LO SELECCIONADO, no sobre un universo aparte.
    const { svc } = svcOf([CINCO[0]]);
    const res = await svc.list(query({ q: 'Carta a' }));
    expect(res.counts).toEqual({ activa: 1, rebasada: 0, invalida: 0, completada: 0, apagada: 0 });
  });

  it('conjunto VACÍO ⇒ las cinco claves en 0 (el panel ENUNCIA el cero; una clave ausente no es un cero)', async () => {
    const { svc } = svcOf([]);
    const res = await svc.list(query());
    expect(res).toMatchObject({
      data: [],
      total: 0,
      truncated: false,
      counts: { activa: 0, rebasada: 0, invalida: 0, completada: 0, apagada: 0 },
    });
  });
});

describe('§M2-B.1 — los tres órdenes, y la paginación estable', () => {
  it('`attention_first` (default): rebasada/invalida → activa → completada → apagada', async () => {
    const { svc } = svcOf(CINCO);
    const res = await svc.list(query());
    expect(res.data.map((d) => d.state)).toEqual([
      'rebasada', // precio $30 — dentro del grupo de atención manda el precio desc…
      'invalida', // …y un precio nulo ordena al final de su grupo (null no es «gratis»)
      'activa',
      'completada',
      'apagada',
    ]);
  });

  it('`price_desc` es el espejo de la vitrina; `updated_desc` es lo último tocado', async () => {
    const rows = [
      row({ id: 'lo', enabled: true, priceCents: 3000, updatedAt: new Date('2026-09-05T00:00:00.000Z') }),
      row({ id: 'hi', enabled: true, priceCents: 9000, updatedAt: new Date('2026-09-01T00:00:00.000Z') }),
    ];
    const { svc } = svcOf(rows);
    expect((await svc.list(query({ sort: 'price_desc' }))).data.map((d) => d.cardId)).toEqual([
      'card-hi',
      'card-lo',
    ]);
    expect((await svc.list(query({ sort: 'updated_desc' }))).data.map((d) => d.cardId)).toEqual([
      'card-lo',
      'card-hi',
    ]);
  });

  it('la paginación no repite ni pierde filas (orden TOTAL: `id` desempata)', async () => {
    // Cinco filas idénticas en estado, precio y fecha: sin el desempate por `id` el orden sería
    // arbitrario y una fila podría salir en dos páginas —o en ninguna—.
    const gemelas = Array.from({ length: 5 }, (_, i) => row({ id: `g${i}`, enabled: true, priceCents: 5000 }));
    const { svc } = svcOf(gemelas);
    const p1 = await svc.list(query({ page: 1, pageSize: 2 }));
    const p2 = await svc.list(query({ page: 2, pageSize: 2 }));
    const p3 = await svc.list(query({ page: 3, pageSize: 2 }));
    const vistos = [...p1.data, ...p2.data, ...p3.data].map((d) => d.cardId);
    expect(vistos).toEqual([...new Set(vistos)]);
    expect(vistos).toHaveLength(5);
    expect(p1.total).toBe(5);
  });
});

describe('§M2-B.1 — READ-ONLY estricto', () => {
  it('el servicio NO escribe: los dobles no exponen ningún método de escritura', async () => {
    // El doble de prisma solo tiene `findMany`; cualquier `update`/`create`/`delete`/`$transaction`
    // reventaría. Misma doctrina que la vitrina pública (una lectura no persiste ni audita).
    const { svc } = svcOf(CINCO);
    await expect(svc.list(query())).resolves.toBeDefined();
  });
});
