'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { forgotPassword } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';

/**
 * Pantalla "olvidé mi contraseña" (contrato POST /auth/forgot-password, `public`).
 * El endpoint SIEMPRE responde 200 exista o no el email (anti-enumeración): por eso
 * tras enviar se muestra SIEMPRE el mismo mensaje genérico, sin revelar si el correo
 * existe. Único error posible del front: 429 RATE_LIMITED (aviso de reintento).
 */
export function ForgotPasswordView() {
  const t = useTranslations('forgotPassword');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setRateLimited(false);
    setSubmitting(true);
    try {
      await forgotPassword(email);
      setSent(true);
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : undefined;
      // Solo el rate-limit se distingue; cualquier otro fallo se trata como enviado
      // para no revelar señal (el backend nunca revela existencia).
      if (code === 'RATE_LIMITED') setRateLimited(true);
      else setSent(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-h2 font-bold">{t('title')}</h1>
        {/* Mensaje genérico: NO revela si el correo existe (anti-enumeración). */}
        <Banner variant="info" role="status" title={t('sentTitle')}>
          {t('sentBody')}
        </Banner>
        <Link href="/login" className="text-center text-sm text-primary hover:underline">
          {t('backToLogin')}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <h1 className="text-h2 font-bold">{t('title')}</h1>
      <p className="text-sm text-muted">{t('subtitle')}</p>

      {rateLimited && (
        <Banner variant="warning" role="alert">
          {t('rateLimited')}
        </Banner>
      )}

      <Input
        label={t('email')}
        name="email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <Button type="submit" loading={submitting} className="w-full">
        {submitting ? t('submitting') : t('submit')}
      </Button>
      <Link href="/login" className="text-center text-sm text-primary hover:underline">
        {t('backToLogin')}
      </Link>
    </form>
  );
}
