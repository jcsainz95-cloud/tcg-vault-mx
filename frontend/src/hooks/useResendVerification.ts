'use client';

import { useState } from 'react';
import { resendVerificationEmail } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';

export type ResendStatus = 'idle' | 'sending' | 'sent' | 'rateLimited' | 'error';

/**
 * Reenvío del correo de verificación (contrato POST /auth/verify-email/resend, AUTENTICADO).
 * Comparte la lógica entre el banner del shell y el aviso de 403 EMAIL_NOT_VERIFIED, con
 * feedback de estado: sending → sent ("correo enviado") | rateLimited (429) | error.
 */
export function useResendVerification() {
  const [status, setStatus] = useState<ResendStatus>('idle');

  async function resend() {
    setStatus('sending');
    try {
      await resendVerificationEmail();
      setStatus('sent');
    } catch (e) {
      const code = e instanceof ApiClientError ? e.code : undefined;
      setStatus(code === 'RATE_LIMITED' ? 'rateLimited' : 'error');
    }
  }

  return { status, resend };
}
