/**
 * staff-control.service.ts — 🔒 **AG-22 `staff_control_by_non_owner`** (API_CONTRACT §19.30.2 (3), C-21 (c), SDX-Z-2): lo que un
 * NO dueño hace con cuentas de PERSONAL avisa al dueño. Aviso «sobre una persona» (`subjectUserId` = quien actuó): si el actor
 * es el dueño, `raise` lo deja en no-op (regla de §19.29.5 paso 2). Actos sobre CLIENTES no avisan (fuera de §Z).
 *
 * | `act` | gravedad |
 * |---|---|
 * | `staff_created` | 🔴 si el rol creado es `super_admin`; 🟡 si `vault_operator` |
 * | `staff_password_reset` | 🔴 si el destino es `super_admin`; 🟡 si operador |
 * | `staff_status_changed`, `staff_deleted` | 🟡 |
 * | `owner_account_denied`, `owner_setting_denied` | 🔴 |
 *
 * `dedupKey` `ag22:<actorId>:<act>:<targetUserId | claves unidas con ','>:<díaMX>`; `facts` `{act, target: {userId,name,role} |
 * null, keys: string[] | null}` — `keys` = nombres del DTO (camelCase), ordenados: la MISMA lista que `403 OWNER_ONLY_SETTING
 * {keys}` (S-GAS-9). ⛔ Ninguna contraseña ni correo.
 *
 * Se llama DESPUÉS del commit del acto (o del rechazo) y ⛔ nunca hace fallar al llamador.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Role, SpendAlertSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { dayMx, SpendAlertsService, SpendFacts } from './spend-alerts.service';
import { SpendMailService } from './spend-mail.service';
import { SPEND_ALERTS_CLOCK, SpendClock } from './spend-alerts.constants';

export type StaffControlAct =
  | 'staff_created'
  | 'staff_password_reset'
  | 'staff_status_changed'
  | 'staff_deleted'
  | 'owner_account_denied'
  | 'owner_setting_denied';

export interface StaffTarget {
  userId: string;
  name: string;
  role: Role;
}

export const STAFF_ROLES: ReadonlySet<Role> = new Set<Role>([Role.vault_operator, Role.super_admin]);

/** La gravedad por `act` (tabla de §19.30.2 (3)). */
export function staffControlSeverity(act: StaffControlAct, target: StaffTarget | null): SpendAlertSeverity {
  switch (act) {
    case 'staff_created':
    case 'staff_password_reset':
      return target?.role === Role.super_admin ? 'immediate' : 'digest';
    case 'owner_account_denied':
    case 'owner_setting_denied':
      return 'immediate';
    default:
      return 'digest';
  }
}

@Injectable()
export class StaffControlAlertsService {
  private readonly logger = new Logger(StaffControlAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: SpendAlertsService,
    private readonly mail: SpendMailService,
    @Inject(SPEND_ALERTS_CLOCK) private readonly clock: SpendClock,
  ) {}

  /**
   * Levanta AG-22. `target` de PERSONAL (los actos sobre clientes no avisan: devuelve sin escribir). Para `owner_setting_denied`,
   * `keys` (camelCase); el destino es `null`.
   */
  async report(actorUserId: string, act: StaffControlAct, target: StaffTarget | null, keys: readonly string[] | null = null): Promise<void> {
    try {
      if (target && !STAFF_ROLES.has(target.role)) return;
      if (!target && act !== 'owner_setting_denied') return;
      const now = this.clock.now();
      const sortedKeys = keys ? [...keys].sort() : null;
      const what = target ? target.userId : (sortedKeys ?? []).join(',');
      const severity = staffControlSeverity(act, target);
      // G2 (§19.33.7) con §19.34.1: `target` es el objeto persona de `SpendFactValue`, `role` incluido (§19.30.2 (3); el correo
      // lo usa, `targetOf` en `spend-alert-text.ts`). ⛔ Sin cast ni subtipo propio.
      const facts: SpendFacts = { act, target: target ? { userId: target.userId, name: target.name, role: target.role } : null, keys: sortedKeys };
      const res = await this.alerts.raise(
        this.prisma,
        { kind: 'staff_control_by_non_owner', severity, dedupKey: `ag22:${actorUserId}:${act}:${what}:${dayMx(now)}`, subjectUserId: actorUserId, facts },
        now,
      );
      if (res && severity === 'immediate') await this.mail.dispatchImmediate(res.id);
    } catch (e) {
      this.logger.error(`AG-22 (${act}) no se pudo registrar: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
