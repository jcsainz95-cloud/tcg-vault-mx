/**
 * Enlaces armados con datos del servidor o de terceros (FE-1, qa 2026-11-22).
 * `safeHttpUrl`: solo `http:`/`https:` absolutos; `javascript:`, `data:` y lo no parseable ⇒ `null` (no se pinta enlace).
 * `mailtoHref`: el correo se codifica (`encodeURIComponent`) salvo la `@`, para que `?`, `&` o espacios no inyecten
 * parámetros (`?bcc=…`) en el `mailto:`.
 */
export function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function mailtoHref(email: string, subject?: string): string {
  const addr = encodeURIComponent(email.trim()).replace(/%40/g, '@');
  return `mailto:${addr}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;
}
