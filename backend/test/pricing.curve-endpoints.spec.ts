import { PricingController } from '../src/modules/pricing/pricing.controller';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { PriceSyncJobService } from '../src/jobs/price-sync.service';
import { DEFAULT_PRICING_CURVE, PricingCurve } from '../src/common/pricing-curve';

/**
 * E7a (ARCHITECTURE §4.36.8 / §4.36.8a · API_CONTRACT §M2 «Curva de precio por VALOR DE MERCADO») —
 * la superficie de admin de la CURVA: `GET`/`PUT /admin/pricing/curve` y el **dry-run**
 * `POST /admin/pricing/curve/preview`.
 *
 * Se adelanta dentro de E7 porque es un envoltorio delgado sobre las puras de E0 y **no depende de
 * E2–E6**: sin él, el previsualizador OBLIGATORIO del editor tendría que reimplementar §4.36.1 en el
 * cliente y el dueño calibraría la curva contra un cálculo que no es el que va a cobrar — el bug de
 * P-48 en espejo.
 */
function seed(): PricingCurve {
  return JSON.parse(JSON.stringify(DEFAULT_PRICING_CURVE)) as PricingCurve;
}

function build(savedCurve: PricingCurve = DEFAULT_PRICING_CURVE) {
  const store = new Map<string, unknown>([['pricing_curve', savedCurve]]);
  const settings = {
    getRaw: jest.fn(async (key: string) => store.get(key) ?? null),
    getNumber: jest.fn(async () => 0),
  } as unknown as SettingsService;
  const prisma = {
    configSetting: {
      upsert: jest.fn(
        async (args: {
          where: { key: string };
          create: { valueJson: unknown };
          update: { valueJson: unknown };
        }) => {
          const key = args.where.key;
          store.set(key, store.has(key) ? args.update.valueJson : args.create.valueJson);
          return { key, valueJson: store.get(key) };
        },
      ),
    },
  } as unknown as PrismaService;
  const audit = { log: jest.fn(async () => undefined) } as unknown as AuditService;
  const pricing = new PricingService(prisma, settings, {} as FxService, {} as never, {} as never, {} as never);
  const controller = new PricingController(
    pricing,
    {} as FxService,
    settings,
    audit,
    prisma,
    {} as PriceSyncJobService,
    {} as never,
    {} as never,
  );
  return { controller, prisma, audit, settings, store };
}

describe('GET /admin/pricing/curve — lee la curva completa', () => {
  it('devuelve las semillas de PROJECT §N.2 cuando no se ha editado', async () => {
    const { controller } = build();
    await expect(controller.getCurve()).resolves.toEqual(DEFAULT_PRICING_CURVE);
  });
});

describe('PUT /admin/pricing/curve — reemplazo del objeto completo, auditado', () => {
  it('guarda, ORDENA los puntos desordenados y audita before/after', async () => {
    const { controller, prisma, audit } = build();
    const draft = seed();
    draft.sale.points = [
      { marketCents: 8000, multiplierBp: 12500 },
      { marketCents: 2500, multiplierBp: 16000 },
    ];
    const after = await controller.putCurve(draft as never, 'admin-1');
    expect(after.sale.points.map((p) => p.marketCents)).toEqual([2500, 8000]);
    expect(after.sale.points[1].multiplierBp).toBe(12500);
    expect(prisma.configSetting.upsert).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'pricing.curve.update', entityType: 'ConfigSetting', actorUserId: 'admin-1' }),
    );
    const entry = (audit.log as unknown as jest.Mock).mock.calls[0][0];
    expect(entry.before.sale.points[1].multiplierBp).toBe(11500); // el objeto ENTERO, before y after
    expect(entry.after.sale.points[1].multiplierBp).toBe(12500);
  });

  it('el cambio surte efecto SIN redeploy: el siguiente cálculo ya usa la curva nueva', async () => {
    const { controller } = build();
    const draft = seed();
    draft.sale.points[1].multiplierBp = 20000; // 2.00× en el tramo alto
    await controller.putCurve(draft as never, 'admin-1');
    const rel = await controller.getCurve();
    expect(rel.sale.points[1].multiplierBp).toBe(20000);
  });

  it.each([
    ['CURVE_EMPTY', (c: PricingCurve) => (c.sale.points = [])],
    ['DUPLICATE_BREAKPOINT', (c: PricingCurve) => c.sale.points.push({ marketCents: 2500, multiplierBp: 15000 })],
    ['SALE_BELOW_MARKET', (c: PricingCurve) => (c.sale.points[1].multiplierBp = 9000)],
    ['BIN_ABOVE_FLOOR', (c: PricingCurve) => (c.buy.binCents = 9999)],
    ['ROUNDING_LADDER_INVALID', (c: PricingCurve) => (c.sale.rounding[0].uptoCents = 20300)],
  ])('rechaza con 422 %s y NO guarda nada', async (code, mutate) => {
    const { controller, prisma, audit } = build();
    const draft = seed();
    mutate(draft);
    await expect(controller.putCurve(draft as never, 'a')).rejects.toMatchObject({ code });
    expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('el 422 dice QUÉ PUNTO lo rompe (criterio 87)', async () => {
    const { controller } = build();
    const draft = seed();
    draft.sale.points[1].multiplierBp = 9000;
    await expect(controller.putCurve(draft as never, 'a')).rejects.toMatchObject({
      code: 'SALE_BELOW_MARKET',
    });
    try {
      await controller.putCurve(draft as never, 'a');
    } catch (e) {
      const body = (e as { getResponse: () => { details?: Record<string, unknown> } }).getResponse();
      expect(body.details).toMatchObject({ axis: 'sale', index: 1, marketCents: 8000, multiplierBp: 9000 });
    }
  });

  it('SEC-A1: el PUT re-valida desde cero — un preview previo NO autoriza', async () => {
    const { controller } = build();
    const bad = seed();
    bad.buy.points = [{ marketCents: 2500, pctBp: 10000 }];
    bad.sale.points = [{ marketCents: 2500, multiplierBp: 10000 }];
    // El preview de este mismo borrador responde 200 (es calculable)…
    const prev = await controller.previewCurve({ draft: bad, marketsCents: [2500] } as never);
    expect(prev.rows).toHaveLength(1);
    expect(prev.violations.map((v) => v.code)).toContain('BUY_ABOVE_SALE');
    // …y aun así el PUT lo RECHAZA. El preview es lectura; la autoridad es el PUT.
    await expect(controller.putCurve(bad as never, 'a')).rejects.toMatchObject({ code: 'BUY_ABOVE_SALE' });
  });
});

describe('POST /admin/pricing/curve/preview — dry-run (§4.36.8a)', () => {
  it('PRUEBA DE MESA normativa: las diez sondas de §4.36.1 dan EXACTAMENTE esas cifras', async () => {
    const { controller } = build();
    const markets = [114, 1000, 2500, 5000, 8000, 8600, 8700, 10000, 30000, 50000];
    const res = await controller.previewCurve({ draft: seed(), marketsCents: markets } as never);
    const byMarket = new Map(res.rows.map((r) => [r.marketCents, r]));
    // VENTA (criterios 79/82)
    expect(byMarket.get(114)!.draft.sale.priceCents).toBe(2500); // gana el piso
    expect(byMarket.get(114)!.draft.sale.basis).toBe('floor');
    expect(byMarket.get(2500)!.draft.sale.priceCents).toBe(4000);
    expect(byMarket.get(5000)!.draft.sale.priceCents).toBe(7000);
    expect(byMarket.get(8000)!.draft.sale.priceCents).toBe(9500);
    expect(byMarket.get(8600)!.draft.sale.priceCents).toBe(10000);
    expect(byMarket.get(8700)!.draft.sale.priceCents).toBe(10500); // NO 11000
    // COMPRA (criterio 80)
    expect(byMarket.get(1000)!.draft.buy.priceCents).toBe(300);
    expect(byMarket.get(2500)!.draft.buy.priceCents).toBe(750);
    expect(byMarket.get(10000)!.draft.buy.priceCents).toBe(4000);
    expect(byMarket.get(30000)!.draft.buy.priceCents).toBe(13500);
    expect(byMarket.get(50000)!.draft.buy.priceCents).toBe(25000);
    expect(res.violations).toEqual([]);
  });

  it('memoria de cálculo del ejemplo del contrato (borrador 1.25× / 32 % vs. vigente), con medios centavos', async () => {
    const draft = seed();
    draft.sale.points[1].multiplierBp = 12500; // MX$80 pasa de 1.15× a 1.25×
    draft.buy.points[0].pctBp = 3200; // MX$25 pasa de 30 % a 32 %
    const { controller } = build();
    const res = await controller.previewCurve({ draft, marketsCents: [5000] } as never);
    const row = res.rows[0];
    expect(row.draft.sale).toMatchObject({
      priceCents: 7500,
      basis: 'market',
      appliedBp: 14409,
      rawCents: 7205, // 5000 × 14409 / 10000 = 7204.5 ⇒ ROUND_HALF_UP ⇒ 7205
      constantCents: 2500,
      constantWon: false,
      baseCents: 7205,
      roundingStepCents: 500,
      segment: { fromIndex: 0, toIndex: 1 },
    });
    expect(row.draft.buy).toMatchObject({
      priceCents: 1734,
      basis: 'market',
      appliedBp: 3467,
      rawCents: 1734, // 5000 × 3467 / 10000 = 1733.5 ⇒ ROUND_HALF_UP ⇒ 1734
      constantCents: 100,
      constantWon: false,
      baseCents: null, // la COMPRA no se redondea
      roundingStepCents: null,
    });
    expect(row.saved.sale).toMatchObject({ priceCents: 7000, appliedBp: 13955, rawCents: 6978 });
    expect(row.saved.buy).toMatchObject({ priceCents: 1667, appliedBp: 3333, rawCents: 1667 });
    expect(row.deltaCents).toEqual({ sale: 500, buy: 67 });
  });

  it('la columna VIGENTE la calcula el SERVIDOR con SU almacén (el request no la trae)', async () => {
    const savedOther = seed();
    savedOther.sale.points[1].multiplierBp = 30000; // curva guardada MUY distinta
    const { controller } = build(savedOther);
    const res = await controller.previewCurve({ draft: seed(), marketsCents: [10000] } as never);
    expect(res.rows[0].draft.sale.priceCents).toBe(11500); // el borrador (1.15×)
    expect(res.rows[0].saved.sale.priceCents).toBe(30000); // la VIGENTE del servidor (3.00×)
    expect(res.rows[0].deltaCents.sale).toBe(-18500);
  });

  it('DEDUPLICA y ORDENA las sondas ascendente (la tabla del editor las quiere así)', async () => {
    const { controller } = build();
    const res = await controller.previewCurve({ draft: seed(), marketsCents: [8000, 114, 8000, 2500] } as never);
    expect(res.rows.map((r) => r.marketCents)).toEqual([114, 2500, 8000]);
  });

  it('`marketCents: 0` es una sonda LEGÍTIMA: enseña «sin mercado ⇒ pendiente; el piso NO gana»', async () => {
    const { controller } = build();
    const res = await controller.previewCurve({ draft: seed(), marketsCents: [0] } as never);
    expect(res.rows[0].draft.sale).toMatchObject({ priceCents: null, basis: 'pending', appliedBp: null });
    expect(res.rows[0].draft.buy).toMatchObject({ priceCents: null, basis: 'pending' });
    expect(res.rows[0].deltaCents).toEqual({ sale: null, buy: null });
  });

  it('el tramo PLANO no reporta segmento; el interpolado sí', async () => {
    const { controller } = build();
    const res = await controller.previewCurve({ draft: seed(), marketsCents: [1000, 5000, 90000] } as never);
    expect(res.rows[0].draft.sale.segment).toBeNull(); // antes del primer punto
    expect(res.rows[1].draft.sale.segment).toEqual({ fromIndex: 0, toIndex: 1 });
    expect(res.rows[2].draft.sale.segment).toBeNull(); // después del último
  });

  it('la escalera se aplica IGUAL cuando gana el piso, y `baseCents` lo hace visible', async () => {
    const draft = seed();
    draft.sale.floorCents = 2530; // MX$25.30 con paso MX$5 ⇒ el publicado es MX$30
    const { controller } = build();
    const res = await controller.previewCurve({ draft, marketsCents: [100] } as never);
    expect(res.rows[0].draft.sale).toMatchObject({
      basis: 'floor',
      constantWon: true,
      constantCents: 2530,
      baseCents: 2530,
      roundingStepCents: 500,
      priceCents: 3000,
    });
  });

  it('`basis` NUNCA es override ni bounty: el dry-run no consulta variantes reales', async () => {
    const { controller } = build();
    const res = await controller.previewCurve({ draft: seed(), marketsCents: [0, 100, 50000] } as never);
    for (const row of res.rows) {
      for (const leg of [row.draft.sale, row.draft.buy, row.saved.sale, row.saved.buy]) {
        expect(['market', 'floor', 'pending']).toContain(leg.basis);
      }
    }
  });

  it('NO persiste ni audita (es lectura pura)', async () => {
    const { controller, prisma, audit } = build();
    await controller.previewCurve({ draft: seed(), marketsCents: [5000] } as never);
    expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  describe('borrador inválido: se parte por COMPUTABILIDAD, no por severidad (§4.36.8a(c))', () => {
    it.each([
      ['CURVE_EMPTY', (c: PricingCurve) => (c.buy.points = [])],
      ['DUPLICATE_BREAKPOINT', (c: PricingCurve) => c.buy.points.push({ marketCents: 2500, pctBp: 3500 })],
      ['VALIDATION_ERROR', (c: PricingCurve) => (c.sale.floorCents = -1)],
      ['ROUNDING_LADDER_INVALID', (c: PricingCurve) => (c.sale.rounding = [{ uptoCents: 20000, stepCents: 500 }])],
    ])('IMPIDE CALCULAR ⇒ 422 %s (un 200 sería inventar un precio)', async (code, mutate) => {
      const { controller } = build();
      const draft = seed();
      mutate(draft);
      await expect(controller.previewCurve({ draft, marketsCents: [5000] } as never)).rejects.toMatchObject({ code });
    });

    it.each([
      ['SALE_BELOW_MARKET', (c: PricingCurve) => (c.sale.points[1].multiplierBp = 9000)],
      ['BIN_ABOVE_FLOOR', (c: PricingCurve) => (c.buy.binCents = 9999)],
      [
        'SALE_CURVE_NOT_MONOTONIC',
        (c: PricingCurve) => {
          c.sale.points = [
            { marketCents: 2500, multiplierBp: 50000 },
            { marketCents: 8000, multiplierBp: 10000 },
          ];
        },
      ],
      ['ROUNDING_LADDER_INVALID', (c: PricingCurve) => (c.sale.rounding[0].uptoCents = 20300)],
    ])('CALCULABLE PERO PROHIBIDO ⇒ 200 con precios + violations[%s]', async (code, mutate) => {
      const { controller } = build();
      const draft = seed();
      mutate(draft);
      const res = await controller.previewCurve({ draft, marketsCents: [5000] } as never);
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].draft.sale.priceCents).not.toBeNull(); // el problema se enseña EN PESOS
      expect(res.violations.map((v) => v.code)).toContain(code);
      // `violations[]` sale del MISMO validador del PUT: mismo `{code, details}`.
      expect(res.violations[0]).toEqual({ code: expect.any(String), details: expect.any(Object) });
    });

    it('acumula VARIAS violaciones no bloqueantes a la vez', async () => {
      const { controller } = build();
      const draft = seed();
      // El punto BAJO a 0.90× rompe V4 sin romper V5 (la curva sigue creciendo hacia 1.15×).
      draft.sale.points[0].multiplierBp = 9000; // SALE_BELOW_MARKET
      draft.buy.binCents = 9999; // BIN_ABOVE_FLOOR
      const res = await controller.previewCurve({ draft, marketsCents: [5000] } as never);
      expect(res.violations.map((v) => v.code).sort()).toEqual(['BIN_ABOVE_FLOOR', 'SALE_BELOW_MARKET']);
    });
  });

  describe('validación de las sondas', () => {
    it.each([
      ['vacío', []],
      ['sobre el cap de 50', Array.from({ length: 51 }, (_, i) => i)],
      ['negativo', [-1]],
      ['no entero', [12.5]],
    ])('%s → 400 VALIDATION_ERROR', async (_label, marketsCents) => {
      const { controller } = build();
      await expect(
        controller.previewCurve({ draft: seed(), marketsCents } as never),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('exactamente 50 sondas es válido', async () => {
      const { controller } = build();
      const res = await controller.previewCurve({
        draft: seed(),
        marketsCents: Array.from({ length: 50 }, (_, i) => (i + 1) * 100),
      } as never);
      expect(res.rows).toHaveLength(50);
    });
  });
});
