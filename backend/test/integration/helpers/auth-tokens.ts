/**
 * auth-tokens.ts — utilidades de prueba para los tokens de un uso (v1.117.2, API_CONTRACT §CTA.13). Propiedad: backend.
 *
 * - `issueAuthToken`: emite un token como lo hace la app — DENTRO del candado de la cuenta y atado al correo actual. `issue`
 *   exige `tx` (no hay emisión fuera del candado), así que las pruebas pasan por aquí.
 * - `authBackgroundIdle`: espera el trabajo de fondo de `forgot-password` (D-CTA-14: responde antes de buscar la cuenta, así
 *   que tras el `200` el token y el correo llegan un instante después).
 */
import { AuthTokenType } from '@prisma/client';
import { E2EHarness } from './e2e-app';
import { withAccountGate } from '../../../src/modules/auth/account-gate';
import { AuthTokenService } from '../../../src/modules/auth/auth-token.service';
import { AuthService } from '../../../src/modules/auth/auth.service';

export function issueAuthToken(h: E2EHarness, userId: string, type: AuthTokenType): Promise<string> {
  const svc = h.app.get(AuthTokenService);
  return withAccountGate(h.prisma, userId, async (tx) => {
    const u = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true } });
    if (u.email === null) throw new Error(`issueAuthToken: la cuenta ${userId} no tiene correo`);
    return svc.issue(tx, { id: u.id, email: u.email }, type);
  });
}

export function authBackgroundIdle(h: E2EHarness): Promise<void> {
  return h.app.get(AuthService).backgroundIdle();
}
