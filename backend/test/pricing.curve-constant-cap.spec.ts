import { HttpStatus } from '@nestjs/common';
import { PricingController } from '../src/modules/pricing/pricing.controller';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { PriceSyncJobService } from '../src/jobs/price-sync.service';
import {
  DEFAULT_PRICING_CURVE,
  MAX_CENTS_CURVE,
  MAX_CURVE_CONSTANT_CENTS,
  PricingCurve,
  collectCurveViolations,
  sanitizePricingCurve,
} from '../src/common/pricing-curve';

/**
 * v2.1.9 · D1 (API_CONTRACT §M2 / ARCHITECTURE §4.36.3) — **techo de CORDURA de `floorCents` y
 * `binCents`: `[0, MAX_CURVE_CONSTANT_CENTS]` = MX$2,000 (Q-D1, cerrado por el dueño).**
 *
 * ### El caso que QA demostró EN VIVO
 * ```
 * PUT /admin/pricing/curve {"sale":{"floorCents":2000000000000000,…}}  → HTTP 200
 * GET /catalog/cards                     → venta 2147483647 · basis "floor"  — TODA la vitrina
 * ```
 * Eran las **únicas** dos entradas de la curva sin cota superior, y justo las que fijan el piso de
 * venta y el mínimo de compra. Una curva con piso gigante está **bien formada**, así que
 * `sanitizePricingCurve` la aceptaba (`fellBack=false`) y no había respaldo al seed.
 *
 * ### Por qué el techo NO es `MAX_CENTS_CURVE` (y por qué hay un test para eso)
 * `marketCents` describe **el valor de una carta** y su techo es de **representabilidad** (Int32).
 * `floorCents`/`binCents` son las únicas entradas que **por sí solas** republican el catálogo entero:
 * su techo es de **cordura**. Con Int32 como techo, el caso exacto de arriba **seguiría pasando** con
 * `floorCents: 2147483647` — un techo que no cambia el síntoma es teatro. El test de más abajo lo
 * fija: `MAX_CENTS_CURVE` NO sirve como techo aquí.
 *
 * ### Lo que este techo NO hace (no lo intentes cubrir)
 * No ataja «un cero de más»: un piso de MX$250 es calibración legítima y **debe guardarse**. Eso lo
 * cubren dos señales que YA existen — `constantWon` por sonda en el preview y `premium_at_floor` en
 * la cola de precio pendiente (§4.36.5c). Sin mecanismo nuevo.
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
      upsert: jest.fn(async (args: { where: { key: string }; create: { valueJson: unknown }; update: { valueJson: unknown } }) => {
        const key = args.where.key;
        store.set(key, store.has(key) ? args.update.valueJson : args.create.valueJson);
        return { key, valueJson: store.get(key) };
      }),
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
  return { controller, prisma, store };
}

/** Los valores que importan, y por qué cada uno está en la lista. */
const OVER_CAP: ReadonlyArray<[label: string, value: number]> = [
  // El número EXACTO del reporte de QA (2e15): ni siquiera es Int32.
  ['2e15 — el valor del reporte en vivo', 2_000_000_000_000_000],
  // El caso que un techo de representabilidad NO habría atajado: Int32 máximo, publicable.
  ['2147483647 — Int32 máx: el techo de MAX_CENTS NO lo habría atajado', MAX_CENTS_CURVE],
  // v2.1.9 (Q-D1): el techo bajó de MX$10,000 a MX$2,000, así que `1000000` —que en el borrador de
  // esta rev era el LÍMITE ACEPTADO— pasa a ser RECHAZO. Se conserva nombrado a propósito: es la
  // frontera vieja, y verla rechazada es lo que hace visible que el techo se apretó de verdad.
  ['1000000 — el techo del borrador (MX$10,000): AHORA se rechaza', 1_000_000],
  // La frontera nueva, +1: el techo es INCLUSIVO en 200000.
  ['200001 — justo por encima del techo', MAX_CURVE_CONSTANT_CENTS + 1],
];

describe('D1 · PUT /admin/pricing/curve — el piso y el bin llevan techo de cordura', () => {
  it.each(OVER_CAP)('sale.floorCents = %s ⇒ 422 VALIDATION_ERROR (status HTTP asertado)', async (_label, value) => {
    const { controller, prisma } = build();
    const draft = seed();
    draft.sale.floorCents = value;
    await expect(controller.putCurve(draft as never, 'admin-1')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      // El status importa tanto como el código: un 200 con `code` en el cuerpo sería el bug.
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      details: { axis: 'sale', index: null, field: 'floorCents' },
    });
    // Y money-safe: NO se persistió nada.
    expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
  });

  it.each(OVER_CAP)('buy.binCents = %s ⇒ 422 VALIDATION_ERROR (status HTTP asertado)', async (_label, value) => {
    const { controller, prisma } = build();
    const draft = seed();
    draft.buy.binCents = value;
    await expect(controller.putCurve(draft as never, 'admin-1')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      details: { axis: 'buy', index: null, field: 'binCents' },
    });
    expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
  });

  it('el techo es INCLUSIVO: floorCents = 200000 (MX$2,000) ⇒ 200 y se guarda', async () => {
    const { controller, store } = build();
    const draft = seed();
    draft.sale.floorCents = MAX_CURVE_CONSTANT_CENTS;
    // `binCents` debe seguir por DEBAJO del piso (invariante BIN_ABOVE_FLOOR), así que se deja el seed.
    const saved = await controller.putCurve(draft as never, 'admin-1');
    expect(saved.sale.floorCents).toBe(MAX_CURVE_CONSTANT_CENTS);
    expect((store.get('pricing_curve') as PricingCurve).sale.floorCents).toBe(MAX_CURVE_CONSTANT_CENTS);
  });

  it('el techo es INCLUSIVO: binCents = 199999 (bajo el piso en el techo) ⇒ 200 y se guarda', async () => {
    const { controller } = build();
    const draft = seed();
    draft.sale.floorCents = MAX_CURVE_CONSTANT_CENTS;
    // `BIN_ABOVE_FLOOR` exige bin ESTRICTAMENTE bajo el piso: el mayor bin guardable es techo−1.
    draft.buy.binCents = MAX_CURVE_CONSTANT_CENTS - 1;
    const saved = await controller.putCurve(draft as never, 'admin-1');
    expect(saved.buy.binCents).toBe(MAX_CURVE_CONSTANT_CENTS - 1);
  });

  /**
   * El contrato es explícito en que el techo del bin va **aunque** `BIN_ABOVE_FLOOR` lo acote de
   * forma transitiva: V3 corta **antes** de que ese invariante se evalúe, y apoyarse solo en él
   * dejaría el error señalando el campo equivocado en el editor. Este test fija ESE reparto.
   */
  it('el reparto de errores: en el techo manda BIN_ABOVE_FLOOR; por ENCIMA manda V3 con field=binCents', () => {
    const atCap = seed();
    atCap.sale.floorCents = MAX_CURVE_CONSTANT_CENTS;
    atCap.buy.binCents = MAX_CURVE_CONSTANT_CENTS; // dentro del techo, pero NO bajo el piso
    const atCapViolations = collectCurveViolations(atCap);
    // V3 NO se queja: el valor está dentro del techo. Quien lo rechaza es el invariante de la pareja,
    // que además es NO bloqueante (el previsualizador puede seguir calculando y enseñar el problema).
    expect(atCapViolations.filter((e) => e.blocking)).toEqual([]);
    expect(atCapViolations.map((e) => e.code)).toContain('BIN_ABOVE_FLOOR');

    const overCap = seed();
    overCap.sale.floorCents = MAX_CURVE_CONSTANT_CENTS;
    overCap.buy.binCents = MAX_CURVE_CONSTANT_CENTS + 1;
    // Por encima del techo manda V3, BLOQUEANTE y señalando el campo correcto — que es justo por lo
    // que el techo del bin es explícito y no se deja al invariante transitivo.
    const blocker = collectCurveViolations(overCap).find((e) => e.blocking)!;
    expect(blocker.code).toBe('VALIDATION_ERROR');
    expect(blocker.details).toMatchObject({ axis: 'buy', index: null, field: 'binCents' });
  });

  it('NO ataja «un cero de más»: un piso de MX$250 pasa y DEBE pasar (calibración legítima)', async () => {
    // Dicho explícitamente para que nadie lea este techo como una defensa contra el typo. El error y
    // la intención escriben el MISMO número; ese caso lo cubren `constantWon` y `premium_at_floor`.
    const { controller } = build();
    const draft = seed();
    draft.sale.floorCents = 25_000;
    const saved = await controller.putCurve(draft as never, 'admin-1');
    expect(saved.sale.floorCents).toBe(25_000);
  });
});

describe('D1 · POST /admin/pricing/curve/preview — bloquea IGUAL que el PUT (V3 es Fase 1)', () => {
  it.each(OVER_CAP)('sale.floorCents = %s ⇒ 422 en el dry-run, mismo code y mismos details', async (_label, value) => {
    const { controller } = build();
    const draft = seed();
    draft.sale.floorCents = value;
    await expect(
      controller.previewCurve({ draft, marketsCents: [5000] } as never),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      details: { axis: 'sale', index: null, field: 'floorCents' },
    });
  });

  it.each(OVER_CAP)('buy.binCents = %s ⇒ 422 en el dry-run', async (_label, value) => {
    const { controller } = build();
    const draft = seed();
    draft.buy.binCents = value;
    await expect(
      controller.previewCurve({ draft, marketsCents: [5000] } as never),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      details: { axis: 'buy', index: null, field: 'binCents' },
    });
  });

  it('un piso dentro del techo sigue calculando (el dry-run no se vuelve más estricto de la cuenta)', async () => {
    const { controller } = build();
    const draft = seed();
    draft.sale.floorCents = MAX_CURVE_CONSTANT_CENTS;
    const res = await controller.previewCurve({ draft, marketsCents: [5000] } as never);
    expect(res.rows).toHaveLength(1);
  });
});

describe('D1 · el techo NO es MAX_CENTS, y eso es la mitad del arreglo', () => {
  it('MAX_CURVE_CONSTANT_CENTS es 200_000 (MX$2,000) y es ESTRICTAMENTE menor que Int32', () => {
    expect(MAX_CURVE_CONSTANT_CENTS).toBe(200_000);
    expect(MAX_CURVE_CONSTANT_CENTS).toBeLessThan(MAX_CENTS_CURVE);
    // 10 737× por debajo de Int32: la vitrina saturada queda inalcanzable por construcción.
    expect(MAX_CENTS_CURVE / MAX_CURVE_CONSTANT_CENTS).toBeGreaterThan(10_000);
  });

  it('deja 80× sobre la semilla del piso: apretar no rompe la calibración real', () => {
    // El ancla del número es QUÉ acota: `floorCents` es el precio de la carta MÁS BARATA de la tienda.
    // Si el techo no dejara holgura cómoda sobre la semilla, sería un techo mal puesto.
    const seedFloor = DEFAULT_PRICING_CURVE.sale.floorCents;
    expect(MAX_CURVE_CONSTANT_CENTS / seedFloor).toBeGreaterThanOrEqual(80);
  });

  it('`marketCents` CONSERVA su techo de representabilidad (Int32): son magnitudes distintas', () => {
    // El valor de una carta legítimamente puede ser alto; el piso de la tienda, no.
    const draft = seed();
    draft.sale.points = [{ marketCents: MAX_CENTS_CURVE, multiplierBp: 15_000 }];
    const v = collectCurveViolations(draft).filter((e) => e.blocking);
    expect(v.map((e) => e.details?.field)).not.toContain('marketCents');
  });

  it('una curva PERSISTIDA con el piso disparado ya NO se sirve: cae al seed (money-safe en lectura)', () => {
    // El síntoma que QA vio era de LECTURA: el saneador aceptaba la curva porque estaba bien formada.
    // Con el techo, la misma curva es inválida y `sanitizePricingCurve` responde con el respaldo.
    const stored = seed();
    stored.sale.floorCents = 2_000_000_000_000_000;
    const res = sanitizePricingCurve(stored);
    expect(res.fellBack).toBe(true);
    expect(res.curve.sale.floorCents).toBe(DEFAULT_PRICING_CURVE.sale.floorCents);
  });
});
