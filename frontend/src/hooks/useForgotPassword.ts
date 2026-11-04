'use client';

import { useState } from 'react';
import { forgotPassword } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';

export type ForgotPasswordStatus = 'idle' | 'sending' | 'sent' | 'rateLimited' | 'error';

/**
 * «¿Olvidaste tu contraseña?» / «Mandar otro» por correo (contrato POST /auth/forgot-password, `public`). Un solo
 * sitio para los cuatro que lo piden (`ForgotPasswordView`, `InlineAuthPanel`, `TokenLinkInvalid`, `PasswordPage`;
 * TL-CTA-9, DESIGN_SYSTEM §CTA-UX.3b):
 * - 2xx ⇒ `sent` (respuesta genérica: no dice si el correo existe).
 * - 429 `RATE_LIMITED` ⇒ `rateLimited` (copy de tope de cada sitio).
 * - otro 4xx (validación) ⇒ `sent`, sin cambio: un 400 por formato no debe distinguirse de un correo sin cuenta.
 * - 5xx o fallo de red (no es `ApiClientError`) ⇒ `error`: ⛔ nunca «enviado» si no se mandó. No es oráculo de
 *   enumeración: el servidor responde `{ok:true}` antes de buscar la cuenta, así que un 5xx no depende de ella.
 * El correo lo guarda cada sitio (el hook no lo toca), así que tras `error` sigue en el campo para reintentar.
 */
export function useForgotPassword() {
  const [status, setStatus] = useState<ForgotPasswordStatus>('idle');

  async function send(email: string) {
    setStatus('sending');
    try {
      await forgotPassword(email);
      setStatus('sent');
    } catch (e) {
      setStatus(classifyForgotPasswordError(e));
    }
  }

  return { status, send, reset: () => setStatus('idle') };
}

export function classifyForgotPasswordError(e: unknown): Exclude<ForgotPasswordStatus, 'idle' | 'sending'> {
  if (!(e instanceof ApiClientError)) return 'error';
  if (e.code === 'RATE_LIMITED') return 'rateLimited';
  if (e.status >= 400 && e.status < 500) return 'sent';
  return 'error';
}
