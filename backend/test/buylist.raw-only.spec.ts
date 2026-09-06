import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { BusinessException } from '../src/common/business.exception';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';
import { BUYLIST_ACCEPTED_PRODUCT_TYPES } from '../src/common/business-rules';
import { BUYLIST_QUOTE_BATCH_MAX } from '../src/modules/buylist/dto/buylist.dto';
import { SettingKey } from '../src/modules/settings/settings.constants';
import { buildGradeKey } from '../src/modules/pricing/pricing.types';

/**
 * v1.53-buylist-graded-identity (ARCHITECTURE §4.40, API_CONTRACT v1.53) — **EL COTIZADOR VUELVE A
 * SER RAW-ONLY.** Defecto de DINERO vivo en producción, no una mejora de UI.
 *
 * ### Lo que estaba pasando
 * El cotizador ofrecía `graded` y `sealed`, **ningún DTO de buylist tiene dónde capturar QUÉ grado
 * es** el slab, y `buildGradeKey` rellenaba el hueco con
 * `` `graded:${gradingCompany ?? 'PSA'}:${gradeValue ?? '10'}` `` ⇒ **toda carta graduada se cotizaba
 * contra la referencia de PSA 10, el grado más caro que existe**, fuera un PSA 6 o un CGC 8.
 *
 * ### Lo que este spec ancla
 *  1. Las **tres** superficies rechazan `graded`/`sealed` con `422 BUYLIST_RAW_ONLY` — y lo hace el
 *     SERVICIO, no el `ValidationPipe` (el selector del front es cosmética: un `curl` lo esquiva).
 *  2. **El caso que decide la implementación**: en `/quote/batch` el rechazo es **POR-ÍTEM**. Un lote
 *     de 50 con UNA graduada devuelve **200 con 49 cotizaciones vivas**. Si diera `400`, la guarda se
 *     puso en el pipe y se llevó por delante 49 líneas raw legítimas del grid (§4.40.3.3).
 *  3. En `POST /buylist/requests` **no hay degradación por-ítem**: es todo-o-nada y **la solicitud no
 *     se crea** (congela dinero en una transacción).
 *  4. **Ningún monto de una línea raw cambia**: cerrar la superficie no puede mover un precio legítimo.
 */

const pii = new PiiCryptoService(new ConfigService({}));

const MARKET_CENTS = 12_500;
/**
 * $125 de mercado ⇒ pct interpolado EXACTO entre 40 % ($100) y 50 % ($500) sobre la curva por
 * defecto: 4062.5 bp ⇒ 12500 × 4062.5 / 10000 = 5078.125 ⇒ **$50.78** (mismo número que
 * `buylist.finish.spec.ts`: si este cambia, es que se movió el dinero de una línea raw).
 */
const RAW_QUOTE_CENTS = 5_078;

function pricingStub(): PricingService {
  return {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    // Cuerpos REALES: son puros y no tocan `this`. Así el test no puede divergir de producción —
    // que es justo lo que importa aquí, porque el defecto vivía DENTRO de `buildGradeKey`.
    gradeKeyFor: jest.fn(PricingService.prototype.gradeKeyFor),
    tryGradeKeyFor: jest.fn(PricingService.prototype.tryGradeKeyFor),
    getReference: jest
      .fn()
      .mockResolvedValue({ status: 'priced', referenceMxnCents: MARKET_CENTS }),
    settlePendingForVariant: jest.fn(async () => undefined),
    escalatePending: jest.fn(async () => undefined),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getVariantOverride: jest.fn(async () => null),
  } as unknown as PricingService;
}

function prismaStub() {
  const prisma: any = {
    card: {
      findUnique: jest
        .fn()
        .mockImplementation(async ({ where }: any) => ({
          id: where.id,
          rarity: 'Common',
          rarityCanonical: 'common',
          availableFinishes: ['normal'],
        })),
      findMany: jest.fn(async function (this: any, args: any) {
        const ids: string[] = args?.where?.id?.in ?? [];
        return Promise.all(ids.map((id) => this.findUnique({ where: { id } })));
      }),
    },
    kycProfile: {
      findUnique: jest.fn(async () => ({
        clabeEnc: pii.encrypt('012345678901234567'),
        clabeHmac: pii.clabeBlindIndex('012345678901234567'),
      })),
      upsert: jest.fn(async () => undefined),
    },
    // ⚠️ Fusión del ciclo de adquisición (v1.51.3, D11/D36): `createRequest` tiene DOS puertas más
    // ANTES de congelar dinero — el **celular** del vendedor (`PHONE_REQUIRED`) y la **dirección de
    // origen** (`PICKUP_ADDRESS_REQUIRED`/`NOT_FOUND`). Se satisfacen aquí para que este spec siga
    // midiendo lo suyo (la guarda raw-only) y no el resto del pipeline; que la guarda corra ANTES
    // que las tres tiene su propio test más abajo.
    user: { findUnique: jest.fn(async () => ({ phone: '+525512345678' })) },
    address: {
      findUnique: jest.fn(async ({ where }: any) => ({
        id: where.id,
        userId: 'u1',
        line1: 'Calle 1',
        city: 'CDMX',
        state: 'CDMX',
        postalCode: '01000',
        country: 'MX',
      })),
    },
    sellRequest: {
      aggregate: jest.fn(async () => ({ _sum: { quotedTotalCents: 0 } })),
      // v1.51 (§4.39c sitio 3): el acumulado AML del mes pasó de `aggregate` a `findMany` (cuerpo
      // único en `common/buylist-aml.ts`). Sin compromiso previo ⇒ lista vacía.
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: any) => ({
        id: 'sr1',
        status: data.status,
        quotedTotalCents: data.quotedTotalCents,
        ineRequired: data.ineRequired,
        items: [],
      })),
    },
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
  };
  return prisma;
}

function settingsHighCaps(): SettingsService {
  return {
    getRaw: jest.fn(async () => null),
    // ⚠️ Fusión del ciclo de adquisición (D18, criterio 132(b)): `createRequest` gana una PUERTA 4
    // —el **mínimo de compra**— que se juzga sobre el total cotizado. Un `100_000_000` uniforme
    // dejaría ese mínimo por las nubes y este spec mediría el mínimo en vez de la guarda raw-only.
    // Los TOPES siguen altísimos (que es lo que «HighCaps» quiere decir) y el MÍNIMO vale 0.
    getNumber: jest.fn(async (key: unknown) =>
      key === SettingKey.BUYLIST_MINIMUM_REQUEST_CENTS ? 0 : 100_000_000,
    ),
  } as unknown as SettingsService;
}

function build(): { svc: BuylistService; prisma: any; pricing: PricingService } {
  const prisma = prismaStub();
  const pricing = pricingStub();
  const svc = new BuylistService(
    prisma as PrismaService,
    pricing,
    settingsHighCaps(),
    {} as UsersService,
    pii,
  );
  return { svc, prisma, pricing };
}

/** Extrae `{ code, status, details }` de la excepción, como los ve el filtro global. */
async function catchBusiness(p: Promise<unknown>) {
  try {
    await p;
    throw new Error('se esperaba un rechazo y no lo hubo');
  } catch (e) {
    if (!(e instanceof BusinessException)) throw e;
    const body = e.getResponse() as { code: string; details: Record<string, unknown> };
    return { code: e.code, status: e.getStatus(), details: body.details };
  }
}

// ---------------------------------------------------------------------------
// 0) La lista blanca: es una DECISIÓN DE PRODUCTO, escrita literal
// ---------------------------------------------------------------------------

describe('§4.40.3.1 — `BUYLIST_ACCEPTED_PRODUCT_TYPES` es literal y vale `["raw"]`', () => {
  /**
   * Ancla humana, hermana de la de `ACCEPTED_RAW_CONDITIONS` en `enum-values-parity.spec.ts`:
   * ensanchar esta lista NO es una tarea de backend. Comprar graduadas es decisión del dueño
   * (§4.40.6): `product-owner` actualiza `PROJECT.md` y sólo entonces se programa `M-49`. Si este
   * test se rompe, alguien está reabriendo la superficie — que se rompa es el punto.
   */
  it('lista EXACTA: el buylist compra `raw` y nada más (PROJECT §E, §K LOCKED, criterio 61)', () => {
    expect([...BUYLIST_ACCEPTED_PRODUCT_TYPES]).toEqual(['raw']);
  });

  it('NO se deriva de `PRODUCT_TYPE_VALUES` (derivarla la rompería al crecer el enum)', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'common', 'business-rules.ts'), 'utf8');
    const decl = /export const BUYLIST_ACCEPTED_PRODUCT_TYPES[^\n]*\n/.exec(src)![0];
    expect(decl).toContain("['raw']");
    expect(decl).not.toContain('PRODUCT_TYPE_VALUES');
  });
});

// ---------------------------------------------------------------------------
// 1) POST /buylist/quote — 422 de request completo
// ---------------------------------------------------------------------------

describe('POST /buylist/quote — `graded`/`sealed` ⇒ 422 BUYLIST_RAW_ONLY (§4.40.3)', () => {
  it.each(['graded', 'sealed'] as const)('`%s` ⇒ 422 con `details.productType`', async (pt) => {
    const { svc } = build();
    const err = await catchBusiness(svc.publicQuote('c1', pt as never));
    expect(err.code).toBe('BUYLIST_RAW_ONLY');
    expect(err.status).toBe(422);
    expect(err.details).toEqual({ productType: pt });
    // Sin `index`: esta ruta no tiene `items[]` que señalar (API_CONTRACT §Errores).
    expect(err.details).not.toHaveProperty('index');
  });

  it('EL CASO DEL DINERO: jamás se lee la referencia de `graded:PSA:10` para cotizar', async () => {
    const { svc, pricing } = build();
    await catchBusiness(svc.publicQuote('c1', 'graded' as never));
    // La guarda corre ANTES de tocar precio: ni curva, ni referencia, ni override.
    expect(pricing.getReference).not.toHaveBeenCalled();
    expect(pricing.getVariantOverride).not.toHaveBeenCalled();
  });

  it('la línea RAW no cambia de monto (cerrar la superficie no mueve un precio legítimo)', async () => {
    const { svc } = build();
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'normal');
    expect(q.quote.quotedPriceCents).toBe(RAW_QUOTE_CENTS);
    expect(q.priceBasis).toBe('market');
  });
});

// ---------------------------------------------------------------------------
// 2) POST /buylist/quote/batch — EL TEST QUE DECIDE LA IMPLEMENTACIÓN
// ---------------------------------------------------------------------------

describe('POST /buylist/quote/batch — el rechazo es POR-ÍTEM, no del request (§4.40.3.3)', () => {
  /**
   * **El caso que se cae solo si la guarda se pone en el `ValidationPipe`.** Un `@IsIn(['raw'])` en el
   * DTO devolvería `400` para el request ENTERO y se llevaría por delante las otras 49 líneas raw
   * legítimas del grid. Por eso `BUYLIST_RAW_ONLY` es un `422` de negocio que el batch degrada a
   * `ok:false`.
   */
  it('50 líneas con UNA graduada ⇒ 49 cotizaciones VIVAS + 1 `ok:false` (el lote NO se cae)', async () => {
    const { svc } = build();
    const items = Array.from({ length: BUYLIST_QUOTE_BATCH_MAX }, (_, i) => ({
      cardId: `c${i}`,
      productType: 'raw' as const,
    }));
    // La graduada va EN MEDIO a propósito: ni la primera (cortocircuito) ni la última.
    const BAD = 23;
    items[BAD] = { cardId: `c${BAD}`, productType: 'graded' as never };

    const { results } = await svc.batchQuote(items);

    expect(results).toHaveLength(BUYLIST_QUOTE_BATCH_MAX);
    const ok = results.filter((r) => r.ok);
    const ko = results.filter((r) => !r.ok);
    expect(ok).toHaveLength(49);
    expect(ko).toHaveLength(1);

    const bad = results[BAD];
    expect(bad.ok).toBe(false);
    expect(bad.ok === false && bad.error.code).toBe('BUYLIST_RAW_ONLY');
    // Correlación por `index` (llave del contrato, robusta ante cardId repetidos).
    expect(bad.index).toBe(BAD);
    expect(bad.cardId).toBe(`c${BAD}`);

    // Y las 49 vivas cotizan EXACTAMENTE lo mismo que el quote por-carta.
    for (const r of ok) {
      expect(r.ok === true && r.quote.quotedPriceCents).toBe(RAW_QUOTE_CENTS);
    }
  });

  it('`sealed` degrada igual que `graded` (criterio 61: tampoco hay buylist de sellado)', async () => {
    const { svc } = build();
    const { results } = await svc.batchQuote([
      { cardId: 'a', productType: 'raw' },
      { cardId: 'b', productType: 'sealed' as never },
      { cardId: 'c', productType: 'raw' },
    ]);
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(results[1].ok === false && results[1].error.code).toBe('BUYLIST_RAW_ONLY');
  });

  it('un lote ENTERO de graduadas sigue devolviendo 3 resultados (no lanza)', async () => {
    const { svc } = build();
    const { results } = await svc.batchQuote(
      ['graded', 'sealed', 'graded'].map((pt, i) => ({ cardId: `c${i}`, productType: pt as never })),
    );
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.ok === false)).toBe(true);
  });

  it('el LOTE de overrides no se arma con las líneas rechazadas (no hay clave que buscar)', async () => {
    const { svc, pricing } = build();
    await svc.batchQuote([
      { cardId: 'a', productType: 'raw' },
      { cardId: 'b', productType: 'graded' as never },
    ]);
    const keys = (pricing.getVariantOverridesBatch as jest.Mock).mock.calls[0][0];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ cardId: 'a', productType: 'raw', gradeKey: 'raw:NM' });
  });
});

// ---------------------------------------------------------------------------
// 3) POST /buylist/requests — todo-o-nada: la solicitud NO se crea
// ---------------------------------------------------------------------------

describe('POST /buylist/requests — `graded`/`sealed` ⇒ 422 y NO se crea la solicitud (§4.40.3)', () => {
  it('una sola línea graduada entre raw aborta la solicitud entera, con `details.index`', async () => {
    const { svc, prisma } = build();
    const err = await catchBusiness(
      svc.createRequest('u1', [
        { cardId: 'a', productType: 'raw' },
        { cardId: 'b', productType: 'raw' },
        { cardId: 'c', productType: 'graded' as never },
      ]),
    );
    expect(err.code).toBe('BUYLIST_RAW_ONLY');
    expect(err.status).toBe(422);
    // `index` = posición 0-based, para que el front señale la línea.
    expect(err.details).toEqual({ index: 2, productType: 'graded' });

    // TODO-O-NADA: ni solicitud, ni transacción, ni cola de pendientes.
    expect(prisma.sellRequest.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('la guarda corre ANTES de leer la KYC: una petición imposible no toca PII', async () => {
    const { svc, prisma } = build();
    await catchBusiness(svc.createRequest('u1', [{ cardId: 'c', productType: 'sealed' as never }]));
    expect(prisma.kycProfile.findUnique).not.toHaveBeenCalled();
    // v1.51.3: y tampoco toca las otras dos puertas (celular y libreta de direcciones). La petición
    // es imposible; no se lee ni un dato personal para descubrirlo.
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.address.findUnique).not.toHaveBeenCalled();
  });

  it('una solicitud SOLO raw sigue creándose con el mismo total de siempre', async () => {
    const { svc, prisma } = build();
    const res = await svc.createRequest(
      'u1',
      [
        { cardId: 'a', productType: 'raw' },
        { cardId: 'b', productType: 'raw' },
      ],
      undefined,
      undefined,
      'addr-1',
    );
    expect(res.status).toBe('cotizada');
    expect(res.quotedTotalCents).toBe(RAW_QUOTE_CENTS * 2);
    expect(prisma.sellRequest.create).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4) La clave que se congela: nunca `graded:PSA:10` desde el buylist
// ---------------------------------------------------------------------------

describe('§4.40.4 — ninguna superficie de buylist puede producir un gradeKey de graduada', () => {
  it('todas las claves pedidas al pricing por el buylist son `raw:*`', async () => {
    const { svc, pricing } = build();
    await svc.publicQuote('c1', 'raw', 'NM', 'normal');
    await svc.batchQuote([
      { cardId: 'a', productType: 'raw' },
      { cardId: 'b', productType: 'graded' as never },
    ]);
    await svc.createRequest('u1', [{ cardId: 'c', productType: 'raw' }], undefined, undefined, 'addr-1');

    const keys = (pricing.getReference as jest.Mock).mock.calls.map((c) => c[2]);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k).toBe('raw:NM');
    // Y la referencia del grado más caro no se leyó ni una vez.
    expect(keys).not.toContain(buildGradeKey({ productType: 'graded', gradingCompany: 'PSA', gradeValue: '10' }));
  });
});
