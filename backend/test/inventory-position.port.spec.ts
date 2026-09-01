import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { InventoryPositionAdapter } from '../src/modules/inventory/inventory-position.adapter';
import { NOT_ON_HAND } from '../src/modules/inventory/master-set.service';
import { variantPositionKey } from '../src/common/variant-key';
import {
  INVENTORY_POSITION_PORT,
  VariantPositionRef,
} from '../src/modules/inventory/inventory-position.port';

/**
 * v1.51 (M-46, ARCHITECTURE §4.39f) — **`INVENTORY_POSITION_PORT`**: el ÚNICO dato que cruza de
 * `inventory` a `buylist`.
 *
 * Lo que se prueba aquí es el **contrato del puerto**, no la mesa: que cuenta lo que debe contar
 * (plataforma, on-hand, misma variante **con `cardProductId`**), que lo hace **en lote** y que
 * **NO se traga los errores** — porque tragarlos y devolver un `Map` vacío produciría exactamente el
 * `0` que este puerto existe para prohibir.
 */

interface Row {
  cardId: string;
  productType: string;
  rawCondition?: string | null;
  gradingCompany?: string | null;
  gradeValue?: string | null;
  finish: string;
  cardProductId?: number | null;
  n: number;
}

function build(rows: Row[] | Error) {
  const groupBy = jest.fn(async (_args?: any) => {
    if (rows instanceof Error) throw rows;
    return rows.map((r) => ({
      cardId: r.cardId,
      productType: r.productType,
      rawCondition: r.rawCondition ?? null,
      gradingCompany: r.gradingCompany ?? null,
      gradeValue: r.gradeValue ?? null,
      finish: r.finish,
      cardProductId: r.cardProductId ?? null,
      _count: { _all: r.n },
    }));
  });
  const prisma = { inventoryItem: { groupBy } } as unknown as PrismaService;
  const pricing = {
    gradeKeyFor: jest.fn(PricingService.prototype.gradeKeyFor),
  } as unknown as PricingService;
  return { adapter: new InventoryPositionAdapter(prisma, pricing), groupBy };
}

const RAW_NM: VariantPositionRef = {
  cardId: 'card-1',
  productType: 'raw' as never,
  gradeKey: 'raw:NM',
  finish: 'normal' as never,
  cardProductId: null,
};

describe('INVENTORY_POSITION_PORT — el token y su forma', () => {
  it('el token es una constante string estable (no un Symbol que rompa el @Inject)', () => {
    expect(INVENTORY_POSITION_PORT).toBe('INVENTORY_POSITION_PORT');
  });

  it('el adaptador implementa el método del puerto, y solo ese', () => {
    const { adapter } = build([]);
    expect(typeof adapter.onHandCountsFor).toBe('function');
    // Solo lectura: el adaptador NO expone nada que escriba inventario.
    const metodos = Object.getOwnPropertyNames(Object.getPrototypeOf(adapter)).filter(
      (m) => m !== 'constructor',
    );
    expect(metodos).toEqual(['onHandCountsFor']);
  });
});

describe('Qué cuenta (y qué NO)', () => {
  it('cuenta SOLO piezas de PLATAFORMA y SOLO on-hand (`NOT_ON_HAND` por complemento)', async () => {
    const { adapter, groupBy } = build([]);
    await adapter.onHandCountsFor([RAW_NM]);
    const where = (groupBy.mock.calls[0][0] as any).where;
    expect(where.ownerType).toBe('platform');
    // Se REUSA la constante exportada; no se redefine el conjunto (una quinta copia sería la forma
    // más barata de que dos pantallas cuenten distinto).
    expect(where.status).toEqual({ notIn: NOT_ON_HAND });
    expect(NOT_ON_HAND).toEqual(
      expect.arrayContaining(['withdrawn', 'shipped', 'delivered', 'lost', 'damaged']),
    );
  });

  it('acota por las cartas pedidas (lo que sirve el índice `@@index([cardId, finish, status])`)', async () => {
    const { adapter, groupBy } = build([]);
    await adapter.onHandCountsFor([RAW_NM, { ...RAW_NM, cardId: 'card-2' }, { ...RAW_NM }]);
    expect((groupBy.mock.calls[0][0] as any).where.cardId).toEqual({ in: ['card-1', 'card-2'] });
  });

  it('agrupa por la llave CANÓNICA (`variantPositionKey` + `gradeKeyFor`), no a mano', async () => {
    const { adapter } = build([
      { cardId: 'card-1', productType: 'raw', rawCondition: 'NM', finish: 'normal', n: 5 },
    ]);
    const m = await adapter.onHandCountsFor([RAW_NM]);
    expect(m.get(variantPositionKey(RAW_NM))).toBe(5);
  });

  it('la IDENTIDAD DE PRODUCTO separa (D7): una promo NO suma a la carta de set', async () => {
    const promo: VariantPositionRef = { ...RAW_NM, cardProductId: 777 };
    const { adapter } = build([
      { cardId: 'card-1', productType: 'raw', rawCondition: 'NM', finish: 'normal', n: 3 },
      {
        cardId: 'card-1',
        productType: 'raw',
        rawCondition: 'NM',
        finish: 'normal',
        cardProductId: 777,
        n: 8,
      },
    ]);
    const m = await adapter.onHandCountsFor([RAW_NM, promo]);
    expect(m.get(variantPositionKey(RAW_NM))).toBe(3);
    expect(m.get(variantPositionKey(promo))).toBe(8);
  });

  it('el ACABADO separa, y el GRADO también (una PSA 10 no es una raw NM)', async () => {
    const graded: VariantPositionRef = {
      ...RAW_NM,
      productType: 'graded' as never,
      gradeKey: 'graded:PSA:10',
    };
    const { adapter } = build([
      { cardId: 'card-1', productType: 'raw', rawCondition: 'NM', finish: 'normal', n: 2 },
      { cardId: 'card-1', productType: 'raw', rawCondition: 'NM', finish: 'holofoil', n: 9 },
      {
        cardId: 'card-1',
        productType: 'graded',
        gradingCompany: 'PSA',
        gradeValue: '10',
        finish: 'normal',
        n: 4,
      },
    ]);
    const m = await adapter.onHandCountsFor([RAW_NM, graded]);
    expect(m.get(variantPositionKey(RAW_NM))).toBe(2);
    expect(m.get(variantPositionKey(graded))).toBe(4);
  });

  it('las variantes NO pedidas se descartan (no se filtra inventario ajeno a la solicitud)', async () => {
    const { adapter } = build([
      { cardId: 'card-1', productType: 'raw', rawCondition: 'NM', finish: 'normal', n: 2 },
      { cardId: 'card-1', productType: 'raw', rawCondition: 'LP', finish: 'normal', n: 50 },
    ]);
    const m = await adapter.onHandCountsFor([RAW_NM]);
    expect([...m.keys()]).toEqual([variantPositionKey(RAW_NM)]);
  });

  it('una variante SIN piezas simplemente NO aparece en el Map — y eso NO es un `0` inventado', async () => {
    // La ausencia de clave la traduce el consumidor a `stock: 0`, que es un CERO LEGÍTIMO
    // («no hay ninguna»), distinto del cero prohibido («no pude contar»), que es `positionUnavailable`.
    const { adapter } = build([]);
    const m = await adapter.onHandCountsFor([RAW_NM]);
    expect(m.size).toBe(0);
    expect(m.get(variantPositionKey(RAW_NM))).toBeUndefined();
  });
});

describe('En lote y sin N+1', () => {
  it('UNA sola query para N variantes', async () => {
    const { adapter, groupBy } = build([]);
    const refs = Array.from({ length: 40 }, (_, i) => ({ ...RAW_NM, cardId: `card-${i}` }));
    await adapter.onHandCountsFor(refs);
    expect(groupBy).toHaveBeenCalledTimes(1);
  });

  it('con CERO variantes no consulta nada', async () => {
    const { adapter, groupBy } = build([]);
    expect((await adapter.onHandCountsFor([])).size).toBe(0);
    expect(groupBy).not.toHaveBeenCalled();
  });
});

describe('⚠️ Money-safe: el puerto NO se traga los errores', () => {
  it('un fallo de BD SE PROPAGA (no devuelve un Map vacío que se leería como ceros)', async () => {
    const { adapter } = build(new Error('connection reset'));
    // Si el adaptador capturara aquí, el consumidor recibiría un Map vacío indistinguible de «no
    // tengo ninguna de estas cartas» y pintaría CEROS: la mentira accionable exacta que §4.39f
    // prohíbe. La excepción tiene que subir para que la mesa diga `positionUnavailable`.
    await expect(adapter.onHandCountsFor([RAW_NM])).rejects.toThrow('connection reset');
  });
});
