/**
 * marketing-token-label.ts — validación de la etiqueta de un token `marketing-reader` (API_CONTRACT §MKT.G.6). PURO.
 *
 * `label`: recortado, 1-60 caracteres de `[A-Za-z0-9 ._-]`, y sin rachas de ≥7 dígitos (mismo filtro PII que las
 * anotaciones, `marketing-pii-filter.ts`). Si no ⇒ `422 VALIDATION_ERROR` con `details.field = 'label'`.
 */
import { BusinessException } from '../../common/business.exception';
import { containsPii } from './marketing-pii-filter';

const LABEL = /^[A-Za-z0-9 ._-]{1,60}$/;

export function parseTokenLabel(raw: unknown): string {
  const bad = (): never => {
    throw BusinessException.validation(
      'VALIDATION_ERROR',
      'label must be 1-60 characters of letters, digits, space, dot, underscore or hyphen, without personal data',
      { field: 'label' },
    );
  };
  if (typeof raw !== 'string') return bad();
  const label = raw.trim();
  if (!LABEL.test(label) || containsPii(label)) return bad();
  return label;
}
