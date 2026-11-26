import { SettleReconciliationService } from '../src/modules/payments/settle-reconciliation.service';
import { AdminService } from '../src/modules/admin/admin.service';
import type { SettleRecord } from '../src/modules/payments/settle-line';

/**
 * §BOVEDA-COBRADA-SIN-PIEZAS — B-2/BC-6: el aviso al dueño usa el correo EXISTENTE (`ownerRecipients` + `MailPort`), solo para líneas
 * «requiere atención» NUEVAS y sin datos personales; y el contador del tablero NUNCA devuelve 0 cuando la consulta falla.
 */
const owner = { id: 'u-owner', email: 'dueno@tienda.mx', name: 'Dueño', nameSource: 'user', locale: 'es', isOwner: true, role: 'super_admin', status: 'active', deletedAt: null };

function build(mail?: { send: jest.Mock }) {
  const prisma: any = {
    user: { findMany: jest.fn(async () => [owner]) },
    order: { findUnique: jest.fn(async () => null) },
    auditLog: { findFirst: jest.fn(), create: jest.fn() },
  };
  const svc = new SettleReconciliationService(prisma, {} as never, mail as never);
  return { svc, prisma };
}
const attention = (changed?: boolean): SettleRecord => ({ orderItemId: 'oi1', inventoryItemId: 'i1', outcome: { kind: 'attention', was: 'in_custody', reason: 'no_equivalent_copy' }, changed });

describe('SettleReconciliationService — aviso al dueño', () => {
  it('línea «requiere atención» NUEVA ⇒ un correo al dueño, con el folio del pedido y sin datos personales', async () => {
    const mail = { send: jest.fn(async (_m: { to: string; text: string }) => undefined) };
    const { svc } = build(mail);
    await svc.afterSettle({ orderId: 'o1', orderNumber: 'TCG-000042', records: [attention()], supersededOrderIds: [] });
    expect(mail.send).toHaveBeenCalledTimes(1);
    const m = mail.send.mock.calls[0][0];
    expect(m.to).toBe('dueno@tienda.mx');
    expect(m.text).toContain('TCG-000042');
    expect(m.text).not.toMatch(/@|CLABE|tarjeta/i);
  });
  it('lo ya marcado que sigue igual (changed:false), lo resuelto y la ausencia de MailPort ⇒ cero correos y sin lanzar', async () => {
    const mail = { send: jest.fn(async () => undefined) };
    const { svc } = build(mail);
    await svc.afterSettle({ orderId: 'o1', orderNumber: 'X', records: [attention(false)], supersededOrderIds: [] });
    await svc.afterSettle({ orderId: 'o1', orderNumber: 'X', records: [{ orderItemId: 'a', inventoryItemId: 'b', outcome: { kind: 'recovered', was: 'listed' } }], supersededOrderIds: [] });
    expect(mail.send).not.toHaveBeenCalled();
    await expect(build().svc.afterSettle({ orderId: 'o1', orderNumber: 'X', records: [attention()], supersededOrderIds: [] })).resolves.toBeUndefined();
  });
  it('un fallo del correo no se propaga (un 5xx haría que Stripe reintentara un settle ya aplicado)', async () => {
    const { svc } = build({ send: jest.fn(async () => { throw new Error('smtp'); }) });
    await expect(svc.afterSettle({ orderId: 'o1', orderNumber: 'X', records: [attention()], supersededOrderIds: [] })).resolves.toBeUndefined();
  });
});

describe('AdminService — contador del tablero', () => {
  it('si la consulta falla devuelve `null` (⛔ nunca 0: «todo bien» no se afirma sin medir)', async () => {
    const svc: any = Object.create(AdminService.prototype);
    svc.prisma = { $queryRaw: jest.fn(async () => { throw new Error('db down'); }) };
    svc.logger = { error: jest.fn() };
    expect(await svc.vaultOrdersWithUnassignedCount()).toBeNull();
  });
  it('con la consulta sana cuenta pedidos DISTINTOS', async () => {
    const svc: any = Object.create(AdminService.prototype);
    svc.prisma = { $queryRaw: jest.fn(async () => [{ orderId: 'a' }, { orderId: 'a' }, { orderId: 'b' }]) };
    svc.logger = { error: jest.fn() };
    expect(await svc.vaultOrdersWithUnassignedCount()).toBe(2);
  });
});
