import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { BusinessException } from '../../../common/business.exception';

/** `?userId=` de las listas de reembolsos (§FICHA-CLIENTE §2): vacío ≡ ausente; lo que no es uuid ⇒ 400 (nunca llega a Prisma). */
export function parseCustomerUserId(raw: unknown): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string' || !isUUID(raw)) {
    throw BusinessException.badRequest('VALIDATION_ERROR', 'userId must be a uuid', { field: 'userId' });
  }
  return raw;
}

/**
 * Los reembolsos de tarjeta de ESTE cliente: el comprador del libro es `shipmentRequest.userId ?? order.userId`
 * (misma regla que `GET /admin/refunds` al pintar `customer`). Lo comparten esa lista (`?userId=`) y `overview`.
 */
export const paymentRefundOfCustomer = (userId: string): Prisma.PaymentRefundWhereInput => ({
  OR: [{ shipmentRequest: { userId } }, { order: { userId } }],
});
