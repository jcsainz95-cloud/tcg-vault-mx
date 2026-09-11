import { IS_REAL, apiAsOk } from './env';

/**
 * Descubrimiento de PEDIDOS del propio cliente para los E2E (contrato §4 · `GET /orders`).
 *
 * Existe por el hallazgo **H-4** de QA: los specs de «Reanudar pago» eran `mockOnly` *«depende de
 * ord-9002 / ord-9003 de las fixtures»*. Una parte de eso se mide perfectamente contra el stack
 * —que el folio de la columna PEDIDO sea el que sirve el backend, y que un pedido que NO está
 * `pending` **no** ofrezca reanudar— sin ningún id horneado: se descubre la fila desde la API y se
 * afirma sobre ELLA.
 *
 * Lo que **no** se puede fabricar aquí hoy es un `pending` con reserva viva, y está MEDIDO, no
 * supuesto (2026-09-11, stack nativo `1522b45`):
 *
 * ```
 * POST /api/v1/checkout/session {"inventoryItemIds":[…]}
 *   ⇒ 503 {"code":"PAYMENT_PROVIDER_UNAVAILABLE","message":"…the reservation was released…"}
 *   ⇒ GET /orders: el pedido queda `failed` y con `reservedUntil: null`
 * ```
 *
 * Sin Stripe no hay `pending`, así que los casos que lo necesitan se **saltan con esa razón
 * impresa** (`skipIfSeedMissing`) en vez de declararse mock-only: el día que el entorno tenga
 * claves de prueba, corren solos.
 */
export interface OrderRow {
  id: string;
  orderNumber: string | null;
  status: string;
  reservedUntil?: string | null;
  totalCents: number;
}

async function myOrders(): Promise<OrderRow[]> {
  const res = await apiAsOk<{ data: OrderRow[] }>('customer', 'GET', '/orders?pageSize=50');
  return res.data;
}

/**
 * Un pedido **con folio del servidor** para afirmar la columna PEDIDO. Devuelve `null` si la cuenta
 * no tiene ninguno (⇒ el caso se salta diciendo que falta el dato, no que sea mock-only).
 */
export async function anyOrderWithNumber(): Promise<OrderRow | null> {
  if (!IS_REAL) return null;
  return (await myOrders()).find((o) => typeof o.orderNumber === 'string' && o.orderNumber !== '') ?? null;
}

/** Un pedido que NO está `pending`: el que **no** debe ofrecer «Reanudar pago». */
export async function anySettledOrder(): Promise<OrderRow | null> {
  if (!IS_REAL) return null;
  return (await myOrders()).find((o) => o.status !== 'pending') ?? null;
}

/**
 * Un pedido `pending` con reserva VIVA — el único que ofrece «Reanudar pago» (§4-R.5). Hoy, sin
 * proveedor de pagos, no existe: ver la medición del encabezado.
 */
export async function anyResumableOrder(): Promise<OrderRow | null> {
  if (!IS_REAL) return null;
  const now = Date.now();
  return (
    (await myOrders()).find(
      (o) =>
        o.status === 'pending' &&
        typeof o.reservedUntil === 'string' &&
        new Date(o.reservedUntil).getTime() > now,
    ) ?? null
  );
}
