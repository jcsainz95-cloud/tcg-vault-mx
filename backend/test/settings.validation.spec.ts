import { SettingsService } from '../src/modules/settings/settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { BusinessException } from '../src/common/business.exception';
import { grossUpTotal } from '../src/common/money';
import {
  PRICE_PROVIDER_VALUES,
  SETTING_DEFAULTS,
  SettingKey,
} from '../src/modules/settings/settings.constants';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ⭐⭐ **`I-PP1` (API_CONTRACT §M10-PP, v1.65) — «EL SEED ES EL PRIMARIO», assertado como IGUALDAD.**
 *
 * ### Por qué esto lee el contrato en vez de comparar contra una cadena
 *
 * El test anterior decía *«default seed (`pokemontcg_io`)»* y **fijaba ese literal**. Cuando el
 * contrato movió el primario, el test siguió verde defendiendo el valor equivocado: fue una de las
 * cinco copias del literal que produjeron la contradicción de `ARCHITECTURE §4.35a(a)`, y **la única
 * que además la sostenía con un candado**. Cambiar la cadena por la nueva sólo **mueve la copia de
 * sitio**: el mismo desacuerdo puede volver a nacer con el siguiente cambio de primario.
 *
 * ⛔ Y **no sirve** derivar los dos lados de la misma constante de código (`expect(SEED).toBe(SEED)`):
 * eso es la tautología que `test/enum-values-parity.spec.ts` documenta —un test que **no puede
 * fallar**— y dejaría el seed sin candado alguno.
 *
 * ⇒ La igualdad necesita **dos fuentes independientes**, y `§M10-PP` dice exactamente cuáles son
 * (tabla de los tres hechos): el **PRIMARIO** es hecho **(A)**, lo decide **el contrato**; el **SEED**
 * es el **literal de este repo**. Así que el test lee el primario **del bloque canónico del contrato**
 * (`<!-- CANON: proveedor-de-precio -->`) y lo compara con el literal del código. Mismo patrón, mismo
 * fichero-fuente y misma justificación que `enum-values-parity.spec.ts`.
 *
 * **Qué atrapa, en las dos direcciones:**
 *  - alguien devuelve el seed al legacy (o a cualquier no-primario) ⇒ **rojo**;
 *  - el arquitecto nombra otro PRIMARIO en §M10-PP y el seed no lo sigue ⇒ **rojo** hasta que backend
 *    lo aterrice — que es el trabajo, no un falso positivo.
 *
 * **Y no caduca**: no hay ningún nombre de proveedor escrito en este archivo para este hecho.
 */
function primaryPriceProviderPerContract(): string {
  const contract = readFileSync(join(__dirname, '..', '..', 'docs', 'API_CONTRACT.md'), 'utf8');
  const from = contract.indexOf('<!-- CANON: proveedor-de-precio');
  const to = contract.indexOf('<!-- /CANON: proveedor-de-precio -->', from);
  if (from < 0 || to <= from) {
    throw new Error(
      'API_CONTRACT.md: no se encontró el bloque `<!-- CANON: proveedor-de-precio -->` (§M10-PP). ' +
        'Es la FUENTE ÚNICA del dial `price_provider`: si se movió o se renombró, este test no puede ' +
        'verificar `I-PP1` y hay que hablarlo con el arquitecto (regla 9), no relajarlo aquí.',
    );
  }
  const canon = contract.slice(from, to);
  const found = [...canon.matchAll(/^-\s+\*\*`([a-z0-9_]+)`\s*—\s*PROVIDER PRIMARIO\.\*\*/gm)].map(
    (m) => m[1],
  );
  if (found.length !== 1) {
    throw new Error(
      `§M10-PP debe nombrar EXACTAMENTE UN «PROVIDER PRIMARIO»; encontrados: ${found.length} ` +
        `(${found.join(', ') || 'ninguno'}). Dos primarios —o ninguno— no es algo que este test pueda ` +
        'resolver: es una escalada al arquitecto.',
    );
  }
  return found[0];
}

/**
 * Fix correctness #2: PUT /admin/settings valida cada dial por tipo+rango, rechaza
 * keys desconocidas (422) y no persiste valores que romperían la matemática de money.ts.
 */
describe('SettingsService.update — validación de diales (fix #2)', () => {
  let prisma: any;
  let service: SettingsService;

  beforeEach(() => {
    // v2.1.6 (P48-B1): `update()` escribe DENTRO de una `$transaction` (el «todo o nada» que su
    // comentario prometía y no cumplía). El mock la ejecuta con el mismo cliente.
    // v1.63 (I-FX2/I-FX4, §M2-F.5): escribir `fxManualOverrideRate` obliga a `update()` a LEER el
    // estado previo (la fila del modo, la de la tasa y la última `FxRate` de Banxico) para pinnear
    // el modo ANTES de aplicar la escritura. El mock devuelve «tabla vacía» ⇒ los defaults de
    // código (`fx_rate_mode = "legacy"`, sin override) ⇒ resolución legacy ⇒ `auto`.
    // v1.63.2 (S-FX-1): escribir el valor del FX toma además la **puerta única** con
    // `pg_advisory_xact_lock` DENTRO de la transacción (`lockFxGate`), y relee el estado por el mismo
    // handle. El mock lo acepta como un no-op: aquí no hay concurrencia que serializar — la carrera
    // se mide, con exclusión mutua de verdad, en `test/fx.mode-switch.spec.ts` (FX-20).
    prisma = {
      configSetting: { upsert: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue(null) },
      fxRate: { findFirst: jest.fn().mockResolvedValue(null) },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    prisma.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma));
    service = new SettingsService(prisma as unknown as PrismaService);
  });

  it('accepts valid dials and upserts them', async () => {
    const applied = await service.update({ ivaPct: 16, salesMarkupPct: 15, stripeFeePct: 0.036 });
    expect(applied).toEqual({ ivaPct: 16, salesMarkupPct: 15, stripeFeePct: 0.036 });
    expect(prisma.configSetting.upsert).toHaveBeenCalledTimes(3);
  });

  it('rejects stripe_fee_pct >= 1 (would divide by <= 0 in gross-up)', async () => {
    await expect(service.update({ stripeFeePct: 1 })).rejects.toBeInstanceOf(BusinessException);
    await expect(service.update({ stripeFeePct: 1.2 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
  });

  it('rejects non-numeric iva_pct (would produce NaN)', async () => {
    await expect(service.update({ ivaPct: 'sixteen' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
  });

  it('rejects negative sales_markup_pct', async () => {
    await expect(service.update({ salesMarkupPct: -5 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects non-integer / negative cents dials', async () => {
    await expect(service.update({ shippingFeeCents: -100 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(service.update({ shippingFeeCents: 175.5 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects unknown keys with 422 (no longer silently ignored)', async () => {
    await expect(service.update({ notADial: 123 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
  });

  it('is all-or-nothing: one invalid value blocks the whole batch', async () => {
    await expect(service.update({ ivaPct: 16, stripeFeePct: 5 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
  });

  it('rejects invalid pricing provider enum', async () => {
    await expect(service.update({ pricingProviderRaw: 'made_up' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  // v1.14-price-ingest (WS-A): dial `priceProvider` (IsIn pokemontcg_io|pokemonpricetracker).
  // v1.44 (P-47) += `tcgcsv_singles`, el provider PRIMARIO del barrido de singles por-acabado.
  //
  // ⚠️⚠️ **CANDADO DE DINERO — NO BORRAR NI RECORTAR LA LISTA DE ABAJO** (QA BLOQUEANTE-2, P-47;
  // ARCHITECTURE §4.36(d) bandera nº1; API_CONTRACT §M10 «enum vigente `tcgcsv_singles |
  // pokemonpricetracker | pokemontcg_io`»).
  //
  // Antes de este `it`, **ningún test de todo el árbol assertaba que `tcgcsv_singles` fuera un valor
  // ACEPTADO del dial**: las 37 menciones que hay en `test/` son literales de `source` en fixtures de
  // `PriceReference` (la FILA que escribe el provider), no del dial que lo SELECCIONA. Consecuencia
  // medida por QA: borrar `'tcgcsv_singles'` de `PRICE_PROVIDER_VALUES`
  // (`settings.constants.ts`) dejaba **4281/4281 tests en verde** mientras
  // `PUT /admin/settings {"priceProvider":"tcgcsv_singles"}` empezaba a devolver `422` ⇒ el dueño
  // perdía, en silencio, **el flip al provider primario Y su rollback** (la palanca money-safe de
  // §M10). No es hipotético: la fusión de la curva v2 ya intentó llevarse el valor por delante una
  // vez, y por eso §4.36(d) lo lista como la bandera nº1 del merge.
  //
  // Por eso el assert es de IDA Y VUELTA (no basta con que no lance): se comprueba que el valor
  // **se persiste en la fila `price_provider`**, que es lo que lee `providerFor()` en el barrido.
  it.each(['pokemontcg_io', 'pokemonpricetracker', 'tcgcsv_singles'])(
    'accepts priceProvider="%s" (los TRES del enum de contrato) y lo PERSISTE en `price_provider`',
    async (value) => {
      await expect(service.update({ priceProvider: value })).resolves.toEqual({
        priceProvider: value,
      });
      expect(prisma.configSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'price_provider' },
          create: expect.objectContaining({ key: 'price_provider', valueJson: value }),
          update: expect.objectContaining({ valueJson: value }),
        }),
      );
    },
  );

  // ⚠️ **PIN del CONTENIDO del enum — la otra mitad del candado: «ni MÁS».**
  //
  // El `it.each` de arriba cubre «ni MENOS» (los tres valores del contrato se aceptan) y el `it` de
  // abajo cubre dos valores concretos que deben rechazarse. Ninguno de los dos ve el fallo por
  // AÑADIDO, que es money-critical por una razón que no está en este módulo: `providerFor()`
  // (`price-ingest.service.ts`) hace `providers.find(p => p.source === wanted)` y, **si no encuentra
  // el valor, cae a `pokemontcg_io` (legacy) dejando solo un `warn` en logs**. Es decir: un cuarto
  // valor en esta lista sería ACEPTADO por el `PUT` con `200`, el dueño creería haber flipeado el
  // provider, y **el catálogo entero se repreciaría desde la fuente legacy sin que nadie se entere**.
  //
  // Por eso se pinea el CONTENIDO EXACTO contra API_CONTRACT §M10-PP (enum
  // `tcgcsv_singles | pokemonpricetracker | pokemontcg_io`; el literal `PRICE_PROVIDER_VALUES =
  // ['pokemontcg_io','pokemonpricetracker','tcgcsv_singles']`, citado ahí literalmente). Si el
  // contrato gana un cuarto provider, este test DEBE romperse: añadirlo es una decisión del
  // arquitecto (regla 9), no un `push` al array.
  it('PIN: PRICE_PROVIDER_VALUES es EXACTAMENTE el enum de §M10-PP (ni uno más, ni uno menos)', () => {
    expect([...PRICE_PROVIDER_VALUES].sort()).toEqual(
      ['pokemonpricetracker', 'pokemontcg_io', 'tcgcsv_singles'].sort(),
    );
  });

  it('rejects priceProvider outside the ingest enum (e.g. poketrace/manual) with 422', async () => {
    await expect(service.update({ priceProvider: 'poketrace' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(service.update({ priceProvider: 'made_up' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('allows fxManualOverrideRate null (no override) or positive number', async () => {
    await expect(service.update({ fxManualOverrideRate: null })).resolves.toBeDefined();
    await expect(service.update({ fxManualOverrideRate: 18.5 })).resolves.toBeDefined();
    await expect(service.update({ fxManualOverrideRate: 0 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  // v1.1: catalogSyncFromDate ahora es un dial de primera clase del DTO M10 (API_CONTRACT §M10).
  it('accepts a valid catalogSyncFromDate (yyyy/MM/dd) and upserts it', async () => {
    const applied = await service.update({ catalogSyncFromDate: '2025/03/01' });
    expect(applied).toEqual({ catalogSyncFromDate: '2025/03/01' });
    expect(prisma.configSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'catalog_sync_from_date' },
      }),
    );
  });

  it('rejects catalogSyncFromDate with an invalid format (422)', async () => {
    await expect(service.update({ catalogSyncFromDate: '2025-03-01' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(service.update({ catalogSyncFromDate: 'not-a-date' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(service.update({ catalogSyncFromDate: 20250301 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
  });
});

/**
 * v1.1: catalogSyncFromDate se expone en GET /admin/settings (getAllDto), como pide el contrato §M10.
 */
describe('SettingsService.getAllDto — expone catalogSyncFromDate', () => {
  it('returns catalogSyncFromDate with its default when no DB row exists', async () => {
    const prisma = { configSetting: { findUnique: jest.fn().mockResolvedValue(null) } };
    const service = new SettingsService(prisma as unknown as PrismaService);
    const dto = await service.getAllDto();
    expect(dto).toHaveProperty('catalogSyncFromDate', '2024/01/01');
  });

  // ⚠️⚠️ v1.65 (D-PP-1) — SIN DB row, el DTO M10 devuelve el SEED, y el seed **es el PRIMARIO**
  // (`I-PP1`). Se asserta como IGUALDAD contra el contrato: ver `primaryPriceProviderPerContract`.
  //
  // ⚠️ Éste y el `it.each` de arriba prueban **hechos DISTINTOS y no se sustituyen**:
  //   · arriba (hecho 1 del §M10-PP) — el `PUT` ACEPTA `tcgcsv_singles`: es la palanca del dueño;
  //   · aquí   (hecho 2 del §M10-PP) — con qué valor NACE una BD fresca (CI, dev, staging, DR).
  // Un provider puede ser aceptable sin ser el seed, y el legacy lo será mientras siga en el enum
  // (`I-PP3`). Confundirlos fue la causa raíz de §4.35a(a).
  it('I-PP1: sin fila en BD, `priceProvider` cae al SEED, y el SEED ES el PRIMARIO del contrato', async () => {
    const primary = primaryPriceProviderPerContract();
    const prisma = { configSetting: { findUnique: jest.fn().mockResolvedValue(null) } };
    const service = new SettingsService(prisma as unknown as PrismaService);
    const dto = await service.getAllDto();
    expect(dto).toHaveProperty('priceProvider', primary);
  });

  // El mismo hecho, un peldaño más abajo: el LITERAL del mapa de defaults (que es donde §M10-PP dice
  // que vive) == el PRIMARIO del contrato. Se separa del anterior a propósito: si un día el DTO
  // dejara de exponer el dial, este assert seguiría siendo el candado de `I-PP1`.
  it('I-PP1: SETTING_DEFAULTS[price_provider] == el PRIMARIO de §M10-PP, y es un valor del enum', () => {
    const primary = primaryPriceProviderPerContract();
    expect(PRICE_PROVIDER_VALUES).toContain(primary); // coherencia hecho 1 ↔ enum
    expect(SETTING_DEFAULTS[SettingKey.PRICE_PROVIDER]).toBe(primary);
  });

  it('returns the persisted catalogSyncFromDate when a DB row exists', async () => {
    const prisma = {
      configSetting: {
        findUnique: jest.fn().mockImplementation(({ where }: { where: { key: string } }) =>
          where.key === 'catalog_sync_from_date'
            ? Promise.resolve({ key: where.key, valueJson: '2025/06/15' })
            : Promise.resolve(null),
        ),
      },
    };
    const service = new SettingsService(prisma as unknown as PrismaService);
    const dto = await service.getAllDto();
    expect(dto.catalogSyncFromDate).toBe('2025/06/15');
  });
});

/**
 * v1.40 (Enmienda A, P-37): `IVA_PCT` es la FUENTE ÚNICA del IVA. El dial redundante
 * `stripeFeeIvaPct` se RETIRA del DTO de §M10: ya no se expone en GET, y un PUT con esa key
 * cae en 422 (key desconocida). El IVA que Stripe MX cobra sobre su comisión se DERIVA de
 * `ivaPct` (`ivaPct/100`) dentro del gross-up — idéntico al centavo (16 ⇒ 0.16).
 */
describe('SettingsService — stripeFeeIvaPct retirado del DTO (v1.40 P-37)', () => {
  it('getAllDto NO expone stripeFeeIvaPct', async () => {
    const prisma = { configSetting: { findUnique: jest.fn().mockResolvedValue(null) } };
    const service = new SettingsService(prisma as unknown as PrismaService);
    const dto = await service.getAllDto();
    expect(dto).not.toHaveProperty('stripeFeeIvaPct');
  });

  it('update rechaza la key stripeFeeIvaPct con 422 (key desconocida) y no persiste', async () => {
    const prisma: any = { configSetting: { upsert: jest.fn().mockResolvedValue({}) } };
    const service = new SettingsService(prisma as unknown as PrismaService);
    await expect(service.update({ stripeFeeIvaPct: 0.08 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
  });

  it('getStripeFee deriva stripeFeeIvaPct de ivaPct (16 ⇒ 0.16), NUNCA de la fila vieja ni 0', async () => {
    // Solo hay fila para iva_pct=16; stripe_fee_iva_pct NO se lee (aunque existiera, es inerte).
    const prisma = {
      configSetting: {
        findUnique: jest.fn().mockImplementation(({ where }: { where: { key: string } }) =>
          where.key === 'iva_pct'
            ? Promise.resolve({ key: where.key, valueJson: 16 })
            : Promise.resolve(null),
        ),
      },
    };
    const service = new SettingsService(prisma as unknown as PrismaService);
    const fee = await service.getStripeFee();
    expect(fee.stripeFeeIvaPct).toBe(0.16);
    // La key deprecada nunca se consulta en el gross-up.
    const consultedKeys = (prisma.configSetting.findUnique as jest.Mock).mock.calls.map(
      (c) => c[0].where.key,
    );
    expect(consultedKeys).not.toContain('stripe_fee_iva_pct');
  });

  it('smoke gross-up: con ivaPct=16 el neteo es IDÉNTICO al del antiguo 0.16', async () => {
    const prisma = { configSetting: { findUnique: jest.fn().mockResolvedValue(null) } };
    const service = new SettingsService(prisma as unknown as PrismaService);
    const fee = await service.getStripeFee(); // deriva stripeFeeIvaPct = 16/100 = 0.16
    const baseCents = 116000; // subtotal 100000 + IVA 16000
    const derived = grossUpTotal(baseCents, fee);
    // Referencia: exactamente el gross-up con el 0.16 hardcodeado de antes (misma matemática).
    const legacy = grossUpTotal(baseCents, {
      stripePct: fee.stripePct,
      stripeFixedCents: fee.stripeFixedCents,
      stripeFeeIvaPct: 0.16,
    });
    expect(derived).toBe(legacy);
  });
});
