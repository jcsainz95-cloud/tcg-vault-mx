import { describe, it, expect } from 'vitest';
import { ApiClientError } from '@/lib/api-client';
import { classifyForgotPasswordError } from './useForgotPassword';

/**
 * TL-CTA-9 (DESIGN_SYSTEM §CTA-UX.3b): la regla única de los cuatro «olvidé». 429 conserva su tope; 4xx de validación
 * sigue siendo la respuesta genérica; 5xx y red son error, nunca «enviado».
 */
describe('useForgotPassword · clasificación del fallo', () => {
  it.each([
    ['429 RATE_LIMITED', new ApiClientError(429, { code: 'RATE_LIMITED', message: 'x' }), 'rateLimited'],
    ['400 validación', new ApiClientError(400, { code: 'VALIDATION_ERROR', message: 'x' }), 'sent'],
    ['500', new ApiClientError(500, { code: 'INTERNAL', message: 'x' }), 'error'],
    ['503', new ApiClientError(503, { code: 'INTERNAL', message: 'x' }), 'error'],
    ['red caída (TypeError)', new TypeError('Failed to fetch'), 'error'],
    ['valor no Error', 'boom', 'error'],
  ] as const)('%s ⇒ %s', (_l, err, expected) => {
    expect(classifyForgotPasswordError(err)).toBe(expected);
  });
});
