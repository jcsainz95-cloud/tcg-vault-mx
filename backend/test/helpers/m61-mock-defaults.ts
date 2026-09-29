/**
 * v1.80 (M-61, §M4-SHIP) — los dobles de Prisma de las suites unitarias LEGACY de `shipments` se construyen a
 * mano con SOLO los delegados que cada prueba ejercita. Los verbos de envío ganaron lecturas nuevas que ninguna
 * de esas pruebas mide (`replacementCase`, `orderItem`, `paymentRefund` para el origen y el libro; `$queryRaw`
 * para el candado de fila): este helper AÑADE esos delegados INERTES (vacíos) **solo si faltan**, sin tocar lo
 * que cada suite sí instrumenta. ⛔ No afloja ninguna aserción: las pruebas siguen midiendo lo suyo; las lecturas
 * nuevas se prueban contra Postgres real en `test/integration/shipments-prep*.e2e-spec.ts`.
 */
export function withM61Defaults<T extends Record<string, any>>(db: T): T {
  const d = db as Record<string, any>;
  d.replacementCase ??= {};
  d.replacementCase.findMany ??= jest.fn(async () => []);
  d.replacementCase.count ??= jest.fn(async () => 0);
  d.orderItem ??= {};
  d.orderItem.findMany ??= jest.fn(async () => []);
  d.paymentRefund ??= {};
  d.paymentRefund.findMany ??= jest.fn(async () => []);
  d.paymentRefund.aggregate ??= jest.fn(async () => ({ _sum: { amountCents: 0 } }));
  d.user ??= {};
  d.user.findMany ??= jest.fn(async () => []);
  d.user.findUnique ??= jest.fn(async () => null);
  d.$queryRaw ??= jest.fn(async () => [{ status: 'settled' }]);
  // El candado de fila vive dentro de `$transaction`: si la suite no modela la tx, el propio doble hace de tx.
  d.$transaction ??= jest.fn(async (cb: (tx: unknown) => unknown) => cb(d));
  return db;
}
