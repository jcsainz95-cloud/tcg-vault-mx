/** §PROV F1 — correo de invitación / restablecimiento al proveedor. Pasa por el esqueleto de marca (PRIV-4). */
import { ctaRows, escapeHtml, headingRow, mailShell, proseRow, spacerRow } from '../buylist/mail-shell';

export function supplierInviteMail(link: string, businessName: string, reset: boolean): { subject: string; html: string; text: string } {
  const subject = reset ? 'Restablece tu contraseña de proveedor' : 'Te invitamos como tienda aliada';
  const intro = reset
    ? 'Pediste restablecer tu contraseña de proveedor.'
    : 'Te invitamos a ser tienda aliada de TCG HUNT: ahí verás qué cartas compramos y a qué precio.';
  const once = 'El enlace sirve una sola vez y vence en 72 horas.';
  const hi = `Hola ${businessName},`;
  const html = mailShell({
    locale: 'es',
    title: subject,
    preheader: reset ? 'Restablece tu contraseña de proveedor de TCG HUNT.' : 'Activa tu cuenta de proveedor de TCG HUNT para empezar.',
    blocks: [
      headingRow(escapeHtml(subject), 22),
      spacerRow(16),
      proseRow(escapeHtml(hi)),
      spacerRow(16),
      proseRow(escapeHtml(intro)),
      spacerRow(16),
      proseRow(escapeHtml(once)),
      spacerRow(32),
      ctaRows(link, reset ? 'RESTABLECER CONTRASEÑA' : 'ACTIVAR MI CUENTA', 'ink'),
    ],
    footerWhy: 'Recibes este correo porque el equipo de TCG HUNT te dio de alta como proveedor.',
  });
  return { subject, html, text: `${hi}\n\n${intro}\n${once}\n${link}\n` };
}
