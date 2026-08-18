/**
 * Constantes de servidor del GUEST CHECKOUT (v1.21). API_CONTRACT §4-G.10 / ARCHITECTURE §11.
 *
 * NO son diales de M10 a propósito: siguen el precedente de las ventanas 7d/30d del buylist
 * (v1.18) y evitan tocar el módulo `settings` (otro work stream). Promoverlas a `ConfigSetting`
 * más adelante es NO-BREAKING. La tarifa de envío NO vive aquí: reusa el dial existente
 * `SHIPPING_FEE_CENTS` (default 17500).
 */

/**
 * TTL del enlace de SEGUIMIENTO —el que viaja por correo (settle / reenvío / soporte)—: 90 días
 * (cubre entrega + ventana de disputa de 7d con margen). API_CONTRACT §4-G.7a.
 */
export const GUEST_TRACKING_TTL_DAYS = 90;

/**
 * v1.21.1 (§4-G.7a, ARCHITECTURE §4.21e-bis / amenaza T7b) — TTL del token de CHECKOUT, el único
 * que la API devuelve en claro (respuesta de `POST /checkout/guest/session`): **120 minutos**.
 *
 * Existe para UNA sola cosa: sobrevivir al redirect 3DS de Stripe y pintar la confirmación +
 * seguimiento inmediato, cuando el navegador puede haber perdido el estado y no hay sesión.
 * **Nunca se envía por correo.** Es una fila `OrderAccessToken` normal: lo ÚNICO que lo distingue
 * del token de seguimiento es su `expiresAt` (sin columna nueva, sin migración).
 *
 * Por qué corto: el claro es irrecuperable (en BD solo vive el SHA-256 — propiedad de seguridad
 * T5), así que el correo del settle lleva **otro** token y ambos coexisten. Con 120 min el
 * solapamiento de dos puertas sin contraseña dura **≤2 horas** en vez de los 90 días que suponía
 * emitir ambas con la misma vida (T7b).
 */
export const GUEST_CHECKOUT_TOKEN_TTL_MIN = 120;

/** Tope de edad del pedido para EMITIR enlaces nuevos: 365 días. Después, la vía es el reclamo. */
export const GUEST_TRACKING_MAX_AGE_DAYS = 365;

/** Tope de enlaces emitidos por pedido en 24h (cuenta filas `OrderAccessToken`). */
export const GUEST_RESEND_MAX_PER_DAY = 5;

/** Máximo de líneas por pedido de invitado (anti-DoS de inventario, T9). */
export const GUEST_MAX_ITEMS = 20;

/** Minutos que una orden de invitado `pending` retiene la reserva antes del barrido (T9). */
export const GUEST_ORDER_RESERVATION_TTL_MIN = 60;

/** Ventana de disputa de condición (PROJECT §H): 7 días desde la ENTREGA. */
export const GUEST_DISPUTE_WINDOW_DAYS = 7;

/** Canal de evidencia de disputa (criterio 56b). Mismo valor que expone §7 para clientes. */
export const SUPPORT_EVIDENCE_CONTACT = 'soporte@tcgvaultmx.com';

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Estado público del pedido de invitado (§4-G.5). NO es una columna: se DERIVA de
 * `Order.status` + el `ShipmentRequest` del pedido. La API devuelve el enum; el texto legible
 * vive en la i18n del front (§0).
 */
export type GuestOrderPublicStatus =
  | 'pendiente_pago'
  | 'pagado'
  | 'preparando'
  | 'guia'
  | 'enviado'
  | 'entregado'
  | 'en_revision'
  | 'cancelado'
  | 'reembolsado';
