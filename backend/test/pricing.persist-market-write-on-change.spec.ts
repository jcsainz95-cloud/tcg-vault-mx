/**
 * pricing.persist-market-write-on-change.spec.ts — **P-53 §2: WRITE-ON-CHANGE del ESCRITOR DIARIO.**
 *
 * `PricingService.persistMarketReference` es el escritor que corre TODOS LOS DÍAS
 * (`ingestSinglesForSet` → cron `price-ingest-1/2` → `catchUpIfStale`). Hasta P-53 su clave de lectura
 * incluía `capturedDate = today()`, así que materializaba UNA fila por (carta, producto, acabado) POR
 * DÍA aunque el precio no se moviera (~28,559 filas/día; el disco crecía sin freno — ALTO-1). Y NO
 * poblaba `evidenceDate`, lo que dejaba a `hasRecentIngest` siempre en `false` (ALTO-2).
 *
 * Estos casos FALLAN contra el escritor viejo (que escribía una fila por día y no tocaba `evidenceDate`)
 * y pasan con el write-on-change:
 *  - **T-1** dos barridos con el MISMO USD ⇒ 1 sola fila + `evidenceDate` avanzado (viejo: 2 filas).
 *  - **T-2** cambio de USD ⇒ 2 filas (el punto de cambio sobrevive).
 *  - **T-3** día sin cambio: `capturedDate`/`priceMxnCents` de la vigente INTACTOS (money-safe: la
 *    valuación viva `priceUsdCents × FX` es idéntica antes/después del barrido sin cambio).
 *  - **T-4** re-run intra-día con valor nuevo ⇒ corrige la fila de HOY en su sitio (1 fila, sin colisión
 *    con la `@@unique`).
 *  - **manual** override vigente ⇒ ni se pisa ni se le avanza `evidenceDate`.
 */
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { usdToMxnCents } from '../src/common/money';

const fx = { rate: 18, bufferPct: 3 };

const HOY = (() => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
})();
const AYER = (() => {
  const d = new Date(HOY);
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
})();
const ANTEAYER = (() => {
  const d = new Date(HOY);
  d.setUTCDate(d.getUTCDate() - 2);
  return d;
})();

type Row = Record<string, unknown>;

/** Doble de Prisma en memoria que HONRA el `where` (igualdad + null) y el `orderBy capturedDate desc`. */
function build(seed: Row[] = []) {
  const rows: Row[] = seed.map((r, i) => ({
    id: r.id ?? `seed-${i}`,
    cardProductId: null,
    evidenceDate: null,
    ...r,
  }));
  let seq = 0;

  const matches = (row: Row, where: Record<string, unknown> = {}): boolean => {
    for (const [k, v] of Object.entries(where)) {
      if (v === null) {
        if (row[k] != null) return false;
        continue;
      }
      if (v instanceof Date) {
        const rv = row[k];
        if (!(rv instanceof Date) || rv.getTime() !== v.getTime()) return false;
        continue;
      }
      if (row[k] !== v) return false;
    }
    return true;
  };

  const prisma = {
    priceReference: {
      findFirst: jest.fn(async (args: { where?: Record<string, unknown>; orderBy?: any }) => {
        let hits = rows.filter((r) => matches(r, args.where ?? {}));
        if (args.orderBy?.capturedDate === 'desc') {
          hits = [...hits].sort(
            (a, b) => (b.capturedDate as Date).getTime() - (a.capturedDate as Date).getTime(),
          );
        }
        return hits[0] ?? null;
      }),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row: Row = { id: `new-${seq++}`, cardProductId: null, evidenceDate: null, ...data };
        rows.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error(`update: no existe ${where.id}`);
        Object.assign(row, data);
        return row;
      }),
    },
  };
  const svc = new PricingService(
    prisma as unknown as PrismaService,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { svc, prisma, rows };
}

/** Fila de MERCADO raw vigente en USD (la forma que escribe el escritor diario). */
function rawUsd(over: Partial<Row>): Row {
  return {
    cardId: 'card-A',
    productType: 'raw',
    gradeKey: 'raw:NM',
    finish: 'normal',
    cardProductId: 'cp-1',
    source: 'tcgcsv_singles',
    refKind: 'market',
    isManualOverride: false,
    priceUsdCents: 250,
    fxRate: 18,
    fxBufferPct: 3,
    priceMxnCents: usdToMxnCents(250, 18, 3),
    capturedDate: AYER,
    evidenceDate: AYER,
    ...over,
  };
}

describe('P-53 §2 — persistMarketReference write-on-change (escritor DIARIO)', () => {
  it('T-1 · dos barridos con el MISMO USD ⇒ 1 sola fila y evidenceDate avanzado a HOY', async () => {
    // Vigente de AYER con el mismo valor que hoy trae el barrido.
    const { svc, prisma, rows } = build([rawUsd({ id: 'r-ayer', capturedDate: AYER, evidenceDate: AYER })]);
    await svc.persistMarketReference(
      'card-A',
      'normal',
      { marketCents: 250, currency: 'USD', source: 'tcgcsv_singles' },
      fx,
      'cp-1',
    );
    // ⛔ CANARIO ALTO-1: el escritor viejo (clave con capturedDate=hoy) crearía una fila NUEVA ⇒ 2 filas.
    expect(prisma.priceReference.create).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    // ⛔ CANARIO ALTO-2: la evidencia se avanza a HOY (el viejo la dejaba null ⇒ hasRecentIngest false).
    expect((rows[0].evidenceDate as Date).getTime()).toBe(HOY.getTime());
    // capturedDate NO retrocede ni avanza: sigue siendo el punto de cambio (AYER).
    expect((rows[0].capturedDate as Date).getTime()).toBe(AYER.getTime());
  });

  it('T-2 · cambio de USD ⇒ fila NUEVA de HOY (el punto de cambio sobrevive)', async () => {
    const { svc, prisma, rows } = build([rawUsd({ id: 'r-ayer', priceUsdCents: 250, capturedDate: AYER })]);
    await svc.persistMarketReference(
      'card-A',
      'normal',
      { marketCents: 300, currency: 'USD', source: 'tcgcsv_singles' },
      fx,
      'cp-1',
    );
    expect(prisma.priceReference.create).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(2);
    const nueva = rows.find((r) => r.id !== 'r-ayer')!;
    expect(nueva.priceUsdCents).toBe(300);
    expect((nueva.capturedDate as Date).getTime()).toBe(HOY.getTime());
    expect((nueva.evidenceDate as Date).getTime()).toBe(HOY.getTime());
    // La fila del punto anterior queda intacta (forward-fill de la serie histórica).
    const vieja = rows.find((r) => r.id === 'r-ayer')!;
    expect(vieja.priceUsdCents).toBe(250);
    expect((vieja.capturedDate as Date).getTime()).toBe(AYER.getTime());
  });

  it('T-3 · money-safe: día sin cambio NO toca capturedDate/priceMxnCents/fxRate de la vigente', async () => {
    const mxnAyer = usdToMxnCents(250, 18, 3);
    const { svc, rows } = build([
      rawUsd({ id: 'r-ayer', priceUsdCents: 250, fxRate: 18, priceMxnCents: mxnAyer, capturedDate: AYER }),
    ]);
    // El barrido de hoy trae el MISMO USD (la FX del snapshot podría diferir; da igual: no es un cambio).
    await svc.persistMarketReference(
      'card-A',
      'normal',
      { marketCents: 250, currency: 'USD', source: 'tcgcsv_singles' },
      { rate: 19.5, bufferPct: 3 }, // FX distinta hoy — NO cuenta como cambio (§0.1).
      'cp-1',
    );
    const r = rows[0];
    // El MXN congelado y la FX de la fila NO se tocan: la valuación viva recompone MXN = USD × FX vigente.
    expect(r.priceMxnCents).toBe(mxnAyer);
    expect(r.priceUsdCents).toBe(250);
    expect(Number(r.fxRate)).toBe(18);
    expect((r.capturedDate as Date).getTime()).toBe(AYER.getTime());
    // La valuación viva antes y después del barrido sin cambio es IDÉNTICA (mismo USD).
    const liveAntes = svc.liveMxnCents(
      { priceMxnCents: mxnAyer, priceUsdCents: 250, isManualOverride: false },
      { rate: 19.5, bufferPct: 3 },
    );
    const liveDespues = svc.liveMxnCents(
      { priceMxnCents: r.priceMxnCents as number, priceUsdCents: r.priceUsdCents as number, isManualOverride: false },
      { rate: 19.5, bufferPct: 3 },
    );
    expect(liveDespues).toBe(liveAntes);
  });

  it('T-4 · re-run intra-día con valor nuevo ⇒ corrige la fila de HOY en su sitio (1 fila)', async () => {
    const { svc, prisma, rows } = build([
      rawUsd({ id: 'r-hoy', priceUsdCents: 250, capturedDate: HOY, evidenceDate: HOY }),
    ]);
    await svc.persistMarketReference(
      'card-A',
      'normal',
      { marketCents: 300, currency: 'USD', source: 'tcgcsv_singles' },
      fx,
      'cp-1',
    );
    expect(prisma.priceReference.create).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(rows[0].priceUsdCents).toBe(300);
    expect(rows[0].refKind).toBe('market');
    expect((rows[0].capturedDate as Date).getTime()).toBe(HOY.getTime());
  });

  it('T-1b · sin fila previa ⇒ CREA la del día con evidenceDate=capturedDate=HOY', async () => {
    const { svc, prisma, rows } = build([]);
    await svc.persistMarketReference(
      'card-A',
      'normal',
      { marketCents: 250, currency: 'USD', source: 'tcgcsv_singles' },
      fx,
      'cp-1',
    );
    expect(prisma.priceReference.create).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    expect((rows[0].capturedDate as Date).getTime()).toBe(HOY.getTime());
    expect((rows[0].evidenceDate as Date).getTime()).toBe(HOY.getTime());
  });

  it('manual · override vigente ⇒ ni se pisa ni se le avanza evidenceDate', async () => {
    const { svc, prisma, rows } = build([
      rawUsd({ id: 'r-man', isManualOverride: true, source: 'manual', capturedDate: AYER, evidenceDate: null }),
    ]);
    await svc.persistMarketReference(
      'card-A',
      'normal',
      { marketCents: 999, currency: 'USD', source: 'tcgcsv_singles' },
      fx,
      'cp-1',
    );
    expect(prisma.priceReference.create).not.toHaveBeenCalled();
    expect(prisma.priceReference.update).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(rows[0].evidenceDate).toBeNull();
  });

  it('MXN · el valor es priceMxnCents (sin FX); mismo MXN ⇒ confirma, no inserta', async () => {
    const { svc, prisma, rows } = build([
      rawUsd({
        id: 'r-mxn',
        priceUsdCents: null,
        fxRate: null,
        fxBufferPct: null,
        priceMxnCents: 35_000,
        capturedDate: AYER,
        evidenceDate: ANTEAYER,
      }),
    ]);
    await svc.persistMarketReference(
      'card-A',
      'normal',
      { marketCents: 35_000, currency: 'MXN', source: 'tcgcsv_singles' },
      { rate: 0, bufferPct: 0 },
      'cp-1',
    );
    expect(prisma.priceReference.create).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect((rows[0].evidenceDate as Date).getTime()).toBe(HOY.getTime());
    expect(rows[0].priceMxnCents).toBe(35_000);
  });
});
