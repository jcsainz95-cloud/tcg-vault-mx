/**
 * v1.2 — Correo de soporte donde el cliente envía la EVIDENCIA de una disputa de condición
 * (ya no se sube foto a la app; ver API_CONTRACT §7 y ARCHITECTURE §3.6). Se expone como
 * `evidenceContact` en la respuesta de creación y en el detalle admin.
 *
 * SUPUESTO/placeholder por confirmar por el humano (PROJECT.md › Restricciones técnicas).
 * Overridable por env `DISPUTE_EVIDENCE_CONTACT` sin redeploy de código.
 */
export const DISPUTE_EVIDENCE_CONTACT =
  process.env.DISPUTE_EVIDENCE_CONTACT ?? 'soporte@tcgvault.mx';
