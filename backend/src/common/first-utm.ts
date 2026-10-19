/**
 * first-utm.ts — EL validador PURO del primer-toque UTM (§MKT.C / ARCHITECTURE §13.1, B1 [PV-M2]).
 *
 * ### Qué hace
 * Dado un objeto de parámetros de query (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content` y
 * cualquier otra cosa), devuelve SOLO los cuatro utm VÁLIDOS, ya normalizados, bajo los nombres cortos
 * `source` / `medium` / `campaign` / `content`.
 *
 * ### La regla (normativa, PV-M2)
 *  - Solo se miran las cuatro claves `utm_source|utm_medium|utm_campaign|utm_content`; ⛔ cualquier otra
 *    clave se IGNORA (no viaja al resultado): `session_id`, `fbclid`, `token`, `email`, etc.
 *  - Cada valor se normaliza a **minúsculas** y se acepta SOLO si cumple `^[a-z0-9._-]{1,64}$`; si no,
 *    **ESE valor se descarta** (el resto puede guardarse). Así `juan@correo.com` (lleva `@`), `<script>`
 *    (lleva `<>`), un valor con espacios, acentos o de >64 caracteres, NUNCA se guardan — la regex ya los
 *    excluye, sin lista negra que mantener.
 *  - Un valor que no sea `string` (array de query duplicada, número) se descarta.
 *
 * ### Pureza y alcance
 * Es una función PURA: sin Prisma, sin Nest, sin estado, sin `now()`. Desde la Fase 2 (v1.102⟨mkt-fase2⟩) la usa
 * `sanitizeMeasurementInput` (`modules/measurement/measurement-input.ts`): con `MEASUREMENT_MODE=on` y consentimiento
 * registrado, las columnas `firstUtm*` de `Order`/`SellRequest` se escriben en el mismo `create`; con `off` quedan `NULL`.
 */

/** Los cuatro utm válidos, ya normalizados. Solo viajan las claves que pasaron la validación. */
export interface FirstUtmValues {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
}

/** PV-M2: minúsculas, 1–64 caracteres de `[a-z0-9._-]`. ⛔ Sin espacios, `@`, `<>`, acentos, etc. */
const UTM_VALUE_RE = /^[a-z0-9._-]{1,64}$/;

/** Clave de query → clave corta de salida. El iterar SOLO estas cuatro es lo que ignora las ajenas. */
const UTM_KEY_MAP: ReadonlyArray<readonly [keyof FirstUtmValues, string]> = [
  ['source', 'utm_source'],
  ['medium', 'utm_medium'],
  ['campaign', 'utm_campaign'],
  ['content', 'utm_content'],
];

/**
 * Valida y normaliza los primeros-toque UTM de un objeto de params. Ver el encabezado del archivo para
 * la regla completa. Nombre canónico (= el del contrato, §MKT.C). `parseFutm` es su alias.
 */
export function parseFirstUtm(params: Record<string, unknown> | null | undefined): FirstUtmValues {
  const out: FirstUtmValues = {};
  if (params == null || typeof params !== 'object') return out;
  for (const [outKey, queryKey] of UTM_KEY_MAP) {
    const raw = (params as Record<string, unknown>)[queryKey];
    if (typeof raw !== 'string') continue; // no-string (array/número/ausente) ⇒ se descarta
    const normalized = raw.toLowerCase();
    if (!UTM_VALUE_RE.test(normalized)) continue; // ESE valor no cumple ⇒ se descarta
    out[outKey] = normalized;
  }
  return out;
}

/**
 * Alias de `parseFirstUtm`. El contrato (§MKT.C) lo nombra `parseFirstUtm`; el encargo de backend lo
 * nombró `parseFutm`. Se exponen AMBOS, apuntando a la MISMA función, para que no exista ambigüedad ni
 * divergencia (una sola implementación, dos nombres).
 */
export const parseFutm = parseFirstUtm;
