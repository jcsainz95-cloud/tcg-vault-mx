/**
 * spend-control.ts — 💰 D2f: la tarjeta «Control del gasto» del tablero (`workQueue.spendControl`, API_CONTRACT §19.29.9) y el
 * contador del menú (S-GAS-3, §19.30.8: `picking-list/summary.spendAlertsUnseenImmediate`). UN predicado de «sin ver» para los
 * dos lectores (⛔ ninguna segunda definición: S-GAS-3 llama `countUnseenImmediate`).
 *
 *  - «Sin ver» = `severity` dada, `seenAt IS NULL`, `muted = false` y ⛔ sin AG-7, AG-11, AG-12 (criterio 331, sin doble conteo:
 *    esos ya los cuenta `workQueue.shipping` — `lowBalance` y `withCarrierAlert`, §19.13 —; siguen en la lista del panel).
 *  - `labelSpend24h` = por persona con gasto en las 24 h MÓVILES, con EL cuerpo de TG-1 (`shipments/label-spend.ts`:
 *    `labelSpend24h`), `capCents` = dial `operator_label_cap_24h_cents`, `null` para el dueño (`isOwnerAccount`, de la BASE).
 *    Solo filas con gasto > 0 (la pantalla dice «Nadie compró guías en las últimas 24 h» con la lista vacía); orden: más gasto
 *    primero, luego nombre.
 * Solo lectura: ⛔ escribe nada (censo C-GAS-1 intacto).
 */
import { Prisma, SpendAlertKind, SpendAlertSeverity } from '@prisma/client';
import { labelSpend24h, SPEND_WINDOW_MS } from '../shipments/label-spend';
import { isOwnerAccount, OWNER_SELECT } from './owner';

type Db = Pick<Prisma.TransactionClient, 'spendAlert' | 'shipmentLabelAttempt' | 'shipmentPaidLabel' | 'user'>;

/** AG-7 (saldo), AG-11 (devuelto), AG-12 (problema del paquete): los cuenta `workQueue.shipping`, no la tarjeta. */
export const SPEND_CONTROL_EXCLUDED_KINDS: readonly SpendAlertKind[] = ['provider_balance_low', 'parcel_returned', 'parcel_problem'];

export function unseenSpendAlertsWhere(severity: SpendAlertSeverity): Prisma.SpendAlertWhereInput {
  return { severity, seenAt: null, muted: false, kind: { notIn: [...SPEND_CONTROL_EXCLUDED_KINDS] } };
}

/** S-GAS-3 y `spendControl.unseenImmediate`: el mismo número. */
export function countUnseenImmediate(db: Pick<Db, 'spendAlert'>): Promise<number> {
  return db.spendAlert.count({ where: unseenSpendAlertsWhere('immediate') });
}

export interface SpendControlDTO {
  unseenImmediate: number;
  unseenDigest: number;
  labelSpend24h: { userId: string; name: string; cents: number; capCents: number | null }[];
}

export async function spendControlOf(db: Db, now: Date, capCents: number): Promise<SpendControlDTO> {
  const [unseenImmediate, unseenDigest, actors] = await Promise.all([
    countUnseenImmediate(db),
    db.spendAlert.count({ where: unseenSpendAlertsWhere('digest') }),
    db.shipmentLabelAttempt.findMany({
      where: { since: { gt: new Date(now.getTime() - SPEND_WINDOW_MS) } },
      distinct: ['actorUserId'],
      select: { actorUserId: true },
    }),
  ]);
  const ids = actors.map((a) => a.actorUserId);
  const [users, spends] = await Promise.all([
    ids.length > 0 ? db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, ...OWNER_SELECT } }) : Promise.resolve([]),
    Promise.all(ids.map(async (id) => [id, await labelSpend24h(db, id, now)] as const)),
  ]);
  const byId = new Map(users.map((u) => [u.id, u]));
  const rows = spends
    .filter(([, cents]) => cents > 0)
    .map(([userId, cents]) => {
      const u = byId.get(userId);
      return { userId, name: u?.name ?? '', cents, capCents: isOwnerAccount(u) ? null : capCents };
    })
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
  return { unseenImmediate, unseenDigest, labelSpend24h: rows };
}
