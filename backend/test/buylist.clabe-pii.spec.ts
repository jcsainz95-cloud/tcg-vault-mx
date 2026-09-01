import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/**
 * PII en buylist:
 *  - Match CLABE "a nombre propio" por BLIND INDEX (HMAC), SIN descifrar.
 *  - Snapshot de CLABE persistido CIFRADO (nunca en claro en la columna).
 *  - Reveal on-demand: descifra la CLABE completa (18 dígitos) para pagar SPEI.
 *  - adminGet no expone la CLABE en claro (solo enmascarada).
 */
const CLABE_A = '012345678901234567';
const CLABE_B = '111122223333444455';

const pii = new PiiCryptoService(new ConfigService({}));

function pricingPending(): PricingService {
  return {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    // v2.1.1 (§4.36.5b): el seam de VENTA devuelve una DECISIÓN (monto + veredicto). El mock usa
    // el CUERPO REAL (`PricingService.prototype`): es puro y no toca `this`, así que el test no
    // puede divergir de producción ni reimplementar la matemática.
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    // v2.0 (P-48): con la curva, SIN mercado la línea queda `precio_pendiente` (el bin no gana) y eso
    // dispara el gate de INE de Fase 0.3 — ruido ajeno a lo que este spec verifica (CLABE/PII).
    getReference: jest.fn().mockResolvedValue({ status: 'priced', referenceMxnCents: 12500 }),
    // v2.0 (§4.36.5c): el MISMO seam escala Y cierra la cola.
    settlePendingForVariant: jest.fn(async () => undefined),
    escalatePending: jest.fn().mockResolvedValue(undefined),
    // v1.28 (P-18): controles por variante — sin filas M-30 por default (comportamiento previo).
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getVariantOverride: jest.fn(async () => null),
  } as unknown as PricingService;
}

function settings(): SettingsService {
  return {
    getRaw: jest.fn(async (key: string) =>
      key === 'buylist_price_rules' ? { Common: { mode: 'fixed', value: 50 } } : {},
    ),
    getNumber: jest.fn(async (key: string) => (key === 'buylist_price_fallback_pct' ? 40 : 100_000_000)),
  } as unknown as SettingsService;
}

describe('BuylistService — match CLABE por HMAC (sin descifrar)', () => {
  function buildPrisma(kycHmac: string | null) {
    let created: any;
    const prisma: any = {
      card: {
        findUnique: jest.fn().mockResolvedValue({ id: 'c', rarity: 'Common' }),
        // v2.1.1: `createRequest` carga las cartas EN LOTE (mata el N+1 que hacía un
        // `findUnique` por ítem). Delega en el MISMO `findUnique` del fixture (`this`).
        findMany: jest.fn(async function (this: any, args: any) {
          const ids: string[] = args?.where?.id?.in ?? [];
          const rows = await Promise.all(ids.map((id) => this.findUnique({ where: { id } })));
          return rows.filter(Boolean);
        }),
      },
      kycProfile: {
        findUnique: jest.fn().mockResolvedValue(
          kycHmac ? { userId: 'u', clabeHmac: kycHmac, clabeEnc: pii.encrypt(CLABE_A) } : null,
        ),
        upsert: jest.fn(async ({ create, update }: any) => {
          created = create ?? update;
        }),
      },
      sellRequest: {
        findMany: jest.fn(async () => []), // M-46 §4.39c: acumulado mensual = findMany+reduce (COALESCE de 2 columnas)
        create: jest.fn(async ({ data }: any) => ({ id: 'sr', status: data.status, quotedTotalCents: data.quotedTotalCents, clabeSnapshotEnc: data.clabeSnapshotEnc, items: [] })),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    return { prisma, getUpsert: () => created };
  }

  it('CLABE propia (mismo HMAC almacenado) → OK y snapshot CIFRADO', async () => {
    const { prisma } = buildPrisma(pii.clabeBlindIndex(CLABE_A));
    const svc = new BuylistService(prisma as PrismaService, pricingPending(), settings(), {} as UsersService, pii);
    const res = await svc.createRequest('u', [{ cardId: 'c', productType: 'raw' as any }], CLABE_A);
    expect(res.status).toBe('cotizada');
    // Snapshot persistido cifrado, no en claro.
    const snap = prisma.sellRequest.create.mock.calls[0][0].data.clabeSnapshotEnc;
    expect(snap).not.toContain(CLABE_A);
    expect(pii.decrypt(snap)).toBe(CLABE_A);
    // Se guardó el blind index, no la CLABE en claro.
    const upsertCreate = prisma.kycProfile.upsert.mock.calls[0][0].create;
    expect(upsertCreate.clabeHmac).toBe(pii.clabeBlindIndex(CLABE_A));
    expect(upsertCreate.clabeEnc).not.toContain(CLABE_A);
  });

  it('CLABE de tercero (HMAC distinto) → CLABE_NOT_OWN_NAME', async () => {
    const { prisma } = buildPrisma(pii.clabeBlindIndex(CLABE_A));
    const svc = new BuylistService(prisma as PrismaService, pricingPending(), settings(), {} as UsersService, pii);
    await expect(
      svc.createRequest('u', [{ cardId: 'c', productType: 'raw' as any }], CLABE_B),
    ).rejects.toMatchObject({ code: 'CLABE_NOT_OWN_NAME' });
  });

  it('sin KYC previa: primera CLABE se acepta y fija el blind index', async () => {
    const { prisma } = buildPrisma(null);
    const svc = new BuylistService(prisma as PrismaService, pricingPending(), settings(), {} as UsersService, pii);
    const res = await svc.createRequest('u', [{ cardId: 'c', productType: 'raw' as any }], CLABE_A);
    expect(res.status).toBe('cotizada');
  });
});

describe('BuylistService.revealClabe — reveal on-demand para pagar', () => {
  it('descifra la CLABE COMPLETA del snapshot cifrado', async () => {
    const prisma: any = {
      sellRequest: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sr', userId: 'u', clabeSnapshotEnc: pii.encrypt(CLABE_A) }),
      },
      kycProfile: { findUnique: jest.fn() },
    };
    const svc = new BuylistService(prisma as PrismaService, {} as PricingService, {} as SettingsService, {} as UsersService, pii);
    const res = await svc.revealClabe('sr');
    expect(res).toEqual({ sellRequestId: 'sr', clabe: CLABE_A });
  });

  it('si el snapshot falta, cae a la CLABE cifrada de KYC', async () => {
    const prisma: any = {
      sellRequest: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sr', userId: 'u', clabeSnapshotEnc: null }),
      },
      kycProfile: { findUnique: jest.fn().mockResolvedValue({ clabeEnc: pii.encrypt(CLABE_B) }) },
    };
    const svc = new BuylistService(prisma as PrismaService, {} as PricingService, {} as SettingsService, {} as UsersService, pii);
    const res = await svc.revealClabe('sr');
    expect(res.clabe).toBe(CLABE_B);
  });
});

describe('BuylistService.adminGet — nunca CLABE en claro', () => {
  it('devuelve clabeMasked y omite el snapshot cifrado', async () => {
    const prisma: any = {
      sellRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'sr',
          userId: 'u',
          status: 'recibida',
          clabeSnapshotEnc: pii.encrypt(CLABE_A),
          items: [],
        }),
      },
    };
    const svc = new BuylistService(prisma as PrismaService, {} as PricingService, {} as SettingsService, {} as UsersService, pii);
    const res: any = await svc.adminGet('sr');
    expect(res.clabeMasked).toBe('**************4567');
    expect(res.clabeSnapshotEnc).toBeUndefined();
    expect(JSON.stringify(res)).not.toContain(CLABE_A);
  });
});
