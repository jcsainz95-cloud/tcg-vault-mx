/**
 * P-21 (ronda de cierre, condición techlead) — helper ÚNICO para leer envs de correo con default.
 *
 * Problema que resuelve: `??` solo cubre `undefined`/`null`; con la env DEFINIDA pero VACÍA
 * (`MAIL_FROM=`, `DISPUTE_EVIDENCE_CONTACT=`) el valor efectivo era `''` → Resend rechazaba TODO
 * envío (from vacío) o la API devolvía `evidenceContact: ""`. `envOr` trata **vacío/blanco como
 * ausente** y devuelve el valor SANEADO (trim) cuando sí hay contenido.
 *
 * Vive aquí (módulo `mail`) y NO en `src/common/` a propósito: `common/` es zona compartida
 * serializada entre streams, y los cuatro consumidores son de correo y ya dependen de `mail/`
 * (`mail.module.ts`, `disputes.constants.ts`, `orders/guest-checkout.constants.ts`,
 * `buylist-mail.templates.ts`). Promoverlo a `common/` cuando quede libre es NO-BREAKING
 * (ver TECH_DEBT BE-P21-2).
 */
export function envOr(value: string | undefined | null, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}
