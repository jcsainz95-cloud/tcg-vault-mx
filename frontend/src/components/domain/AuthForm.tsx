'use client';

import { useEffect, useRef, useState } from 'react';
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
import { PrivacySiteNote } from '@/components/legal/PrivacyNoticeLink';
import { buildPasswordChangeRedirect, homeForRole, passwordRouteForRole, safeNext as safeNextOf } from '@/lib/account-routes';
import { TOO_MANY_PASSWORD_ATTEMPTS, retryAfterMinutes } from '@/lib/password-attempts';
import { consumeSessionMaxAgeLogout } from '@/lib/session';
import type { UserDTO } from '@/types/contract';

export function AuthForm({
  mode,
  notice,
  next,
}: {
  mode: 'login' | 'register';
  /**
   * Aviso a mostrar: cierre por inactividad, o tope absoluto de la sesión (LIVE-2, DESIGN_SYSTEM §81).
   * Solo en `mode === 'login'`.
   */
  notice?: 'inactivity' | 'sessionMaxAge';
  /** Destino a preservar tras el login (viene de `?next=` del gate de admin). */
  next?: string;
}) {
  const t = useTranslations('auth');
  const tErr = useTranslations('error');
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  /**
   * `C7` (DESIGN_SYSTEM §37.13 v4.9.1 · contrato v1.80.8.1): el aviso del 429 se elige por `error.code`,
   * ⛔ nunca por el status solo. `TOO_MANY_PASSWORD_ATTEMPTS` (tope por correo, solo login) ⇒
   * `auth.login.rateLimited*` + enlace a restablecer (restablecer SÍ levanta ese candado). `RATE_LIMITED`
   * (tope por IP) o cualquier otro 429 ⇒ `auth.rateLimitedByIp*`, sin enlace y sin «correo»: restablecer no
   * lo levanta y el tope no depende del correo. Minutos = fórmula normativa (`retryAfterMinutes`:
   * `max(1, ceil(s / 60))`, `null` sin cifra usable) para los dos códigos. ⛔ Sin contador regresivo sin
   * cifra; el botón no se apaga (el servidor es la puerta). ⛔ Nunca «tu cuenta está bloqueada».
   */
  /**
   * ⭐ v1.80.9 (§M6-U.10 punto 3, DESIGN_SYSTEM §42.1 C-3): `typedUsername` = lo tecleado en ESE submit no
   * lleva `@`. Elige el texto del aviso por cuenta («pídele al administrador», sin enlace). ⛔ Depende solo de
   * lo tecleado, nunca de la respuesta más allá de `error.code` ⇒ no es oráculo de existencia (criterio 259).
   */
  const [rateLimited, setRateLimited] = useState<{ minutes: number | null; code: string; typedUsername: boolean } | null>(null);
  /**
   * ⭐ v1.80.9 (DESIGN_SYSTEM §42.1 C-4, N-5): el error de credenciales dice «Usuario» si lo tecleado en el
   * MISMO submit que lo produjo no lleva `@` (no el campo vivo, que pudo editarse después). Misma regla que
   * `typedUsername`: forma de lo tecleado + `error.code`, nada más.
   */
  const [errorTypedUsername, setErrorTypedUsername] = useState(false);
  const rateLimitRef = useRef<HTMLDivElement>(null);

  // Solo se honra un `next` interno (empieza con "/") para evitar open redirect.
  const safeNext = safeNextOf(next);

  /**
   * LIVE-2 (DESIGN_SYSTEM §81.2, FRONTEND_NOTES §103). `sessionMaxAgeFromMark`: el interceptor de
   * refresh dejó la marca de un solo uso (`401` con `reason:'session_max_age'`) y el guard de hoy nos
   * trajo con `?next=` a secas ⇒ se pinta el aviso y el URL se reescribe a
   * `?next=…&reason=session_max_age` (el estado vive en el URL, como inactividad: recargar lo repinta).
   * Así los guards (`components/layout/*`) no cambian. Solo en login; el registro no consume la marca.
   */
  const [sessionMaxAgeFromMark, setSessionMaxAgeFromMark] = useState(false);
  useEffect(() => {
    if (mode !== 'login') return;
    if (!consumeSessionMaxAgeLogout() || notice) return;
    setSessionMaxAgeFromMark(true);
    router.replace({ pathname: '/login', query: { ...(next ? { next } : {}), reason: 'session_max_age' } });
    // Una sola vez al montar: la marca es de un solo uso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /**
   * §81.2.4: el aviso (y, por §81.2.7, también el de inactividad) desaparece al PRIMER intento —enviar
   * el formulario o pulsar «Continuar con Google»— y no vuelve en esta visita aunque el intento falle.
   */
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const activeNotice =
    mode !== 'login' || noticeDismissed ? undefined : (notice ?? (sessionMaxAgeFromMark ? 'sessionMaxAge' : undefined));

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
    setNoticeDismissed(true);
    setErrorCode(null);
    setRateLimited(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    // Correo o usuario: lo decide la FORMA de lo tecleado (con o sin `@`), como el servidor (§M6-U.2).
    const typedUsername = !email.includes('@');
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
      // ⛔ v1.80 (C7): con el 429 NO se reintenta solo (ni temporizador ni cuenta atrás que re-envíe): se
      // pinta el aviso y el usuario decide. Se guarda el `code`: solo `TOO_MANY_PASSWORD_ATTEMPTS` ofrece
      // restablecer (contrato v1.80.8.1); el status 429 solo decide QUE hay aviso, no CUÁL.
      if (err instanceof ApiClientError && err.status === 429) {
        setRateLimited({ minutes: retryAfterMinutes(err.details), code: err.code, typedUsername });
      } else {
        setErrorTypedUsername(typedUsername);
        setErrorCode(err instanceof ApiClientError ? err.code : 'INTERNAL');
      }
      setLoading(false);
    }
  }

  // Tabla de la errata v1.80.8.1: el aviso por cuenta (con enlace) SOLO con su código y en login.
  const perAccount = mode === 'login' && rateLimited?.code === TOO_MANY_PASSWORD_ATTEMPTS;
  // ⭐ v1.80.9 (§42.1 C-3): candado por cuenta con un USUARIO tecleado ⇒ «pídele al administrador», ⛔ sin
  // enlace a restablecer (el equipo sin correo no tiene por dónde recibirlo). Con `@`, el aviso de hoy.
  const perAccountUsername = perAccount && rateLimited?.typedUsername === true;
  // ⭐ v1.80.9 (§42.1 C-4): solo `INVALID_CREDENTIALS` en login y sin `@` en lo tecleado.
  const invalidCredentialsUsername = mode === 'login' && errorCode === 'INVALID_CREDENTIALS' && errorTypedUsername;

  useEffect(() => {
    if (rateLimited) rateLimitRef.current?.focus();
  }, [rateLimited]);

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
        {activeNotice === 'inactivity' && (
          <Banner variant="warning" role="status">
            {t('inactivityLogout')}
          </Banner>
        )}
        {/* LIVE-2 · DESIGN_SYSTEM §81.1: el mismo aviso que inactividad con otro texto. ⛔ Nunca
            `danger` ni `role="alert"`: el usuario no hizo nada mal. */}
        {activeNotice === 'sessionMaxAge' && (
          <Banner variant="warning" role="status">
            {t('sessionMaxAgeLogout')}
          </Banner>
        )}
        {rateLimited && (
          <div ref={rateLimitRef} tabIndex={-1} className="outline-none" data-testid="auth-rate-limited">
            <Banner variant="warning" role="alert">
              <p>
                {perAccount
                  ? perAccountUsername
                    ? rateLimited.minutes !== null
                      ? t('lockedAskAdminRetryIn', { minutes: rateLimited.minutes })
                      : t('lockedAskAdmin')
                    : rateLimited.minutes !== null
                      ? t('login.rateLimitedRetryIn', { minutes: rateLimited.minutes })
                      : t('login.rateLimited')
                  : rateLimited.minutes !== null
                    ? t('rateLimitedByIpRetryIn', { minutes: rateLimited.minutes })
                    : t('rateLimitedByIp')}
              </p>
              {perAccount && !perAccountUsername && (
                <Link href="/forgot-password" className="mt-2 inline-block text-text underline underline-offset-4 hover:text-accent">
                  {t('login.rateLimitedResetLink')}
                </Link>
              )}
            </Banner>
          </div>
        )}
        {errorCode && (
          <Banner variant="danger" role="alert">
            {invalidCredentialsUsername
              ? t('invalidCredentialsUsername')
              : tErr.has(errorCode)
                ? tErr(errorCode)
                : tErr('INTERNAL')}
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
        {mode === 'login' ? (
          /*
           * ⭐ v1.80.9 (§M6-U.10 punto 1, DESIGN_SYSTEM §42.1 C-1): la MISMA pantalla para clientes y equipo
           * (HECHOS 2026-10-04 (c)). `type="text"` para que el navegador no rechace un usuario; `inputMode="email"`
           * deja el teclado con `@`. `name="email"`: el contrato no cambia la llave. ⛔ Sin placeholder ni ayuda:
           * la pantalla no anuncia que existen usuarios.
           */
          <Input
            label={t('emailOrUsername')}
            name="email"
            type="text"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
          />
        ) : (
          <Input label={t('email')} name="email" type="email" autoComplete="email" required />
        )}
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

      {/* LIVE-8 · sitio 2a (DESIGN_SYSTEM §80.2, criterio 504): bajo «Crear cuenta» y ANTES del
          divisor, para que se lea antes de «Continuar con Google». */}
      {mode === 'register' && (
        <PrivacySiteNote site="register" className="mt-4 text-center text-[13px] leading-[1.6] text-muted" />
      )}

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
      {/* §81.2.4: pulsar Google cuenta como intento (captura: el botón vive dentro del componente). */}
      <div className="mt-6" onClickCapture={() => setNoticeDismissed(true)}>
        <GoogleSignInButton onSuccess={(_role, user) => redirectAfterAuth(user)} />
      </div>
      {/* LIVE-8 · sitio 2b (§80.2 nota 2b): «Continuar con Google» desde «Entrar» también CREA cuenta
          si el correo no existe (`auth.service.ts:527`). */}
      {mode === 'login' && (
        <PrivacySiteNote site="googleSignIn" className="mt-4 text-center text-[13px] leading-[1.6] text-muted" />
      )}

      <Link
        href={mode === 'login' ? '/register' : '/login'}
        className="mt-9 text-center text-sm text-muted hover:text-text"
      >
        {mode === 'login' ? t('toRegister') : t('toLogin')}
      </Link>
    </form>
  );
}
