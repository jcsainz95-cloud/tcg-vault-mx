import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { BuylistRule } from '../src/common/money';
import { BatchQuoteDto, BUYLIST_QUOTE_BATCH_MAX } from '../src/modules/buylist/dto/buylist.dto';

/**
 * WS-C (v1.15-buylist-batch-clabe) — cobertura de backend:
 *  - CLABE opcional + fallback server-side (SOLO la CLABE propia; nunca la de otro usuario).
 *  - 422 CLABE_REQUIRED cuando no hay ni en request ni en archivo.
 *  - Batch quote: errores por-ítem (una carta inválida no tumba el lote; HTTP global 200),
 *    equivalencia numérica vs. el quote por-carta, y READ-ONLY (no escala pendientes).
 *  - `clabeOnFile` refleja el estado real.
 * PII: la CLABE en claro NUNCA aparece en la respuesta ni sin cifrar en el snapshot.
 */

const pii = new PiiCryptoService(new ConfigService({}));

const SEED: Record<string, BuylistRule> = {
  Common: { mode: 'fixed', value: 50 },
  Uncommon: { mode: 'fixed', value: 50 },
  'Reverse Holo': { mode: 'fixed', value: 150 },
};

/** Settings con caps/umbral MUY altos (no interfieren) y las reglas del seed. */
function settingsHighCaps(): SettingsService {
  return {
    getRaw: jest.fn(async (key: string) =>
      key === 'buylist_price_rules' ? SEED : {},
    ),
    getNumber: jest.fn(async (key: string) =>
      key === 'buylist_price_fallback_pct' ? 40 : 100_000_000,
    ),
  } as unknown as SettingsService;
}

// ---------------------------------------------------------------------------
// 1) CLABE opcional + fallback server-side (PII)
// ---------------------------------------------------------------------------

describe('createRequest — CLABE opcional + fallback server-side (§4.16a)', () => {
  const CLABE_OWN = '012345678901234567';
  const CLABE_OTHER = '999988887777666655';
  const VALID_CLABE = '111122223333444455';

  function pricingCotiza(): PricingService {
    return {
      gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
      // Common/normal usa regla FIJA, no depende de la referencia.
      getReference: jest.fn().mockResolvedValue({ status: 'pending' }),
      escalatePending: jest.fn().mockResolvedValue(undefined),
      // v1.28 (P-18): controles por variante — sin filas M-30 por default (comportamiento previo).
      getVariantOverridesBatch: jest.fn(async () => new Map()),
      getVariantOverride: jest.fn(async () => null),
    } as unknown as PricingService;
  }

  /**
   * Prisma con una KYC POR usuario: solo el `userId` consultado obtiene su propia fila. Prueba la
   * autorización estricta: el servicio jamás debe leer la KYC de otro usuario.
   */
  function buildPrisma(kycByUser: Record<string, { clabeEnc?: string; clabeHmac?: string } | null>) {
    const prisma: any = {
      card: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'c', rarity: 'Common', availableFinishes: ['normal'] }),
      },
      kycProfile: {
        findUnique: jest.fn(async ({ where }: any) => kycByUser[where.userId] ?? null),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      sellRequest: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { quotedTotalCents: 0 } }),
        create: jest.fn(async ({ data }: any) => ({
          id: 'sr',
          status: data.status,
          quotedTotalCents: data.quotedTotalCents,
          clabeSnapshotEnc: data.clabeSnapshotEnc,
          items: [],
        })),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    return prisma;
  }

  function svc(prisma: any): BuylistService {
    return new BuylistService(
      prisma as PrismaService,
      pricingCotiza(),
      settingsHighCaps(),
      {} as UsersService,
      pii,
    );
  }

  it('sin `clabe` en el body usa la CLABE PROPIA en archivo (fallback), snapshot CIFRADO', async () => {
    const prisma = buildPrisma({
      u1: { clabeEnc: pii.encrypt(CLABE_OWN), clabeHmac: pii.clabeBlindIndex(CLABE_OWN) },
      // Otro usuario con OTRA CLABE en archivo: jamás debe usarse para u1.
      u2: { clabeEnc: pii.encrypt(CLABE_OTHER), clabeHmac: pii.clabeBlindIndex(CLABE_OTHER) },
    });
    const res = await svc(prisma).createRequest('u1', [{ cardId: 'c', productType: 'raw' as any }]);
    expect(res.status).toBe('cotizada');

    // El snapshot descifra a la CLABE PROPIA (no la de u2), y NO está en claro en la columna.
    const snap = prisma.sellRequest.create.mock.calls[0][0].data.clabeSnapshotEnc;
    expect(snap).not.toContain(CLABE_OWN);
    expect(pii.decrypt(snap)).toBe(CLABE_OWN);

    // Autorización estricta: la KYC SIEMPRE se leyó por el userId autenticado, nunca por otro.
    for (const call of prisma.kycProfile.findUnique.mock.calls) {
      expect(call[0]).toEqual({ where: { userId: 'u1' } });
    }

    // Fallback: NO reescribe la CLABE en KYC (ya está en archivo); tampoco su HMAC.
    const upsertArg = prisma.kycProfile.upsert.mock.calls[0][0];
    expect(upsertArg.update.clabeEnc).toBeUndefined();
    expect(upsertArg.update.clabeHmac).toBeUndefined();

    // La respuesta NUNCA contiene la CLABE (ni en claro ni enmascarada).
    expect(JSON.stringify(res)).not.toContain(CLABE_OWN);
    expect(res).not.toHaveProperty('clabe');
  });

  it('con `clabe` en el body: comportamiento actual intacto (persiste clabeEnc+clabeHmac)', async () => {
    const prisma = buildPrisma({ u1: null });
    const res = await svc(prisma).createRequest(
      'u1',
      [{ cardId: 'c', productType: 'raw' as any }],
      VALID_CLABE,
    );
    expect(res.status).toBe('cotizada');
    const upsertCreate = prisma.kycProfile.upsert.mock.calls[0][0].create;
    expect(upsertCreate.clabeHmac).toBe(pii.clabeBlindIndex(VALID_CLABE));
    expect(upsertCreate.clabeEnc).not.toContain(VALID_CLABE);
    expect(pii.decrypt(upsertCreate.clabeEnc)).toBe(VALID_CLABE);
    // Snapshot = la CLABE del body, cifrada.
    const snap = prisma.sellRequest.create.mock.calls[0][0].data.clabeSnapshotEnc;
    expect(pii.decrypt(snap)).toBe(VALID_CLABE);
  });

  it('sin `clabe` y sin CLABE propia en archivo → 422 CLABE_REQUIRED (no crea solicitud)', async () => {
    // u1 no tiene CLABE; u2 SÍ — pero jamás debe alcanzarse la de u2.
    const prisma = buildPrisma({
      u1: { clabeEnc: undefined, clabeHmac: undefined },
      u2: { clabeEnc: pii.encrypt(CLABE_OTHER), clabeHmac: pii.clabeBlindIndex(CLABE_OTHER) },
    });
    await expect(
      svc(prisma).createRequest('u1', [{ cardId: 'c', productType: 'raw' as any }]),
    ).rejects.toMatchObject({ code: 'CLABE_REQUIRED' });
    expect(prisma.sellRequest.create).not.toHaveBeenCalled();
    // No se consultó (ni usó) la KYC de otro usuario.
    for (const call of prisma.kycProfile.findUnique.mock.calls) {
      expect(call[0]).toEqual({ where: { userId: 'u1' } });
    }
  });

  it('sin `clabe` y sin KYC alguna → 422 CLABE_REQUIRED', async () => {
    const prisma = buildPrisma({ u1: null });
    await expect(
      svc(prisma).createRequest('u1', [{ cardId: 'c', productType: 'raw' as any }]),
    ).rejects.toMatchObject({ code: 'CLABE_REQUIRED' });
  });

  it('con `clabe` de formato inválido en el body → 422 CLABE_INVALID (no fallback)', async () => {
    const prisma = buildPrisma({
      u1: { clabeEnc: pii.encrypt(CLABE_OWN), clabeHmac: pii.clabeBlindIndex(CLABE_OWN) },
    });
    await expect(
      svc(prisma).createRequest('u1', [{ cardId: 'c', productType: 'raw' as any }], '123'),
    ).rejects.toMatchObject({ code: 'CLABE_INVALID' });
  });
});

// ---------------------------------------------------------------------------
// 2) Batch quote — errores por-ítem, equivalencia y READ-ONLY
// ---------------------------------------------------------------------------

describe('batchQuote — errores por-ítem (§4.16b)', () => {
  const CARDS: Record<string, any> = {
    'c-ok': { id: 'c-ok', rarity: 'Common', availableFinishes: ['normal', 'reverse_holo', 'holofoil'] },
    'c-pending': { id: 'c-pending', rarity: 'Illustration Rare', availableFinishes: ['normal', 'holofoil'] },
    'c-bad-finish': { id: 'c-bad-finish', rarity: 'Common', availableFinishes: ['normal'] },
    // 'c-missing' → no existe
  };

  function buildSvc() {
    const escalatePending = jest.fn().mockResolvedValue(undefined);
    const prisma: any = {
      card: { findUnique: jest.fn(async ({ where }: any) => CARDS[where.id] ?? null) },
    };
    const pricing = {
      gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
      getReference: jest.fn(async (cardId: string) =>
        cardId === 'c-ok'
          ? { status: 'priced', referenceMxnCents: 12500 }
          : { status: 'pending' },
      ),
      escalatePending,
      // v1.28 (P-18): controles por variante — sin filas M-30 por default (comportamiento previo).
      getVariantOverridesBatch: jest.fn(async () => new Map()),
      getVariantOverride: jest.fn(async () => null),
    } as unknown as PricingService;
    const svc = new BuylistService(
      prisma as PrismaService,
      pricing,
      settingsHighCaps(),
      {} as UsersService,
      pii,
    );
    return { svc, escalatePending, prisma };
  }

  it('una carta inválida NO tumba el lote: mezcla ok/errores correlada por index', async () => {
    const { svc, escalatePending } = buildSvc();
    const { results } = await svc.batchQuote([
      { cardId: 'c-ok', productType: 'raw' as any, rawCondition: 'NM' as any, finish: 'normal' as any }, // 0
      { cardId: 'c-missing', productType: 'raw' as any }, // 1 → NOT_FOUND
      { cardId: 'c-bad-finish', productType: 'raw' as any, finish: 'reverse_holo' as any }, // 2 → FINISH_NOT_AVAILABLE
      { cardId: 'c-pending', productType: 'raw' as any, finish: 'holofoil' as any }, // 3 → ok, precio_pendiente
      { cardId: 'c-ok', productType: 'raw' as any, finish: 'reverse_holo' as any }, // 4 → ok, Reverse Holo $1.50
    ]);

    expect(results).toHaveLength(5);

    // index 0 — ok, Common normal → fixed $0.50
    expect(results[0]).toMatchObject({
      index: 0,
      cardId: 'c-ok',
      ok: true,
      finish: 'normal',
      appliedRule: { mode: 'fixed', value: 50, source: 'rule' },
      quote: { status: 'cotizada', quotedPriceCents: 50, currency: 'MXN' },
    });

    // index 1 — carta inexistente → NOT_FOUND por-ítem
    expect(results[1]).toMatchObject({
      index: 1,
      cardId: 'c-missing',
      ok: false,
      error: { code: 'NOT_FOUND' },
    });

    // index 2 — acabado no disponible → FINISH_NOT_AVAILABLE por-ítem
    expect(results[2]).toMatchObject({
      index: 2,
      cardId: 'c-bad-finish',
      ok: false,
      error: { code: 'FINISH_NOT_AVAILABLE' },
    });

    // index 3 — ok pero precio_pendiente (Illustration Rare premium, holofoil sin referencia)
    expect(results[3]).toMatchObject({
      index: 3,
      cardId: 'c-pending',
      ok: true,
      appliedRule: { mode: 'pct', value: 40, source: 'fallback' },
      quote: { status: 'precio_pendiente', quotedPriceCents: null, currency: 'MXN' },
      referencePrice: { status: 'pending' },
    });

    // index 4 — ok, Reverse Holo → fixed $1.50
    expect(results[4]).toMatchObject({
      index: 4,
      cardId: 'c-ok',
      ok: true,
      finish: 'reverse_holo',
      appliedRule: { mode: 'fixed', value: 150, source: 'rule' },
      quote: { status: 'cotizada', quotedPriceCents: 150, currency: 'MXN' },
    });

    // READ-ONLY: aunque hubo un precio_pendiente, NO escala a la cola del dueño (endpoint anónimo).
    expect(escalatePending).not.toHaveBeenCalled();
  });

  it('los mensajes de error por-ítem describen la causa sin fugar datos sensibles', async () => {
    const { svc } = buildSvc();
    const { results } = await svc.batchQuote([
      { cardId: 'c-bad-finish', productType: 'raw' as any, finish: 'reverse_holo' as any },
    ]);
    const r = results[0];
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.error.code).toBe('FINISH_NOT_AVAILABLE');
      expect(typeof r.error.message).toBe('string');
      expect(r.error.message.length).toBeGreaterThan(0);
    }
  });

  it('equivalencia numérica batch vs. quote por-carta (mismo monto por acabado)', async () => {
    const { svc } = buildSvc();
    const finishes: Array<'normal' | 'reverse_holo' | 'holofoil'> = [
      'normal',
      'reverse_holo',
      'holofoil',
    ];
    // Quote por-carta de referencia.
    const perCard = await Promise.all(
      finishes.map((f) => svc.publicQuote('c-ok', 'raw' as any, 'NM' as any, f as any)),
    );
    // Mismo conjunto en 1 request batch.
    const { results } = await svc.batchQuote(
      finishes.map((f) => ({ cardId: 'c-ok', productType: 'raw' as any, finish: f as any })),
    );
    finishes.forEach((_f, i) => {
      const row = results[i];
      expect(row.ok).toBe(true);
      if (row.ok === true) {
        const { index, cardId, ok, ...payload } = row;
        expect(index).toBe(i);
        expect(cardId).toBe('c-ok');
        expect(ok).toBe(true);
        // El payload del ítem es IDÉNTICO al del quote por-carta.
        expect(payload).toEqual(perCard[i]);
      }
    });
    // Sanidad de montos: normal $0.50, reverse $1.50, holofoil 40% de 12500 = $50.00.
    expect((results[0] as any).quote.quotedPriceCents).toBe(50);
    expect((results[1] as any).quote.quotedPriceCents).toBe(150);
    expect((results[2] as any).quote.quotedPriceCents).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// 3) DTO del batch — cap 50 / no vacío / ítem malformado (§4.16b)
// ---------------------------------------------------------------------------

describe('BatchQuoteDto — cap y validación (400 VALIDATION_ERROR)', () => {
  const validItem = (i: number) => ({ cardId: `card-${i}`, productType: 'raw' });

  async function errorsFor(items: unknown): Promise<string[]> {
    const dto = plainToInstance(BatchQuoteDto, { items });
    const errs = await validate(dto, { whitelist: true });
    // Aplana los nombres de constraints violados (incluye nested).
    const flat: string[] = [];
    const walk = (es: any[]) => {
      for (const e of es) {
        if (e.constraints) flat.push(...Object.keys(e.constraints));
        if (e.children?.length) walk(e.children);
      }
    };
    walk(errs);
    return flat;
  }

  it('cap = 50 (constante de servidor)', () => {
    expect(BUYLIST_QUOTE_BATCH_MAX).toBe(50);
  });

  it('items vacío → viola arrayNotEmpty', async () => {
    expect(await errorsFor([])).toContain('arrayNotEmpty');
  });

  it('items por encima del cap (51) → viola arrayMaxSize', async () => {
    const items = Array.from({ length: 51 }, (_v, i) => validItem(i));
    expect(await errorsFor(items)).toContain('arrayMaxSize');
  });

  it('exactamente el cap (50) es válido', async () => {
    const items = Array.from({ length: 50 }, (_v, i) => validItem(i));
    expect(await errorsFor(items)).toHaveLength(0);
  });

  it('1 ítem válido pasa', async () => {
    expect(await errorsFor([validItem(0)])).toHaveLength(0);
  });

  it('ítem malformado (sin cardId, productType inválido) → error nested', async () => {
    const errs = await errorsFor([{ productType: 'invalid' }]);
    expect(errs.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 4) clabeOnFile en GET /users/me/kyc (§4.16c)
// ---------------------------------------------------------------------------

describe('UsersService.getKyc — clabeOnFile refleja el estado real (§4.16c)', () => {
  function usersSvc(kyc: any): UsersService {
    const prisma: any = {
      kycProfile: { findUnique: jest.fn().mockResolvedValue(kyc) },
      sellRequest: { aggregate: jest.fn().mockResolvedValue({ _sum: { quotedTotalCents: 0 } }) },
    };
    const settings = {
      getNumber: jest.fn().mockResolvedValue(300_000),
    } as unknown as SettingsService;
    return new UsersService(prisma as PrismaService, settings, pii);
  }

  it('CLABE en archivo → clabeOnFile=true (y simétrico con ineOnFile)', async () => {
    const res = await usersSvc({
      kycStatus: 'pending',
      clabeEnc: pii.encrypt('012345678901234567'),
      ineFrontKey: 'k/front',
      ineBackKey: 'k/back',
    }).getKyc('u1');
    expect(res.clabeOnFile).toBe(true);
    expect(res.ineOnFile).toBe(true);
    // La CLABE se sigue devolviendo ENMASCARADA, nunca en claro.
    expect(res.clabeMasked).toBe('**************4567');
    expect(JSON.stringify(res)).not.toContain('012345678901234567');
  });

  it('sin CLABE en archivo (solo INE) → clabeOnFile=false', async () => {
    const res = await usersSvc({
      kycStatus: 'pending',
      clabeEnc: null,
      ineFrontKey: 'k/front',
      ineBackKey: 'k/back',
    }).getKyc('u1');
    expect(res.clabeOnFile).toBe(false);
    expect(res.ineOnFile).toBe(true);
  });

  it('sin KYC alguna → clabeOnFile=false e ineOnFile=false', async () => {
    const res = await usersSvc(null).getKyc('u1');
    expect(res.clabeOnFile).toBe(false);
    expect(res.ineOnFile).toBe(false);
  });
});
