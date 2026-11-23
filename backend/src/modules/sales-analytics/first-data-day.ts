/**
 * first-data-day.ts — §REPORTES-CEO F2a (API_CONTRACT_REPORTES §2): `firstDataDay` = día MX del primer pedido liquidado
 * (`MIN(Order.settledAt)`, una agregación), o `null` si no hay pedidos. Alimenta `comparison.basis` (`comparisonBasis`).
 */
import { toMexicoCityDateKey } from '../../common/business-days';
import type { PrismaService } from '../../prisma/prisma.service';
import type { Ymd } from './sales-period';

export async function firstDataDay(db: Pick<PrismaService, 'order'>): Promise<Ymd | null> {
  const r = await db.order.aggregate({ where: { settledAt: { not: null } }, _min: { settledAt: true } });
  return r._min.settledAt ? toMexicoCityDateKey(r._min.settledAt) : null;
}
