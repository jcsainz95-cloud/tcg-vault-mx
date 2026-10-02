/**
 * 🔒 v1.80.7 (API_CONTRACT §0 «429 RATE_LIMITED», norma de forma) — con ventana conocida el filtro devuelve
 * `details: { retryAfterSeconds: n }` con la MISMA `n` que la cabecera `Retry-After` que el throttler ya puso en la
 * respuesta; sin cabecera ⇒ `details {}`; un `RATE_LIMITED` de negocio sin ventana ⇒ `details {}`. ⛔ Ninguna cifra
 * inventada. La medida en vivo (login ×6) está en `test/integration/auth-throttle.e2e-spec.ts`.
 */
import { ArgumentsHost, HttpException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { BusinessException } from '../src/common/business.exception';

function respuesta(headers: Record<string, string | number> = {}) {
  const res: any = {
    statusCode: 0,
    body: undefined as any,
    headers: { ...headers },
    getHeader: jest.fn((k: string) => res.headers[k] ?? res.headers[k.toLowerCase()]),
    setHeader: jest.fn((k: string, v: string) => {
      res.headers[k] = v;
    }),
    status: jest.fn((s: number) => {
      res.statusCode = s;
      return res;
    }),
    json: jest.fn((b: unknown) => {
      res.body = b;
      return res;
    }),
  };
  return res;
}

function lanzar(e: unknown, headers: Record<string, string | number> = {}) {
  const res = respuesta(headers);
  const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({}) }) } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(e, host);
  return res;
}

describe('429 RATE_LIMITED — la forma (v1.80.7)', () => {
  it('ThrottlerException con `Retry-After: 37` ⇒ 429 RATE_LIMITED y `details { retryAfterSeconds: 37 }`', () => {
    const res = lanzar(new ThrottlerException(), { 'Retry-After': 37 });
    expect(res.statusCode).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.body.error.details).toEqual({ retryAfterSeconds: 37 });
  });

  it('la cabecera como texto (Express la guarda así) ⇒ el mismo entero', () => {
    const res = lanzar(new ThrottlerException(), { 'Retry-After': '12' });
    expect(res.body.error.details).toEqual({ retryAfterSeconds: 12 });
  });

  it('429 sin cabecera ⇒ `details {}` (⛔ sin cifra inventada, ⛔ sin `{statusCode, message}` del framework)', () => {
    const res = lanzar(new HttpException('Too many', 429));
    expect(res.statusCode).toBe(429);
    expect(res.body.error.details).toEqual({});
    const res2 = lanzar(new ThrottlerException(), { 'Retry-After': '0' });
    expect(res2.body.error.details).toEqual({});
  });

  it('RATE_LIMITED de negocio (sin ventana) ⇒ `details {}`', () => {
    const res = lanzar(new BusinessException('RATE_LIMITED', 429, 'Too many verification emails; try later'));
    expect(res.statusCode).toBe(429);
    expect(res.body.error).toEqual({ code: 'RATE_LIMITED', message: 'Too many verification emails; try later', details: {} });
  });
});
