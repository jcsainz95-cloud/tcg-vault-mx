/**
 * Helpers PUROS de minimización de datos de la vista pública de seguimiento (§4-G.3) y de los
 * correos del guest checkout. Viven en `orders/` (no en `common/crypto/pii-mask.ts`, que es zona
 * de otro stream) y NO tienen dependencias de infraestructura, para poder testearlos como
 * funciones puras: la minimización es requisito de PAYLOAD, no de UI.
 */

/**
 * Correo enmascarado `j***@***.com`: confirma al comprador QUÉ correo usó sin revelarlo (ni a
 * quien reenvíe el enlace). Se conserva la primera letra del local-part y el TLD; el dominio y el
 * resto se ocultan. Nunca devuelve el correo completo.
 */
export function maskEmail(email?: string | null): string {
  if (!email) return '';
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const tld = dot >= 0 ? domain.slice(dot) : '';
  return `${local[0]}***@***${tld}`;
}

/** CP enmascarado `***45`: SOLO los 2 últimos dígitos (PROJECT §J). */
export function maskPostalCode(postalCode?: string | null): string {
  if (!postalCode) return '';
  return `***${postalCode.slice(-2)}`;
}

/**
 * Nombre del destinatario enmascarado `Juan P.`: nombre de pila + inicial del primer apellido.
 * Nunca el nombre completo (PROJECT §J).
 */
export function maskRecipientName(name?: string | null): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[1][0].toUpperCase()}.`;
}

/** Normalización canónica del correo del invitado: trim + lowercase (§4-G.2). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
