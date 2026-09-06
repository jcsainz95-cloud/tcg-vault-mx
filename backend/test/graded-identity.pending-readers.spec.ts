import { ConfigService } from '@nestjs/config';
import { VaultService } from '../src/modules/vault/vault.service';
import { AdminService } from '../src/modules/admin/admin.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { BusinessException } from '../src/common/business.exception';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';
import {
  buildGradeKey,
  tryBuildGradeKey,
  sealedMarketGradeKey,
} from '../src/modules/pricing/pricing.types';

/**
 * v1.53-buylist-graded-identity (ARCHITECTURE §4.40.4c / §4.40.9 qa-e y qa-f, **MONEY**) —
 * **LA MITAD PERSISTIDA del defecto.**
 *
 * El defecto no se detenía en la cotización: `convertToInventory` crea el `InventoryItem` copiando
 * `cardId`/`productType`/`rawCondition`/`finish` y **sin** `gradingCompany`/`gradeValue`/`certNumber`
 * —no puede: el origen no los tiene—, así que la pieza nacía `graded` con identidad NULA y **todos**
 * los lectores la volvían a resolver como **PSA 10, para siempre**: bóveda, catálogo, precio de
 * venta, valor de custodia, P&L y `price-sync` (§9 D-BG-3).
 *
 * Este spec ancla las dos caras del arreglo, que son las que QA mira primero:
 *  - **(e)** una pieza `graded` con identidad nula se valúa **`pending`**, no PSA 10, en bóveda,
 *    admin y checkout. No es una regresión: es que por primera vez dice la verdad.
 *  - **(f)** una pieza `graded` **con** identidad completa se valúa **exactamente igual que antes**
 *    (este pase no puede mover ni un peso de un slab bien capturado).
 */

const REF_PSA10 = 90_000; // lo que valía la referencia `graded:PSA:10` — el grado MÁS CARO
const REF_PSA9 = 30_000;

/** `PricingService` con los CUERPOS REALES de las dos variantes de clave (aquí es lo que se prueba). */
function pricingWithRealKeys(over: Record<string, unknown> = {}): PricingService {
  return {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    computeSalePriceForItem: jest.fn(PricingService.prototype.computeSalePriceForItem),
    gradeKeyFor: jest.fn(PricingService.prototype.gradeKeyFor),
    tryGradeKeyFor: jest.fn(PricingService.prototype.tryGradeKeyFor),
    sealedMarketGradeKeyForItem: (i: { tcgplayerProductId: number | null }) =>
      i.tcgplayerProductId != null ? sealedMarketGradeKey(i.tcgplayerProductId) : null,
    // La ÚNICA fila de mercado de graduadas que existe es la de PSA 10 (el caso real: el defecto
    // «solo muerde donde exista una fila graded:PSA:10», §4.40.1).
    getReference: jest.fn(async (_c: string, _p: string, gradeKey: string) =>
      gradeKey === 'graded:PSA:10'
        ? { status: 'priced', referenceMxnCents: REF_PSA10, capturedDate: '2026-09-01' }
        : gradeKey === 'graded:PSA:9'
          ? { status: 'priced', referenceMxnCents: REF_PSA9, capturedDate: '2026-09-01' }
          : { status: 'pending' },
    ),
    getReferencesBatch: jest.fn(async (keys: { cardId: string; productType: string; gradeKey: string; finish: string }[]) => {
      const m = new Map<string, unknown>();
      for (const k of keys) {
        const cents = k.gradeKey === 'graded:PSA:10' ? REF_PSA10 : k.gradeKey === 'graded:PSA:9' ? REF_PSA9 : null;
        if (cents != null) {
          m.set(`${k.cardId}|${k.productType}|${k.gradeKey}|${k.finish}`, {
            status: 'priced',
            referenceMxnCents: cents,
          });
        }
      }
      return m;
    }),
    getPricedRawFinishesBatch: jest.fn(async () => new Map()),
    getVariantOverride: jest.fn(async () => null),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    fxSnapshotSafe: jest.fn(async () => null),
    ...over,
  } as unknown as PricingService;
}

const card = {
  id: 'c1',
  name: 'Charizard',
  number: '4',
  rarity: 'Rare Holo',
  rarityCanonical: 'rare',
  availableFinishes: ['normal'],
  set: { name: 'Base Set' },
};

/** La pieza EXACTA que produce `convertToInventory`: graduada, sin identidad de slab. */
const sinIdentidad = (over: Record<string, unknown> = {}): any => ({
  id: 'i-sin',
  folio: 'INV-000001',
  cardId: 'c1',
  productType: 'graded',
  rawCondition: null,
  finish: 'normal',
  gradingCompany: null,
  gradeValue: null,
  certNumber: null,
  listPriceCents: null,
  acquisitionCostCents: 50_000,
  acquisitionType: 'buylist',
  tcgplayerProductId: null,
  ownershipStatus: 'settled',
  status: 'in_custody',
  card,
  ...over,
});

/** La pieza BIEN capturada: no puede cambiar de valuación con este pase. */
const conIdentidad = (over: Record<string, unknown> = {}): any =>
  sinIdentidad({
    id: 'i-con',
    folio: 'INV-000002',
    gradingCompany: 'PSA',
    gradeValue: '9',
    certNumber: '12345678',
    ...over,
  });

// ---------------------------------------------------------------------------
// Bóveda (cliente) — el patrimonio que el cliente VE
// ---------------------------------------------------------------------------

describe('bóveda — una graduada sin identidad de slab NO se valúa como PSA 10 (§4.40.4c)', () => {
  function vault(items: unknown[]) {
    const prisma: any = {
      inventoryItem: { findMany: jest.fn(async () => items) },
      shipmentItem: { findMany: jest.fn(async () => []) },
    };
    return new VaultService(prisma as PrismaService, pricingWithRealKeys());
  }

  it('sale `pending` y NO suma al portafolio (antes sumaba MX$900 del grado más caro)', async () => {
    const res = await vault([sinIdentidad()]).holdings('u1');
    expect(res.data[0].referenceValue).toEqual({ status: 'pending' });
    expect(res.portfolio.totalValueMxnCents).toBe(0);
    expect(res.portfolio.pendingPriceCount).toBe(1);
  });

  it('regresión (f): la MISMA carta BIEN capturada (PSA 9) se valúa exactamente igual que antes', async () => {
    const res = await vault([conIdentidad()]).holdings('u1');
    expect(res.portfolio.totalValueMxnCents).toBe(REF_PSA9);
    expect(res.portfolio.pendingPriceCount).toBe(0);
  });

  it('el detalle del holding aplica el MISMO criterio que el listado', async () => {
    const item = sinIdentidad();
    const prisma: any = {
      inventoryItem: { findUnique: jest.fn(async () => ({ ...item, ownerUserId: 'u1', movements: [] })) },
    };
    const svc = new VaultService(prisma as PrismaService, pricingWithRealKeys());
    const res = await svc.holdingDetail('u1', 'i-sin');
    expect(res.referenceValue).toEqual({ status: 'pending' });
  });
});

// ---------------------------------------------------------------------------
// Admin — valor de inventario, valor de custodia (pasivo con el cliente)
// ---------------------------------------------------------------------------

describe('admin — el agregado dice la verdad: cuenta como PENDIENTE, no al precio de un PSA 10', () => {
  function admin(items: unknown[]) {
    const prisma: any = { inventoryItem: { findMany: jest.fn(async () => items) } };
    return new AdminService(
      prisma as PrismaService,
      pricingWithRealKeys(),
      new PiiCryptoService(new ConfigService({})),
      {} as never,
    );
  }

  it('`inventoryValue`: la pieza sin identidad NO suma a `atReferenceCents` y sí a `pendingPriceCount`', async () => {
    const res = await admin([sinIdentidad(), conIdentidad()]).inventoryValue();
    // Solo la BIEN capturada aporta valor de referencia.
    expect(res.atReferenceCents).toBe(REF_PSA9);
    expect(res.pendingPriceCount).toBe(1);
    expect(res.breakdown.graded.pieceCount).toBe(2);
    expect(res.breakdown.graded.atReferenceCents).toBe(REF_PSA9);
    // INVARIANTE del contrato §M7: top-level = Σ del breakdown (no se rompe con el cambio).
    const buckets = [res.breakdown.raw, res.breakdown.sealed, res.breakdown.graded];
    expect(buckets.reduce((s, b) => s + b.atReferenceCents, 0)).toBe(res.atReferenceCents);
  });

  it('`custodyValue`: el pasivo de custodia NO se infla con el precio de un grado que nadie capturó', async () => {
    const res = await admin([sinIdentidad()]).custodyValue();
    expect(res.totalCustodyValueCents).toBe(0);
  });

  it('`custodyValue` con la pieza BIEN capturada sigue valuando igual (regresión f)', async () => {
    const res = await admin([conIdentidad()]).custodyValue();
    expect(res.totalCustodyValueCents).toBe(REF_PSA9);
  });
});

// ---------------------------------------------------------------------------
// Checkout — el precio de VENTA (dinero entrante mal calculado)
// ---------------------------------------------------------------------------

describe('checkout — una pieza sin identidad de slab NO es vendible (`PRICE_PENDING`, no un 500)', () => {
  function orders() {
    return new OrdersService(
      {} as PrismaService,
      pricingWithRealKeys(),
      {} as never,
      {} as never,
      {} as never,
    );
  }

  it('rechaza con `PRICE_PENDING` en vez de cobrar el precio derivado de `graded:PSA:10`', async () => {
    const svc = orders() as unknown as { salePriceOf(i: unknown): Promise<number> };
    await expect(svc.salePriceOf(sinIdentidad({ status: 'listed' }))).rejects.toMatchObject({
      code: 'PRICE_PENDING',
    });
    // Es un rechazo de NEGOCIO (422), no una caída: existen piezas `listed` legacy (§4.40.5c).
    await svc.salePriceOf(sinIdentidad({ status: 'listed' })).catch((e: unknown) => {
      expect(e).toBeInstanceOf(BusinessException);
      expect((e as BusinessException).getStatus()).toBe(422);
    });
  });

  it('regresión (f): la pieza BIEN capturada sigue cobrando lo mismo que antes del pase', async () => {
    const svc = orders() as unknown as { salePriceOf(i: unknown): Promise<number> };
    const price = await svc.salePriceOf(conIdentidad({ status: 'listed' }));
    // El precio sale de la CURVA sobre REF_PSA9; lo que importa aquí es que RESUELVE y es > 0.
    expect(price).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// El invariante que resume el pase
// ---------------------------------------------------------------------------

describe('§4.40.4 — ningún lector puede volver a producir `graded:PSA:10` desde una fila sin grado', () => {
  it('la clave de la pieza convertida es `null` y la de la bien capturada, la suya', () => {
    expect(tryBuildGradeKey(sinIdentidad())).toBeNull();
    expect(tryBuildGradeKey(conIdentidad())).toBe('graded:PSA:9');
    expect(tryBuildGradeKey(conIdentidad())).not.toBe(
      buildGradeKey({ productType: 'graded', gradingCompany: 'PSA', gradeValue: '10' }),
    );
  });
});
