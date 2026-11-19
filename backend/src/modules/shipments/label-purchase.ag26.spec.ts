import { ShipmentLabelService } from './label-purchase.service';

/** ENV3-4: un fallo SQL al evaluar AG-26 NO puede dejar abortada la tx que acaba de comprar la guía (SAVEPOINT). */
describe('§ENV3 AG-26 — aislado en un SAVEPOINT', () => {
  const claim = { row: { id: 's1', orderId: 'o1', folio: 'ENV-1', addressSnapshot: { postalCode: '64000' } }, rate: { carrierName: 'fedex', serviceName: 'Standard Overnight', deliveryKind: 'home' } };
  const snapshot = { serviceCode: 'standard_overnight', serviceName: 'FedEx Standard Overnight', costQuotedCents: 10000, profile: { package: 'envelope', boxes: 1, perBoxKg: 1 } };
  const build = (createFails: boolean) => {
    const sql: string[] = [];
    const tx = {
      $executeRaw: jest.fn(async (q: TemplateStringsArray) => { sql.push(q.join('')); return 0; }),
      order: { findUnique: jest.fn(async () => ({ shippingQuoteSnapshot: snapshot })) },
      shippingQuoteLog: { create: jest.fn(async () => { if (createFails) throw new Error('sql boom'); }) },
    };
    const svc = Object.create(ShipmentLabelService.prototype) as never as { overCustomerQuote: (...a: unknown[]) => Promise<void> };
    Object.assign(svc, {
      logger: { error: jest.fn() },
      settings: { getNumber: jest.fn(async () => 1000), get: jest.fn(async () => ['standard_overnight', 'fedex_express_saver']) },
      alerts: { raise: jest.fn(async () => undefined) },
    });
    return { svc, tx, sql };
  };
  it('si el INSERT del log falla, se hace ROLLBACK TO SAVEPOINT y la compra sigue (no lanza)', async () => {
    const { svc, tx, sql } = build(true);
    await expect(svc.overCustomerQuote(tx, claim, 12000, new Date(), 11000)).resolves.toBeUndefined();
    expect(sql.some((q) => /^SAVEPOINT/.test(q))).toBe(true);
    expect(sql.some((q) => /ROLLBACK TO SAVEPOINT/.test(q))).toBe(true);
  });
  it('sin fallo: SAVEPOINT y RELEASE, sin rollback', async () => {
    const { svc, tx, sql } = build(false);
    await svc.overCustomerQuote(tx, claim, 12000, new Date(), 11000);
    expect(sql.some((q) => /RELEASE SAVEPOINT/.test(q))).toBe(true);
    expect(sql.some((q) => /ROLLBACK/.test(q))).toBe(false);
  });
});
