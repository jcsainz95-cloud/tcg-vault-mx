import { CardProductResolverService } from '../src/modules/catalog/card-product-resolver.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { FinishReconciler } from '../src/modules/catalog/finish-reconciler.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { TcgcsvCatalogClient } from '../src/modules/pricing/providers/tcgcsv-singles.provider';
import { usdToMxnCents } from '../src/common/money';

/**
 * P-53 · La CURA del ritmo de escritura de `PriceReference` (write-on-change), modelo fuerte.
 *
 * ⚠️ **Estas pruebas están escritas para FALLAR contra el escritor viejo** (el `upsert` cuya clave
 * incluía `capturedDate = today()`, que materializaba UNA fila POR DÍA por (carta, producto, acabado)
 * aunque el USD no se moviera). El contrato que fijan:
 *
 *  - **T-1 (día idéntico):** dos barridos con el MISMO `priceUsdCents` ⇒ **1 fila**, y su `evidenceDate`
 *    avanza al día del segundo barrido; `capturedDate` y `priceMxnCents` intactos. El escritor viejo
 *    dejaba 2 filas ⇒ T-1 en rojo (canario de mutación T-10).
 *  - **T-2 (cambio):** un barrido con `priceUsdCents` distinto ⇒ **2 filas**, `capturedDate` distintos;
 *    la vieja conserva su `evidenceDate` = su última confirmación.
 *  - **T-3 (solo FX):** mismo USD, `fx.rate` distinto ⇒ **1 fila** (NO nueva); `evidenceDate` avanza; el
 *    `priceUsdCents` se conserva ⇒ una lectura viva con la FX nueva refleja el MXN nuevo (money-safe:
 *    la FX se recompone en lectura, no dispara fila).
 *  - **T-4 (manual no clobber):** override manual vigente ⇒ el escritor de singles NO escribe ni
 *    bump-ea `evidenceDate` (§4.27f respetado).
 *  - **MONEY-SAFE:** la valuación VIGENTE (MXN vivo = `priceUsdCents × FX`) es IDÉNTICA antes/después de
 *    un barrido sin cambio, porque el `priceUsdCents` de la fila vigente no se toca.
 *
 * Se ejercita el escritor `upsertVariantPrice` DIRECTAMENTE (el flujo completo `resolveCardProductsForSet`
 * ya lo cubre `card-product-resolver.spec.ts`); aquí el foco es el RITMO de escritura y su money-safety.
 * El «hoy» de negocio se controla con fake timers porque `capturedDate`/`evidenceDate` son date-only.
 */

const D1 = new Date('2026-09-17T12:00:00Z');
const D2 = new Date('2026-09-18T12:00:00Z');
const D3 = new Date('2026-09-19T12:00:00Z');

/** Date-only (UTC medianoche), misma convención que `capturedDate @db.Date`. */
function dateOnly(iso: string): Date {
  const d = new Date(iso);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

interface Row {
  id: string;
  cardId: string;
  productType: string;
  gradeKey: string;
  finish: string;
  cardProductId: string | null;
  source: string;
  priceUsdCents: number | null;
  fxRate: number | null;
  fxBufferPct: number | null;
  priceMxnCents: number;
  capturedDate: Date;
  evidenceDate: Date | null;
  isManualOverride: boolean;
  refKind: string;
}

/** `PriceReference` en memoria con la semántica que usa el escritor: findFirst (más reciente), upsert
 *  (clave de 6 campos) y update (por id). Devuelve las filas para asertar el RITMO de escritura. */
function statefulPrisma(seed: Row[] = []): { prisma: PrismaService; rows: Row[] } {
  const rows: Row[] = [...seed];
  let seq = 0;
  const matchesKey0 = (r: Row, w: any) =>
    r.cardId === w.cardId &&
    r.productType === w.productType &&
    r.gradeKey === w.gradeKey &&
    r.finish === w.finish &&
    r.cardProductId === w.cardProductId;
  const prisma = {
    priceReference: {
      findFirst: jest.fn(async ({ where, orderBy }: any) => {
        let matches = rows.filter((r) => matchesKey0(r, where));
        if (orderBy?.capturedDate === 'desc') {
          matches = [...matches].sort((a, b) => b.capturedDate.getTime() - a.capturedDate.getTime());
        }
        return matches[0] ?? null;
      }),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const k = where.cardId_productType_gradeKey_finish_capturedDate_cardProductId;
        const found = rows.find(
          (r) =>
            r.cardId === k.cardId &&
            r.productType === k.productType &&
            r.gradeKey === k.gradeKey &&
            r.finish === k.finish &&
            r.cardProductId === k.cardProductId &&
            r.capturedDate.getTime() === k.capturedDate.getTime(),
        );
        if (found) {
          Object.assign(found, update);
          return found;
        }
        const row = { id: `pr-${seq++}`, ...create } as Row;
        rows.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error(`update: id ${where.id} no existe`);
        Object.assign(row, data);
        return row;
      }),
    },
  } as unknown as PrismaService;
  return { prisma, rows };
}

function makeSvc(prisma: PrismaService): CardProductResolverService {
  return new CardProductResolverService(
    prisma,
    {} as unknown as TcgcsvCatalogClient,
    { reconcile: jest.fn() } as unknown as FinishReconciler,
    {} as unknown as FxService,
  );
}

/** Llama al escritor privado (el flujo completo lo ejercita el otro spec). */
function write(
  svc: CardProductResolverService,
  usdCents: number,
  fx: { rate: number; bufferPct: number },
): Promise<void> {
  return (
    svc as unknown as {
      upsertVariantPrice(
        cardId: string,
        cardProductId: string,
        finish: string,
        marketUsdCents: number,
        fx: { rate: number; bufferPct: number },
      ): Promise<void>;
    }
  ).upsertVariantPrice('c1', 'cp1', 'normal', usdCents, fx);
}

const FX = { rate: 18, bufferPct: 3 };

describe('P-53 · upsertVariantPrice — write-on-change (money-safe)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('T-1 · día idéntico (mismo USD) ⇒ 0 filas nuevas; avanza evidenceDate; capturedDate/priceMxnCents intactos', async () => {
    const { prisma, rows } = statefulPrisma();
    const svc = makeSvc(prisma);

    jest.setSystemTime(D1);
    await write(svc, 500, FX);
    jest.setSystemTime(D2);
    await write(svc, 500, FX); // MISMO USD

    // El escritor VIEJO (upsert por día) dejaría 2 filas aquí. Write-on-change deja 1.
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.capturedDate).toEqual(dateOnly('2026-09-17')); // «desde cuándo rige» NO se mueve
    expect(row.evidenceDate).toEqual(dateOnly('2026-09-18')); // «visto por última vez» SÍ avanza
    expect(row.priceMxnCents).toBe(usdToMxnCents(500, FX.rate, FX.bufferPct)); // congelado, intacto
    expect(row.priceUsdCents).toBe(500);
  });

  it('T-1b · confirmación un tercer día ⇒ sigue 1 fila; evidenceDate al día 3', async () => {
    const { prisma, rows } = statefulPrisma();
    const svc = makeSvc(prisma);
    jest.setSystemTime(D1);
    await write(svc, 500, FX);
    jest.setSystemTime(D2);
    await write(svc, 500, FX);
    jest.setSystemTime(D3);
    await write(svc, 500, FX);
    expect(rows).toHaveLength(1);
    expect(rows[0].evidenceDate).toEqual(dateOnly('2026-09-19'));
  });

  it('T-2 · cambio de USD ⇒ 1 fila NUEVA; capturedDate distintos; la vieja conserva su evidenceDate', async () => {
    const { prisma, rows } = statefulPrisma();
    const svc = makeSvc(prisma);

    jest.setSystemTime(D1);
    await write(svc, 500, FX);
    jest.setSystemTime(D2);
    await write(svc, 600, FX); // el USD CAMBIÓ

    expect(rows).toHaveLength(2);
    const byCaptured = [...rows].sort((a, b) => a.capturedDate.getTime() - b.capturedDate.getTime());
    // Fila vieja: su evidenceDate quedó en su último día de confirmación (D1), no avanza.
    expect(byCaptured[0].capturedDate).toEqual(dateOnly('2026-09-17'));
    expect(byCaptured[0].evidenceDate).toEqual(dateOnly('2026-09-17'));
    expect(byCaptured[0].priceUsdCents).toBe(500);
    // Fila nueva: capturedDate = evidenceDate = D2.
    expect(byCaptured[1].capturedDate).toEqual(dateOnly('2026-09-18'));
    expect(byCaptured[1].evidenceDate).toEqual(dateOnly('2026-09-18'));
    expect(byCaptured[1].priceUsdCents).toBe(600);
  });

  it('T-3 · solo la FX se movió (mismo USD) ⇒ 0 filas nuevas; USD conservado ⇒ MXN vivo refleja la FX nueva', async () => {
    const { prisma, rows } = statefulPrisma();
    const svc = makeSvc(prisma);

    jest.setSystemTime(D1);
    await write(svc, 500, { rate: 18, bufferPct: 3 });
    jest.setSystemTime(D2);
    await write(svc, 500, { rate: 20, bufferPct: 3 }); // MISMO USD, FX distinta

    expect(rows).toHaveLength(1);
    expect(rows[0].evidenceDate).toEqual(dateOnly('2026-09-18'));
    // El `priceUsdCents` se conserva ⇒ una lectura viva recompone MXN con la FX vigente (money-safe:
    // la deriva de FX no fabrica fila, pero SÍ se refleja en la valuación viva).
    expect(rows[0].priceUsdCents).toBe(500);
    const liveNuevo = usdToMxnCents(rows[0].priceUsdCents!, 20, 3);
    const liveViejo = usdToMxnCents(rows[0].priceUsdCents!, 18, 3);
    expect(liveNuevo).toBeGreaterThan(liveViejo);
  });

  it('T-3b · el buffer SÍ es un cambio real ⇒ fila nueva', async () => {
    const { prisma, rows } = statefulPrisma();
    const svc = makeSvc(prisma);
    jest.setSystemTime(D1);
    await write(svc, 500, { rate: 18, bufferPct: 3 });
    jest.setSystemTime(D2);
    await write(svc, 500, { rate: 18, bufferPct: 5 }); // mismo USD pero OTRO buffer
    expect(rows).toHaveLength(2);
  });

  it('T-4 · override manual vigente ⇒ el escritor de singles NO escribe ni bump-ea evidenceDate', async () => {
    const manual: Row = {
      id: 'pr-manual',
      cardId: 'c1',
      productType: 'raw',
      gradeKey: 'raw:NM',
      finish: 'normal',
      cardProductId: 'cp1',
      source: 'manual',
      priceUsdCents: null,
      fxRate: null,
      fxBufferPct: null,
      priceMxnCents: 99900,
      capturedDate: dateOnly('2026-09-10'),
      evidenceDate: null,
      isManualOverride: true,
      refKind: 'market',
    };
    const { prisma, rows } = statefulPrisma([manual]);
    const svc = makeSvc(prisma);

    jest.setSystemTime(D2);
    await write(svc, 500, FX);

    expect(rows).toHaveLength(1); // no se creó nada
    expect(rows[0].id).toBe('pr-manual');
    expect(rows[0].evidenceDate).toBeNull(); // no se bump-eó
    expect(rows[0].priceMxnCents).toBe(99900); // el precio humano intacto
    expect((prisma as any).priceReference.update).not.toHaveBeenCalled();
    expect((prisma as any).priceReference.upsert).not.toHaveBeenCalled();
  });

  it('MONEY-SAFE · la valuación VIGENTE es idéntica antes/después de un barrido sin cambio', async () => {
    const { prisma, rows } = statefulPrisma();
    const svc = makeSvc(prisma);

    jest.setSystemTime(D1);
    await write(svc, 500, FX);
    const before = usdToMxnCents(rows[0].priceUsdCents!, FX.rate, FX.bufferPct);

    jest.setSystemTime(D2);
    await write(svc, 500, FX); // confirma, no cambia

    // Misma fila vigente, mismo USD ⇒ el MXN vivo con la MISMA FX es idéntico bit a bit.
    expect(rows).toHaveLength(1);
    const after = usdToMxnCents(rows[0].priceUsdCents!, FX.rate, FX.bufferPct);
    expect(after).toBe(before);
  });

  it('idempotencia intra-día · re-run el MISMO día con valor nuevo corrige la fila del día, no colisiona', async () => {
    const { prisma, rows } = statefulPrisma();
    const svc = makeSvc(prisma);
    jest.setSystemTime(D1);
    await write(svc, 500, FX);
    await write(svc, 700, FX); // segundo barrido el MISMO día, valor nuevo
    // No hay 2 filas del mismo capturedDate (la @@unique lo prohibiría): se corrige en su sitio.
    expect(rows).toHaveLength(1);
    expect(rows[0].capturedDate).toEqual(dateOnly('2026-09-17'));
    expect(rows[0].priceUsdCents).toBe(700);
  });
});
