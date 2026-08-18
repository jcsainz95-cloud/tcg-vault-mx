/**
 * MOCK: pendiente de contrato — correo de soporte para las pantallas de invitado que NO
 * tienen un DTO donde leerlo.
 *
 * El contrato expone `support.evidenceContact` **solo** dentro del `GuestOrderTrackingDTO`
 * (§4-G.3), es decir, después de canjear el token de seguimiento. La confirmación de compra
 * (§15.5) y el estado neutro de enlace (§15.7) necesitan el mismo dato ANTES de tener ese
 * DTO, y el sistema de diseño prohíbe hardcodearlo en el componente (§7.11).
 *
 * Mientras el arquitecto no exponga un endpoint/campo público de configuración, se usa el
 * valor NORMATIVO que el propio contrato fija para ese campo, centralizado aquí para que
 * cambiarlo sea una sola línea. Solicitud registrada en docs/FRONTEND_NOTES.md.
 */
export const SUPPORT_CONTACT_FALLBACK = 'soporte@tcgvaultmx.com';
