import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { VariantControlsService } from '../src/modules/pricing/variant-controls.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { composeVariantPricing } from '../src/modules/pricing/variant-pricing';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/**
 * E5 (ARCHITECTURE §4.36.6 · PROJECT §N.6, criterios 90/91) — **BOUNTY REVALIDADO CONTRA LA CURVA**.
 *
 * El hueco que cierra: hasta v1.44 `BOUNTY_BELOW_RULE` se validaba SOLO AL CREAR. Si después subía el
 * mercado y la tarifa estándar rebasaba al bounty, la «oferta» publicada **pagaba MENOS que la tarifa
 * normal** y aun así seguía publicada y ganando la precedencia #1.
 *
 * Se valida en las TRES seams: **CREAR** (422, ahora con `<=`), **COTIZAR** (se salta el peldaño 1) y
 * **PUBLICAR** (desaparece de la vitrina). Efecto buscado: el número publicado es EXACTAMENTE lo que
 * se paga, y todo lo de la vitrina es por definición mejor que la tarifa estándar.
 *
 * El escenario del test es el del criterio 90: bounty válido → SUBE EL MERCADO → la regla lo rebasa.
 */

const pii = new PiiCryptoService(new ConfigService({}));

/** Mercado $10 ⇒ curva de compra 30 % = $3. Mercado $500 ⇒ 50 % = $250. */
const MARKET_LOW = 1000;
const MARKET_HIGH = 50000;
const BOUNTY_CENTS = 5000; // $50: mejor que $3, peor que $250

function pricingWith(referenceMxnCents: number, override: Record<string, unknown> | null) {
  return {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    // v2.1.1 (§4.36.5b): el seam de VENTA devuelve una DECISIÓN (monto + veredicto). El mock usa
    // el CUERPO REAL (`PricingService.prototype`): es puro y no toca `this`, así que el test no
    // puede divergir de producción ni reimplementar la matemática.
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    gradeKeyFor: jest.fn(() => 'raw:NM'),
    getReference: jest.fn(async () => ({ status: 'priced', referenceMxnCents })),
    getReferencesBatch: jest.fn(async (keys: { cardId: string; productType: string; gradeKey: string; finish: string }[]) => {
      const m = new Map<string, unknown>();
      for (const k of keys) {
        m.set(`${k.cardId}|${k.productType}|${k.gradeKey}|${k.finish}`, {
          status: 'priced',
          referenceMxnCents,
        });
      }
      return m;
    }),
    getVariantOverride: jest.fn(async () => override),
    getVariantOverridesBatch: jest.fn(async (keys: { cardId: string; productType: string; gradeKey: string; finish: string }[]) => {
      const m = new Map<string, unknown>();
      if (override) for (const k of keys) m.set(`${k.cardId}|${k.productType}|${k.gradeKey}|${k.finish}`, override);
      return m;
    }),
    escalatePending: jest.fn(),
    settlePendingForVariant: jest.fn(async () => undefined),
  } as unknown as PricingService;
}

function buylistWith(referenceMxnCents: number, override: Record<string, unknown> | null) {
  const bountyRow = {
    cardId: 'c1',
    productType: 'raw',
    gradeKey: 'raw:NM',
    finish: 'normal',
    bountyEnabled: true,
    bountyPriceCents: BOUNTY_CENTS,
    bountyTargetQty: 3,
    bountyAcquiredQty: 1,
    card: { name: 'Pikachu ex', number: '104', rarity: 'Double Rare', imageSmallUrl: null, set: { name: 'S' } },
  };
  const prisma = {
    card: {
      findUnique: jest.fn(async () => ({ id: 'c1', rarity: 'Double Rare', availableFinishes: ['normal'] })),
      // v2.1.1: `createRequest` carga las cartas EN LOTE (mata el N+1 que hacía un
      // `findUnique` por ítem). Delega en el MISMO `findUnique` del fixture (`this`).
      findMany: jest.fn(async function (this: any, args: any) {
        const ids: string[] = args?.where?.id?.in ?? [];
        const rows = await Promise.all(ids.map((id) => this.findUnique({ where: { id } })));
        return rows.filter(Boolean);
      }),
    },
    variantPriceOverride: { findMany: jest.fn(async () => [bountyRow]) },
  } as unknown as PrismaService;
  const pricing = pricingWith(referenceMxnCents, override);
  const settings = { getRaw: jest.fn(), getNumber: jest.fn(async () => 0) } as unknown as SettingsService;
  return { svc: new BuylistService(prisma, pricing, settings, {} as UsersService, pii), pricing };
}

const BOUNTY_OVERRIDE = { bountyEnabled: true, bountyPriceCents: BOUNTY_CENTS };

describe('E5 — seam COTIZAR: un bounty rebasado por la curva deja de aplicar (criterio 90)', () => {
  it('con el mercado BAJO el bounty gana la precedencia #1 y paga su monto', async () => {
    const { svc } = buylistWith(MARKET_LOW, BOUNTY_OVERRIDE);
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'normal');
    expect(q.quote.quotedPriceCents).toBe(BOUNTY_CENTS);
    expect(q.priceBasis).toBe('bounty');
  });

  it('SUBE EL MERCADO y la curva lo rebasa ⇒ se paga LA CURVA, nunca el bounty', async () => {
    const { svc } = buylistWith(MARKET_HIGH, BOUNTY_OVERRIDE);
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'normal');
    expect(q.quote.quotedPriceCents).toBe(25000); // $500 × 50 %
    expect(q.priceBasis).toBe('market'); // NUNCA "bounty"
  });

  it('EMPATE exacto con la curva ⇒ tampoco aplica (criterio 91: estrictamente mayor)', async () => {
    const { svc } = buylistWith(MARKET_HIGH, { bountyEnabled: true, bountyPriceCents: 25000 });
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'normal');
    expect(q.quote.quotedPriceCents).toBe(25000);
    expect(q.priceBasis).toBe('market');
  });
});

describe('E5 — seam PUBLICAR: la vitrina solo muestra lo que es MEJOR que la tarifa estándar', () => {
  it('mercado BAJO ⇒ el bounty aparece en la vitrina', async () => {
    const { svc } = buylistWith(MARKET_LOW, BOUNTY_OVERRIDE);
    const res = await svc.publicBounties();
    expect(res.data).toHaveLength(1);
    expect(res.data[0].bountyPriceCents).toBe(BOUNTY_CENTS);
  });

  it('mercado ALTO ⇒ DESAPARECE de la vitrina (Home y Vender)', async () => {
    const { svc } = buylistWith(MARKET_HIGH, BOUNTY_OVERRIDE);
    const res = await svc.publicBounties();
    expect(res.data).toHaveLength(0);
  });

  it('criterio 91: para TODO bounty visible, la cotización es EXACTAMENTE ese monto y supera a la curva', async () => {
    const { svc } = buylistWith(MARKET_LOW, BOUNTY_OVERRIDE);
    const shown = await svc.publicBounties();
    const quoted = await svc.publicQuote('c1', 'raw', 'NM', 'normal');
    expect(quoted.quote.quotedPriceCents).toBe(shown.data[0].bountyPriceCents);
    // …y es estrictamente mayor que la tarifa estándar ($10 × 30 % = $3).
    const { svc: sinBounty } = buylistWith(MARKET_LOW, null);
    const estandar = await sinBounty.publicQuote('c1', 'raw', 'NM', 'normal');
    expect(shown.data[0].bountyPriceCents).toBeGreaterThan(estandar.quote.quotedPriceCents as number);
  });

  it('el FILTRO va ANTES del cap: 50 bounties efectivos siguen llenando la vitrina aunque haya rebasados', async () => {
    // 20 rebasados (los más caros por precio, primeros en el orden del query) + 60 efectivos.
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => ({
        cardId: `dead-${i}`,
        productType: 'raw',
        gradeKey: 'raw:NM',
        finish: 'normal',
        bountyEnabled: true,
        bountyPriceCents: 10000, // por debajo de la curva ($250) ⇒ NO efectivo
        bountyTargetQty: null,
        bountyAcquiredQty: 0,
        card: { name: 'D', number: '1', rarity: null, imageSmallUrl: null, set: { name: 'S' } },
      })),
      ...Array.from({ length: 60 }, (_, i) => ({
        cardId: `live-${i}`,
        productType: 'raw',
        gradeKey: 'raw:NM',
        finish: 'normal',
        bountyEnabled: true,
        bountyPriceCents: 30000 + i, // por encima de la curva ⇒ efectivo
        bountyTargetQty: null,
        bountyAcquiredQty: 0,
        card: { name: 'L', number: '1', rarity: null, imageSmallUrl: null, set: { name: 'S' } },
      })),
    ];
    const prisma = {
      variantPriceOverride: { findMany: jest.fn(async () => rows) },
    } as unknown as PrismaService;
    const svc = new BuylistService(
      prisma,
      pricingWith(MARKET_HIGH, null),
      {} as SettingsService,
      {} as UsersService,
      pii,
    );
    const res = await svc.publicBounties();
    // Si se hubiera filtrado DESPUÉS del cap, la vitrina traería 30 filas (50 − 20 rebasados).
    expect(res.data).toHaveLength(50);
    expect(res.data.every((b) => b.cardId.startsWith('live-'))).toBe(true);
    // Orden `bountyPriceCents desc` conservado tras el filtro.
    expect(res.data[0].bountyPriceCents).toBeGreaterThan(res.data[49].bountyPriceCents);
  });
});

describe('E5 — seam CREAR: 422 BOUNTY_BELOW_RULE contra la CURVA, con el empate ENDURECIDO', () => {
  function controlsWith(referenceMxnCents: number) {
    const prisma = {
      card: {
        findUnique: jest.fn(async () => ({ id: 'c1', rarity: 'Double Rare', rarityCanonical: 'Double Rare', availableFinishes: ['normal'] })),
        // v2.1.1: `createRequest` carga las cartas EN LOTE (mata el N+1 que hacía un
        // `findUnique` por ítem). Delega en el MISMO `findUnique` del fixture (`this`).
        findMany: jest.fn(async function (this: any, args: any) {
          const ids: string[] = args?.where?.id?.in ?? [];
          const rows = await Promise.all(ids.map((id) => this.findUnique({ where: { id } })));
          return rows.filter(Boolean);
        }),
      },
      variantPriceOverride: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => ({
          id: 'vpo-1',
          bountyTargetQty: null,
          bountyAcquiredQty: 0,
          bountyCompletedAt: null,
          sellOverrideCents: null,
          buyOverrideCents: null,
          bountyEnabled: false,
          bountyPriceCents: null,
          ...create,
        })),
        delete: jest.fn(),
      },
    } as unknown as PrismaService;
    const pricing = pricingWith(referenceMxnCents, null);
    const audit = { log: jest.fn(async () => undefined) } as unknown as AuditService;
    return new VariantControlsService(prisma, pricing, audit);
  }

  it('por debajo de la curva ⇒ 422 con `curveQuoteCents` en el detalle', async () => {
    const svc = controlsWith(MARKET_HIGH); // curva = 25000
    await expect(
      svc.update('c1', 'normal', { bounty: { enabled: true, priceCents: 24999 } }, 'a'),
    ).rejects.toMatchObject({ code: 'BOUNTY_BELOW_RULE' });
  });

  it('IGUAL a la curva ⇒ TAMBIÉN 422 (endurecido de `<` a `<=`)', async () => {
    // Sin este endurecimiento el alta aceptaría un bounty que el runtime ignora (exige `>` estricto):
    // quedaría publicado como oferta y pagaría la tarifa normal. Reversible en dato: +$0.01.
    const svc = controlsWith(MARKET_HIGH);
    await expect(
      svc.update('c1', 'normal', { bounty: { enabled: true, priceCents: 25000 } }, 'a'),
    ).rejects.toMatchObject({ code: 'BOUNTY_BELOW_RULE' });
  });

  it('estrictamente mayor ⇒ se acepta', async () => {
    const svc = controlsWith(MARKET_HIGH);
    const res = await svc.update('c1', 'normal', { bounty: { enabled: true, priceCents: 25001 } }, 'a');
    expect(res.pricing.buy).toMatchObject({ effectiveCents: 25001, source: 'bounty' });
  });
});

describe('E5 — ALERTA EN EL BINDER (y solo ahí: sin correo, push ni dashboard)', () => {
  const row = {
    bountyEnabled: true,
    bountyPriceCents: BOUNTY_CENTS,
    bountyTargetQty: 3,
    bountyAcquiredQty: 1,
    bountyCompletedAt: null,
    sellOverrideCents: null,
    buyOverrideCents: null,
  } as never;

  it('bounty vigente ⇒ effective:true y la compra resuelve por bounty', () => {
    const dto = composeVariantPricing(MARKET_LOW, DEFAULT_PRICING_CURVE, row, 'Double Rare');
    expect(dto.bounty).toMatchObject({ effective: true, curveQuoteCents: 300 });
    expect(dto.buy).toMatchObject({ effectiveCents: BOUNTY_CENTS, source: 'bounty' });
  });

  it('bounty REBASADO ⇒ effective:false + `curveQuoteCents` = la tarifa que lo rebasó', () => {
    const dto = composeVariantPricing(MARKET_HIGH, DEFAULT_PRICING_CURVE, row, 'Double Rare');
    expect(dto.bounty).toMatchObject({ effective: false, curveQuoteCents: 25000, priceCents: BOUNTY_CENTS });
    // La compra ya NO resuelve por bounty: paga la curva.
    expect(dto.buy).toMatchObject({ effectiveCents: 25000, source: 'market' });
  });

  it('curva SIN resolver ⇒ effective:true y `curveQuoteCents` null (el bounty explícito manda)', () => {
    const dto = composeVariantPricing(null, DEFAULT_PRICING_CURVE, row, 'Double Rare');
    expect(dto.bounty).toMatchObject({ effective: true, curveQuoteCents: null });
    expect(dto.buy).toMatchObject({ effectiveCents: BOUNTY_CENTS, source: 'bounty' });
  });

  it('bounty APAGADO ⇒ effective:false aunque su monto supere la curva', () => {
    const dto = composeVariantPricing(MARKET_LOW, DEFAULT_PRICING_CURVE, { ...(row as object), bountyEnabled: false } as never, 'Double Rare');
    expect(dto.bounty).toMatchObject({ effective: false });
    expect(dto.buy.source).toBe('market');
  });
});
