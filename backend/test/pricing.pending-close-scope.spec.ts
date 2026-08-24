import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { PokemonTcgIoProvider } from '../src/modules/pricing/providers/pokemontcg-io.provider';
import {
  PokeTraceProvider,
  PokemonPriceTrackerProvider,
} from '../src/modules/pricing/providers/graded-sealed.providers';
import {
  DEFAULT_PRICING_CURVE,
  resolveBuyFromCurve,
  resolvePendingReason,
  resolveSaleFromCurve,
} from '../src/common/pricing-curve';

/**
 * S48-M1 (v2.1.6, hallazgo de SEGURIDAD) — **un cliente no puede apagar el aviso del dueño**.
 *
 * `closePendingForVariant` cerraba **por variante, sin eje ni razón**, apoyado en el invariante v1.26:
 * «la `PriceReference` es COMPARTIDA por clave, así que si el mercado resolvió, resolvió para las dos
 * caras». **Ese argumento era válido con UNA sola razón** (`no_market`, que sí depende de un dato
 * compartido). `premium_at_floor` —añadida en v2.0— depende de **constantes distintas por eje**
 * (`sale.floorCents` vs `buy.binCents`), así que las dos caras **ya no resuelven juntas**.
 *
 * Consecuencia: un cliente AUTENTICADO mandando esa variante en `POST /buylist/requests` cerraba la
 * entrada que el eje de VENTA había abierto. No perdía el bloqueo (el seam re-bloquea y re-escala en
 * el siguiente `publish-all`), pero **perdía el AVISO** — justo la entrada que §4.36.5c describe como
 * «la que necesita que el dueño mire». Y el momento en que más duele es el **cut-over**, que es cuando
 * más entradas hay en la cola.
 */

const KEY = { cardId: 'c1', productType: 'raw' as const, gradeKey: 'raw:NM', finish: 'normal' as const };

function buildHarness() {
  const rows: Array<Record<string, unknown>> = [];
  let seq = 0;
  const matches = (e: Record<string, unknown>, w: Record<string, unknown>) =>
    e.cardId === w.cardId &&
    e.productType === w.productType &&
    e.gradeKey === w.gradeKey &&
    e.finish === w.finish &&
    (w.cardProductId === undefined || e.cardProductId === w.cardProductId) &&
    (w.sealedProductId === undefined || e.sealedProductId === w.sealedProductId) &&
    e.status === w.status;

  /** Espeja el `OR` de Prisma sobre (reason, context) — es LO QUE SE ESTÁ PROBANDO. */
  const matchesOr = (e: Record<string, unknown>, or?: Array<Record<string, unknown>>) => {
    if (!or) return true;
    return or.some((cond) =>
      Object.entries(cond).every(([k, v]) => e[k] === v),
    );
  };

  const prisma = {
    pendingPriceEntry: {
      findFirst: jest.fn(async ({ where }: never) => rows.find((e) => matches(e, where)) ?? null),
      create: jest.fn(async ({ data }: never) => {
        const row = { id: `pend-${++seq}`, resolvedAt: null, ...(data as object) };
        rows.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: never) => {
        const row = rows.find((e) => e.id === (where as { id: string }).id);
        if (row) Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: never) => {
        const w = where as Record<string, unknown> & { OR?: Array<Record<string, unknown>> };
        let count = 0;
        for (const e of rows) {
          if (matches(e, w) && matchesOr(e, w.OR)) {
            Object.assign(e, data);
            count++;
          }
        }
        return { count };
      }),
    },
  } as unknown as PrismaService;

  const pricing = new PricingService(
    prisma,
    { getRaw: jest.fn(async () => DEFAULT_PRICING_CURVE) } as unknown as SettingsService,
    {} as FxService,
    {} as PokemonTcgIoProvider,
    {} as PokemonPriceTrackerProvider,
    {} as PokeTraceProvider,
  );
  return { pricing, rows };
}

describe('S48-M1 — el escenario EXACTO que reportó seguridad (mercado MX$10, seed real)', () => {
  it('con MX$10 la VENTA queda bloqueada y la COMPRA resuelve: las dos caras NO resuelven juntas', () => {
    const sale = resolveSaleFromCurve(1000, DEFAULT_PRICING_CURVE);
    const buy = resolveBuyFromCurve(1000, DEFAULT_PRICING_CURVE);
    const premium = 'Special Illustration Rare';
    expect(sale).toMatchObject({ cents: 2500, basis: 'floor' });
    expect(buy).toMatchObject({ cents: 300, basis: 'market' });
    expect(resolvePendingReason(sale.basis, premium)).toBe('premium_at_floor');
    expect(resolvePendingReason(buy.basis, premium)).toBeNull();
    // Es la asimetría de CONSTANTES lo que lo produce (V7 garantiza bin < floor).
    expect(DEFAULT_PRICING_CURVE.buy.binCents).toBeLessThan(DEFAULT_PRICING_CURVE.sale.floorCents);
  });

  it('el cliente ya NO apaga el aviso: `buylist` no cierra un `premium_at_floor` abierto por `inventory`', async () => {
    const h = buildHarness();
    // 1. El eje de VENTA escala el guardarraíl (publish-all / bulkPublish).
    await h.pricing.settlePendingForVariant('premium_at_floor', KEY, 'inventory');
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({ status: 'open', reason: 'premium_at_floor', context: 'inventory' });

    // 2. Un cliente autenticado manda esa variante en POST /buylist/requests: la COMPRA resuelve.
    await h.pricing.settlePendingForVariant(null, KEY, 'buylist');

    // 3. El aviso SIGUE ABIERTO. Antes de v2.1.6 quedaba `resolved` y el dueño no se enteraba.
    expect(h.rows[0]).toMatchObject({ status: 'open', reason: 'premium_at_floor' });
  });

  it('el eje que la ABRIÓ sí la cierra cuando su propio precio vuelve a resolver', async () => {
    const h = buildHarness();
    await h.pricing.settlePendingForVariant('premium_at_floor', KEY, 'inventory');
    await h.pricing.settlePendingForVariant(null, KEY, 'inventory');
    expect(h.rows[0]).toMatchObject({ status: 'resolved' });
    expect(h.rows[0].resolvedAt).toBeInstanceOf(Date);
  });

  it('SIMÉTRICO: un `premium_at_floor` abierto por COMPRA no lo cierra la VENTA', async () => {
    const h = buildHarness();
    await h.pricing.settlePendingForVariant('premium_at_floor', KEY, 'buylist');
    await h.pricing.settlePendingForVariant(null, KEY, 'inventory');
    expect(h.rows[0]).toMatchObject({ status: 'open', context: 'buylist' });
  });
});

describe('S48-M1 — `no_market` SÍ se sigue cerrando desde cualquier eje (invariante v1.26 intacto)', () => {
  it('`buylist` cierra un `no_market` abierto por `inventory`: el dato que faltaba es COMPARTIDO', async () => {
    const h = buildHarness();
    await h.pricing.settlePendingForVariant('no_market', KEY, 'inventory');
    await h.pricing.settlePendingForVariant(null, KEY, 'buylist');
    // Si esto NO cerrara, la otra cara quedaría abierta para siempre — que es exactamente lo que el
    // invariante v1.26 vino a evitar. La corrección de S48-M1 es quirúrgica, no un apagón del cierre.
    expect(h.rows[0]).toMatchObject({ status: 'resolved' });
  });

  it('las filas HISTÓRICAS (`reason: null`, anteriores a M-41) se cierran como `no_market`', async () => {
    const h = buildHarness();
    h.rows.push({
      id: 'legacy-1',
      ...KEY,
      cardProductId: null,
      sealedProductId: null,
      context: 'inventory',
      status: 'open',
      reason: null, // pre-M-41: `premium_at_floor` no existía
      resolvedAt: null,
    });
    await h.pricing.settlePendingForVariant(null, KEY, 'buylist');
    expect(h.rows[0]).toMatchObject({ status: 'resolved' });
  });

  it('la razón se ACTUALIZA en la fila abierta y el cierre respeta la razón VIGENTE, no la primera', async () => {
    const h = buildHarness();
    // Abre por falta de dato…
    await h.pricing.settlePendingForVariant('no_market', KEY, 'inventory');
    // …llega mercado, pero es ABSURDO ⇒ el problema vigente pasa a ser el guardarraíl.
    await h.pricing.settlePendingForVariant('premium_at_floor', KEY, 'inventory');
    expect(h.rows[0]).toMatchObject({ reason: 'premium_at_floor' });
    // Ahora el otro eje ya NO puede cerrarla, aunque cuando se abrió sí habría podido.
    await h.pricing.settlePendingForVariant(null, KEY, 'buylist');
    expect(h.rows[0]).toMatchObject({ status: 'open' });
  });

  it('sin `context` (vía manual del admin) el cierre sigue siendo TOTAL: arregla el dato compartido', async () => {
    const h = buildHarness();
    await h.pricing.settlePendingForVariant('premium_at_floor', KEY, 'inventory');
    await h.pricing.closePendingForVariant(KEY.cardId, KEY.productType, KEY.gradeKey, KEY.finish);
    expect(h.rows[0]).toMatchObject({ status: 'resolved' });
  });
});
