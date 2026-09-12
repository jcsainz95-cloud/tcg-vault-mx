import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
// v1.51.20 · BL-26: la puerta de `createRequest` (celular + dirección + mínimo) en un solo sitio.
import { GATE_ADDRESS_ID, buylistGateMocks } from './helpers/buylist-create-gate';
import { usersServiceDouble } from './helpers/users-service-double';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

const pii = new PiiCryptoService(new ConfigService({}));
const VALID_CLABE = '012345678901234567'; // 18 dígitos

/**
 * Fase 0.3 (compliance) — cierre del bypass del umbral INE / topes AML vía "precio pendiente".
 * Un ítem `precio_pendiente` suma 0 a `quotedTotalCents`; sin control, una carta cara sin referencia
 * evadía la exigencia de INE. DECISIÓN CONSERVADORA: si hay ≥1 línea `precio_pendiente`, se EXIGE INE.
 */

function buildPricing(referenceMxnCents: number | null): PricingService {
  return {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    // v2.1.1 (§4.36.5b): el seam de VENTA devuelve una DECISIÓN (monto + veredicto). El mock usa
    // el CUERPO REAL (`PricingService.prototype`): es puro y no toca `this`, así que el test no
    // puede divergir de producción ni reimplementar la matemática.
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    tryGradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    getReference: jest.fn().mockResolvedValue(
      referenceMxnCents == null ? { status: 'pending' } : { status: 'priced', referenceMxnCents },
    ),
    // v2.0 (§4.36.5c): el MISMO seam escala Y cierra la cola.
    settlePendingForVariant: jest.fn(async () => undefined),
    escalatePending: jest.fn().mockResolvedValue(undefined),
    // v1.28 (P-18): controles por variante — sin filas M-30 por default (comportamiento previo).
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getVariantOverride: jest.fn(async () => null),
  } as unknown as PricingService;
}

// Umbral INE ALTO (100M) para AISLAR el efecto de la línea pendiente: la exigencia de INE en estos
// tests proviene EXCLUSIVAMENTE de la presencia de una línea `precio_pendiente`, no del monto.
function buildSettings(): SettingsService {
  return {
    getRaw: jest.fn(async () => ({})), // sin reglas explícitas → fallback pct
    getNumber: jest.fn(async (key: string) => {
      if (key === 'buylist_cap_per_month_cents') return 100_000_000;
      if (key === 'buylist_cap_per_request_cents') return 100_000_000;
      if (key === 'ine_threshold_cents') return 100_000_000;
      if (key === 'buylist_price_fallback_pct') return 40;
      return 0;
    }),
  } as unknown as SettingsService;
}

function buildPrisma(rarity: string | null) {
  const prisma: any = {
    card: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'c1',
        rarity,
        availableFinishes: ['normal', 'holofoil'],
      }),
      // v2.1.1: `createRequest` carga las cartas EN LOTE (mata el N+1 que hacía un
      // `findUnique` por ítem). El mock delega en el MISMO `findUnique` del fixture
      // (`this` = este objeto `card`), para no duplicar datos ni criterios.
      findMany: jest.fn(async function (this: any, args: any) {
        const ids: string[] = args?.where?.id?.in ?? [];
        const rows = await Promise.all(ids.map((id) => this.findUnique({ where: { id } })));
        return rows.filter(Boolean);
      }),
    },
    // v1.51.20 · BL-26: vendedor con celular y dirección propia (la puerta se prueba por HTTP).
    ...buylistGateMocks('user-1'),
    kycProfile: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    sellRequest: {
      findMany: jest.fn(async () => []), // M-46 §4.39c: acumulado mensual = findMany+reduce (COALESCE de 2 columnas)
      create: jest.fn(async ({ data }: any) => ({
        id: 'sr-1',
        status: data.status,
        quotedTotalCents: data.quotedTotalCents,
        ineRequired: data.ineRequired,
        items: (data.items.create as any[]).map((it, i) => ({
          id: `it-${i}`,
          cardId: it.cardId,
          card: { id: it.cardId, name: 'X', number: '1' },
          productType: it.productType,
          rawCondition: it.rawCondition ?? null,
          finish: it.finish,
          rarity: it.rarity,
          ruleMode: it.ruleMode,
          ruleValue: it.ruleValue,
          ruleSource: it.ruleSource,
          quotedPriceCents: it.quotedPriceCents,
          approvedPriceCents: null,
          itemStatus: it.itemStatus,
          inventoryItemId: null,
        })),
      })),
    },
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
  };
  return prisma;
}

describe('BuylistService.createRequest — Fase 0.3: INE exigida ante línea pendiente', () => {
  it('línea precio_pendiente SIN INE → 422 INE_REQUIRED (aunque el total cotizado sea $0 y bajo el umbral)', async () => {
    // Illustration Rare (premium) SIN referencia → fallback pct, referencia null → precio_pendiente.
    const prisma = buildPrisma('Illustration Rare');
    const svc = new BuylistService(
      prisma as PrismaService,
      buildPricing(null),
      buildSettings(),
      usersServiceDouble(),
      pii,
    );

    await expect(
      svc.createRequest(
        'user-1',
        [{ cardId: 'c1', productType: 'raw' as any, rawCondition: 'NM' as any, finish: 'holofoil' as any }],
        VALID_CLABE,
        // sin ineUploadKeys
        undefined,
        GATE_ADDRESS_ID,
      ),
    ).rejects.toMatchObject({ code: 'INE_REQUIRED' });
  });

  /**
   * ⭐⭐ **v1.69 (P-78, BK-6 · API_CONTRACT §M6-K.5) — `details` VACÍO.**
   *
   * Aquí viajaba `thresholdCents`, y era **el último sitio** que le imprimía al VENDEDOR el número
   * exacto a partir del cual le pedimos identificación — o sea, el manual de cómo quedarse un peso
   * por debajo. Decisión (c) del dueño, literal: *«los topes dejan de mostrarse al cliente —
   * pantalla **y mensaje de error**»*.
   * ⛔ Y no se fabrica otra cifra en su lugar: el remedio es una FRASE, y vive en el copy del front.
   * La capacidad de avisar ANTES no se pierde — el cotizador pregunta con
   * `GET /users/me/kyc?quotedTotalCents=N` y recibe un veredicto, no el número.
   */
  it('§M6-K.5 · el `details` del INE_REQUIRED del intake va VACÍO: ni `thresholdCents` ni sustituto', async () => {
    const prisma = buildPrisma('Illustration Rare');
    const svc = new BuylistService(
      prisma as PrismaService,
      buildPricing(null),
      buildSettings(),
      usersServiceDouble(),
      pii,
    );

    const err = await svc
      .createRequest(
        'user-1',
        [{ cardId: 'c1', productType: 'raw' as any, rawCondition: 'NM' as any, finish: 'holofoil' as any }],
        VALID_CLABE,
        undefined,
        GATE_ADDRESS_ID,
      )
      .then(
        () => null,
        (e: { code: string; details: Record<string, unknown> }) => e,
      );

    expect(err!.code).toBe('INE_REQUIRED');
    expect(err!.details).toEqual({});
    // ⛔ Ninguna cifra, con ningún nombre: el candado mide la CLASE, no solo la clave vieja.
    expect(JSON.stringify(err!.details)).not.toMatch(/\d/);
  });

  /**
   * ⭐⭐ **`C17` / `SEC-PII-3` — el intake escribe el INE **por la rutina compartida**, no por su
   * cuenta.** Antes tenía su propio `upsert`: pisaba la key vieja **sin borrar el objeto** (huérfano
   * invisible para la purga) y su rama `update` **no tocaba `kycStatus`** ⇒ un `verified` cambiaba
   * sus imágenes y **conservaba la insignia**, y el revisor veía `verified` sobre un documento que
   * nadie revisó. *La frontera es la API, no la pantalla.*
   */
  it('C17 · delega en `UsersService.buildIneSubmission` y funde SU `data` en el upsert', async () => {
    const prisma = buildPrisma('Illustration Rare');
    const users = usersServiceDouble();
    const svc = new BuylistService(
      prisma as PrismaService,
      buildPricing(null),
      buildSettings(),
      users,
      pii,
    );
    const keys = {
      front: 'kyc_ine/2026-09-12/11111111-2222-4333-8444-555555555555.png',
      back: 'kyc_ine/2026-09-12/11111111-2222-4333-8444-666666666666.png',
    };
    await svc.createRequest(
      'user-1',
      [{ cardId: 'c1', productType: 'raw' as any, rawCondition: 'NM' as any, finish: 'holofoil' as any }],
      VALID_CLABE,
      keys,
      GATE_ADDRESS_ID,
    );
    // (a) Pasó por la ÚNICA rutina de escritura (donde vive la compuerta de C15).
    expect(users.buildIneSubmission).toHaveBeenCalledWith('user-1', keys);
    // (b) Y lo que escribe es lo que ESA rutina decide — incluido `kycStatus: 'pending'` en las DOS
    //     ramas del upsert (A6), que es justo lo que la rama `update` no hacía.
    const upsert = (prisma as any).kycProfile.upsert.mock.calls[0][0];
    expect(upsert.update).toMatchObject({ ineFrontKey: keys.front, kycStatus: 'pending' });
    expect(upsert.create).toMatchObject({ ineBackKey: keys.back, kycStatus: 'pending' });
  });

  it('línea precio_pendiente CON INE → pasa y marca ineRequired=true', async () => {
    const prisma = buildPrisma('Illustration Rare');
    const svc = new BuylistService(
      prisma as PrismaService,
      buildPricing(null),
      buildSettings(),
      usersServiceDouble(),
      pii,
    );

    const res = await svc.createRequest(
      'user-1',
      [{ cardId: 'c1', productType: 'raw' as any, rawCondition: 'NM' as any, finish: 'holofoil' as any }],
      VALID_CLABE,
      { front: 'ine-front-key', back: 'ine-back-key' },
      GATE_ADDRESS_ID,
    );
    expect(res.ineRequired).toBe(true);
    expect(res.items[0].itemStatus).toBe('precio_pendiente');
  });

  it('sin líneas pendientes y bajo el umbral → NO exige INE (control sin cambios)', async () => {
    // v2.0 (P-48): ya no hay «bulk fijo que cotiza sin mercado». Una línea cotiza ⇔ HAY mercado.
    const prisma = buildPrisma('Common');
    const settings = {
      getRaw: jest.fn(async () => ({ Common: { mode: 'fixed', value: 50 } })),
      getNumber: jest.fn(async (key: string) => {
        if (key === 'buylist_cap_per_month_cents') return 100_000_000;
        if (key === 'buylist_cap_per_request_cents') return 100_000_000;
        if (key === 'ine_threshold_cents') return 100_000_000;
        if (key === 'buylist_price_fallback_pct') return 40;
        return 0;
      }),
    } as unknown as SettingsService;
    const svc = new BuylistService(
      prisma as PrismaService,
      buildPricing(12500),
      settings,
      usersServiceDouble(),
      pii,
    );

    const res = await svc.createRequest(
      'user-1',
      [{ cardId: 'c1', productType: 'raw' as any, rawCondition: 'NM' as any }],
      VALID_CLABE,
      undefined,
      GATE_ADDRESS_ID,
    );
    expect(res.ineRequired).toBe(false);
    expect(res.items[0].itemStatus).toBe('cotizada');
  });
});
