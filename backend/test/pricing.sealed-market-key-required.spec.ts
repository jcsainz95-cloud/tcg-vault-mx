import { PricingController } from '../src/modules/pricing/pricing.controller';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { ErrorCode } from '../src/common/error-codes';

/**
 * v1.70 (P-83 · API_CONTRACT §M2-SK norma **SK-3** · §0 `SEALED_MARKET_KEY_REQUIRED`) —
 * **`'sealed'` es una clave de COLA, nunca una clave de PRECIO.**
 *
 * `POST /admin/pricing/override` con `productType:"sealed"` y `gradeKey:"sealed"` (la constante legada
 * que usa la pieza SIN mapeo) ⇒ **`422 SEALED_MARKET_KEY_REQUIRED`**,
 * `details: { gradeKey: "sealed", remedy: "map_or_price_the_piece" }`.
 *
 * La escritura que esto rechaza «funcionaba» y no servía, dos veces: la fila no la lee nadie (la
 * publicación lee `sealed:tcg:<productId>`) y no distingue un producto de otro (un ETB y un blíster
 * anclados a la misma `Card` comparten fila). Lo que se mide aquí no es solo el código: es que
 * **la tabla de dinero NO se toca** y que **no se dispara la publicación**.
 */

const REF = {
  id: 'pr-1',
  capturedDate: new Date('2026-09-28T00:00:00.000Z'),
  source: 'manual' as const,
  gradeKey: 'sealed:tcg:4242',
  productType: 'sealed' as const,
  priceMxnCents: 150_000,
  isManualOverride: true,
};

function build() {
  const pricing = {
    manualOverride: jest.fn(async () => REF),
    applyManualOverride: jest.fn(async () => ({ ref: REF, before: null })),
    publishedSlabsForGradeKey: jest.fn(async () => []),
  } as unknown as PricingService;
  const audit = { log: jest.fn(async () => undefined) } as unknown as AuditService;
  const prisma = { card: { findUnique: jest.fn(async () => ({ id: 'c1' })) } };
  const ctrl = new PricingController(
    pricing, {} as never, {} as never, audit, prisma as never, {} as never, {} as never, {} as never,
  );
  // Disparador (c) post-escritura: si se llamara, el rechazo habría llegado tarde.
  const trigger = jest
    .spyOn(ctrl as unknown as { triggerPublishForVariant: () => Promise<void> }, 'triggerPublishForVariant')
    .mockResolvedValue(undefined);
  return { ctrl, pricing, audit, prisma, trigger };
}

const sealedBody = (over: Record<string, unknown> = {}) => ({
  cardId: 'c1',
  productType: 'sealed',
  gradeKey: 'sealed',
  priceMxnCents: 150_000,
  ...over,
});

describe('POST /admin/pricing/override — SK-3: sellado SIN clave de mercado ⇒ 422 SEALED_MARKET_KEY_REQUIRED', () => {
  it('el código existe en el catálogo estable de errores (§0)', () => {
    expect((ErrorCode as Record<string, string>).SEALED_MARKET_KEY_REQUIRED).toBe('SEALED_MARKET_KEY_REQUIRED');
  });

  it("productType:'sealed' + gradeKey:'sealed' ⇒ 422 con el details del contrato, y NO se escribe dinero", async () => {
    const { ctrl, pricing, audit, trigger } = build();
    const err: any = await ctrl.override(sealedBody() as never, 'admin-1').catch((e) => e);
    expect(err).toMatchObject({ code: 'SEALED_MARKET_KEY_REQUIRED', status: 422 });
    // `details` EXACTO: el front decide las dos salidas con `remedy`; una llave de más o de menos es
    // un cambio de forma que el contrato no declaró.
    expect(err.details).toEqual({ gradeKey: 'sealed', remedy: 'map_or_price_the_piece' });
    expect(pricing.applyManualOverride).not.toHaveBeenCalled();
    expect(pricing.manualOverride).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'pricing.override' }));
    expect(trigger).not.toHaveBeenCalled();
  });

  it('el mensaje dice QUÉ hacer: mapear la pieza o fijar el precio de ESA pieza (listPriceCents)', async () => {
    const { ctrl } = build();
    const err: any = await ctrl.override(sealedBody() as never, 'admin-1').catch((e) => e);
    expect(err.message).toMatch(/mape/i);
    expect(err.message).toContain('listPriceCents');
  });

  it('el rechazo no depende de acabado ni de intent (no hay variante del body que lo esquive)', async () => {
    const { ctrl, pricing } = build();
    for (const over of [
      { finish: 'normal' },
      { finish: 'reverse_holo' },
      { intent: 'market' },
      { intent: 'graded_estimate' },
    ]) {
      await expect(ctrl.override(sealedBody(over) as never, 'admin-1')).rejects.toMatchObject({
        code: 'SEALED_MARKET_KEY_REQUIRED',
      });
    }
    expect(pricing.applyManualOverride).not.toHaveBeenCalled();
  });

  it("el rechazo se decide por el body: ni siquiera consulta la carta (sin viaje a BD para un 422 de forma)", async () => {
    const { ctrl, prisma } = build();
    await ctrl.override(sealedBody() as never, 'admin-1').catch(() => undefined);
    expect(prisma.card.findUnique).not.toHaveBeenCalled();
  });

  it("CONTROL: sellado MAPEADO (gradeKey 'sealed:tcg:<productId>') sigue escribiendo como hoy — 200", async () => {
    const { ctrl, pricing, trigger } = build();
    const res = await ctrl.override(sealedBody({ gradeKey: 'sealed:tcg:4242' }) as never, 'admin-1');
    expect(res).toHaveProperty('data');
    expect(pricing.applyManualOverride).toHaveBeenCalledTimes(1);
    expect((pricing.applyManualOverride as jest.Mock).mock.calls[0][0]).toMatchObject({
      productType: 'sealed',
      gradeKey: 'sealed:tcg:4242',
    });
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it("CONTROL: la llave 'sealed' en OTRO productType sigue siendo VALIDATION_ERROR (no se confunde con SK-3)", async () => {
    const { ctrl } = build();
    await expect(
      ctrl.override({ ...sealedBody(), productType: 'raw' } as never, 'admin-1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 422 });
  });

  it('CONTROL: una clave de sellado mal formada sigue siendo VALIDATION_ERROR, no SK-3', async () => {
    const { ctrl } = build();
    await expect(
      ctrl.override(sealedBody({ gradeKey: 'sealed:tcg:0' }) as never, 'admin-1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 422 });
  });
});
