/**
 * phone.util.ts — v1.96⟨cardshow-leads⟩ (API_CONTRACT §CARDSHOW.1b). Normalización de teléfono MX del
 * lead vendedor/patrocinador. Acepta `+52`/`52` y el `1` de móvil opcionales y separadores ` -()`;
 * persiste **solo 10 dígitos** (E.164 sin `+`, sin prefijo de país). Un valor que no reduce a 10 dígitos
 * MX ⇒ `null` (el servicio responde `400 {field:'phone'}`, ⛔ no silencioso).
 *
 * Ejemplos del contrato: `55 1234 5678` → `5512345678`; `+52 1 55 1234 5678` → `5512345678`.
 */
export function normalizeMxPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  let d = digits;
  if (d.length === 13 && d.startsWith('521')) d = d.slice(3); // +52 1 + 10 dígitos
  else if (d.length === 12 && d.startsWith('52')) d = d.slice(2); // +52 + 10 dígitos
  else if (d.length === 11 && d.startsWith('1')) d = d.slice(1); // 1 + 10 dígitos
  return /^\d{10}$/.test(d) ? d : null;
}
