'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Link } from '@/i18n/navigation';
import { login, register } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { config } from '@/lib/config';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { GoogleSignInButton } from './GoogleSignInButton';
import { buildPasswordChangeRedirect, homeForRole, passwordRouteForRole, safeNext as safeNextOf } from '@/lib/account-routes';
import type { UserDTO } from '@/types/contract';

export function AuthForm({
  mode,
  notice,
  next,
}: {
  mode: 'login' | 'register';
  /** Aviso a mostrar (p. ej. cierre por inactividad). */
  notice?: 'inactivity';
  /** Destino a preservar tras el login (viene de `?next=` del gate de admin). */
  next?: string;
}) {
  const t = useTranslations('auth');
  const tErr = useTranslations('error');
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  // Solo se honra un `next` interno (empieza con "/") para evitar open redirect.
  const safeNext = safeNextOf(next);

  /**
   * Destino tras la sesión creada (login, registro o Google):
   * - v1.67 (contrato «Contraseña temporal OBLIGATORIA», DESIGN_SYSTEM §33.8 paso 1): con
   *   `user.mustChangePassword` se navega DIRECTO a la página de contraseña del rol
   *   (`/account/password` | `/admin/account/password`) — sin banner ni «Continuar» — y el
   *   `?next=` **no se consume: se reenvía** para que esa página lo honre tras el `200`.
   *   `replace`, no `push`: el login no debe quedar en el historial detrás de un bloqueo.
   * - Si no: `?next=` seguro, o el home del rol (staff → `/admin`, resto → `/`).
   */
  function redirectAfterAuth(user?: UserDTO) {
    if (user?.mustChangePassword) {
      // Misma construcción que los guards y el interceptor (F2-3), sin `reason` (aquí no hay
      // banner). `null` solo si el propio `next` era ya una página de contraseña: se va a ella a secas.
      router.replace(
        buildPasswordChangeRedirect(user.role, safeNext ?? '/', { reason: null }) ??
          passwordRouteForRole(user.role),
      );
      return;
    }
    router.push(safeNext ?? homeForRole(user?.role));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorCode(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    try {
      // Email/contraseña es la acción PRIMARIA (contrato §1 /auth/login|register).
      // Redirige según el rol devuelto en AuthResponse.user.role (admin → /admin).
      if (mode === 'login') {
        const res = await login({ email, password });
        redirectAfterAuth(res.user);
      } else {
        const res = await register({
          email,
          password,
          name: String(form.get('name') ?? ''),
          phone: String(form.get('phone') ?? '') || undefined,
        });
        redirectAfterAuth(res.user);
      }
    } catch (err) {
      setErrorCode(err instanceof ApiClientError ? err.code : 'INTERNAL');
      setLoading(false);
    }
  }

  return (
    /*
     * 6g — El formulario ya no es una tarjeta flotante: vive sobre el papel de la
     * media pantalla derecha (ver (auth)/layout.tsx). Los campos son reglas, el
     * título va en mincho y Google queda bajo el divisor como alternativa neutra.
     */
    <form onSubmit={onSubmit} className="flex flex-col">
      <h1 className="font-serif text-[30px] leading-[1.1] text-text lg:text-[38px]">
        {mode === 'login' ? t('loginTitle') : t('registerTitle')}
      </h1>
      {/* El aviso de "sesión simulada" solo aplica en modo mock; en producción
          el formulario pega al backend real, así que no debe mostrarse. */}
      <div className="empty:hidden [&>*]:mt-7">
        {config.useMocks && <Banner variant="info">{t('mockNotice')}</Banner>}
        {notice === 'inactivity' && (
          <Banner variant="warning" role="status">
            {t('inactivityLogout')}
          </Banner>
        )}
        {errorCode && (
          <Banner variant="danger" role="alert">
            {tErr.has(errorCode) ? tErr(errorCode) : tErr('INTERNAL')}
          </Banner>
        )}
      </div>
      <div className="[&>*]:mt-8">
        {mode === 'register' && (
          <>
            <Input label={t('name')} name="name" autoComplete="name" required />
            <Input label={t('phone')} name="phone" type="tel" inputMode="tel" autoComplete="tel" />
          </>
        )}
        <Input label={t('email')} name="email" type="email" autoComplete="email" required />
        <Input
          label={t('password')}
          name="password"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
        />
      </div>

      <Button type="submit" loading={loading} className="mt-10 w-full">
        {loading ? t('loading') : mode === 'login' ? t('loginCta') : t('registerCta')}
      </Button>

      {mode === 'login' && (
        <Link href="/forgot-password" className="mt-5 text-center text-sm text-accent hover:text-text">
          {t('forgotPassword')}
        </Link>
      )}

      {/* Divisor "o / or" — Google es alternativa neutra, no compite como CTA */}
      <div className="mt-9 flex items-center gap-4" aria-hidden>
        <span className="h-px flex-1 bg-border-strong" />
        <span className="font-mono text-[11px] text-muted">{t('dividerOr')}</span>
        <span className="h-px flex-1 bg-border-strong" />
      </div>
      <div className="mt-6">
        <GoogleSignInButton onSuccess={(_role, user) => redirectAfterAuth(user)} />
      </div>

      <Link
        href={mode === 'login' ? '/register' : '/login'}
        className="mt-9 text-center text-sm text-muted hover:text-text"
      >
        {mode === 'login' ? t('toRegister') : t('toLogin')}
      </Link>
    </form>
  );
}
