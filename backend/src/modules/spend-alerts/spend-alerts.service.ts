/**
 * spend-alerts.service.ts — 💰 la base de avisos al dueño (API_CONTRACT §M4-SHIP.19.29.5 con §19.30.2 (5), §19.30.8
 * S-GAS-5). ⭐ ÚNICO escritor de `SpendAlert` (candado `C-GAS-1`: censo de `spendAlert.create|upsert|update`).
 *
 * D2c construyó `raise`/`resolve`/`observeBalance` (⛔ firmas CONGELADAS: D2d las llama, §19.32.9). D2g añade aquí, sin
 * tocarlas, los ÚNICOS otros escritores de la tabla (para que el censo `C-GAS-1` siga siendo «un fichero»): las transiciones del
 * correo del despacho (`mailTransition`, `mailTransitionMany`) y «visto» (`markSeen`). El despacho en sí (candado, cupos, lote),
 * el panel, `spend-watch` y `spend-digest` viven en sus ficheros y escriben SOLO por estos métodos.
 *
 * `raise` (§19.29.5):
 *  1. `kind ∈ spend_alerts_disabled` ⇒ la fila SE CREA silenciada (`muted = true`, `mailStatus = 'not_applicable'`) —
 *     ⛔ v1.80.12.10 (C-21 (e)): apagar un aviso apaga el correo, no la fila. AG-21/AG-22 no se pueden apagar.
 *  2. Aviso «sobre una persona» (AG-1…AG-4, AG-13, AG-22) cuyo sujeto es el dueño (`isOwnerAccount`, de la BASE) ⇒ no-op.
 *  3. `INSERT … ON CONFLICT (dedupKey)` ⇒ `occurrenceCount + 1`, `lastOccurredAt`, gravedad = la mayor (de 🟡 a 🔴 con
 *     `not_applicable` y sin silenciar ⇒ pasa a `pending`), y `facts`: `triggers` se UNE sin repetidos; `cancelledCount`,
 *     `unrecoveredCents`, `unknownRefunds` se reescriben con lo vigente; lo demás queda como lo dejó el primero (S-GAS-5).
 *  4. `mailStatus` inicial: 🔴 ⇒ `pending`; 🟡 ⇒ `not_applicable`.
 * Dentro de la tx del hecho cuando la hay (outbox); después del rollback en las negativas (como la bitácora).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SpendAlertKind, SpendAlertMailStatus, SpendAlertSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { OWNER_SELECT, isOwnerAccount } from './owner';

/** El mapa fijo kind ⇔ código (§19.29.2, AG-21/AG-22 de §19.30.1/.2). */
export const SPEND_ALERT_CODE_OF: Readonly<Record<SpendAlertKind, string>> = {
  label_after_address_fix: 'AG-1',
  label_cap_warning: 'AG-2',
  label_cap_blocked: 'AG-3',
  label_reissue_loop: 'AG-4',
  label_charge_drift: 'AG-5',
  carrier_extra_charge: 'AG-6',
  provider_balance_low: 'AG-7',
  cancel_refund_missing: 'AG-8',
  label_charged_unexplained: 'AG-9',
  label_not_shipped: 'AG-10',
  parcel_returned: 'AG-11',
  parcel_problem: 'AG-12',
  label_costly_choice: 'AG-13',
  operator_refund_cap: 'AG-14',
  super_admin_money_out: 'AG-15',
  shrinkage: 'AG-16',
  chargeback: 'AG-17',
  buylist_manual_price: 'AG-18',
  psa_credits: 'AG-19',
  stuck_refund: 'AG-20',
  owner_account_changed: 'AG-21',
  staff_control_by_non_owner: 'AG-22',
};

/** Avisos «sobre una persona» (Z.0.5): el dueño queda fuera. */
export const PERSON_ALERT_KINDS: ReadonlySet<SpendAlertKind> = new Set<SpendAlertKind>([
  'label_after_address_fix',
  'label_cap_warning',
  'label_cap_blocked',
  'label_reissue_loop',
  'label_costly_choice',
  'staff_control_by_non_owner',
]);

/** La vigilancia de la vigilancia no se apaga (§19.30.2 (5)). */
const NEVER_MUTED: ReadonlySet<SpendAlertKind> = new Set<SpendAlertKind>(['owner_account_changed', 'staff_control_by_non_owner']);

/** S-GAS-5: llaves de `facts` que se REESCRIBEN con lo vigente al repetirse el aviso. */
const REWRITTEN_FACTS = ['cancelledCount', 'unrecoveredCents', 'unknownRefunds'] as const;

export type SpendFacts = Record<string, string | number | boolean | string[] | null>;

export interface RaiseInput {
  kind: SpendAlertKind;
  severity: SpendAlertSeverity;
  dedupKey: string;
  subjectUserId?: string | null;
  shipmentRequestId?: string | null;
  orderId?: string | null;
  amountCents?: number | null;
  facts: SpendFacts;
}

type Db = Prisma.TransactionClient | PrismaService;

/** El día en `America/Mexico_City` (`YYYY-MM-DD`) — la frontera de las llaves «por día MX» (§19.29.6). */
export function dayMx(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function mergeFacts(prev: SpendFacts, next: SpendFacts): SpendFacts {
  const out: SpendFacts = { ...prev };
  for (const k of REWRITTEN_FACTS) if (k in next) out[k] = next[k];
  if (Array.isArray(next.triggers)) {
    const before = Array.isArray(prev.triggers) ? prev.triggers : [];
    out.triggers = [...new Set([...before, ...next.triggers])];
  }
  return out;
}

@Injectable()
export class SpendAlertsService {
  private readonly logger = new Logger(SpendAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Crea o repite un aviso. Devuelve `null` si fue no-op (persona = dueño). */
  async raise(db: Db, input: RaiseInput, now: Date): Promise<{ id: string; created: boolean } | null> {
    const code = SPEND_ALERT_CODE_OF[input.kind];
    if (PERSON_ALERT_KINDS.has(input.kind) && input.subjectUserId) {
      const subject = await db.user.findUnique({ where: { id: input.subjectUserId }, select: OWNER_SELECT });
      if (isOwnerAccount(subject)) return null;
    }
    const disabled = (await this.settings.get<string[]>(SettingKey.SPEND_ALERTS_DISABLED, db)) ?? [];
    const muted = !NEVER_MUTED.has(input.kind) && disabled.includes(code);
    const mailStatus = muted || input.severity === 'digest' ? 'not_applicable' : 'pending';
    const created = await db.$queryRaw<{ id: string }[]>`
      INSERT INTO "SpendAlert" (id, kind, severity, "dedupKey", "subjectUserId", "shipmentRequestId", "orderId", "amountCents",
                                facts, "mailStatus", muted, "firstOccurredAt", "lastOccurredAt")
      VALUES (gen_random_uuid()::text, ${input.kind}::"SpendAlertKind", ${input.severity}::"SpendAlertSeverity", ${input.dedupKey},
              ${input.subjectUserId ?? null}, ${input.shipmentRequestId ?? null}, ${input.orderId ?? null}, ${input.amountCents ?? null},
              ${JSON.stringify(input.facts)}::jsonb, ${mailStatus}::"SpendAlertMailStatus", ${muted}, ${now}, ${now})
      ON CONFLICT ("dedupKey") DO NOTHING
      RETURNING id`;
    if (created.length === 1) return { id: created[0].id, created: true };
    // Repetido: bajo el candado de su fila (la unión de `facts` es leer-y-escribir).
    const [row] = await db.$queryRaw<{ id: string; severity: SpendAlertSeverity; mailStatus: string; muted: boolean; facts: SpendFacts }[]>`
      SELECT id, severity, "mailStatus", muted, facts FROM "SpendAlert" WHERE "dedupKey" = ${input.dedupKey} FOR UPDATE`;
    const severity: SpendAlertSeverity = row.severity === 'immediate' || input.severity === 'immediate' ? 'immediate' : 'digest';
    const escalates = row.severity === 'digest' && severity === 'immediate' && row.mailStatus === 'not_applicable' && !row.muted;
    await db.spendAlert.update({
      where: { id: row.id },
      data: {
        occurrenceCount: { increment: 1 },
        lastOccurredAt: now,
        severity,
        ...(escalates ? { mailStatus: 'pending' as const } : {}),
        facts: mergeFacts(row.facts ?? {}, input.facts) as Prisma.InputJsonValue,
        ...(input.amountCents !== undefined && input.amountCents !== null ? { amountCents: input.amountCents } : {}),
      },
    });
    return { id: row.id, created: false };
  }

  /** AG-7 y AG-10 se resuelven solos (§19.29.5). AG-7 reescribe su llave para que el siguiente «abierto» sea fila nueva. */
  async resolve(db: Db, dedupKey: string, now: Date): Promise<boolean> {
    const open = await db.spendAlert.findUnique({ where: { dedupKey }, select: { id: true, resolvedAt: true } });
    if (!open || open.resolvedAt) return false;
    await db.spendAlert.update({
      where: { id: open.id },
      data: { resolvedAt: now, ...(dedupKey === 'ag7:open' ? { dedupKey: `ag7:closed:${open.id}` } : {}) },
    });
    return true;
  }

  /**
   * AG-7 (i) (§19.29.6): toda lectura de saldo pasa por aquí. Bajo el umbral y sin aviso abierto ⇒ crea `ag7:open` 🔴; en o
   * sobre el umbral ⇒ lo resuelve (histéresis por la llave única). ⛔ Nunca hace fallar al llamador.
   */
  async observeBalance(balanceCents: number, now: Date): Promise<void> {
    try {
      const threshold = await this.settings.getNumber(SettingKey.SKYDROPX_LOW_BALANCE_CENTS);
      if (balanceCents < threshold) {
        await this.prisma.$transaction(async (tx) => {
          const existing = await tx.spendAlert.findUnique({ where: { dedupKey: 'ag7:open' }, select: { id: true } });
          if (existing) return;
          await this.raise(tx, { kind: 'provider_balance_low', severity: 'immediate', dedupKey: 'ag7:open', facts: { balanceCents, thresholdCents: threshold } }, now);
        });
      } else {
        await this.resolve(this.prisma, 'ag7:open', now);
      }
    } catch (e) {
      this.logger.error(`observeBalance falló: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ============================================================ D2g — los otros escritores (censo C-GAS-1: solo este fichero)

  /**
   * Transición del correo de UN aviso con CAS sobre su estado (`mailStatus ∈ from`). Devuelve cuántas filas cambió (0 ⇔ otro
   * despacho ya la movió). La usan el despacho (`pending|failed → sending|batched|no_recipient`, `sending → sent|failed`) y
   * `spend-watch` (`sending` vencido ⇒ `failed_unknown`).
   */
  async mailTransition(
    db: Db,
    id: string,
    from: readonly SpendAlertMailStatus[],
    data: { mailStatus: SpendAlertMailStatus; mailedAt?: Date | null; batchHour?: Date | null; incrementAttempts?: boolean },
  ): Promise<number> {
    const r = await db.spendAlert.updateMany({
      where: { id, mailStatus: { in: [...from] } },
      data: {
        mailStatus: data.mailStatus,
        ...(data.mailedAt !== undefined ? { mailedAt: data.mailedAt } : {}),
        ...(data.batchHour !== undefined ? { batchHour: data.batchHour } : {}),
        ...(data.incrementAttempts ? { mailAttempts: { increment: 1 } } : {}),
      },
    });
    return r.count;
  }

  /** Lo mismo sobre un conjunto (el lote de una hora: `batched → batch_sent` / vuelta a `batched`; `sending` vencidos). */
  async mailTransitionMany(
    db: Db,
    where: { ids?: readonly string[]; from: readonly SpendAlertMailStatus[]; mailedBefore?: Date },
    data: { mailStatus: SpendAlertMailStatus; mailedAt?: Date | null },
  ): Promise<number> {
    const r = await db.spendAlert.updateMany({
      where: {
        ...(where.ids ? { id: { in: [...where.ids] } } : {}),
        mailStatus: { in: [...where.from] },
        ...(where.mailedBefore ? { mailedAt: { lt: where.mailedBefore } } : {}),
      },
      data: { mailStatus: data.mailStatus, ...(data.mailedAt !== undefined ? { mailedAt: data.mailedAt } : {}) },
    });
    return r.count;
  }

  /**
   * `POST /admin/spend-alerts/seen` (§19.29.9 con §19.30.2 (4), C-21 (d)). Idempotente (`seenAt: null` en el `where`).
   * Un NO dueño no marca avisos sobre sí mismo ni AG-21: `OR [{subjectUserId: null}, {subjectUserId: {not: actor}}]` —
   * ⛔ un `NOT {subjectUserId: actor}` a secas deja fuera los `null` en SQL — **y** `kind ≠ owner_account_changed`.
   * `skipped` = ids pedidos que EXISTÍAN, seguían sin ver y no se marcaron por esta regla.
   */
  async markSeen(db: Db, ids: readonly string[], actorUserId: string, actorIsOwner: boolean, now: Date): Promise<{ updated: number; skipped: number }> {
    const unique = [...new Set(ids)];
    const base: Prisma.SpendAlertWhereInput = { id: { in: unique }, seenAt: null };
    const allowed: Prisma.SpendAlertWhereInput = actorIsOwner
      ? base
      : { AND: [base, { OR: [{ subjectUserId: null }, { subjectUserId: { not: actorUserId } }] }, { kind: { not: 'owner_account_changed' } }] };
    const candidates = actorIsOwner ? 0 : await db.spendAlert.count({ where: base });
    const r = await db.spendAlert.updateMany({ where: allowed, data: { seenAt: now, seenByUserId: actorUserId } });
    return { updated: r.count, skipped: actorIsOwner ? 0 : candidates - r.count };
  }
}
