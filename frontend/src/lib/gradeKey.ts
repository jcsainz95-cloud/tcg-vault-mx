/**
 * `gradeKey` — la CLAVE DE DINERO de una fila de precio (contrato §M2).
 *
 * Su forma canónica para gradeadas es **`graded:<company>:<grade>`** (p. ej. `graded:PSA:10`) y la
 * comparte más de un consumidor: `POST /admin/pricing/override`, la pestaña Gradeadas de M1, el
 * cajón de variante, la captura de estimados del gancho (§O) y la guarda INV-D del backend
 * (`publishedSlabsForGradeKey`, que parte la clave con este mismo criterio).
 *
 * Estaba interpolada a mano en varios sitios. Se centraliza porque un `gradeKey` mal armado no
 * falla ruidosamente: escribe una fila **distinta** de la que el lector busca, y el síntoma aparece
 * después y en otro sitio (un precio que «no se guardó», o peor, uno que se guardó donde no debía).
 */

/** Clave canónica de la cara RAW (contrato: `raw:NM`; NO es un default inventado por el cliente). */
export const RAW_GRADE_KEY = 'raw:NM';

/** `("PSA", "10") → "graded:PSA:10"`. */
export function buildGradedKey(company: string, gradeValue: string): string {
  return `graded:${company}:${gradeValue}`;
}

/**
 * Parte una clave graded. Devuelve `null` si no tiene la forma canónica — mismo criterio que la
 * guarda del backend: una clave con otra forma **no se adivina**.
 */
export function parseGradedKey(key: string): { company: string; gradeValue: string } | null {
  const parts = key.split(':');
  if (parts.length !== 3 || parts[0] !== 'graded') return null;
  const [, company, gradeValue] = parts;
  if (!company || !gradeValue) return null;
  return { company, gradeValue };
}

/** Etiqueta legible de una clave graded (`graded:PSA:10` → `PSA 10`); `null` si no es graded. */
export function gradeLabelFromKey(key: string): string | null {
  const parsed = parseGradedKey(key);
  return parsed ? `${parsed.company} ${parsed.gradeValue}` : null;
}
