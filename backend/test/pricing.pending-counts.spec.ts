import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';

/**
 * v2.1 (ARCHITECTURE §4.36.5c · API_CONTRACT §M2) — `counts` en `GET /admin/pricing/pending`.
 *
 * Los DOS números juntos son el diagnóstico que hace ACCIONABLE el guardarraíl (§4.36.9c-3): contra
 * la línea base ≈3/333, `premium_at_floor` subiendo con `no_market` PLANO ⇒ **piso mal calibrado**;
 * AMBOS subiendo ⇒ **feed de mercado degradado** (y ahí tocar el piso sería tratar el síntoma). Por
 * eso viajan en el MISMO snapshot que la lista.
 *
 * Reglas NORMATIVAS que se verifican aquí:
 *  - los counts IGNORAN `?reason=` (y la paginación) pero RESPETAN `?context=`;
 *  - solo `status='open'`;
 *  - invariante de suma: `no_market + premium_at_floor + unknown === nº de entradas open de la cola`.
 */

interface Row {
  id: string;
  cardId: string;
  productType: string;
  gradeKey: string;
  finish: string;
  context: string;
  status: string;
  reason: string | null;
  sealedProductId: string | null;
}

const ROWS: Row[] = [
  // Cola de VENTA (inventory): 3 no_market, 2 premium_at_floor, 1 histórica (reason=null).
  ...Array.from({ length: 3 }, (_, i) => row(`inv-nm-${i}`, 'inventory', 'no_market')),
  ...Array.from({ length: 2 }, (_, i) => row(`inv-pf-${i}`, 'inventory', 'premium_at_floor')),
  row('inv-legacy', 'inventory', null),
  // Cola de COMPRA (buylist): 5 no_market, 1 premium_at_floor.
  ...Array.from({ length: 5 }, (_, i) => row(`buy-nm-${i}`, 'buylist', 'no_market')),
  row('buy-pf-0', 'buylist', 'premium_at_floor'),
  // Resueltas: NO son trabajo pendiente y no deben inflar el encabezado.
  { ...row('inv-done', 'inventory', 'no_market'), status: 'resolved' },
  { ...row('buy-done', 'buylist', 'premium_at_floor'), status: 'resolved' },
];

function row(id: string, context: string, reason: string | null): Row {
  return {
    id,
    cardId: `c-${id}`,
    productType: 'raw',
    gradeKey: 'raw:NM',
    finish: 'normal',
    context,
    status: 'open',
    reason,
    sealedProductId: null,
  };
}

function build() {
  const matches = (e: Row, where: Record<string, unknown>) =>
    (where.status === undefined || e.status === where.status) &&
    (where.context === undefined || e.context === where.context) &&
    (where.reason === undefined || e.reason === where.reason);

  const prisma = {
    pendingPriceEntry: {
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        ROWS.filter((e) => matches(e, where)).map((e) => ({
          ...e,
          card: { id: e.cardId, name: 'X', number: '1', set: { name: 'S' } },
          sealedProduct: null,
        })),
      ),
      groupBy: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const acc = new Map<string | null, number>();
        for (const e of ROWS.filter((x) => matches(x, where))) {
          acc.set(e.reason, (acc.get(e.reason) ?? 0) + 1);
        }
        return [...acc].map(([reason, n]) => ({ reason, _count: { _all: n } }));
      }),
    },
  } as unknown as PrismaService;
  const settings = { getRaw: jest.fn(), getNumber: jest.fn() } as unknown as SettingsService;
  return new PricingService(prisma, settings, {} as FxService, {} as never, {} as never, {} as never);
}

describe('counts de la cola de precio pendiente (§4.36.5c)', () => {
  it('sin filtros: cuenta TODAS las entradas open de las dos colas', async () => {
    const res = await build().pendingQueue();
    expect(res.counts).toEqual({ no_market: 8, premium_at_floor: 3, unknown: 1 });
  });

  it('RESPETA `?context=`: el bucket de VENTA no suma pendientes de COMPRA', async () => {
    const venta = await build().pendingQueue('inventory');
    expect(venta.counts).toEqual({ no_market: 3, premium_at_floor: 2, unknown: 1 });
    const compra = await build().pendingQueue('buylist');
    expect(compra.counts).toEqual({ no_market: 5, premium_at_floor: 1, unknown: 0 });
  });

  it('IGNORA `?reason=`: filtrar para triar NO cambia el encabezado', async () => {
    const sinFiltro = await build().pendingQueue('inventory');
    const filtrada = await build().pendingQueue('inventory', 'premium_at_floor');
    // La LISTA sí se filtra…
    expect(filtrada.data).toHaveLength(2);
    expect(sinFiltro.data).toHaveLength(6);
    // …pero los counts describen la COLA COMPLETA: si respetaran `reason`, el encabezado diría
    // «0 SIN MERCADO · 2 PREMIUM EN EL PISO» — mentiría justo cuando el dueño más lo mira.
    expect(filtrada.counts).toEqual(sinFiltro.counts);
  });

  it('INVARIANTE DE SUMA: no_market + premium_at_floor + unknown === nº de entradas open de la cola', async () => {
    for (const ctx of [undefined, 'inventory', 'buylist'] as const) {
      const res = await build().pendingQueue(ctx);
      const total = res.counts.no_market + res.counts.premium_at_floor + res.counts.unknown;
      // `data` sin `?reason=` ES la cola completa de ese contexto.
      expect(total).toBe(res.data.length);
    }
  });

  it('`unknown` recoge las filas históricas (reason=null, anteriores a M-41)', async () => {
    const res = await build().pendingQueue('inventory');
    expect(res.counts.unknown).toBe(1);
    // Sin esta tercera clave, la cola con filas históricas no cuadraría con la lista.
    expect(res.counts.no_market + res.counts.premium_at_floor).toBe(res.data.length - 1);
  });

  it('solo cuenta `status="open"`: una entrada resuelta ya no es trabajo pendiente', async () => {
    const res = await build().pendingQueue();
    // Hay 2 filas `resolved` en el fixture que NO se cuentan ni se listan.
    expect(res.counts.no_market + res.counts.premium_at_floor + res.counts.unknown).toBe(12);
    expect(ROWS.filter((r) => r.status === 'resolved')).toHaveLength(2);
  });
});
