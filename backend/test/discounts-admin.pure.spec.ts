/**
 * discounts-admin.pure.spec.ts — 💰 códigos de descuento, fase 2, la parte PURA (API_CONTRACT §DSC.4 v1.110.1, §DSC.6 «Dónde
 * se ve el pedido», §DSC.7). Propiedad: backend. Deterministas (N=1 dicho como tal). La mitad con Postgres vive en
 * `test/integration/discounts-admin.e2e-spec.ts` (DCO-B12…B15) y `test/integration/discounts.e2e-spec.ts` (DCO-B4/B5).
 *
 *  - DCO-B4 (puro, v1.110.1): dial de la clase en 0 ⇒ `ALREADY_FREE_SHIPPING`; orden `NO_SHIPPING → LARGE_BOX → ALREADY_FREE`.
 *  - Lote: `PREFIJO-` + 10 de `23456789ABCDEFGHJKMNPQRSTVWXYZ` (sin 0/O/1/I), distintos, colisión ⇒ se regenera.
 *  - `state` derivado: `paused > expired > scheduled > exhausted > live`; el lote, `paused ⇔ ningún sin usar active`.
 *  - CSV a salvo de fórmulas; pesos con 2 decimales; la fila `total` = el JSON; envío regalado separado pedido / retiro.
 *  - Entrada del dueño: campos por `kind`, desconocidos ⇒ 422 `{ field }`, por cliente 1 por defecto, lote sin límites.
 *  - Correo: la línea «Descuento (CÓDIGO)» y la de envío gratis; sin código ⇒ nada (I-1).
 *  - §DSC.0 I-3 (v1.110.1): `pricing-brackets` es el ÚNICO lector del original (`unitPriceCents + unitDiscountCents`).
 */
import { DiscountTerms } from '../src/common/money';
import { priceDirectShipCartWithCode, priceVaultCartWithCode, withdrawalCodeOutcome } from '../src/modules/discounts/discount-pricing';
import {
  BATCH_ALPHABET,
  DiscountReportDTO,
  ReportRedemption,
  batchCodesCsv,
  batchStateOf,
  batchStatusOf,
  batchSuffix,
  buildDiscountReport,
  codeStateOf,
  generateBatchCodes,
  reportCsv,
} from '../src/modules/discounts/discount-admin-view';
import {
  changedFields,
  diffSnapshots,
  parseBatchCreate,
  parseCodeCreate,
  parseConfigPatch,
  parsePreview,
} from '../src/modules/discounts/discount-admin-input';
import { discountMailRows, discountMailTextLines } from '../src/modules/orders/mail/order-notice.templates';
import { BusinessException } from '../src/common/business.exception';
import type { BoxChoice } from '../src/modules/orders/box-fit';
import { ConfigService } from '@nestjs/config';
import { AdminService } from '../src/modules/admin/admin.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { PricingService } from '../src/modules/pricing/pricing.service';
import type { UploadsService } from '../src/modules/uploads/uploads.service';

const FEE = { stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 };
const DIALS = { cardsFeeCents: 10000, sealedFeeCents: 17500, freeFromCents: 400000 };
const NOW = new Date('2026-10-25T18:00:00Z');
const FREE: DiscountTerms = { kind: 'free_shipping', percentPct: null, amountCents: null, maxDiscountCents: null, minSubtotalCents: null, productScopes: [], destinations: [] };
const raw = (id: string, P: number) => ({ id, group: 'piece' as const, type: 'raw' as const, unitPriceCents: P, quantity: 1 });

function fieldOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BusinessException);
    return ((e as BusinessException).details as { field?: string } | undefined)?.field;
  }
  throw new Error('no lanzó');
}

describe('DCO-B4 (puro, v1.110.1) — envío gratis con el dial de la clase en 0 no aplica', () => {
  it('cartas con `direct_ship_cards_fee_cents` = 0 ⇒ ALREADY_FREE_SHIPPING (nunca se gasta un uso sin beneficio)', () => {
    const p = priceDirectShipCartWithCode([raw('a', 50000)], FREE, { kind: 'cards_only', dials: { ...DIALS, cardsFeeCents: 0 }, choice: null }, 16, FEE);
    expect(p).toEqual({ outcome: 'not_applicable', reason: 'ALREADY_FREE_SHIPPING', details: {} });
  });

  it('sellado con su dial en 0 ⇒ ALREADY_FREE_SHIPPING; el de cartas en 0 no afecta al sellado', () => {
    const sealed = { id: 's', group: 'piece' as const, type: 'sealed' as const, unitPriceCents: 50000, quantity: 1 };
    expect(priceDirectShipCartWithCode([sealed], FREE, { kind: 'sealed', dials: { ...DIALS, sealedFeeCents: 0 }, choice: null }, 16, FEE)).toMatchObject({
      reason: 'ALREADY_FREE_SHIPPING',
    });
    expect(priceDirectShipCartWithCode([sealed], FREE, { kind: 'sealed', dials: { ...DIALS, cardsFeeCents: 0 }, choice: null }, 16, FEE)).toMatchObject({
      outcome: 'applied',
      shippingWaivedCents: 17500,
    });
  });

  it('orden de motivos: caja grande gana sobre el dial en 0 (LARGE_BOX); bóveda ⇒ NO_SHIPPING', () => {
    const choice = { box: { code: 'XL', label: 'XL', customerFeeCents: 35000 }, review: false } as unknown as BoxChoice;
    const acc = { id: 'x', group: 'accessory' as const, type: 'accessory' as const, unitPriceCents: 5000, quantity: 1 };
    expect(priceDirectShipCartWithCode([acc], FREE, { kind: 'sealed', dials: { ...DIALS, sealedFeeCents: 0 }, choice }, 16, FEE)).toMatchObject({ reason: 'LARGE_BOX' });
    expect(priceVaultCartWithCode([raw('a', 50000)], FREE, 16, FEE)).toMatchObject({ reason: 'NO_SHIPPING' });
  });

  it('retiro con el dial en 0 ⇒ ALREADY_FREE_SHIPPING; con dial > 0 ⇒ applied', () => {
    expect(withdrawalCodeOutcome(FREE, 0)).toEqual({ outcome: 'not_applicable', reason: 'ALREADY_FREE_SHIPPING', details: {} });
    expect(withdrawalCodeOutcome(FREE, 20300)).toEqual({ outcome: 'applied', shippingWaivedCents: 20300 });
  });
});

describe('§DSC.7 lote — alfabeto sin 0/O/1/I, aleatorio inyectable, sin repetidos', () => {
  it('el alfabeto es exactamente el del contrato (30 símbolos) y no trae 0, O, 1, I', () => {
    expect(BATCH_ALPHABET).toBe('23456789ABCDEFGHJKMNPQRSTVWXYZ');
    expect(BATCH_ALPHABET).toHaveLength(30);
    for (const c of '0O1I') expect(BATCH_ALPHABET.includes(c)).toBe(false);
  });

  it('500 códigos: todos `PREFIJO-` + 10 del alfabeto y distintos (aleatorio real, crypto.randomInt)', () => {
    const codes = generateBatchCodes('VERANO', 500);
    expect(new Set(codes).size).toBe(500);
    for (const c of codes) expect(c).toMatch(/^VERANO-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{10}$/);
  });

  it('el sufijo sale de la fuente aleatoria que recibe (por defecto crypto): rand ≡ 0 ⇒ «2222222222»', () => {
    expect(batchSuffix(() => 0)).toBe('2222222222');
    expect(batchSuffix(() => 29)).toBe('ZZZZZZZZZZ');
  });

  it('colisión con un texto tomado ⇒ se regenera (nunca devuelve uno de `taken`)', () => {
    let i = 0;
    const seq = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    const rand = () => seq[i++ % seq.length];
    expect(generateBatchCodes('AB', 1, new Set(['AB-2222222222']), rand)).toEqual(['AB-3333333333']);
  });
});

describe('§DSC.7 `state` derivado', () => {
  const base = { status: 'active' as const, startsAt: new Date('2026-10-01T00:00:00Z'), endsAt: new Date('2026-11-01T00:00:00Z'), maxTotalUses: 2 };
  it('paused > expired > scheduled > exhausted > live', () => {
    expect(codeStateOf(base, 0, NOW)).toBe('live');
    expect(codeStateOf(base, 2, NOW)).toBe('exhausted');
    expect(codeStateOf({ ...base, startsAt: new Date('2026-10-30T00:00:00Z') }, 2, NOW)).toBe('scheduled');
    expect(codeStateOf({ ...base, endsAt: NOW }, 2, NOW)).toBe('expired'); // endsAt EXCLUSIVO
    expect(codeStateOf({ ...base, status: 'paused', endsAt: NOW }, 2, NOW)).toBe('paused');
    expect(codeStateOf({ ...base, maxTotalUses: null }, 1000, NOW)).toBe('live');
  });

  it('lote: paused ⇔ ningún código sin usar está active; exhausted ⇔ todos consumidos', () => {
    expect(batchStatusOf([{ status: 'paused', used: false }, { status: 'active', used: true }])).toBe('paused');
    expect(batchStatusOf([{ status: 'paused', used: false }, { status: 'active', used: false }])).toBe('active');
    expect(batchStatusOf([{ status: 'active', used: true }])).toBe('active');
    const b = { status: 'active' as const, startsAt: base.startsAt, endsAt: null };
    expect(batchStateOf(b, 3, 3, NOW)).toBe('exhausted');
    expect(batchStateOf(b, 2, 3, NOW)).toBe('live');
    expect(batchStateOf({ ...b, status: 'paused' }, 3, 3, NOW)).toBe('paused');
  });
});

describe('§DSC.7 reporte y CSV', () => {
  const at = (iso: string) => new Date(iso);
  const red = (over: Partial<ReportRedemption>): ReportRedemption => ({
    code: 'VERANO10',
    status: 'consumed',
    createdAt: at('2026-10-20T10:00:00Z'),
    consumedAt: at('2026-10-20T10:05:00Z'),
    lateConsumed: false,
    customerEmail: 'ana@correo.mx',
    order: null,
    withdrawal: null,
    ...over,
  });
  const rows: ReportRedemption[] = [
    red({ order: { id: 'o1', orderNumber: 'TCG-1', discountCents: 5000, shippingWaivedCents: 10000, totalCents: 46010, refundedCents: 0 } }),
    red({ order: { id: 'o2', orderNumber: 'TCG-2', discountCents: 2500, shippingWaivedCents: 0, totalCents: 23005, refundedCents: 23005 }, lateConsumed: true }),
    red({ withdrawal: { folio: 'RET-1', shippingWaivedCents: 20300, totalCents: 0 }, order: null }),
    red({ status: 'reserved', consumedAt: null, order: { id: 'o3', orderNumber: 'TCG-3', discountCents: 9999, shippingWaivedCents: 9999, totalCents: 9999, refundedCents: 0 } }),
  ];

  it('el dinero cuenta solo `consumed`; envío regalado separado entre pedidos y retiros', () => {
    const r = buildDiscountReport(rows, 1, 10);
    expect(r).toMatchObject({
      consumed: 3,
      reservedNow: 1,
      limit: 10,
      paidOrders: 2,
      discountGivenCents: 7500,
      shippingWaivedOrdersCents: 10000,
      shippingWaivedWithdrawalsCents: 20300,
      withdrawals: 1,
      salesCollectedCents: 69015,
      refundedOrders: 1,
      refundedCents: 23005,
      lateConsumed: 1,
    });
    expect(r.rows).toHaveLength(4);
    expect(r.usedCodes).toBeUndefined();
    expect(buildDiscountReport(rows, 1, 10, { batch: true }).usedCodes).toHaveLength(3);
  });

  it('CSV: celdas de texto con fórmula ⇒ prefijo `\'`; pesos con 2 decimales; fila total = JSON', () => {
    const evil: DiscountReportDTO = buildDiscountReport(
      [red({ customerEmail: '=HYPERLINK("http://x","y")', code: '+SUM', order: { id: 'o9', orderNumber: '-1', discountCents: 105, shippingWaivedCents: 0, totalCents: 1000, refundedCents: 0 } })],
      0,
      null,
    );
    const lines = reportCsv(evil).trimEnd().split('\n');
    expect(lines[0]).toBe('"at","kind","folio","customerEmail","code","discountMxn","shippingWaivedMxn","totalMxn","refundedMxn","status"');
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(lines[1]).toContain(`"'+SUM"`);
    expect(lines[1]).toContain(`"'-1"`);
    expect(lines[1]).toContain(',1.05,0.00,10.00,0.00,');
    expect(lines[2]).toBe('"total","","","","",1.05,0.00,10.00,0.00,"consumed"');
    // Ninguna celda empieza con un carácter de fórmula fuera de comillas.
    for (const l of lines) for (const cell of l.split(',')) expect(cell).not.toMatch(/^[=+\-@\t\r]/);
  });

  it('codes.csv: `code,status,usedAt` con la misma defensa', () => {
    expect(batchCodesCsv([{ code: 'AB-2222222222', state: 'live', usedAt: null }, { code: 'AB-3333333333', state: 'exhausted', usedAt: at('2026-10-20T10:05:00Z') }])).toBe(
      '"code","status","usedAt"\n"AB-2222222222","live",""\n"AB-3333333333","exhausted","2026-10-20T10:05:00.000Z"\n',
    );
  });
});

describe('§DSC.7 entrada del dueño', () => {
  it('alta: normaliza el texto; por cliente 1 por defecto; startsAt ⇒ ahora; `null` explícito ⇒ sin límite', () => {
    const { code, config } = parseCodeCreate({ code: ' verano-10 ', kind: 'percent', percentPct: 10 }, NOW);
    expect(code).toBe('VERANO-10');
    expect(config).toMatchObject({ maxUsesPerCustomer: 1, maxTotalUses: null, startsAt: NOW, productScopes: [], destinations: [] });
    expect(parseCodeCreate({ code: 'ABCD', kind: 'percent', percentPct: 10, maxUsesPerCustomer: null }, NOW).config.maxUsesPerCustomer).toBeNull();
  });

  it('campos por `kind` y reglas ⇒ 422 con su `field`', () => {
    expect(fieldOf(() => parseCodeCreate({ code: 'ABCD', kind: 'percent' }, NOW))).toBe('percentPct');
    expect(fieldOf(() => parseCodeCreate({ code: 'ABCD', kind: 'percent', percentPct: 101 }, NOW))).toBe('percentPct');
    expect(fieldOf(() => parseCodeCreate({ code: 'ABCD', kind: 'fixed_amount' }, NOW))).toBe('amountCents');
    expect(fieldOf(() => parseCodeCreate({ code: 'ABCD', kind: 'fixed_amount', amountCents: 100, maxDiscountCents: 5 }, NOW))).toBe('maxDiscountCents');
    expect(fieldOf(() => parseCodeCreate({ code: 'ABCD', kind: 'free_shipping', destinations: ['vault'] }, NOW))).toBe('destinations');
    expect(fieldOf(() => parseCodeCreate({ code: 'AB', kind: 'free_shipping' }, NOW))).toBe('code');
    expect(fieldOf(() => parseCodeCreate({ code: 'ABCD', kind: 'free_shipping', endsAt: NOW.toISOString() }, NOW))).toBe('endsAt');
    expect(fieldOf(() => parseCodeCreate({ code: 'ABCD', kind: 'free_shipping', productScopes: ['raw', 'raw'] }, NOW))).toBe('productScopes');
    expect(fieldOf(() => parseCodeCreate({ code: 'ABCD', kind: 'free_shipping', archivedAt: null }, NOW))).toBe('archivedAt');
  });

  it('lote: prefijo 2..8, cantidad 1..500, ⛔ maxTotalUses/maxUsesPerCustomer/code; límites fijos en 1', () => {
    expect(parseBatchCreate({ prefix: 'ver', quantity: 500, kind: 'percent', percentPct: 5 }, NOW).config).toMatchObject({ maxTotalUses: 1, maxUsesPerCustomer: 1 });
    expect(fieldOf(() => parseBatchCreate({ prefix: 'VER', quantity: 501, kind: 'percent', percentPct: 5 }, NOW))).toBe('quantity');
    expect(fieldOf(() => parseBatchCreate({ prefix: 'V', quantity: 1, kind: 'percent', percentPct: 5 }, NOW))).toBe('prefix');
    expect(fieldOf(() => parseBatchCreate({ prefix: 'VER', quantity: 1, kind: 'percent', percentPct: 5, maxTotalUses: 3 }, NOW))).toBe('maxTotalUses');
    expect(fieldOf(() => parseBatchCreate({ prefix: 'VER', quantity: 1, kind: 'percent', percentPct: 5, code: 'X' }, NOW))).toBe('code');
  });

  it('PATCH: ⛔ `code`; reenviar el mismo valor no es cambio (listas sin orden, fechas por instante)', () => {
    expect(fieldOf(() => parseConfigPatch({ code: 'OTRO' }, { allowStatus: true }))).toBe('code');
    const row = { productScopes: ['raw', 'sealed'], endsAt: new Date('2026-11-01T00:00:00Z'), percentPct: 10 };
    const p = parseConfigPatch({ productScopes: ['sealed', 'raw'], endsAt: '2026-11-01T00:00:00.000Z', percentPct: 15 }, { allowStatus: true });
    expect(changedFields(row, p.config as Record<string, unknown>)).toEqual(['percentPct']);
  });

  it('preview: 1..5 líneas, sin `code`', () => {
    expect(fieldOf(() => parsePreview({ kind: 'percent', percentPct: 10, sampleLines: [] }, NOW))).toBe('sampleLines');
    expect(fieldOf(() => parsePreview({ kind: 'percent', percentPct: 10, sampleLines: Array(6).fill({ scope: 'raw', priceCents: 1, quantity: 1 }) }, NOW))).toBe('sampleLines');
    expect(fieldOf(() => parsePreview({ code: 'ABCD', kind: 'percent', percentPct: 10, sampleLines: [{ scope: 'raw', priceCents: 1, quantity: 1 }] }, NOW))).toBe('code');
  });

  it('bitácora: antes → después solo de lo que cambió; alta ⇒ before null', () => {
    expect(diffSnapshots({ percentPct: 10, status: 'active' }, { percentPct: 15, status: 'active' })).toEqual([{ field: 'percentPct', before: 10, after: 15 }]);
    expect(diffSnapshots(null, { status: 'active' })).toEqual([{ field: 'status', before: null, after: 'active' }]);
  });
});

describe('§DSC.6 (914) correo — la línea del código', () => {
  const fmt = (c: number) => `MX$${(c / 100).toFixed(2)}`;
  it('sin código ⇒ ninguna línea (I-1)', () => {
    expect(discountMailRows(null, 'es', fmt)).toEqual([]);
    expect(discountMailRows(undefined, 'es', fmt)).toEqual([]);
  });
  it('descuento y envío gratis, es/en; texto con «−»', () => {
    const rows = discountMailRows({ code: 'VERANO10', discountCents: 5000, shippingWaivedCents: 10000 }, 'es', fmt);
    expect(discountMailTextLines(rows)).toEqual(['Descuento (VERANO10): − MX$50.00', 'Envío gratis (VERANO10): − MX$100.00']);
    expect(discountMailRows({ code: 'X1X1', discountCents: 1, shippingWaivedCents: 0 }, 'en', fmt).map((r) => r.label)).toEqual(['Discount (X1X1)']);
  });
});

describe('§DSC.0 I-3 (v1.110.1) — `pricing-brackets` calibra con el precio EXHIBIDO (cobrado + rebaja)', () => {
  it('una venta de 90000 cobrados con 10000 de rebaja suma 100000 en `grossMxnCents`; sin rebaja, lo de hoy', async () => {
    const rows = [
      { marketBracket: 'r80_300', priceBasis: 'market', marketMxnCents: 80000, unitPriceCents: 90000, unitDiscountCents: 10000 },
      { marketBracket: 'r80_300', priceBasis: 'market', marketMxnCents: 80000, unitPriceCents: 50000, unitDiscountCents: 0 },
    ];
    const findMany = jest.fn(async () => rows);
    const prisma = { orderItem: { findMany }, sellRequestItem: { findMany: jest.fn(async () => []) } } as unknown as PrismaService;
    const svc = new AdminService(prisma, {} as PricingService, new PiiCryptoService(new ConfigService({})), {} as UploadsService);
    const res = await svc.pricingBrackets(undefined, undefined, 'sale');
    expect(res.sale!.find((r) => r.bracket === 'r80_300')).toMatchObject({ operations: 2, grossMxnCents: 150000 });
    expect((findMany.mock.calls[0] as unknown as [{ select: Record<string, boolean> }])[0].select).toMatchObject({ unitPriceCents: true, unitDiscountCents: true });
  });
});
