import { ConfigService } from '@nestjs/config';
import { AdminService } from '../src/modules/admin/admin.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';

/**
 * ⭐⭐ EL P&L DEL DEPLOY 1 — «exactamente lo mismo» + el sumando que faltaba
 * (v1.64-iva-inclusive, `ARCHITECTURE §4.44.j` y `§9 · D-IVA-5`, `API_CONTRACT §M10-IVA.5` `IVA-5`).
 *
 * **La promesa entera del deploy 1 es que el P&L no se mueve**, y este fichero la mide en las dos
 * mitades que hay que separar para no mentir:
 *
 *  - **(A) NEUTRALIDAD, bit a bit.** Con el mismo conjunto de filas de antes —todas
 *    `IVA_EXCLUSIVE`, que es lo que la migración M-50 dejó— las SEIS cifras del reporte son
 *    IDÉNTICAS a las que producía el algoritmo anterior. El algoritmo anterior no se cita de
 *    memoria: se **reconstruye aquí** y se compara como identidad. *Una constante copiada probaría
 *    que sé teclear; una identidad contra el algoritmo viejo prueba que nada se movió.*
 *  - **(B) `D-IVA-5`, la cifra que SÍ cambia y DEBE cambiar.** El ingreso de envío de los pedidos
 *    `direct_ship` no lo contaba nadie: el `ShipmentRequest` de fulfillment lleva
 *    `shippingFeeCents = 0` a propósito y `Order.subtotalCents` excluye el envío. El COSTO sí se
 *    capturaba ⇒ el P&L **subestimaba** la ganancia. Este pase lo suma, **neteado desde el primer
 *    commit** (lo exige `§9 · D-IVA-5`). Es dinero que faltaba, ⛔ no una reinterpretación.
 *
 * Y la mitad que mata la mutación silenciosa: **el ingreso sale de columnas persistidas, jamás del
 * dial vivo** — este servicio ni siquiera recibe `SettingsService`, y se asierta.
 */

/** Fila de orden tal y como la devuelve el `findMany` del P&L (con `include` de items). */
type OrdenFake = {
  subtotalCents: number;
  ivaCents: number;
  processingFeeCents: number;
  ivaRatePct: number;
  priceConvention: 'IVA_EXCLUSIVE' | 'IVA_INCLUSIVE';
  fulfillmentMode: 'vault' | 'direct_ship';
  shippingFeeCents: number;
  items: { inventoryItem: { acquisitionCostCents: number | null } }[];
};

type EnvioFake = {
  shippingFeeCents: number;
  shippingCostCents: number;
  processingFeeCents: number;
  ivaCents: number;
  priceConvention: 'IVA_EXCLUSIVE' | 'IVA_INCLUSIVE';
};

const orden = (o: Partial<OrdenFake> = {}): OrdenFake => ({
  subtotalCents: 10000,
  ivaCents: 1600,
  processingFeeCents: 869,
  ivaRatePct: 16,
  priceConvention: 'IVA_EXCLUSIVE',
  fulfillmentMode: 'vault',
  shippingFeeCents: 0,
  items: [{ inventoryItem: { acquisitionCostCents: 4000 } }],
  ...o,
});

const envio = (e: Partial<EnvioFake> = {}): EnvioFake => ({
  shippingFeeCents: 17500,
  shippingCostCents: 9000,
  processingFeeCents: 800,
  ivaCents: 2800,
  priceConvention: 'IVA_EXCLUSIVE',
  ...e,
});

/**
 * ⭐ EL ALGORITMO ANTERIOR A ESTE PASE, reconstruido literal desde `admin.service.ts` tal y como
 * estaba (`incomeCents += o.subtotalCents`, `shippingRevenueCents += s.shippingFeeCents`, y **sin**
 * el sumando de `direct_ship` — que es justamente `D-IVA-5`). Es la referencia contra la que se
 * mide la neutralidad. ⛔ No se toca cuando cambie el código nuevo: si hay que tocarlo, es que la
 * neutralidad se rompió.
 */
function pnlLegacy(ordenes: OrdenFake[], envios: EnvioFake[]) {
  let incomeCents = 0;
  let stripeFeesCents = 0;
  let cogsCents = 0;
  for (const o of ordenes) {
    incomeCents += o.subtotalCents;
    stripeFeesCents += o.processingFeeCents;
    for (const it of o.items) cogsCents += it.inventoryItem.acquisitionCostCents ?? 0;
  }
  let shippingRevenueCents = 0;
  let shippingCostCents = 0;
  for (const s of envios) {
    shippingRevenueCents += s.shippingFeeCents;
    shippingCostCents += s.shippingCostCents;
    stripeFeesCents += s.processingFeeCents;
  }
  return {
    incomeCents,
    shippingRevenueCents,
    cogsCents,
    stripeFeesCents,
    shippingCostCents,
    profitCents: incomeCents + shippingRevenueCents - cogsCents - stripeFeesCents - shippingCostCents,
  };
}

function servicio(ordenes: OrdenFake[], envios: EnvioFake[]) {
  const prisma = {
    order: { findMany: jest.fn().mockResolvedValue(ordenes) },
    shipmentRequest: { findMany: jest.fn().mockResolvedValue(envios) },
  };
  const service = new AdminService(
    prisma as unknown as PrismaService,
    {} as PricingService,
    new PiiCryptoService(new ConfigService({})),
    {} as any,
  );
  return { service, prisma };
}

describe('P&L — DEPLOY 1 (§4.44.j): neutralidad demostrada + `D-IVA-5`', () => {
  // ===========================================================================================
  // (A) ⭐⭐ NEUTRALIDAD — la promesa entera del deploy 1
  // ===========================================================================================
  describe('⭐⭐ (A) el P&L da EXACTAMENTE lo mismo que antes del pase', () => {
    /**
     * Escenarios de SOLO bóveda (cero `direct_ship`): ahí `D-IVA-5` no aporta nada por definición,
     * así que las SEIS cifras tienen que coincidir con el algoritmo viejo **al centavo**.
     */
    const escenarios: { nombre: string; ordenes: OrdenFake[]; envios: EnvioFake[] }[] = [
      { nombre: 'base vacía', ordenes: [], envios: [] },
      { nombre: 'una orden, sin envíos', ordenes: [orden()], envios: [] },
      { nombre: 'sin órdenes, un envío', ordenes: [], envios: [envio()] },
      {
        nombre: 'los importes reales de la base de desarrollo (3 órdenes iguales)',
        ordenes: [
          orden({ subtotalCents: 115000, ivaCents: 21200, processingFeeCents: 24562 }),
          orden({ subtotalCents: 115000, ivaCents: 21200, processingFeeCents: 24562 }),
          orden({ subtotalCents: 115000, ivaCents: 21200, processingFeeCents: 24562 }),
        ],
        envios: [],
      },
      {
        nombre: 'mezcla con costo de envío capturado y sin capturar',
        ordenes: [orden(), orden({ subtotalCents: 250000, ivaCents: 40000, processingFeeCents: 11000 })],
        envios: [envio(), envio({ shippingCostCents: 0 })],
      },
      {
        nombre: 'COGS ausente (pieza sin costo de adquisición ⇒ 0, no null)',
        ordenes: [orden({ items: [{ inventoryItem: { acquisitionCostCents: null } }] })],
        envios: [envio()],
      },
      {
        nombre: 'orden con varias líneas',
        ordenes: [
          orden({
            subtotalCents: 33333,
            items: [
              { inventoryItem: { acquisitionCostCents: 100 } },
              { inventoryItem: { acquisitionCostCents: 20000 } },
              { inventoryItem: { acquisitionCostCents: null } },
            ],
          }),
        ],
        envios: [],
      },
    ];

    it.each(escenarios)('$nombre — las SEIS cifras son idénticas a las del algoritmo viejo', async ({ ordenes, envios }) => {
      const { service } = servicio(ordenes, envios);
      expect(await service.pnl()).toEqual(pnlLegacy(ordenes, envios));
    });

    it('⭐ y sobre 200 escenarios generados al azar (solo bóveda), también', async () => {
      // Un `it.each` fijo prueba los casos que se me ocurrieron; esto prueba los que no.
      let semilla = 20260909;
      const rnd = (max: number) => {
        semilla = (semilla * 1103515245 + 12345) % 2147483648;
        return semilla % max;
      };
      for (let caso = 0; caso < 200; caso++) {
        const ordenes = Array.from({ length: rnd(5) }, () =>
          orden({
            subtotalCents: rnd(500000),
            ivaCents: rnd(80000),
            processingFeeCents: rnd(30000),
            items: Array.from({ length: rnd(4) }, () => ({
              inventoryItem: { acquisitionCostCents: rnd(3) === 0 ? null : rnd(200000) },
            })),
          }),
        );
        const envios = Array.from({ length: rnd(4) }, () =>
          envio({ shippingFeeCents: rnd(50000), shippingCostCents: rnd(30000), processingFeeCents: rnd(3000) }),
        );
        const { service } = servicio(ordenes, envios);
        expect(await service.pnl()).toEqual(pnlLegacy(ordenes, envios));
      }
    });

    it('⭐ el CSV del P&L reserializa esas mismas cifras (no es un quinto sitio, §4.44.j)', async () => {
      const ordenes = [orden(), orden({ subtotalCents: 250000, ivaCents: 40000 })];
      const envios = [envio()];
      const { service } = servicio(ordenes, envios);
      const esperado = pnlLegacy(ordenes, envios);
      const [header, row] = (await service.exportCsv('pnl')).trim().split('\n');
      expect(header).toBe(
        'report,incomeCents,shippingRevenueCents,cogsCents,stripeFeesCents,shippingCostCents,profitCents',
      );
      expect(row).toBe(
        `pnl,${esperado.incomeCents},${esperado.shippingRevenueCents},${esperado.cogsCents},` +
          `${esperado.stripeFeesCents},${esperado.shippingCostCents},${esperado.profitCents}`,
      );
    });
  });

  // ===========================================================================================
  // (B) `D-IVA-5` — el sumando que faltaba
  // ===========================================================================================
  describe('⭐ (B) `D-IVA-5`: el ingreso de envío de los pedidos `direct_ship` ya se cuenta', () => {
    /**
     * Fixture que reproduce el defecto real: un pedido de invitado con envío directo cobra el envío
     * DENTRO de la orden (`Order.shippingFeeCents = 20300`), y su `ShipmentRequest` de fulfillment
     * lleva `shippingFeeCents = 0` **a propósito** para no contar dos veces — pero además su
     * `shippingCostCents` SÍ se captura. Antes de este pase: ingreso 0, costo 9000.
     */
    const directShip = orden({ fulfillmentMode: 'direct_ship', shippingFeeCents: 20300 });
    const fulfillment = envio({ shippingFeeCents: 0, ivaCents: 0, shippingCostCents: 9000, processingFeeCents: 0 });

    it('suma `Order.shippingFeeCents` a `shippingRevenueCents` — y el viejo daba 0', async () => {
      const { service } = servicio([directShip], [fulfillment]);
      const p = await service.pnl();
      expect(p.shippingRevenueCents).toBe(20300);
      // La medida del defecto: el algoritmo anterior perdía ese ingreso entero.
      expect(pnlLegacy([directShip], [fulfillment]).shippingRevenueCents).toBe(0);
      expect(p.shippingRevenueCents - pnlLegacy([directShip], [fulfillment]).shippingRevenueCents).toBe(20300);
    });

    it('⭐ el costo del envío ya se restaba: el defecto era que el P&L SUBESTIMABA la ganancia', async () => {
      const { service } = servicio([directShip], [fulfillment]);
      const p = await service.pnl();
      const viejo = pnlLegacy([directShip], [fulfillment]);
      expect(viejo.shippingCostCents).toBe(9000); // el costo SÍ se capturaba
      expect(p.shippingCostCents).toBe(9000); // y sigue igual
      expect(p.profitCents - viejo.profitCents).toBe(20300); // la ganancia sube por el ingreso que faltaba
    });

    it('⛔ NO entra en `incomeCents`: es ingreso de ENVÍO, no de mercancía', async () => {
      const { service } = servicio([directShip], [fulfillment]);
      const p = await service.pnl();
      expect(p.incomeCents).toBe(directShip.subtotalCents);
      expect(p.incomeCents).not.toBe(directShip.subtotalCents + 20300);
    });

    it('⛔ NO se cuenta dos veces cuando el envío de fulfillment trae tarifa 0 (invariante §4.21b)', async () => {
      const { service } = servicio([directShip], [fulfillment]);
      expect((await service.pnl()).shippingRevenueCents).toBe(20300);
    });

    it('⛔ una orden `vault` NO aporta envío (su `shippingFeeCents` es 0 por diseño)', async () => {
      const { service } = servicio([orden({ fulfillmentMode: 'vault', shippingFeeCents: 0 })], [envio()]);
      expect((await service.pnl()).shippingRevenueCents).toBe(17500);
    });

    it('⭐ CONTRA-CANDADO: una `vault` con tarifa distinta de 0 (corrupción) NO se cuela por este sumando', async () => {
      // El predicado es el MODO, no el importe. Si alguien lo relajara a «suma si shippingFeeCents>0»,
      // esto se pondría rojo — y con ello volvería el doble conteo que §4.21b evita.
      const { service } = servicio([orden({ fulfillmentMode: 'vault', shippingFeeCents: 99999 })], []);
      expect((await service.pnl()).shippingRevenueCents).toBe(0);
    });

    it('los dos ingresos de envío conviven y se SUMAN (bóveda + direct_ship)', async () => {
      const { service } = servicio([directShip, orden()], [envio(), fulfillment]);
      // 17500 (retiro de bóveda) + 0 (fulfillment) + 20300 (dentro de la orden)
      expect((await service.pnl()).shippingRevenueCents).toBe(17500 + 20300);
    });
  });

  // ===========================================================================================
  // (C) Lo que el helper garantiza hacia el deploy 2 — y el amarre contra el dial vivo
  // ===========================================================================================
  describe('(C) el neteo por convención ya está cableado, y solo mira columnas persistidas', () => {
    it('⭐⭐ el fixture de `IVA-5`: 10000 + 8621 + 10000 == 28621 (ni 31600 ni 26242)', async () => {
      // Es el candado del contrato, corrido aquí en su forma unitaria: dos órdenes `IVA_INCLUSIVE`
      // (dial 100 % y dial 0 %) más una histórica `IVA_EXCLUSIVE`.
      const ordenes = [
        orden({ subtotalCents: 11600, ivaCents: 1600, priceConvention: 'IVA_INCLUSIVE' }),
        orden({ subtotalCents: 10000, ivaCents: 1379, priceConvention: 'IVA_INCLUSIVE' }),
        orden({ subtotalCents: 10000, ivaCents: 1600, priceConvention: 'IVA_EXCLUSIVE' }),
      ];
      const { service } = servicio(ordenes, []);
      const p = await service.pnl();
      expect(p.incomeCents).toBe(28621);
      expect(p.incomeCents).not.toBe(31600); // contó el IVA como ingreso propio
      expect(p.incomeCents).not.toBe(26242); // neteó también la histórica
    });

    it('⭐ y el CSV lo repite', async () => {
      const ordenes = [
        orden({ subtotalCents: 11600, ivaCents: 1600, priceConvention: 'IVA_INCLUSIVE' }),
        orden({ subtotalCents: 10000, ivaCents: 1379, priceConvention: 'IVA_INCLUSIVE' }),
        orden({ subtotalCents: 10000, ivaCents: 1600, priceConvention: 'IVA_EXCLUSIVE' }),
      ];
      const { service } = servicio(ordenes, []);
      expect((await service.exportCsv('pnl')).trim().split('\n')[1]).toContain('pnl,28621,');
    });

    it('el ingreso de envío de bóveda también se netea por la convención de SU fila', async () => {
      const { service } = servicio([], [envio({ shippingFeeCents: 20300, ivaCents: 2800, priceConvention: 'IVA_INCLUSIVE' })]);
      expect((await service.pnl()).shippingRevenueCents).toBe(20300 - 2800);
    });

    it('⭐⭐ NO hay dial que mover: el servicio del P&L ni siquiera tiene acceso a `SettingsService`', async () => {
      // El amarre de `IVA-5` («se mueve el dial y las tres cifras NO se mueven») en su forma más
      // fuerte posible: no es que no lo lea — es que no lo tiene. Se asierta que las dos únicas
      // fuentes consultadas son las dos tablas, y ninguna fila de `ConfigSetting`.
      const ordenes = [orden(), orden({ priceConvention: 'IVA_INCLUSIVE', subtotalCents: 11600 })];
      const { service, prisma } = servicio(ordenes, [envio()]);
      const primero = await service.pnl();
      const segundo = await service.pnl();
      expect(segundo).toEqual(primero);
      expect((prisma as any).configSetting).toBeUndefined();
      expect(prisma.order.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.shipmentRequest.findMany).toHaveBeenCalledTimes(2);
    });

    it('⭐ una orden SIN convención hace REVENTAR el reporte (no lo deja mentir)', async () => {
      const { service } = servicio([{ ...orden(), priceConvention: undefined as never }], []);
      await expect(service.pnl()).rejects.toThrow(/unknown priceConvention/);
    });

    it('⭐ un ENVÍO sin convención también (la fila de envío no es un ciudadano de segunda)', async () => {
      const { service } = servicio([], [{ ...envio(), priceConvention: undefined as never }]);
      await expect(service.pnl()).rejects.toThrow(/unknown priceConvention/);
    });
  });
});
