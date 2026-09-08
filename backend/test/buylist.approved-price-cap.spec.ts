import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';

const pii = new PiiCryptoService(new ConfigService({}));

/**
 * B-4 / S-B5 (pentest) — Tope de `approvedPriceCents` en la decisión carta-por-carta.
 * Un `vault_operator`/admin NO puede aprobar un monto de SPEI arbitrario: el monto se
 * acota server-side a ≤ quotedPriceCents × 2 y ≤ tope AML por solicitud (300,000c default).
 */
function buildSettings(capPerRequest = 300_000): SettingsService {
  return {
    getNumber: jest.fn(async (key: string) => {
      if (key === 'buylist_cap_per_request_cents') return capPerRequest;
      return 0;
    }),
  } as unknown as SettingsService;
}

function buildService(item: any, settings = buildSettings()) {
  // v1.8-ronda-c: itemDecision ahora incluye sellRequest.userId (RB-3 cap por-KYC) y recalcula
  // approvedTotalCents (RB-6). El mock provee el include, kycProfile (sin override) y el aggregate.
  // v1.51.5 · BL-14: el `include` trae además el ESTADO de la solicitud, y la escritura del ítem es
  // un `updateMany` guardado (`count === 1`) seguido de una relectura.
  const withRel = {
    ...item,
    sellRequest: {
      userId: item.userId ?? 'u1',
      status: item.requestStatus ?? 'verificacion',
      // ⚠️ v1.58 · §M5-R (BL-39): la constancia de RECEPCIÓN. Estos fixtures deciden líneas de una
      // solicitud VIVA con la carta ya en nuestras manos; sin este dato describirían un escenario
      // imposible. El caso contrario es el sujeto de `buylist.m5r-received-approve.spec.ts`.
      receivedAt: item.receivedAt === undefined ? new Date('2026-09-02T00:00:00Z') : item.receivedAt,
      // ⚠️ v1.58 · BL-40: el DISCRIMINADOR del ciclo de oferta, que es el que decide qué cota aplica.
      // `null` por defecto = **cohorte legacy / fuera del ciclo**, que es el escenario de los tests de
      // arriba y donde la cota relativa `× 2` **sigue exactamente igual que antes de v1.58**.
      offerSentAt: item.offerSentAt ?? null,
    },
  };
  const live: any = { ...item };
  const prisma: any = {
    sellRequestItem: {
      findUnique: jest.fn(async (args: any) => (args?.include ? withRel : { ...live })),
      updateMany: jest.fn(async ({ data }: any) => {
        Object.assign(live, data);
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }: any) => ({ id: item.id, ...data })),
      aggregate: jest.fn().mockResolvedValue({
        _sum: { approvedPriceCents: 0 },
        _count: { approvedPriceCents: 0 },
      }),
    },
    sellRequest: { update: jest.fn(), updateMany: jest.fn(async () => ({ count: 1 })) },
    kycProfile: { findUnique: jest.fn().mockResolvedValue(item.kyc ?? null) },
    $transaction: jest.fn(async (cb: any, _opts?: any) => cb(prisma)),
  };
  const svc = new BuylistService(
    prisma as PrismaService,
    {} as PricingService,
    settings,
    {} as UsersService,
    pii,
  );
  return { svc, prisma };
}

describe('BuylistService.itemDecision — cota de approvedPriceCents (B-4)', () => {
  it('RECHAZA aprobar muy por encima de lo cotizado (PoC: monto arbitrario)', async () => {
    const { svc, prisma } = buildService({
      id: 'sri-1',
      quotedPriceCents: 5000,
      itemStatus: 'verificacion',
      sellRequestId: 'sr-1',
    });
    await expect(svc.itemDecision('sri-1', 'approve', 99_999_999)).rejects.toMatchObject({
      code: 'APPROVED_PRICE_CAP_EXCEEDED',
    });
    expect(prisma.sellRequestItem.updateMany).not.toHaveBeenCalled();
  });

  it('RECHAZA un ajuste al alza por encima del tope AML por solicitud aunque no supere 2x', async () => {
    // quoted alto → cota relativa (2x = 800,000) > cota AML (300,000). Manda la AML.
    const { svc } = buildService({
      id: 'sri-2',
      quotedPriceCents: 400_000,
      itemStatus: 'verificacion',
      sellRequestId: 'sr-2',
    });
    await expect(svc.itemDecision('sri-2', 'adjust', 500_000)).rejects.toMatchObject({
      code: 'APPROVED_PRICE_CAP_EXCEEDED',
    });
  });

  it('ACEPTA un ajuste al alza normal dentro del factor (≤ 2x lo cotizado)', async () => {
    const { svc, prisma } = buildService({
      id: 'sri-3',
      quotedPriceCents: 5000,
      itemStatus: 'verificacion',
      sellRequestId: 'sr-3',
    });
    const res = await svc.itemDecision('sri-3', 'adjust', 8000); // 1.6x
    expect(res).toMatchObject({ itemStatus: 'ajustada', approvedPriceCents: 8000 });
    // v1.51.5 · BL-14: el plazo de 7d también se escribe GUARDADO (`updateMany`), y DESPUÉS de la
    // decisión — antes se ponía primero y suelto, así que sobre una solicitud cerrada quedaba puesto
    // aunque la decisión no prosperara.
    expect(prisma.sellRequest.updateMany).toHaveBeenCalled();
  });

  it('ACEPTA aprobar el precio cotizado tal cual (flujo normal intacto)', async () => {
    const { svc } = buildService({
      id: 'sri-4',
      quotedPriceCents: 5000,
      itemStatus: 'verificacion',
      sellRequestId: 'sr-4',
    });
    const res = await svc.itemDecision('sri-4', 'approve');
    expect(res).toMatchObject({ itemStatus: 'aprobada', approvedPriceCents: 5000 });
  });

  it('sin quotedPriceCents (precio_pendiente) usa solo la cota AML: rechaza por encima del tope', async () => {
    const { svc } = buildService({
      id: 'sri-5',
      quotedPriceCents: null,
      itemStatus: 'verificacion',
      sellRequestId: 'sr-5',
    });
    await expect(svc.itemDecision('sri-5', 'approve', 300_001)).rejects.toMatchObject({
      code: 'APPROVED_PRICE_CAP_EXCEEDED',
    });
  });
});

// =============================================================================================
/**
 * ⚠️⚠️ v1.58 · **BL-40 — DENTRO DEL CICLO LA COTA PIERDE SU TÉRMINO RELATIVO.** DINERO.
 *
 * ### El defecto, con los números ordinarios del contrato
 * Dentro del ciclo `approve` **no acepta monto**: lo **deriva** de `offeredPriceCents` (D2,
 * inmutable) — **y aun así lo pasaba por `min(quotedPriceCents × 2, capAML)`**. Con una línea
 * **cotizada en MX$300** y un **override motivado a MX$1,000** (bruto MX$1,000, muy por debajo del
 * tope AML de MX$3,000): **la oferta sale, el vendedor manda la carta, y `approve` la rechaza contra
 * una cota de MX$600.**
 *
 * ***Es la única de las cuatro sin remedio posible para el vendedor: ya se desprendió de su carta.***
 * Y el comentario del propio código lo delataba — aplicábamos una cota de *«defensa en profundidad,
 * no confianza en el origen»* **sobre un monto que nosotros mismos ya prometimos por correo**.
 *
 * ⛔ **NO se resuelve al revés** (imponer el `× 2` al ofertar): sería inventarle al negocio una cota
 * que `PROJECT.md` no tiene, y mataría el caso que el override existe para atender.
 *
 * | Mutación | Test que cae |
 * |---|---|
 * | volver a aplicar la cota relativa **dentro** del ciclo | «⭐ los números ordinarios …» |
 * | retirar la cota relativa **también fuera** del ciclo | «contracaso LEGACY …» |
 * | retirar **también** el tope AML dentro del ciclo | «el término `capAML` SE QUEDA …» |
 */
describe('⚠️⚠️ BL-40 — la cota de `approve` DENTRO del ciclo de oferta', () => {
  const EN_CICLO = new Date('2026-09-01T00:00:00Z');

  it('⭐ los números ordinarios: cotizada MX$300, oferta vinculante MX$1,000 ⇒ `approve` PASA', async () => {
    const { svc } = buildService({
      id: 'sri-bl40-1',
      sellRequestId: 'sr-bl40-1',
      itemStatus: 'verificacion',
      quotedPriceCents: 30_000, // MX$300
      offerSentAt: EN_CICLO, // ⇒ DENTRO del ciclo
      offerDecision: 'buy',
      offeredPriceCents: 100_000, // MX$1,000 — 3.3× la cotización, y MUY por debajo del tope AML
    });
    // Antes de v1.58 esto era `422 APPROVED_PRICE_CAP_EXCEEDED` contra una cota de MX$600, sobre una
    // oferta que ya le habíamos mandado por correo al vendedor.
    const res: any = await svc.itemDecision('sri-bl40-1', 'approve');
    expect(res).toMatchObject({ itemStatus: 'aprobada', approvedPriceCents: 100_000 });
  });

  it('el término `capAML` SE QUEDA dentro del ciclo (defensa en profundidad para filas malformadas)', async () => {
    // Tras §M5-A no puede disparar sobre una fila que pasó la emisión —cada línea ≤ el bruto ≤ el
    // tope—, así que su valor es cubrir legacy y filas malformadas. Que es para lo que sirve un
    // backstop: **se queda, y se comprueba que sigue vivo.**
    const { svc, prisma } = buildService({
      id: 'sri-bl40-2',
      sellRequestId: 'sr-bl40-2',
      itemStatus: 'verificacion',
      quotedPriceCents: 30_000,
      offerSentAt: EN_CICLO,
      offerDecision: 'buy',
      offeredPriceCents: 300_001, // un centavo por encima del tope AML
    });
    await expect(svc.itemDecision('sri-bl40-2', 'approve')).rejects.toMatchObject({
      code: 'APPROVED_PRICE_CAP_EXCEEDED',
      // Shape declarado en §M5 (v1.58): el que ya emitía el código.
      details: { approvedPriceCents: 300_001, quotedPriceCents: 30_000, cap: 300_000 },
    });
    expect(prisma.sellRequestItem.updateMany).not.toHaveBeenCalled();
  });

  it('el borde del AML dentro del ciclo es INCLUSIVO: el tope exacto se aprueba', async () => {
    const { svc } = buildService({
      id: 'sri-bl40-3',
      sellRequestId: 'sr-bl40-3',
      itemStatus: 'verificacion',
      quotedPriceCents: 30_000,
      offerSentAt: EN_CICLO,
      offerDecision: 'buy',
      offeredPriceCents: 300_000,
    });
    const res: any = await svc.itemDecision('sri-bl40-3', 'approve');
    expect(res).toMatchObject({ itemStatus: 'aprobada', approvedPriceCents: 300_000 });
  });

  it('contracaso LEGACY (`offerSentAt IS NULL`): MX$1,000 sobre una cotizada en MX$300 SIGUE dando `422`', async () => {
    // ⭐ El contra-control que el contrato exige explícitamente. Fuera del ciclo el monto **sí viene
    // del body** —lo teclea una persona— y la cota relativa es exactamente lo que tiene que acotarlo.
    // *BL-40 retira el término donde el monto es NUESTRO, no donde lo teclea alguien.*
    const { svc } = buildService({
      id: 'sri-bl40-4',
      sellRequestId: 'sr-bl40-4',
      itemStatus: 'verificacion',
      quotedPriceCents: 30_000,
      offerSentAt: null, // cohorte legacy
    });
    await expect(svc.itemDecision('sri-bl40-4', 'approve', 100_000)).rejects.toMatchObject({
      code: 'APPROVED_PRICE_CAP_EXCEEDED',
      details: { approvedPriceCents: 100_000, quotedPriceCents: 30_000, cap: 60_000 },
    });
  });

  it('`adjust` (que solo existe FUERA del ciclo) conserva su cota relativa intacta', async () => {
    const { svc } = buildService({
      id: 'sri-bl40-5',
      sellRequestId: 'sr-bl40-5',
      itemStatus: 'verificacion',
      quotedPriceCents: 30_000,
      offerSentAt: null,
    });
    await expect(svc.itemDecision('sri-bl40-5', 'adjust', 60_001)).rejects.toMatchObject({
      code: 'APPROVED_PRICE_CAP_EXCEEDED',
      details: { cap: 60_000 },
    });
    // …y el borde de la cota relativa sigue siendo inclusivo.
    const ok = buildService({
      id: 'sri-bl40-6',
      sellRequestId: 'sr-bl40-6',
      itemStatus: 'verificacion',
      quotedPriceCents: 30_000,
      offerSentAt: null,
    });
    const res: any = await ok.svc.itemDecision('sri-bl40-6', 'adjust', 60_000);
    expect(res).toMatchObject({ itemStatus: 'ajustada', approvedPriceCents: 60_000 });
  });
});
