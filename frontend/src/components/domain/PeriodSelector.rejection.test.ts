import { describe, it, expect } from 'vitest';
import { ApiClientError } from '@/lib/api-client';
import { isPeriodRejection } from './PeriodSelector';

/** §2 «Caídas del selector»: solo 400/422 CON `VALIDATION_ERROR` mandan de vuelta a «Este mes»; cualquier otro fallo no. */
describe('isPeriodRejection', () => {
  const e = (status: number, code: string) => new ApiClientError(status, { code, message: 'x' });
  it('400/422 VALIDATION_ERROR ⇒ sí', () => {
    expect(isPeriodRejection(e(400, 'VALIDATION_ERROR'))).toBe(true);
    expect(isPeriodRejection(e(422, 'VALIDATION_ERROR'))).toBe(true);
  });
  it('400/422 con otro código, otros estados, no-ApiClientError y vacío ⇒ no', () => {
    expect(isPeriodRejection(e(400, 'BAD_REQUEST'))).toBe(false);
    expect(isPeriodRejection(e(422, 'PERIOD_TOO_LONG'))).toBe(false);
    expect(isPeriodRejection(e(500, 'VALIDATION_ERROR'))).toBe(false);
    expect(isPeriodRejection(e(403, 'FORBIDDEN'))).toBe(false);
    expect(isPeriodRejection(new Error('x'))).toBe(false);
    expect(isPeriodRejection(null)).toBe(false);
  });
});
