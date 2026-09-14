import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AdminService } from '../src/modules/admin/admin.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { netShippingCostCents, shipmentNetRevenueCents } from '../src/common/money';
import { stripComments } from './helpers/strip-comments';

/**
 * ⭐⭐ **`IVA-11` — EL COSTO DE ENVÍO: NETO CONTRA NETO, Y QUE EL `0` NO SIGNIFIQUE DOS COSAS.**
 * (`API_CONTRACT §M10-IVA.5` / `§M10-IVA.8`, D55(c)+(d), preguntas **68** y **69**;
 * `ARCHITECTURE §4.44.f-ter`.)
 *
 * **La regla del dueño, literal (2026-09-10):** *«el costo de envio con el iva que yo pague, tratalo
 * como si no hubiera margen»*.
 *
 * > ⚠️ Es un **tratamiento contable decidido por el dueño**, registrado con su fecha, y este
 * > proyecto **no tiene contador**. ⛔ Ni este fichero ni el código sostienen ninguna postura
 * > fiscal: **que él acredite ese IVA es afirmación SUYA**.
 *
 * ### Son DOS mitades y miden cosas DISTINTAS
 *  - ⭐ **(a) LA IDENTIDAD, exacta pero CONDICIONADA AL FIXTURE.** Cuando lo cobrado iguala a la
 *    factura del carrier, la línea neta de envío da **exactamente 0**. ⛔ **No es global y no debe
 *    serlo**: la tarifa se fija por tabla y el costo real varía por destino y peso ⇒ **un no-cero en
 *    producción es legítimo**. Asertarlo siempre sería `FX-20` otra vez: *un candado que rechaza
 *    conducta correcta*.
 *  - ⭐⭐ **(b) QUE EL `0` NO SIGNIFIQUE DOS COSAS.** `shippingCostCents` es `@default(0)` ⇒ «costó
 *    cero» y «no se capturó» son **indistinguibles**. ⛔ No se asierta que el importe sea distinto:
 *    se asierta que **el CONTADOR lo señala**. *Un candado que fingiera distinguirlas estaría
 *    midiendo un backfill inventado.*
 *  - **(c)** el crédito se **CAPTURA**, y el neto es una **RESTA** — ⛔ sin división por `(1+r)` ni
 *    lectura del dial vivo (`ShipmentRequest` no tiene `ivaRatePct`; derivarlo rompería `IVA-5`).
 *  - **(d)** **filas históricas**: `shippingCostIvaCents = 0` ⇒ `neto = bruto` (**dirección
 *    conservadora**). ⛔ Sin backfill.
 */

const R = 16;

type EnvioFake = {
  shippingFeeCents: number;
  shippingCostCents: number;
  shippingCostIvaCents: number;
  processingFeeCents: number;
  ivaCents: number;
  priceConvention: 'IVA_EXCLUSIVE' | 'IVA_INCLUSIVE';
};

const envio = (e: Partial<EnvioFake> = {}): EnvioFake => ({
  shippingFeeCents: 20_300,
  shippingCostCents: 20_300, // BRUTO: el importe TOTAL de la factura del carrier
  shippingCostIvaCents: 2_800, // el IVA acreditable, CONGELADO al capturar
  processingFeeCents: 0,
  ivaCents: 2_800,
  priceConvention: 'IVA_INCLUSIVE',
  ...e,
});

function servicio(envios: EnvioFake[]) {
  const prisma = {
    order: { findMany: jest.fn().mockResolvedValue([]) },
    shipmentRequest: { findMany: jest.fn().mockResolvedValue(envios) },
  };
  const service = new AdminService(
    prisma as unknown as PrismaService,
    {} as PricingService,
    new PiiCryptoService(new ConfigService({})),
    {} as never,
  );
  return { service, prisma };
}

describe('⭐⭐ `IVA-11` — el costo de envío se compara NETO contra NETO', () => {
  it('⭐⭐ (a) con la factura idéntica a lo cobrado, la línea neta de envío da EXACTAMENTE 0', async () => {
    const { service } = servicio([envio()]);
    const p = await service.pnl();
    expect(p.shippingRevenueCents).toBe(17_500);
    expect(p.shippingCostCents).toBe(17_500);
    expect(p.shippingRevenueCents - p.shippingCostCents).toBe(0);
  });

  it('⛔ (a-mutación) restar el costo BRUTO contra ingreso NETO da −2800: la PÉRDIDA FANTASMA', async () => {
    const { service } = servicio([envio()]);
    const p = await service.pnl();
    // Es literalmente lo que la decisión 68 del dueño existe para evitar, y la cifra que el contrato
    // nombra: **−2 800 en CADA envío**, en silencio, sin que nada falle.
    const bruto = 20_300;
    expect(p.shippingRevenueCents - bruto).toBe(-2_800);
    expect(p.shippingCostCents).not.toBe(bruto);
  });

  it('⛔ (a-alcance) el CERO ⛔ NO se asierta siempre: un no-cero en producción es LEGÍTIMO', async () => {
    // Tres razones legítimas de no-cero (§4.44.f-ter): redondeo, costo aún no capturado, y —la
    // grande— que **la tarifa se fija por tabla y el costo real del carrier varía por destino y
    // peso**. *«Trátalo como si no hubiera margen» es una INTENCIÓN, no una garantía por envío.*
    const { service } = servicio([envio({ shippingCostCents: 25_000, shippingCostIvaCents: 3_448 })]);
    const p = await service.pnl();
    expect(p.shippingRevenueCents - p.shippingCostCents).not.toBe(0);
    // Y aun así el P&L cuadra: el candado es de FÓRMULA, no de resultado.
    expect(p.shippingCostCents).toBe(25_000 - 3_448);
  });

  it('⭐⭐ (b) DOS envíos, uno con costo y otro en `0` ⇒ `shippingCostMissingCount == 1`', async () => {
    const { service } = servicio([envio(), envio({ shippingCostCents: 0, shippingCostIvaCents: 0 })]);
    const p = await service.pnl();
    expect(p.shippingCostMissingCount).toBe(1);
    // ⛔ Rojo si es `0`: *un cero silencioso convierte el ingreso de ese envío en ganancia fantasma,
    // y `@default(0)` lo produce sin que nadie escriba nada.*
    expect(p.shippingCostMissingCount).not.toBe(0);
  });

  it('⛔ (b-alcance) el contador SEÑALA; ⛔ NO afirma que el envío costara cero', async () => {
    // Para las filas existentes «costó cero» y «no se capturó» son **indistinguibles**. El contador
    // es **una señal para un humano** —«estos N envíos no tienen costo: revísalos»—, ⛔ no una
    // afirmación fiscal. Se comprueba que el importe NO se toca por estar en el censo.
    const { service } = servicio([envio({ shippingCostCents: 0, shippingCostIvaCents: 0 })]);
    const p = await service.pnl();
    expect(p.shippingCostMissingCount).toBe(1);
    expect(p.shippingCostCents).toBe(0); // el cero sigue siendo cero: nadie lo «corrige»
  });

  it('⭐ (c) el crédito se CAPTURA y el neto es una RESTA — ⛔ nunca `costo/(1+r)`', () => {
    expect(netShippingCostCents({ shippingCostCents: 20_300, shippingCostIvaCents: 2_800 })).toBe(17_500);
    // La mutación: derivar el crédito dividiendo por la tasa VIVA. Da un número **parecido** —y por
    // eso es peligrosa— pero depende de un dial que puede moverse después.
    const derivado = Math.round((20_300 * 100) / (100 + R));
    expect(derivado).toBe(17_500);
    // ⚠️ Aquí COINCIDEN, y ése es justo el motivo de que el candado sea estructural (abajo) y no
    // aritmético: *la mutación no se ve en el número, se ve en la dependencia.*
    expect(netShippingCostCents({ shippingCostCents: 20_300, shippingCostIvaCents: 0 })).toBe(20_300);
    expect(netShippingCostCents({ shippingCostCents: 20_300, shippingCostIvaCents: 0 })).not.toBe(derivado);
  });

  it('⭐⭐ (c-estructural) POR LO NEGATIVO: el P&L no divide por la tasa ni lee el dial', () => {
    const admin = stripComments(
      readFileSync(join(__dirname, '..', 'src', 'modules', 'admin', 'admin.service.ts'), 'utf8'),
    );
    // ⛔ Ninguna división del costo por `(1 + …)`.
    expect(admin).not.toMatch(/shippingCostCents\s*\/\s*\(?\s*1\s*\+/);
    // ⛔ Y el servicio **no tiene** `SettingsService`: no es que no lea el dial, es que no lo tiene.
    expect(admin).not.toMatch(/SettingsService/);
    // Y el neteo pasa por el helper único, que es una resta.
    expect(admin).toContain('netShippingCostCents(s)');
    const money = stripComments(readFileSync(join(__dirname, '..', 'src', 'common', 'money.ts'), 'utf8'));
    expect(money).toContain('return s.shippingCostCents - s.shippingCostIvaCents;');
  });

  it('⭐ (d) filas HISTÓRICAS: `shippingCostIvaCents = 0` ⇒ `neto = bruto`, dirección conservadora', async () => {
    const { service } = servicio([
      envio({ priceConvention: 'IVA_EXCLUSIVE', shippingFeeCents: 17_500, ivaCents: 2_800, shippingCostCents: 9_000, shippingCostIvaCents: 0 }),
    ]);
    const p = await service.pnl();
    expect(p.shippingCostCents).toBe(9_000);
    // ⭐ Conservadora = **subestima la ganancia, no la infla**. Con un crédito inventado
    // (`9000 × 16/116 = 1241`) la ganancia sería mayor: ⛔ eso es lo que NO se hace.
    expect(p.shippingCostCents).toBeGreaterThan(9_000 - Math.round((9_000 * 16) / 116));
  });

  it('⛔ (d-esquema) la columna NO es nullable: un `NULL` exigiría un backfill que INVENTA', () => {
    const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
    const modelo = (schema.match(/model ShipmentRequest \{[\s\S]*?\n\}/)?.[0] ?? '')
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//'))
      .join('\n');
    expect(modelo).toMatch(/shippingCostIvaCents\s+Int\s+@default\(0\)/);
    expect(modelo).not.toMatch(/shippingCostIvaCents\s+Int\?/);
    // ⭐ Y el hecho que OBLIGÓ a la columna: esta tabla sigue SIN `ivaRatePct`.
    expect(modelo).not.toMatch(/\bivaRatePct\b/);
  });

  it('⭐ el ingreso de envío de la MISMA fila también es neto, y por resta (no por dial)', () => {
    expect(shipmentNetRevenueCents({ shippingFeeCents: 20_300, ivaCents: 2_800, priceConvention: 'IVA_INCLUSIVE' })).toBe(17_500);
    // Fila de fulfillment de `direct_ship`: importes en cero **a propósito** ⇒ aporta 0.
    expect(shipmentNetRevenueCents({ shippingFeeCents: 0, ivaCents: 0, priceConvention: 'IVA_INCLUSIVE' })).toBe(0);
  });
});

/** ⭐ **EL CANARIO** — cada mutación reintroducida, con su cifra. */
describe('⭐ canario de `IVA-11`: la pérdida fantasma y el cero mudo, reproducidos', () => {
  it('⭐⭐ m1 — sumar el costo BRUTO reintroduce −2800 por envío, y la ganancia baja', async () => {
    const { service } = servicio([envio(), envio(), envio()]);
    const p = await service.pnl();
    const brutoTotal = 3 * 20_300;
    // El P&L bueno resta el neto; la mutación restaría el bruto ⇒ 8400 de pérdida inventada.
    expect(brutoTotal - p.shippingCostCents).toBe(8_400);
    expect(p.shippingRevenueCents - p.shippingCostCents).toBe(0);
  });

  it('⭐⭐ m2 — un contador que cuente `net === 0` en vez de `bruto === 0` MIENTE', () => {
    // La mutación sutil: contar sobre el NETO. Una factura de `2800` con crédito `2800` daría
    // `net = 0` y entraría en el censo **siendo una captura legítima**. El censo mide el dato
    // PRIMARIO (`shippingCostCents`), que es lo que el operador tecleó o dejó de teclear.
    const filas = [
      { shippingCostCents: 2_800, shippingCostIvaCents: 2_800 }, // capturado, neto 0
      { shippingCostCents: 0, shippingCostIvaCents: 0 }, // NO capturado
    ];
    const porNeto = filas.filter((f) => netShippingCostCents(f) === 0).length;
    const porBruto = filas.filter((f) => f.shippingCostCents === 0).length;
    expect(porNeto).toBe(2); // la mutación señalaría DOS
    expect(porBruto).toBe(1); // la buena señala UNO
    expect(porNeto).not.toBe(porBruto);
  });

  it('m3 — backfillear el crédito a `costo × 16/116` INFLA la ganancia (y la inventa)', async () => {
    const { service } = servicio([envio({ shippingCostCents: 9_000, shippingCostIvaCents: 0 })]);
    const p = await service.pnl();
    const backfilleado = 9_000 - Math.round((9_000 * 16) / 116);
    expect(p.shippingCostCents).toBe(9_000);
    expect(backfilleado).toBeLessThan(p.shippingCostCents);
    // ⇒ con el backfill, `profitCents` subiría 1 241 centavos por un crédito que **nadie verificó**.
    expect(p.shippingCostCents - backfilleado).toBe(1_241);
  });
});
