'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useForgotPassword } from '@/hooks/useForgotPassword';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';

/**
 * Pantalla "olvidé mi contraseña" (contrato POST /auth/forgot-password, `public`).
 * El endpoint SIEMPRE responde 200 exista o no el email (anti-enumeración): por eso
 * tras enviar se muestra SIEMPRE el mismo mensaje genérico, sin revelar si el correo
 * existe. 429 ⇒ aviso de tope; 5xx o red ⇒ `Banner danger` y el correo se queda para reintentar (TL-CTA-9,
 * §CTA-UX.3b; reglas en `useForgotPassword`).
 */
export function ForgotPasswordView() {
  const t = useTranslations('forgotPassword');
  const [email, setEmail] = useState('');
  const { status, send } = useForgotPassword();
  const submitting = status === 'sending';

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void send(email);
  }

  if (status === 'sent') {
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

      {status === 'rateLimited' && (
        <Banner variant="warning" role="alert">
          {t('rateLimited')}
        </Banner>
      )}
      {status === 'error' && (
        <Banner variant="danger" role="alert">
          {t('sendError')}
        </Banner>
      )}

      {/*
        ⭐ v1.80.9 (DESIGN_SYSTEM §42.2, criterio 262): `type="text"` para que el NAVEGADOR no rechace un
        usuario con su propio mensaje (sería distinto del de un correo inexistente ⇒ señal). El servidor
        responde `200 {ok:true}` igual (§M6-U.3). ⛔ Misma etiqueta «Correo»: la pantalla no menciona usuarios.
      */}
      <Input
        label={t('email')}
        name="email"
        type="text"
        inputMode="email"
        autoCapitalize="none"
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
