/**
 * pricing.m44-no-degrade.spec.ts — **M-44 / M-44b (v1.50.3-g): el escritor HUMANO tampoco degrada.**
 * ARCHITECTURE §4.38(l.4.10) · `API_CONTRACT` rev v1.50.3-g · `SECURITY_NOTES.md` §5.1 (SEC-M43-1).
 *
 * ## Qué defiende este archivo
 * M-43 cerró la degradación **automática** (el ingest hace skip ante una fila `market`). El blue team
 * midió que la **manual** seguía abierta: con el slab fuera de `platform + listed` —`in_stock`
 * pre-publicación, `reserved`, `picking`, envío en curso **o `ownerType='customer'` en custodia**— un
 * `intent:"graded_estimate"` caía sobre la fila del día, **la reclasificaba y le pisaba el monto**, con
 * `200` y sin `409`. La guarda hermana no lo ve porque su predicado es el de una PUBLICACIÓN, no el de
 * una pieza física.
 *
 * La regla que rige desde v1.50.3-g **no tiene sujeto**:
 * > *La naturaleza de una fila solo se SUBE (`graded_estimate → market`), y solo por acto humano
 * > declarado (`intent:"market"`). BAJARLA no es una operación que ofrezca este sistema.*
 *
 * ## Dónde vive la guarda, y por qué importa para estas pruebas
 * **Dentro de la escritura, no en su antesala** ((l.4.10) punto 4). Por eso el doble de Prisma HONRA el
 * `where` del `updateMany`: es la única forma de distinguir «el predicado está» de «el predicado
 * funciona», y de ejercitar la rama de TOCTOU (perder la carrera ⇒ `count = 0` ⇒ `409`), que es
 * precisamente la que un pre-vuelo suelto no cubriría.
 */
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { PokemonTcgIoProvider } from '../src/modules/pricing/providers/pokemontcg-io.provider';
import {
  PokeTraceProvider,
  PokemonPriceTrackerProvider,
} from '../src/modules/pricing/providers/graded-sealed.providers';
import { PricingController } from '../src/modules/pricing/pricing.controller';
import { AuditService } from '../src/modules/audit/audit.service';

/** Los montos REALES del PoC del blue team (`SECURITY_NOTES.md` §5.1), en centavos MXN. */
/** La referencia de MERCADO de la pieza real (`e2e-graded`, PSA 10): MX$5,000. */
const MERCADO_CENTS = 500_000;
/** El «estimado» que la pisaba: MX$12.34. */
const ESTIMADO_CENTS = 1_234;

const HOY = (() => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
})();

type Row = {
  id: string;
  cardId: string;
  productType: string;
  gradeKey: string;
  finish: string;
  priceMxnCents: number;
  isManualOverride: boolean;
  source: string;
  capturedDate: Date;
  cardProductId: string | null;
  refKind: string;
};

function marketRow(over: Partial<Row> = {}): Row {
  return {
    id: 'r-mkt',
    cardId: 'card-graded',
    productType: 'graded',
    gradeKey: 'graded:PSA:10',
    finish: 'normal',
    priceMxnCents: MERCADO_CENTS,
    isManualOverride: true,
    source: 'manual',
    capturedDate: HOY,
    cardProductId: null,
    refKind: 'market',
    ...over,
  };
}

/**
 * Doble de Prisma con estado MUTABLE: `updateMany` evalúa su `where` contra la fila viva, así que la
 * guarda de M-44 se ejercita de verdad (y `count` sale de esa evaluación, no de una constante).
 * `onBeforeUpdateMany` permite guionizar la CARRERA: otro escritor confirma entre el pre-vuelo y la
 * escritura.
 */
function build(rows: Row[], opts: { onBeforeUpdateMany?: () => void } = {}) {
  const created: Record<string, unknown>[] = [];
  const updates: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  const updateManys: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  const prisma = {
    priceReference: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return (
          rows.find(
            (r) =>
              r.cardId === where.cardId &&
              r.productType === where.productType &&
              r.gradeKey === where.gradeKey &&
              r.finish === where.finish &&
              // La fila «del día»: sin esto el doble ignoraría el alcance de (l.4.10 punto 3) y
              // haría pasar en verde una guarda cross-day, que es justamente lo que NO se quiere.
              r.capturedDate.getTime() === (where.capturedDate as Date).getTime() &&
              r.cardProductId === (where.cardProductId as string | null),
          ) ?? null
        );
      }),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        return rows.find((r) => r.id === where.id) ?? null;
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        const row = { id: 'r-new', ...data } as unknown as Row;
        rows.push(row);
        return row;
      }),
      update: jest.fn(
        async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          updates.push({ where, data });
          const row = rows.find((r) => r.id === where.id);
          Object.assign(row as object, data);
          return row;
        },
      ),
      updateMany: jest.fn(
        async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          opts.onBeforeUpdateMany?.();
          updateManys.push({ where, data });
          const not = (where.refKind as { not?: string } | undefined)?.not;
          const hits = rows.filter((r) => r.id === where.id && (not === undefined || r.refKind !== not));
          for (const r of hits) Object.assign(r, data);
          return { count: hits.length };
        },
      ),
    },
    pendingPriceEntry: { updateMany: jest.fn(async () => ({ count: 0 })) },
  };
  const fx = { getCurrent: jest.fn(async () => null) };
  const svc = new PricingService(
    prisma as unknown as PrismaService,
    {} as SettingsService,
    fx as unknown as FxService,
    {} as PokemonTcgIoProvider,
    {} as PokemonPriceTrackerProvider,
    {} as PokeTraceProvider,
  );
  return { svc, rows, created, updates, updateManys, prisma };
}

const estimado = (svc: PricingService, cents = ESTIMADO_CENTS) =>
  svc.applyManualOverride({
    cardId: 'card-graded',
    productType: 'graded',
    gradeKey: 'graded:PSA:10',
    priceMxnCents: cents,
    refKind: 'graded_estimate',
  });

// ===========================================================================
describe('M-44 — `intent:"graded_estimate"` sobre una fila `market` del DÍA ⇒ 409, y la fila NO se toca', () => {
  it('EL POC DEL BLUE TEAM: 500000·market NO se convierte en 1234·graded_estimate', async () => {
    const { svc, rows, updates, updateManys, created } = build([marketRow()]);
    const err = await estimado(svc).catch((e) => e);

    // ⛔ LA TABLA PRIMERO, y el orden es deliberado: el hallazgo es lo que le pasa a la FILA; el
    // código de error es solo la forma en que se dice. Así, si la guarda se cae, el rojo muestra
    // literalmente la degradación (`market → graded_estimate`, `500000 → 1234`) y no un status.
    // Las DOS propiedades: naturaleza **y** monto — el dictamen las nombra por separado («la fila no
    // se toca: ni naturaleza ni monto»), y sin la segunda un arreglo que conservara `refKind` pero
    // pisara el número pasaría en verde.
    expect({ refKind: rows[0].refKind, priceMxnCents: rows[0].priceMxnCents }).toEqual({
      refKind: 'market',
      priceMxnCents: MERCADO_CENTS,
    });
    expect(err.code).toBe('GRADED_ESTIMATE_WOULD_DEGRADE_MARKET_REF');
    // 409 y no 422: el body es impecable; lo que choca es el ESTADO del recurso (l.4.10 punto 1).
    expect(err.status).toBe(409);
    // Y no se tocó por ninguna vía: ni `update`, ni `updateMany`, ni una segunda fila.
    expect(updates).toHaveLength(0);
    expect(updateManys).toHaveLength(0);
    expect(created).toHaveLength(0);
  });

  it('el `details` es el del contrato — y NO lleva el monto (dato comercial, no ayuda a decidir)', async () => {
    const { svc } = build([marketRow()]);
    const err = await estimado(svc).catch((e) => e);
    expect(err.details).toEqual({
      cardId: 'card-graded',
      gradeKey: 'graded:PSA:10',
      currentRefKind: 'market',
      capturedDate: HOY.toISOString().slice(0, 10),
    });
    expect(JSON.stringify(err.details)).not.toContain(String(MERCADO_CENTS));
  });

  it('el mensaje enruta a la salida correcta: `intent:"market"` o el borrado del gancho', async () => {
    const { svc } = build([marketRow()]);
    const err = await estimado(svc).catch((e) => e);
    // El monto SÍ va en el mensaje (es lo que le dice al operador qué está a punto de pisar), en pesos.
    expect(err.message).toContain('MX$5,000.00');
    expect(err.message).toContain('intent:"market"');
    expect(err.message).toContain('PSA 10');
  });

  it('la fila `market` de OTRO día no bloquea nada: el alcance es LA FILA DEL DÍA (l.4.10 punto 3)', async () => {
    // Deliberado: cross-day no hay colisión destructiva (el estimado crea OTRA fila) y la `market` de
    // ayer sigue siendo candidata perenne ⇒ el slab conserva su precio. Prohibirlo mataría el caso
    // legítimo (una carta que tuvo slab, se vendió, y hoy se quiere exhibir su estimado).
    const ayer = new Date(HOY);
    ayer.setUTCDate(ayer.getUTCDate() - 1);
    const { svc, created, rows } = build([marketRow({ capturedDate: ayer })]);
    const res = await estimado(svc);
    expect(res.ref.refKind).toBe('graded_estimate');
    expect(created).toHaveLength(1);
    // La de ayer, intacta: sigue siendo la referencia de mercado de la pieza.
    expect(rows[0]).toMatchObject({ refKind: 'market', priceMxnCents: MERCADO_CENTS });
  });

  it('sobre una fila de ESTIMADO del día sí escribe: el flujo normal del gancho no se toca', async () => {
    const { svc, rows, updateManys } = build([
      marketRow({ id: 'r-est', refKind: 'graded_estimate', priceMxnCents: 40_000 }),
    ]);
    const res = await estimado(svc);
    expect(res.ref.priceMxnCents).toBe(ESTIMADO_CENTS);
    expect(rows[0]).toMatchObject({ refKind: 'graded_estimate', priceMxnCents: ESTIMADO_CENTS });
    // …y lo hizo con la naturaleza EN EL `where`, no leyendo antes y escribiendo después.
    expect(updateManys[0].where).toMatchObject({ refKind: { not: 'market' } });
  });

  it('`intent:"market"` sobre una fila `market` no pasa por la guarda (subir/reafirmar es legítimo)', async () => {
    const { svc, updates, updateManys } = build([marketRow()]);
    const res = await svc.applyManualOverride({
      cardId: 'card-graded',
      productType: 'graded',
      gradeKey: 'graded:PSA:10',
      priceMxnCents: 900_000,
      refKind: 'market',
    });
    expect(res.ref.priceMxnCents).toBe(900_000);
    expect(updateManys).toHaveLength(0);
    expect(updates[0].data).toMatchObject({ refKind: 'market', priceMxnCents: 900_000 });
  });

  it('sin fila del día CREA el estimado (no hay nada que degradar)', async () => {
    const { svc, created } = build([]);
    const res = await estimado(svc);
    expect(created[0]).toMatchObject({ refKind: 'graded_estimate', priceMxnCents: ESTIMADO_CENTS });
    expect(res.before).toBeNull();
  });
});

// ===========================================================================
describe('M-44 — TOCTOU: la decisión de naturaleza es parte de la ESCRITURA (l.4.10 punto 4)', () => {
  it('si otro escritor confirma `market` entre el pre-vuelo y la escritura ⇒ 409, no degradación', async () => {
    // El pre-vuelo ve un estimado (pasa), y JUSTO antes del `updateMany` la petición concurrente
    // `intent:"market"` confirma. Sin la naturaleza en el `where`, este caso terminaba con la fila de
    // mercado destruida y un `200`. Con ella, el `updateMany` no engancha ⇒ `count = 0` ⇒ `409`.
    const rows = [marketRow({ id: 'r-est', refKind: 'graded_estimate', priceMxnCents: 40_000 })];
    const carrera = () => {
      rows[0].refKind = 'market';
      rows[0].priceMxnCents = MERCADO_CENTS;
    };
    const { svc, updateManys } = build(rows, { onBeforeUpdateMany: carrera });
    const err = await estimado(svc).catch((e) => e);
    expect(err.code).toBe('GRADED_ESTIMATE_WOULD_DEGRADE_MARKET_REF');
    expect(err.status).toBe(409);
    // Se INTENTÓ la escritura (o sea: el 409 salió del `rowcount`, no del pre-vuelo) y no pegó.
    expect(updateManys).toHaveLength(1);
    expect(rows[0]).toMatchObject({ refKind: 'market', priceMxnCents: MERCADO_CENTS });
  });

  it('si la fila DESAPARECE en la ventana (DELETE del gancho) se crea: un 409 ahí sería mentira', async () => {
    const rows = [marketRow({ id: 'r-est', refKind: 'graded_estimate', priceMxnCents: 40_000 })];
    const { svc, created } = build(rows, { onBeforeUpdateMany: () => rows.splice(0, 1) });
    const res = await estimado(svc);
    expect(created[0]).toMatchObject({ refKind: 'graded_estimate', priceMxnCents: ESTIMADO_CENTS });
    expect(res.ref.priceMxnCents).toBe(ESTIMADO_CENTS);
  });
});

// ===========================================================================
describe('M-44b — `pricing.override` audita el `before` (l.4.10 punto 5)', () => {
  it('el servicio devuelve el estado ANTERIOR de la fila: monto, naturaleza y procedencia', async () => {
    const { svc } = build([marketRow({ id: 'r-est', refKind: 'graded_estimate', source: 'manual', priceMxnCents: 40_000 })]);
    const res = await estimado(svc);
    // Sin esto, el monto pisado NO se puede reconstruir desde el audit trail (§5.1 del blue team).
    expect(res.before).toEqual({ priceMxnCents: 40_000, refKind: 'graded_estimate', source: 'manual' });
  });

  it('`before: null` ⇔ la escritura CREÓ la fila (estrenar la clave ≠ corregir un número)', async () => {
    const { svc } = build([]);
    expect((await estimado(svc)).before).toBeNull();
  });

  it('el `before` se toma ANTES de pisar, incluso cuando el override es de MERCADO (residual l.4.9-1)', async () => {
    // El `intent:"market"` mal tecleado sigue siendo posible por diseño; lo que M-44b garantiza es que
    // se pueda DESHACER, porque el número anterior queda en la bitácora.
    const { svc } = build([marketRow()]);
    const res = await svc.applyManualOverride({
      cardId: 'card-graded',
      productType: 'graded',
      gradeKey: 'graded:PSA:10',
      priceMxnCents: 1,
      refKind: 'market',
    });
    expect(res.before).toEqual({ priceMxnCents: MERCADO_CENTS, refKind: 'market', source: 'manual' });
  });
});

// ===========================================================================
// El BORDE: precedencia, bitácora del bloqueo y la validación de SEC-M43-4.
// ===========================================================================
const REF_ESCRITA = {
  id: 'pr-1',
  capturedDate: HOY,
  source: 'manual' as const,
  gradeKey: 'graded:PSA:10',
  productType: 'graded' as const,
  priceMxnCents: ESTIMADO_CENTS,
  isManualOverride: true,
  refKind: 'graded_estimate' as const,
};

function buildCtrl(opts: { slabs?: { id: string }[]; degrade?: boolean; cardExists?: boolean } = {}) {
  const pricing = {
    publishedSlabsForGradeKey: jest.fn(async () => opts.slabs ?? []),
    applyManualOverride: jest.fn(async () => {
      if (opts.degrade) {
        // La excepción REAL del servicio, construida por su misma fábrica: si el borde dejara de
        // reconocerla, este doble no lo taparía.
        const { BusinessException } = await import('../src/common/business.exception');
        throw BusinessException.conflict(
          'GRADED_ESTIMATE_WOULD_DEGRADE_MARKET_REF',
          'no se degrada',
          { cardId: 'c1', gradeKey: 'graded:PSA:10', currentRefKind: 'market', capturedDate: '2026-08-29' },
        );
      }
      return { ref: REF_ESCRITA, before: { priceMxnCents: MERCADO_CENTS, refKind: 'market', source: 'manual' } };
    }),
  } as unknown as PricingService;
  const audit = { log: jest.fn(async () => undefined) } as unknown as AuditService;
  const prisma = {
    card: { findUnique: jest.fn(async () => (opts.cardExists === false ? null : { id: 'c1' })) },
  };
  const ctrl = new PricingController(
    pricing, {} as never, {} as never, audit, prisma as never, {} as never, {} as never, {} as never,
  );
  return { ctrl, pricing, audit, prisma };
}

const body = (over: Record<string, unknown> = {}) => ({
  cardId: 'c1',
  productType: 'graded',
  gradeKey: 'graded:PSA:10',
  priceMxnCents: ESTIMADO_CENTS,
  ...over,
});

describe('M-44 en el BORDE — precedencia, bitácora y `before`', () => {
  it('PRECEDENCIA (l.4.10 punto 2): con slab PUBLICADO y fila `market` del día gana SLAB_PUBLISHED', async () => {
    // Las dos condiciones se cumplen. Gana la preexistente: su mensaje es más útil al operador y su
    // `details` enumera los `inventoryItemIds`. M-44 cubre EXACTAMENTE el complemento.
    const { ctrl, pricing } = buildCtrl({ slabs: [{ id: 'inv-1' }], degrade: true });
    const err = await ctrl.override(body({ intent: 'graded_estimate' }) as never, 'admin-1').catch((e) => e);
    expect(err.code).toBe('GRADED_ESTIMATE_SLAB_PUBLISHED');
    // …y ni siquiera se llegó a intentar la escritura, así que la otra guarda no pudo opinar.
    expect(pricing.applyManualOverride).not.toHaveBeenCalled();
  });

  it('el bloqueo de M-44 se AUDITA, igual que sus hermanas (§O.8 / criterio 112b)', async () => {
    const { ctrl, audit } = buildCtrl({ degrade: true });
    await expect(
      ctrl.override(body({ intent: 'graded_estimate' }) as never, 'admin-1'),
    ).rejects.toMatchObject({ code: 'GRADED_ESTIMATE_WOULD_DEGRADE_MARKET_REF', status: 409 });
    const rows = (audit.log as jest.Mock).mock.calls
      .map(([e]) => e as { action: string; after: Record<string, unknown> })
      .filter((e) => e.action === 'pricing.override.blocked');
    expect(rows).toHaveLength(1);
    expect(rows[0].after).toMatchObject({
      code: 'GRADED_ESTIMATE_WOULD_DEGRADE_MARKET_REF',
      reason: 'would_degrade_market_ref',
      cardId: 'c1',
      gradeKey: 'graded:PSA:10',
      // El monto que NO se escribió, para ver si el operador insiste con la misma cifra.
      attemptedPriceMxnCents: ESTIMADO_CENTS,
      intent: 'graded_estimate',
      currentRefKind: 'market',
    });
    // Un intento BLOQUEADO no es un override: no ensucia la bitácora de escrituras.
    const acciones = (audit.log as jest.Mock).mock.calls.map(([e]) => e.action);
    expect(acciones).not.toContain('pricing.override');
  });

  it('M-44b — el `before` viaja a `AuditLog action=pricing.override`', async () => {
    const { ctrl, audit } = buildCtrl();
    await ctrl.override(body({ intent: 'graded_estimate' }) as never, 'admin-1');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'pricing.override',
        before: { priceMxnCents: MERCADO_CENTS, refKind: 'market', source: 'manual' },
        after: expect.objectContaining({ priceMxnCents: ESTIMADO_CENTS, intent: 'graded_estimate' }),
      }),
    );
  });
});

// ===========================================================================
describe('SEC-M43-4 — el borde de DINERO valida su entrada (`API_CONTRACT` v1.50.3-g)', () => {
  it('`productType:"banana"` ⇒ 422 VALIDATION_ERROR (medido en vivo: 500)', async () => {
    const { ctrl, pricing } = buildCtrl();
    const err = await ctrl.override(body({ productType: 'banana' }) as never, 'admin-1').catch((e) => e);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.status).toBe(422);
    expect(err.details).toMatchObject({ field: 'productType' });
    expect(pricing.applyManualOverride).not.toHaveBeenCalled();
  });

  it('`cardId` inexistente ⇒ 404 NOT_FOUND (medido en vivo: 500 por violación de FK)', async () => {
    const { ctrl, pricing } = buildCtrl({ cardExists: false });
    const err = await ctrl.override(body({ intent: 'market' }) as never, 'admin-1').catch((e) => e);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.status).toBe(404);
    expect(pricing.applyManualOverride).not.toHaveBeenCalled();
  });

  it('`gradeKey:"graded:PSA:11"` ⇒ 422 (medido en vivo: 200, y creaba dinero de un grado inexistente)', async () => {
    const { ctrl, pricing } = buildCtrl();
    const err = await ctrl
      .override(body({ gradeKey: 'graded:PSA:11', intent: 'graded_estimate' }) as never, 'admin-1')
      .catch((e) => e);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.status).toBe(422);
    expect(err.details).toMatchObject({ field: 'gradeKey' });
    expect(pricing.applyManualOverride).not.toHaveBeenCalled();
  });

  it('las claves LEGÍTIMAS siguen pasando: no se estrecha el camino feliz', async () => {
    const { ctrl } = buildCtrl();
    const validas: [string, string][] = [
      ['graded', 'graded:PSA:10'],
      ['graded', 'graded:PSA:9'],
      ['graded', 'graded:PSA:1'],
      ['graded', 'graded:CGC:9.5'], // CGC/BGS usan medios grados; el enum del schema tiene CGC.
      ['raw', 'raw:NM'],
      ['sealed', 'sealed'],
      ['sealed', 'sealed:tcg:123456'],
    ];
    for (const [productType, gradeKey] of validas) {
      await expect(
        ctrl.override(
          body({ productType, gradeKey, ...(productType === 'graded' ? { intent: 'market' } : {}) }) as never,
          'admin-1',
        ),
      ).resolves.toBeDefined();
    }
  });

  it('la validación corre ANTES de cualquier escritura y de la guarda de slabs', async () => {
    const { ctrl, pricing } = buildCtrl({ slabs: [{ id: 'inv-1' }] });
    await ctrl
      .override(body({ gradeKey: 'graded:PSA:11', intent: 'graded_estimate' }) as never, 'admin-1')
      .catch(() => undefined);
    expect(pricing.publishedSlabsForGradeKey).not.toHaveBeenCalled();
  });
});
