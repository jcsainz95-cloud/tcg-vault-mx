import { Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AdminDisputesController } from '../src/modules/disputes/disputes.controller';
import { DisputesService } from '../src/modules/disputes/disputes.service';
import { AuditService } from '../src/modules/audit/audit.service';

/**
 * ⚠ **SB-D7 — un fallo de AUDITORÍA no puede convertir un money-out CONSUMADO en un `500`.**
 *
 * `POST /admin/disputes/:id/resolve` con `repurchase` ya reembolsó en Stripe cuando llega a la
 * línea de auditoría. Con un `await this.audit.log(...)` desnudo, un fallo del `INSERT` (BD
 * saturada, conexión caída) hacía que la petición respondiera `500` **después** de mover el
 * dinero: el operador ve un error, lo reintenta y pide un **segundo** reembolso por la misma
 * disputa. La regla ya regía en `payments.service.ts:124-140` (auditar el descuadre NUNCA aborta
 * el webhook); aquí estaba al revés.
 *
 * La pérdida aceptada es una línea de bitácora —que además queda en el log de error—; la
 * alternativa es un abono doble.
 *
 * Mutación: quitar el `.catch(...)` ⇒ el primer caso se pone rojo (la promesa rechaza en vez de
 * resolver con el resultado de la disputa).
 */
describe('SB-D7 · AdminDisputesController.resolve — la auditoría no tumba el money-out', () => {
  const user = { id: 'admin-1', role: Role.super_admin };
  const resuelta = { id: 'd1', status: 'resuelta_recompra' };

  function build(auditFails: boolean) {
    const resolve = jest.fn(async () => resuelta);
    const log = auditFails
      ? jest.fn(async () => {
          throw new Error('BD saturada: no se pudo insertar en AuditLog');
        })
      : jest.fn(async () => undefined);
    const ctrl = new AdminDisputesController(
      { resolve } as unknown as DisputesService,
      { log } as unknown as AuditService,
    );
    const logged: string[] = [];
    jest.spyOn(Logger.prototype, 'error').mockImplementation((m: unknown) => {
      logged.push(String(m));
    });
    return { ctrl, resolve, log, logged };
  }

  afterEach(() => jest.restoreAllMocks());

  it('⭐ `repurchase` consumado + auditoría CAÍDA ⇒ responde 200 con la resolución (no 500)', async () => {
    const { ctrl, resolve, log, logged } = build(true);
    await expect(
      ctrl.resolve('d1', { resolution: 'repurchase', note: 'daño confirmado' } as never, user),
    ).resolves.toBe(resuelta);
    // El money-out corrió UNA vez, y la auditoría se intentó.
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    // El fallo NO se traga en silencio: queda en el log de error, con la disputa y el actor.
    expect(logged.join('\n')).toContain('dispute.repurchase');
    expect(logged.join('\n')).toContain('d1');
  });

  it('camino normal (auditoría OK): 200 y la bitácora escrita con el actor y el desenlace', async () => {
    const { ctrl, log } = build(false);
    await expect(
      ctrl.resolve('d1', { resolution: 'reject', note: 'sin evidencia' } as never, user),
    ).resolves.toBe(resuelta);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-1',
        action: 'dispute.reject',
        entityType: 'Dispute',
        entityId: 'd1',
      }),
    );
  });

  it('el guard de money-out NO se relaja: un `vault_operator` sigue sin poder recomprar', async () => {
    const { ctrl, resolve } = build(false);
    await expect(
      ctrl.resolve('d1', { resolution: 'repurchase', note: 'x' } as never, {
        id: 'op-1',
        role: Role.vault_operator,
      }),
    ).rejects.toMatchObject({ code: 'MONEY_OUT_FORBIDDEN' });
    // Y el dinero no se movió.
    expect(resolve).not.toHaveBeenCalled();
  });
});
