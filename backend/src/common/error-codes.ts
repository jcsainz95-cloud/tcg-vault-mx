/**
 * error-codes.ts — Códigos de error estables (i18n en frontend). API_CONTRACT §0.
 * El backend NO devuelve texto traducido: devuelve `errorCode` + un mensaje EN de fallback.
 */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',

  // Auth
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  USER_BLOCKED: 'USER_BLOCKED',
  // v1.3.1: gestión de usuarios por admin (M6).
  USER_DELETED: 'USER_DELETED',
  CANNOT_DELETE_SELF: 'CANNOT_DELETE_SELF',
  // v1.1: login con Google (verificación server-side del ID token).
  GOOGLE_TOKEN_INVALID: 'GOOGLE_TOKEN_INVALID',
  GOOGLE_EMAIL_UNVERIFIED: 'GOOGLE_EMAIL_UNVERIFIED',
  // v1.5: verificación de correo + recuperación self-service (Resend).
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED', // acción sensible con emailVerified=false (guard)
  EMAIL_VERIFY_TOKEN_INVALID: 'EMAIL_VERIFY_TOKEN_INVALID', // token de verificación inválido/expirado/usado
  RESET_TOKEN_INVALID: 'RESET_TOKEN_INVALID', // token de reset inválido/expirado/usado

  // Money-out / roles
  MONEY_OUT_FORBIDDEN: 'MONEY_OUT_FORBIDDEN',

  // Catalog / pricing
  PRICE_PENDING: 'PRICE_PENDING',

  // Checkout / orders
  ITEM_UNAVAILABLE: 'ITEM_UNAVAILABLE',
  BILLING_PROFILE_REQUIRED: 'BILLING_PROFILE_REQUIRED',

  // Payments / Stripe
  AMOUNT_TOO_LOW: 'AMOUNT_TOO_LOW', // B2: por debajo del mínimo de Stripe MX
  CARD_DECLINED: 'CARD_DECLINED', // B1: StripeCardError mapeado a error de negocio legible
  PAYMENT_PROVIDER_UNAVAILABLE: 'PAYMENT_PROVIDER_UNAVAILABLE', // A2: fallo del PI → reintento

  // Shipments
  ADDRESS_NOT_MX: 'ADDRESS_NOT_MX',
  ITEM_NOT_SETTLED: 'ITEM_NOT_SETTLED',
  ITEM_IN_ANOTHER_SHIPMENT: 'ITEM_IN_ANOTHER_SHIPMENT',

  // Buylist
  BUYLIST_LIMIT_EXCEEDED: 'BUYLIST_LIMIT_EXCEEDED',
  INE_REQUIRED: 'INE_REQUIRED',
  CLABE_NOT_OWN_NAME: 'CLABE_NOT_OWN_NAME',
  CLABE_INVALID: 'CLABE_INVALID',
  // Una carta rechazada en verificación (resultado NO-NM, PROJECT §H) NUNCA puede
  // convertirse en InventoryItem vendible: convert-to-inventory exige itemStatus='aprobada'.
  ITEM_NOT_APPROVED: 'ITEM_NOT_APPROVED',

  // Disputes
  DISPUTE_WINDOW_CLOSED: 'DISPUTE_WINDOW_CLOSED',
  NOT_RAW: 'NOT_RAW',
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];
