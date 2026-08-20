import { OrdersService } from './orders.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * H3 (money-safety) — `nextOrderNumber` usa `$queryRaw` (tagged template, parametrizado) en vez de
 * `$queryRawUnsafe`. El formato legible `TCG-000123` (padding a 6) se conserva intacto.
 */
function build(rows: unknown) {
  const $queryRaw = jest.fn().mockResolvedValue(rows);
  const prisma = { $queryRaw } as unknown as PrismaService;
  const svc = new OrdersService(prisma, {} as never, {} as never, {} as never, {} as never);
  return { svc, $queryRaw };
}

describe('H3 — nextOrderNumber con $queryRaw parametrizado', () => {
  it('formatea el nextval como TCG-000123 (padding a 6)', async () => {
    const { svc, $queryRaw } = build([{ nextval: 123n }]);
    await expect(svc.nextOrderNumber()).resolves.toBe('TCG-000123');
    // Se invocó como tagged template ($queryRaw, no $queryRawUnsafe): el 1er arg es el array de strings.
    expect(Array.isArray($queryRaw.mock.calls[0][0])).toBe(true);
  });

  it('no trunca números grandes que superan 6 dígitos', async () => {
    const { svc } = build([{ nextval: 1234567n }]);
    await expect(svc.nextOrderNumber()).resolves.toBe('TCG-1234567');
  });
});
