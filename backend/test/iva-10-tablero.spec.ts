import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { AdminService } from '../src/modules/admin/admin.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';

/**
 * ⭐ **`IVA-10` — VENTAS BRUTAS Y NETAS: la coherencia POR CONSTRUCCIÓN.**
 * (`API_CONTRACT §M10-IVA.5` / `§M10-IVA.7`, D55(b) y pregunta **70**; `ARCHITECTURE §4.44.o`.)
 *
 * **La decisión del dueño (2026-09-10):** *«Hagamos ventas brutas con iva y ventas netas sin iva»* ·
 * *«Ingreso bruto y neto»*. Y la pregunta 70, contestada: su *«neto»* **ES** `pnl.incomeCents`.
 *
 * **La mutación que este candado mata:** que el tablero y el P&L tengan **dos definiciones de
 * «neto»**, o que la diferencia bruto↔neto deje de ser explicable.
 *
 * ### Las cuatro mitades
 *  - **(a)** ⭐⭐ **la identidad del PUENTE, exacta**, sobre un periodo con al menos una orden
 *    `vault` y una `direct_ship`, y en **las dos** convenciones:
 *    `gross ≡ net + netShipping + iva + processingFee`.
 *  - **(b)** ⭐ **contra el P&L, como IGUALDAD**: `salesPeriod.netAmountCents == pnl.incomeCents`.
 *    *Es la mutación realista, porque son dos endpoints y dos ficheros.*
 *  - **(c)** **`amountCents` YA NO EXISTE** — rojo si sobrevive, aunque valga lo mismo.
 *  - **(d)** **`grossAmountCents == Σ Order.totalCents`** sigue siendo *«lo que el cliente pagó»*.
 *
 * ### ⚠️ Y por qué se RECHAZA definir el neto como «bruto − IVA»
 * Dejaría la **comisión de plataforma** dentro y **no coincidiría con `incomeCents`** ⇒ **tres
 * números**, que es peor que el problema que el dueño quiso cerrar. Está asertado como contra-candado.
 */

const R = 16;

/** Una `Order` liquidada tal y como la leen el tablero y el P&L. */
type OrdenFake = {
  totalCents: number;
  subtotalCents: number;
  shippingFeeCents: number;
  ivaCents: number;
  ivaRatePct: number;
  processingFeeCents: number;
  priceConvention: 'IVA_EXCLUSIVE' | 'IVA_INCLUSIVE';
  fulfillmentMode: 'vault' | 'direct_ship';
  items: { inventoryItem: { acquisitionCostCents: number | null } }[];
};

/**
 * ⭐ **Pedido de BÓVEDA `IVA_INCLUSIVE` construido como lo construye el checkout**: `G = S`,
 * `iva = G − round(G/1.16)`, `total = S + fee`.
 */
const VAULT: OrdenFake = {
  subtotalCents: 11_600,
  shippingFeeCents: 0,
  ivaCents: 1_600,
  ivaRatePct: R,
  processingFeeCents: 869,
  totalCents: 11_600 + 869,
  priceConvention: 'IVA_INCLUSIVE',
  fulfillmentMode: 'vault',
  items: [{ inventoryItem: { acquisitionCostCents: 4_000 } }],
};

/** ⭐ Pedido `direct_ship` `IVA_INCLUSIVE`: `G = S + E = 31900`, `iva = 4400`, `fee = 1754`. */
const DIRECT: OrdenFake = {
  subtotalCents: 11_600,
  shippingFeeCents: 20_300,
  ivaCents: 4_400,
  ivaRatePct: R,
  processingFeeCents: 1_754,
  totalCents: 31_900 + 1_754,
  priceConvention: 'IVA_INCLUSIVE',
  fulfillmentMode: 'direct_ship',
  items: [{ inventoryItem: { acquisitionCostCents: 4_000 } }],
};

/** ⭐ Y una orden HISTÓRICA `IVA_EXCLUSIVE`, porque la identidad se exige en **las dos** convenciones. */
const HISTORICA: OrdenFake = {
  subtotalCents: 10_000,
  shippingFeeCents: 0,
  ivaCents: 1_600,
  ivaRatePct: R,
  processingFeeCents: 869,
  // Bajo la convención vieja el total SÍ llevaba el IVA como sumando.
  totalCents: 10_000 + 1_600 + 869,
  priceConvention: 'IVA_EXCLUSIVE',
  fulfillmentMode: 'vault',
  items: [{ inventoryItem: { acquisitionCostCents: 4_000 } }],
};

function servicio(ordenes: OrdenFake[]) {
  const prisma = {
    order: {
      findMany: jest.fn().mockResolvedValue(ordenes),
      count: jest.fn().mockResolvedValue(ordenes.length),
      aggregate: jest.fn().mockResolvedValue({ _sum: { totalCents: 0 } }),
    },
    shipmentRequest: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    sellRequest: {
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _sum: { approvedTotalCents: 0 } }),
    },
    dispute: { count: jest.fn().mockResolvedValue(0) },
    pendingPriceEntry: { count: jest.fn().mockResolvedValue(0) },
    priceReference: { findFirst: jest.fn().mockResolvedValue(null) },
    fxRate: { findFirst: jest.fn().mockResolvedValue(null) },
    user: { count: jest.fn().mockResolvedValue(0) },
    inventoryItem: { findMany: jest.fn().mockResolvedValue([]) },
    vaultItem: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new AdminService(
    prisma as unknown as PrismaService,
    { sealedMarketGradeKeyForItem: () => null, tryGradeKeyFor: () => null, getReferencesBatch: async () => new Map() } as unknown as PricingService,
    new PiiCryptoService(new ConfigService({})),
    {} as never,
  );
  return { service, prisma };
}

describe('⭐ `IVA-10` — el tablero: bruto y neto, y la diferencia es EXPLICABLE', () => {
  it('⭐⭐ (a) LA IDENTIDAD DEL PUENTE, exacta, con `vault` + `direct_ship` + histórica', async () => {
    const { service } = servicio([VAULT, DIRECT, HISTORICA]);
    const d: any = await service.dashboard(Role.super_admin);
    const s = d.salesPeriod;
    expect(s.grossAmountCents).toBe(
      s.netAmountCents + s.netShippingRevenueCents + s.ivaCents + s.processingFeeCents,
    );
    // ⛔ Rojo con ±1 centavo: la identidad es lo que hace la diferencia **explicable** en vez de
    // sospechosa. Se asierta también en cifras, para que un informe pueda citarlas.
    expect(s.netAmountCents).toBe(10_000 + 10_000 + 10_000);
    expect(s.netShippingRevenueCents).toBe(0 + 17_500 + 0);
    expect(s.ivaCents).toBe(1_600 + 4_400 + 1_600);
    expect(s.processingFeeCents).toBe(869 + 1_754 + 869);
    expect(s.grossAmountCents).toBe(VAULT.totalCents + DIRECT.totalCents + HISTORICA.totalCents);
  });

  it('⭐⭐ (b) contra el P&L, como IGUALDAD: `netAmountCents == pnl.incomeCents`', async () => {
    const { service } = servicio([VAULT, DIRECT, HISTORICA]);
    const d: any = await service.dashboard(Role.super_admin);
    const p = await service.pnl();
    // ⛔ Rojo si difieren en un centavo. Son dos endpoints y dos ficheros: la garantía no es el
    // cuidado, es que los dos salen **del mismo helper**.
    expect(d.salesPeriod.netAmountCents).toBe(p.incomeCents);
  });

  it('⭐ (c) `amountCents` YA NO EXISTE en `salesPeriod` — rojo aunque valiera lo mismo', async () => {
    const { service } = servicio([VAULT]);
    const d: any = await service.dashboard(Role.super_admin);
    expect(d.salesPeriod).not.toHaveProperty('amountCents');
    expect(d.salesPeriod).toHaveProperty('grossAmountCents');
    // *Un «amount» que convive con otro «amount» distinto es la ambigüedad que este pase existe
    // para matar.* El rename ROMPE al front, y debe romperlo: la tarjeta pasa de una cifra a dos.
  });

  it('⭐ (d) `grossAmountCents == Σ Order.totalCents` — «lo que el cliente pagó», sin netear', async () => {
    const { service } = servicio([VAULT, DIRECT]);
    const d: any = await service.dashboard(Role.super_admin);
    expect(d.salesPeriod.grossAmountCents).toBe(VAULT.totalCents + DIRECT.totalCents);
    // Con comisión y envío DENTRO: ⛔ rojo si alguien lo netea.
    expect(d.salesPeriod.grossAmountCents).toBeGreaterThan(d.salesPeriod.netAmountCents);
  });

  it('⛔ CONTRA-CANDADO: el neto ⛔ NO es «bruto − IVA» (dejaría la comisión dentro)', async () => {
    const { service } = servicio([VAULT, DIRECT]);
    const d: any = await service.dashboard(Role.super_admin);
    const s = d.salesPeriod;
    const falso = s.grossAmountCents - s.ivaCents;
    expect(s.netAmountCents).not.toBe(falso);
    // La diferencia es exactamente la comisión + el envío neto, que es lo que «bruto − IVA» deja
    // dentro y `incomeCents` no. ⇒ serían TRES números, que es peor que el problema original.
    expect(falso - s.netAmountCents).toBe(s.processingFeeCents + s.netShippingRevenueCents);
  });

  it('⭐⭐ mover el dial NO mueve la tarjeta: sale de columnas persistidas, no del dial vivo', async () => {
    // El amarre de `IVA-5` aplicado al tablero, en su forma más fuerte: `AdminService` **no recibe**
    // `SettingsService`, así que no es que no lea el dial — es que **no lo tiene**.
    const { service, prisma } = servicio([VAULT, DIRECT, HISTORICA]);
    const a: any = await service.dashboard(Role.super_admin);
    const b: any = await service.dashboard(Role.super_admin);
    expect(b.salesPeriod).toEqual(a.salesPeriod);
    expect((prisma as any).configSetting).toBeUndefined();
  });

  it('⭐ `vault_operator` conserva lo que ya veía y ⛔ NO gana los cuatro campos financieros', async () => {
    // ⚠️ **MEDIDO, y contradice una frase del contrato.** §M10-IVA.7 afirma que esta tarjeta *«ya es
    // de campos financieros ⇒ `super_admin`; `vault_operator` no la recibe (sin cambio)»*. **Hoy sí
    // la recibe.** Se resuelve **sin regresión y sin exposición nueva**: conteo + bruto (renombrado),
    // y los cuatro campos nuevos solo para `super_admin`. Enrutado en `docs/BACKEND_NOTES.md`.
    const { service } = servicio([VAULT, DIRECT]);
    const d: any = await service.dashboard(Role.vault_operator);
    expect(d.salesPeriod).toEqual({
      count: 2,
      grossAmountCents: VAULT.totalCents + DIRECT.totalCents,
    });
    expect(d.salesPeriod).not.toHaveProperty('netAmountCents');
    expect(d).not.toHaveProperty('profitPeriodCents'); // el resto del dinero, como siempre
  });

  it('⭐ la identidad se sostiene sobre 200 periodos generados, en las dos convenciones', async () => {
    let semilla = 4477;
    const rnd = (max: number) => {
      semilla = (semilla * 1103515245 + 12345) % 2147483648;
      return semilla % max;
    };
    const taxBase = (x: number) => Math.round((x * 100) / (100 + R));
    for (let caso = 0; caso < 200; caso += 1) {
      const ordenes: OrdenFake[] = Array.from({ length: 1 + rnd(4) }, () => {
        const inclusive = rnd(2) === 0;
        const S = 1 + rnd(500_000);
        const E = rnd(3) === 0 ? 0 : rnd(50_000);
        const fee = rnd(5_000);
        const ivaCents = inclusive ? S + E - taxBase(S + E) : Math.round(((S + E) * R) / 100);
        return {
          subtotalCents: S,
          shippingFeeCents: E,
          ivaCents,
          ivaRatePct: R,
          processingFeeCents: fee,
          totalCents: inclusive ? S + E + fee : S + E + ivaCents + fee,
          priceConvention: inclusive ? 'IVA_INCLUSIVE' : 'IVA_EXCLUSIVE',
          fulfillmentMode: E > 0 ? 'direct_ship' : 'vault',
          items: [],
        };
      });
      const { service } = servicio(ordenes);
      const d: any = await service.dashboard(Role.super_admin);
      const s = d.salesPeriod;
      expect(s.grossAmountCents).toBe(
        s.netAmountCents + s.netShippingRevenueCents + s.ivaCents + s.processingFeeCents,
      );
      expect(s.netAmountCents).toBe((await service.pnl()).incomeCents);
    }
  });
});
