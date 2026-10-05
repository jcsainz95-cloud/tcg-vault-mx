/**
 * spend-summary.ts — 💰 `summarizeSpendAlerts`: UN cuerpo para `GET /admin/spend-alerts/summary` y para el correo `AVG-3`
 * de las 08:00 (API_CONTRACT §19.29.7 «El resumen cuadra con el panel», §19.31.8 S-GAS-7).
 *
 *  - `byKind`: avisos con `firstOccurredAt` en el rango de días MX, **solo los NO silenciados** (S-GAS-7), por tipo: cuántos 🔴,
 *    cuántos 🟡 y Σ `amountCents`. Orden por número de código.
 *  - `mutedCount`: los silenciados del mismo rango (la línea «N avisos apagados» del correo).
 *  - `labelSpendByPerson`: del LIBRO de intentos (no de los avisos): por quien reclamó, Σ `spendOfAttempt` de los intentos con
 *    `since` en el rango (el MISMO `spendOfAttempt` de TG-1, `shipments/label-spend.ts`), y `labels` = intentos que costaron.
 *  - `costlyChoices`: del libro: intentos con guía (`labeled`) y `marginCents < 0` o `expectedChargeCents > recommendedPriceCents`
 *    (el disparador de AG-13); `overRecommendedCents` = Σ (precio − recomendada) de los que pasaron la recomendada (⛔ no suma
 *    `marginCents`, PS-151).
 */
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { spendOfAttempt } from '../shipments/label-spend';
import { SPEND_ALERT_CODE_OF } from './spend-alerts.service';
import { SpendAlertSummaryDTO } from './spend-alert.mail';

type Db = Prisma.TransactionClient | PrismaService;

const codeNumber = (code: string) => Number(code.replace('AG-', ''));

export async function summarizeSpendAlerts(
  db: Db,
  q: { from: string; to: string; range: { gte?: Date; lt?: Date } },
): Promise<SpendAlertSummaryDTO> {
  const when: Prisma.DateTimeFilter = { ...(q.range.gte ? { gte: q.range.gte } : {}), ...(q.range.lt ? { lt: q.range.lt } : {}) };
  const [groups, mutedCount, attempts] = await Promise.all([
    db.spendAlert.groupBy({
      by: ['kind', 'severity'],
      where: { muted: false, firstOccurredAt: when },
      _count: { _all: true },
      _sum: { amountCents: true },
    }),
    db.spendAlert.count({ where: { muted: true, firstOccurredAt: when } }),
    db.shipmentLabelAttempt.findMany({
      where: { since: when },
      select: {
        actorUserId: true,
        outcome: true,
        expectedChargeCents: true,
        recommendedPriceCents: true,
        marginCents: true,
        paidLabels: { select: { cancelledAt: true, unrefundedCents: true, chargedCents: true } },
      },
    }),
  ]);

  const byCode = new Map<string, { code: string; immediate: number; digest: number; amountCents: number }>();
  for (const g of groups) {
    const code = SPEND_ALERT_CODE_OF[g.kind];
    const acc = byCode.get(code) ?? { code, immediate: 0, digest: 0, amountCents: 0 };
    if (g.severity === 'immediate') acc.immediate += g._count._all;
    else acc.digest += g._count._all;
    acc.amountCents += g._sum.amountCents ?? 0;
    byCode.set(code, acc);
  }

  const spend = new Map<string, { cents: number; labels: number }>();
  const costly = new Map<string, number>();
  let costlyCount = 0;
  let overRecommendedCents = 0;
  for (const a of attempts) {
    const cents = spendOfAttempt(a);
    const acc = spend.get(a.actorUserId) ?? { cents: 0, labels: 0 };
    acc.cents += cents;
    if (cents > 0) acc.labels += 1;
    spend.set(a.actorUserId, acc);
    if (a.outcome === 'labeled') {
      const over = a.recommendedPriceCents !== null && a.expectedChargeCents > a.recommendedPriceCents;
      if (a.marginCents < 0 || over) {
        costlyCount += 1;
        costly.set(a.actorUserId, (costly.get(a.actorUserId) ?? 0) + 1);
        if (over) overRecommendedCents += a.expectedChargeCents - (a.recommendedPriceCents as number);
      }
    }
  }
  const ids = [...new Set([...spend.keys(), ...costly.keys()])];
  const names = new Map(
    (ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name]),
  );
  return {
    from: q.from,
    to: q.to,
    byKind: [...byCode.values()].sort((a, b) => codeNumber(a.code) - codeNumber(b.code)),
    mutedCount,
    labelSpendByPerson: [...spend.entries()]
      .filter(([, v]) => v.labels > 0 || v.cents > 0)
      .map(([userId, v]) => ({ userId, name: names.get(userId) ?? '', cents: v.cents, labels: v.labels }))
      .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name)),
    costlyChoices: {
      count: costlyCount,
      overRecommendedCents,
      byPerson: [...costly.entries()]
        .map(([userId, count]) => ({ userId, name: names.get(userId) ?? '', count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    },
  };
}
