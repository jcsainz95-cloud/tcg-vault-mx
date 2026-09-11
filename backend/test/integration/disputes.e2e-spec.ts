/**
 * `disputes.e2e-spec.ts` — **§M8 v1.68: `resolve` obedece la doctrina de §M5-T y el job de deadline no
 * revive resueltas** — POR HTTP, CONTRA POSTGRES REAL. Propiedad: backend. ARCHITECTURE §4.48.4.
 *
 * Candados del contrato:
 * - **D-1:** `repurchase` y luego `reject` sobre la misma disputa ⇒ `200 · 409 CONFLICT`, `status`
 *   sigue `resuelta_recompra`.
 * - **D-2:** disputa `abierta` con `deadlineAt` vencido; resolverla **y** correr el job (en ese
 *   orden) ⇒ sigue resuelta; rojo si queda `en_revision`.
 *
 * Por qué aquí y no solo en el unitario: la guarda **es** el `where` del `updateMany`, y sólo el
 * motor decide qué casa. El ESTADO (la disputa) se siembra por `h.prisma` —`POST /disputes` exige un
 * ítem entregado en una orden real, que no es el sujeto de esta suite—; la CONDUCTA va por la puerta.
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { DisputeDeadlineJobService } from '../../src/jobs/dispute-deadline.service';

describe('E2E — §M8 · disputas: `resolve` guardado en el motor y job de plazo sin read-then-write', () => {
  let h: E2EHarness;
  let adminToken: string;
  let operatorToken: string;
  let customerId: string;
  let inventoryItemId: string;

  async function siembraDisputa(over: Record<string, unknown> = {}) {
    const d = await h.prisma.dispute.create({
      data: {
        userId: customerId,
        inventoryItemId,
        type: 'condition_raw',
        status: 'abierta',
        description: 'E2E · llegó dañada',
        deadlineAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        ...over,
      },
    });
    return d.id;
  }

  const resolve = (id: string, resolution: 'repurchase' | 'reject', token = adminToken) =>
    h.api('POST', `/admin/disputes/${id}/resolve`, {
      token,
      json: { resolution, note: `E2E · ${resolution}` },
    });

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    operatorToken = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    const u = await h.prisma.user.findUnique({ where: { email: E2E_USERS.customer.email } });
    customerId = u!.id;
    const item = await h.prisma.inventoryItem.findFirst({ where: { productType: 'raw' } });
    inventoryItemId = item!.id;
  });

  afterAll(async () => {
    await h.prisma.dispute.deleteMany({ where: { description: { startsWith: 'E2E · ' } } });
    await h?.close();
  });

  it('D-1 ⭐ `repurchase` y luego `reject` ⇒ 200 · 409 CONFLICT { status, resolvedAt }; sigue `resuelta_recompra`', async () => {
    const id = await siembraDisputa();
    const primera = await resolve(id, 'repurchase');
    expect(primera.status).toBe(200);
    expect(primera.body.status).toBe('resuelta_recompra');
    const tras1 = await h.prisma.dispute.findUnique({ where: { id } });
    expect(tras1!.resolvedAt).toBeInstanceOf(Date);

    const segunda = await resolve(id, 'reject');
    expect(segunda.status).toBe(409);
    expect(segunda.body.error.code).toBe('CONFLICT');
    expect(segunda.body.error.details.status).toBe('resuelta_recompra');
    expect(new Date(segunda.body.error.details.resolvedAt)).toEqual(tras1!.resolvedAt);

    // Cero escritura: estado, fecha, actor y nota de la PRIMERA resolución intactos.
    const tras2 = await h.prisma.dispute.findUnique({ where: { id } });
    expect(tras2!.status).toBe('resuelta_recompra');
    expect(tras2!.resolvedAt).toEqual(tras1!.resolvedAt);
    expect(tras2!.resolvedBy).toBe(tras1!.resolvedBy);
    expect(tras2!.resolution).toBe(tras1!.resolution);
  });

  it('⛔ no idempotente: repetir el MISMO `reject` también es 409 (dos registros de una resolución)', async () => {
    const id = await siembraDisputa({ status: 'en_revision' });
    expect((await resolve(id, 'reject', operatorToken)).status).toBe(200);
    const otra = await resolve(id, 'reject', operatorToken);
    expect(otra.status).toBe(409);
    expect(otra.body.error.code).toBe('CONFLICT');
    expect(otra.body.error.details.status).toBe('rechazada');
  });

  it('`repurchase` por `vault_operator` sigue siendo 403 MONEY_OUT_FORBIDDEN y no toca la fila', async () => {
    const id = await siembraDisputa();
    const res = await resolve(id, 'repurchase', operatorToken);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MONEY_OUT_FORBIDDEN');
    const row = await h.prisma.dispute.findUnique({ where: { id } });
    expect(row!.status).toBe('abierta');
    expect(row!.resolvedAt).toBeNull();
  });

  it('D-2 ⭐ `abierta` vencida: resolver Y correr el job (en ese orden) ⇒ sigue resuelta, no vuelve a `en_revision`', async () => {
    const vencida = await siembraDisputa({ deadlineAt: new Date(Date.now() - 24 * 3600 * 1000) });
    const testigo = await siembraDisputa({ deadlineAt: new Date(Date.now() - 24 * 3600 * 1000) });
    expect((await resolve(vencida, 'repurchase')).status).toBe(200);

    const job = h.app.get(DisputeDeadlineJobService);
    const res = await job.run();
    // El testigo (abierta y vencida) SÍ se mueve: prueba que el job corrió de verdad.
    expect(res.expired).toBeGreaterThanOrEqual(1);
    expect((await h.prisma.dispute.findUnique({ where: { id: testigo } }))!.status).toBe('en_revision');
    // La resuelta NO revive. Rojo si queda `en_revision`.
    const row = await h.prisma.dispute.findUnique({ where: { id: vencida } });
    expect(row!.status).toBe('resuelta_recompra');
    expect(row!.resolvedAt).toBeInstanceOf(Date);
  });

  it('el job por HTTP (`POST /admin/jobs/dispute-deadline`) devuelve `{ expired: count }` y respeta la guarda', async () => {
    const abierta = await siembraDisputa({ deadlineAt: new Date(Date.now() - 3600 * 1000) });
    const rechazada = await siembraDisputa({
      status: 'rechazada',
      deadlineAt: new Date(Date.now() - 3600 * 1000),
      resolvedAt: new Date(),
    });
    const res = await h.api('POST', '/admin/jobs/dispute-deadline', { token: adminToken, json: {} });
    expect(res.status).toBe(200);
    expect(typeof res.body.expired).toBe('number');
    expect((await h.prisma.dispute.findUnique({ where: { id: abierta } }))!.status).toBe('en_revision');
    expect((await h.prisma.dispute.findUnique({ where: { id: rechazada } }))!.status).toBe('rechazada');
  });
});
