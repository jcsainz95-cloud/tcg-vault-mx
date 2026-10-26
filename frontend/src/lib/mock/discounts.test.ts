import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BATCH_ALPHABET,
  MOCK_DISCOUNT_THROTTLE,
  evaluateMockDiscount,
  mockArchiveCode,
  mockBatchCsv,
  mockCreateBatch,
  mockCreateCode,
  mockListCodes,
  mockPatchCode,
  mockSetBatchStatus,
  reserveMockDiscount,
  resetMockDiscounts,
  type DiscountOrderContext,
} from './discounts';
import {
  createGuestCheckoutSession,
  createShipment,
  getShipmentQuote,
  listDiscountCodes,
  setDiscountCodePaused,
} from '@/lib/api';

/**
 * El simulador de §DSC: lo que la pantalla necesita que el mock haga igual que el servidor (§DSC.5-§DSC.8). Las
 * cifras normativas están en `discounts.parity.test.ts`; aquí, la conducta.
 */

const ctx = (over: Partial<DiscountOrderContext> = {}): DiscountOrderContext => ({
  destination: 'direct_ship',
  customer: null,
  lines: [{ id: 'inv-a', kind: 'item', scope: 'raw', priceCents: 100000, quantity: 1 }],
  close: ({ subtotalCents }) => ({ ok: true, totalCents: subtotalCents, shippingWaivedCents: 0 }),
  ...over,
});

beforeEach(() => resetMockDiscounts());
afterEach(() => window.localStorage.removeItem('tcg.role'));

describe('§DSC.6 / criterio 907 — el genérico es UNO para los seis casos', () => {
  it('inexistente, archivado, pausado, vencido, programado, agotado y agotado-para-ti ⇒ el mismo objeto, byte a byte', () => {
    mockCreateCode({ code: 'ARCHIVO1', kind: 'percent', percentPct: 5 });
    const archived = mockListCodes({}).find((c) => c.code === 'ARCHIVO1')!;
    mockArchiveCode(archived.id);
    const mine = mockCreateCode({ code: 'UNAVEZ', kind: 'percent', percentPct: 5, maxUsesPerCustomer: 1 });
    reserveMockDiscount({ codeId: mine.id, customer: 'email:ana@correo.mx', kind: 'order', folio: 'TCG-1', discountCents: 1, shippingWaivedCents: 0, totalCents: 1 });
    const cases = [
      evaluateMockDiscount('NOEXISTE', ctx()),
      evaluateMockDiscount('ARCHIVO1', ctx()),
      evaluateMockDiscount('BOVEDA10', ctx()), // pausado
      evaluateMockDiscount('VERANO15', ctx()), // vencido
      evaluateMockDiscount('FUTURO30', ctx()), // programado
      evaluateMockDiscount('AGOTADO5', ctx()), // agotado
      evaluateMockDiscount('unavez', ctx({ customer: 'email:ana@correo.mx' })), // agotado para ESE cliente (y normaliza)
    ];
    for (const c of cases) expect(JSON.stringify(c.dto)).toBe('{"outcome":"invalid"}');
  });

  it('un código vigente que no encaja da su motivo (C6/C7) con `details` mínimos; el MISMO, re-cotizado, suma una sola vez', () => {
    // v1.110.3 (DCO-B9): el mismo `not_applicable` cotizado 20 veces suma 1 (no bloquea a quien llena el carrito al mínimo).
    for (let i = 0; i < 20; i++) {
      expect(evaluateMockDiscount('MINIMO2000', ctx()).dto).toEqual({
        outcome: 'not_applicable',
        code: 'MINIMO2000',
        reason: 'MIN_SUBTOTAL',
        details: { missingCents: 100000 },
      });
    }
    expect(evaluateMockDiscount('SEPT10', ctx()).dto.outcome).toBe('applied');
    // …y al llegar al mínimo, aplica.
    const full = ctx({ lines: [{ id: 'inv-a', kind: 'item', scope: 'raw', priceCents: 200000, quantity: 1 }] });
    expect(evaluateMockDiscount('MINIMO2000', full).dto.outcome).toBe('applied');
  });
});

describe('§DSC.6 / criterio 908 — límite de intentos', () => {
  it('DCO-B9 v1.110.3 (`HECHOS.md` 2026-10-26 «…cuenta como intento»): 10 códigos vigentes DISTINTOS que no aplican ⇒ bloqueo', () => {
    const t0 = Date.parse('2026-10-26T18:00:00Z');
    for (let i = 0; i < MOCK_DISCOUNT_THROTTLE.maxFailures; i++) {
      mockCreateCode({ code: `MINIMO${i}X`, kind: 'percent', percentPct: 10, minSubtotalCents: 900000 });
    }
    for (let i = 0; i < MOCK_DISCOUNT_THROTTLE.maxFailures; i++) {
      expect(evaluateMockDiscount(`MINIMO${i}X`, ctx({ now: t0 + i })).dto).toMatchObject({ outcome: 'not_applicable', reason: 'MIN_SUBTOTAL' });
    }
    expect(evaluateMockDiscount('SEPT10', ctx({ now: t0 + 1000 })).dto).toEqual({
      outcome: 'rate_limited',
      retryAfterSeconds: MOCK_DISCOUNT_THROTTLE.blockMin * 60,
    });
  });

  it('`not_applicable` e `invalid` suman juntos (9 inválidos + 1 que no aplica ⇒ bloqueo); `applied` no suma', () => {
    const t0 = Date.parse('2026-10-26T19:00:00Z');
    for (let i = 0; i < 20; i++) expect(evaluateMockDiscount('SEPT10', ctx({ now: t0 })).dto.outcome).toBe('applied');
    for (let i = 0; i < MOCK_DISCOUNT_THROTTLE.maxFailures - 1; i++) evaluateMockDiscount(`MAL${i}XX`, ctx({ now: t0 + i }));
    expect(evaluateMockDiscount('SEPT10', ctx({ now: t0 + 100 })).dto.outcome).toBe('applied');
    evaluateMockDiscount('MINIMO2000', ctx({ now: t0 + 200 }));
    expect(evaluateMockDiscount('SEPT10', ctx({ now: t0 + 300 })).dto.outcome).toBe('rate_limited');
  });

  it('10 fallidos ⇒ el 11.º, aun con código válido, da `rate_limited` con `retryAfterSeconds`; vencido el bloqueo, aplica', () => {
    const t0 = Date.parse('2026-10-25T18:00:00Z');
    for (let i = 0; i < MOCK_DISCOUNT_THROTTLE.maxFailures; i++) evaluateMockDiscount(`MAL${i}XX`, ctx({ now: t0 + i }));
    const blocked = evaluateMockDiscount('SEPT10', ctx({ now: t0 + 1000 }));
    expect(blocked.dto).toEqual({ outcome: 'rate_limited', retryAfterSeconds: MOCK_DISCOUNT_THROTTLE.blockMin * 60 });
    const later = evaluateMockDiscount('SEPT10', ctx({ now: t0 + (MOCK_DISCOUNT_THROTTLE.blockMin * 60 + 5) * 1000 }));
    expect(later.dto.outcome).toBe('applied');
  });
});

describe('§DSC.8 — retiro de bóveda (P-DSC-3 = a, `HECHOS.md` 2026-10-25)', () => {
  it('envío gratis ⇒ desglose en ceros, `shippingWaivedCents` = la tarifa de hoy; `POST /shipments` ⇒ picking sin Stripe', async () => {
    const plain = await getShipmentQuote(['inv-1002'], 'addr-1');
    const q = await getShipmentQuote(['inv-1002'], 'addr-1', 'ENVIO25');
    expect(q.discount).toEqual({
      outcome: 'applied',
      code: 'ENVIO25',
      kind: 'free_shipping',
      merchandiseBeforeDiscountCents: 0,
      discountCents: 0,
      shippingWaivedCents: plain.breakdown.subtotalCents,
    });
    expect(q.breakdown).toMatchObject({ subtotalCents: 0, ivaCents: 0, processingFeeCents: 0, totalCents: 0 });
    const res = await createShipment(['inv-1002'], 'addr-1', 'ENVIO25');
    expect(res).toMatchObject({ status: 'picking', stripe: null, breakdown: { totalCents: 0 }, discount: { code: 'ENVIO25' } });
  });

  it('% o monto ⇒ WITHDRAWAL_ONLY_FREE_SHIPPING (C13b) y el cobro de hoy; la sesión ⇒ 422 sin crear nada', async () => {
    const plain = await getShipmentQuote(['inv-1002'], 'addr-1');
    const q = await getShipmentQuote(['inv-1002'], 'addr-1', 'SEPT10');
    expect(q.discount).toMatchObject({ outcome: 'not_applicable', reason: 'WITHDRAWAL_ONLY_FREE_SHIPPING' });
    expect(q.breakdown).toEqual(plain.breakdown);
    await expect(createShipment(['inv-1002'], 'addr-1', 'SEPT10')).rejects.toMatchObject({
      status: 422,
      code: 'DISCOUNT_CODE_NOT_APPLICABLE',
      details: { reason: 'WITHDRAWAL_ONLY_FREE_SHIPPING' },
    });
  });
});

describe('§DSC.6 — la sesión re-valida: `422`/`429` sin crear nada', () => {
  it('invitado con un código que ya no aplica ⇒ 422 DISCOUNT_CODE_INVALID (genérico, sin `details`)', async () => {
    await expect(
      createGuestCheckoutSession({
        inventoryItemIds: ['inv-1001'],
        email: 'ana@correo.mx',
        shippingAddress: { recipientName: 'Ana', line1: 'Calle 1', neighborhood: 'Centro', city: 'CDMX', state: 'CDMX', postalCode: '06000', country: 'MX', phone: '5512345678' },
        acceptedTerms: true,
        fulfillmentMode: 'direct_ship',
        discountCode: 'BOVEDA10',
      }),
    ).rejects.toMatchObject({ status: 422, code: 'DISCOUNT_CODE_INVALID', details: undefined });
  });
});

describe('§DSC.7 — panel del dueño (mock)', () => {
  it('912: con un uso apartado, tipo/valor/filtros ⇒ 409 LOCKED; fin y usos totales ≥ en uso ⇒ 200; por debajo ⇒ 409', () => {
    const c = mockCreateCode({ code: 'BLOQUEO1', kind: 'percent', percentPct: 10, maxTotalUses: 5 });
    reserveMockDiscount({ codeId: c.id, customer: 'user:u1', kind: 'order', folio: 'TCG-2', discountCents: 1, shippingWaivedCents: 0, totalCents: 1 });
    reserveMockDiscount({ codeId: c.id, customer: 'user:u2', kind: 'order', folio: 'TCG-3', discountCents: 1, shippingWaivedCents: 0, totalCents: 1 });
    expect(() => mockPatchCode(c.id, { percentPct: 20 })).toThrow(expect.objectContaining({ status: 409, code: 'DISCOUNT_CODE_LOCKED', details: { lockedFields: ['percentPct'] } }));
    expect(() => mockPatchCode(c.id, { productScopes: ['sealed'] })).toThrow(expect.objectContaining({ code: 'DISCOUNT_CODE_LOCKED' }));
    expect(mockPatchCode(c.id, { maxTotalUses: 2, endsAt: '2030-01-01T06:01:00.000Z' }).maxTotalUses).toBe(2);
    expect(() => mockPatchCode(c.id, { maxTotalUses: 1 })).toThrow(expect.objectContaining({ code: 'DISCOUNT_CODE_LIMIT_BELOW_USES', details: { inUse: 2 } }));
    expect(() => mockArchiveCode(c.id)).toThrow(expect.objectContaining({ code: 'DISCOUNT_CODE_HAS_USES' }));
  });

  it('911: lote de 50 ⇒ 50 textos distintos `PREFIJO-` + 10 del alfabeto, CSV de 50; pausar el lote pausa los N', () => {
    const { batch } = mockCreateBatch({ prefix: 'EVENTO', quantity: 50, kind: 'fixed_amount', amountCents: 10000 });
    const codes = mockListCodes({ batchId: batch.id });
    expect(new Set(codes.map((c) => c.code)).size).toBe(50);
    for (const c of codes) {
      expect(c.code).toMatch(new RegExp(`^EVENTO-[${BATCH_ALPHABET}]{10}$`));
      expect(c).toMatchObject({ maxTotalUses: 1, maxUsesPerCustomer: 1 });
    }
    expect(mockListCodes({}).some((c) => c.batchId === batch.id)).toBe(false); // sin `batchId` excluye los de lote
    expect(mockBatchCsv(batch.id).trim().split('\n')).toHaveLength(51);
    reserveMockDiscount({ codeId: codes[0].id, customer: 'user:u', kind: 'order', folio: 'TCG-4', discountCents: 1, shippingWaivedCents: 0, totalCents: 1 });
    expect(mockSetBatchStatus(batch.id, 'paused').status).toBe('paused');
    const after = mockListCodes({ batchId: batch.id });
    expect(after.filter((c) => c.status === 'paused')).toHaveLength(50);
    expect(evaluateMockDiscount(codes[1].code, ctx()).dto).toEqual({ outcome: 'invalid' });
  });

  it('890 / DL7: el operador recibe 403 FORBIDDEN y no se escribe nada', async () => {
    window.localStorage.setItem('tcg.role', 'vault_operator');
    await expect(listDiscountCodes()).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    await expect(setDiscountCodePaused('dsc-sept10', true)).rejects.toMatchObject({ status: 403 });
    window.localStorage.removeItem('tcg.role');
    expect((await listDiscountCodes()).data.find((c) => c.code === 'SEPT10')?.status).toBe('active');
  });
});
