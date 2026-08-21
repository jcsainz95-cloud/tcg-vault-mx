/**
 * v1.2 — Correo de soporte donde el cliente envía la EVIDENCIA de una disputa de condición
 * (ya no se sube foto a la app; ver API_CONTRACT §7 y ARCHITECTURE §3.6). Se expone como
 * `evidenceContact` en la respuesta de creación y en el detalle admin.
 *
 * SUPUESTO/placeholder por confirmar por el humano (PROJECT.md › Restricciones técnicas).
 * Overridable por env `DISPUTE_EVIDENCE_CONTACT` sin redeploy de código.
 * P-21 (rebrand): el default conserva el buzón histórico; cuando exista `soporte@tcghunt.mx`,
 * devops fija la env (misma env que consume `orders/guest-checkout.constants.ts` y, en cascada,
 * `buylist-mail.templates.ts`).
 * P-21 cierre: `envOr` (no `??`) — env definida pero vacía/blanca cae al default (evita exponer
 * `evidenceContact: ""` en la API).
 */
import { envOr } from '../mail/mail-env.util';

export const DISPUTE_EVIDENCE_CONTACT = envOr(
  process.env.DISPUTE_EVIDENCE_CONTACT,
  'soporte@tcgvaultmx.com',
);
