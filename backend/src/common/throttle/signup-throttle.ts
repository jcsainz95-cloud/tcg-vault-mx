import { ExecutionContext, SetMetadata } from '@nestjs/common';
import { ThrottlerOptions } from '@nestjs/throttler';
import { createHash } from 'crypto';

/**
 * v1.117⟨cuenta-correo⟩ (API_CONTRACT §CTA.4 «Límite contra enumeración», ARCHITECTURE §16 D-CTA-6) — los throttlers con
 * nombre del alta. El `409 EMAIL_TAKEN` de `register` y de `register/email-only` revela que la cuenta existe (decisión del
 * dueño, P-CTA-3); se ACOTA:
 *  - `signup`: 5/min por IP **compartido** entre las dos rutas (no 5 + 5). El `generateKey` por defecto de Nest mete clase y
 *    handler en la clave (un cubo por ruta): aquí la clave es solo `signup:<ip>` ⇒ un cubo para las dos.
 *  - `signup-day`: 30 / 24 h por IP, solo en `email-only`; cuenta `201`, `409` y `400` (el guard corre antes que el pipe).
 *  - IP = `req.ip` con `trust proxy = 1` (última entrada de `X-Forwarded-For`, C7-18), el tracker por defecto.
 * Cada ruta elige sus cubos con `@SignupThrottle(...)`; en las demás rutas los dos se saltan (`skipIf`). El `default` global
 * (300/min) y los `@Throttle({ default })` por ruta no cambian.
 */
export const SIGNUP_THROTTLER = 'signup';
export const SIGNUP_DAY_THROTTLER = 'signup-day';
export const SIGNUP_LIMIT_PER_MINUTE = 5;
export const SIGNUP_DAY_LIMIT = 30;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type SignupThrottlerName = typeof SIGNUP_THROTTLER | typeof SIGNUP_DAY_THROTTLER;
export const SIGNUP_THROTTLERS_KEY = 'tcg:signupThrottlers';

/** Marca la ruta con los cubos del alta que gasta. */
export const SignupThrottle = (...names: SignupThrottlerName[]) => SetMetadata(SIGNUP_THROTTLERS_KEY, names);

function routeUses(context: ExecutionContext, name: SignupThrottlerName): boolean {
  const names = Reflect.getMetadata(SIGNUP_THROTTLERS_KEY, context.getHandler()) as SignupThrottlerName[] | undefined;
  return Array.isArray(names) && names.includes(name);
}

/** Clave compartida entre rutas: solo nombre del cubo + tracker (IP). Hash como el de Nest (no deja la IP en claro). */
function sharedKey(_context: ExecutionContext, tracker: string, throttlerName: string): string {
  return createHash('sha256').update(`${throttlerName}-${tracker}`).digest('hex');
}

/** La configuración de `ThrottlerModule.forRoot` de la app (una fuente: la usan `app.module.ts` y sus pruebas). */
export const APP_THROTTLERS: ThrottlerOptions[] = [
  { name: 'default', ttl: MINUTE_MS, limit: 300 },
  {
    name: SIGNUP_THROTTLER,
    ttl: MINUTE_MS,
    limit: SIGNUP_LIMIT_PER_MINUTE,
    skipIf: (ctx) => !routeUses(ctx, SIGNUP_THROTTLER),
    generateKey: sharedKey,
  },
  {
    name: SIGNUP_DAY_THROTTLER,
    ttl: DAY_MS,
    limit: SIGNUP_DAY_LIMIT,
    skipIf: (ctx) => !routeUses(ctx, SIGNUP_DAY_THROTTLER),
    generateKey: sharedKey,
  },
];
