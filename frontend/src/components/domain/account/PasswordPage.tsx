'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { forgotPassword, getMe, logout as apiLogout } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { useSession } from '@/lib/session';
import { accountRouteForRole, safeNext } from '@/lib/account-routes';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import type { UserDTO } from '@/types/contract';
import { PasswordForm } from './PasswordForm';
import { SectionError } from './SectionShell';
import type { AccountSurface } from './AccountView';

export interface PasswordPageProps {
  surface: AccountSurface;
  /** `?next=` reenviado por el login o por el rebote de los guards (se honra tras el 200). */
  next?: string;
  /** `?reason=required`: llegó rebotado desde otra pantalla (§33.8 paso 3/4). */
  reason?: string;
}

type Phase = 'form' | 'done';

/**
 * Página de contraseña del rol — `/account/password` · `/admin/account/password` (contrato
 * v1.67 · DESIGN_SYSTEM §33.7 y §33.8). UNA página, tres modos, decididos por `GET /users/me`
 * (exento del 403; única fuente de `hasPassword` y `mustChangePassword`):
 *
 * - **Bloqueo** (`mustChangePassword === true`): «Crea tu contraseña definitiva», banner si
 *   `reason=required`, campo 1 «Contraseña temporal», «Guardar y continuar»; al 200 → «Listo» hacia
 *   `?next=` seguro o la cuenta. Única otra salida: «Cerrar sesión». Sin «← Mi cuenta» (rebotaría).
 * - **Cambiar** (`hasPassword === true`): variante A de §33.7 con «← Mi cuenta».
 * - **Crear** (`hasPassword === false`, solo-Google): SIN campos — explica y «Enviarme el enlace»
 *   (`POST /auth/forgot-password` con el correo de la sesión). ⛔ Nunca `change-password` aquí.
 *
 * i18n (F2-8): el BLOQUEO vive bajo `auth.changePassword.*` (es copy del flujo de autenticación —
 * la temporal la emitió el admin y la pantalla se comporta como un paso más del login: sin «Mi
 * cuenta», con banner `requiredNotice`); cambiar/crear viven bajo `account.password.*` (sección de
 * «Mi cuenta»). Los errores de `forgot-password` del modo crear son claves propias de
 * `account.password.*` (`rateLimited`, `resendError`), no préstamos de `verifyEmail.*`.
 */
export function PasswordPage({ surface, next, reason }: PasswordPageProps) {
  const t = useTranslations('account.password');
  const tc = useTranslations('auth.changePassword');
  const tnav = useTranslations('nav');
  const router = useRouter();
  const qc = useQueryClient();
  const { user: sessionUser, ready } = useSession();
  const meQuery = useQuery({ queryKey: ['me'], queryFn: getMe, enabled: ready && !!sessionUser });
  const user: UserDTO | null = meQuery.data ?? sessionUser;

  const [phase, setPhase] = useState<Phase>('form');
  // Se congela al entrar: tras el 200 la bandera ya es `false` y el modo bloqueo debe seguir
  // mostrando «Listo» (no «Cambiar otra vez»).
  const [wasBlocked, setWasBlocked] = useState<boolean | null>(null);
  const [forceCreate, setForceCreate] = useState(false);
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'rateLimited' | 'error'>('idle');

  const blocked = user?.mustChangePassword === true;
  const createMode = !blocked && (forceCreate || user?.hasPassword === false);
  const dest = safeNext(next) ?? accountRouteForRole(user?.role);
  const backHref = accountRouteForRole(user?.role);

  useEffect(() => {
    if (user && wasBlocked === null) setWasBlocked(user.mustChangePassword === true);
  }, [user, wasBlocked]);

  // Foco inicial (§33.8): en el banner si `reason=required`, si no en el `h1`. Solo en bloqueo.
  const bannerRef = useRef<HTMLDivElement>(null);
  const h1Ref = useRef<HTMLHeadingElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!user || phase !== 'form' || !blocked) return;
    (reason === 'required' ? bannerRef.current : h1Ref.current)?.focus?.();
    // Solo al montar con usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!user, blocked]);
  useEffect(() => {
    if (phase === 'done') doneRef.current?.focus?.();
  }, [phase]);

  async function onLogout() {
    await apiLogout();
    router.replace('/login');
  }

  async function sendLink() {
    if (!user) return;
    setSendState('sending');
    try {
      await forgotPassword(user.email);
      setSendState('sent');
    } catch (e) {
      const code = e instanceof ApiClientError ? e.code : undefined;
      setSendState(code === 'RATE_LIMITED' ? 'rateLimited' : 'error');
    }
  }

  if (!ready || (!user && meQuery.isLoading)) {
    return (
      <div className="gutter mx-auto max-w-xl py-10" aria-busy="true">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="mt-4 h-4 w-80" />
        <Skeleton className="mt-10 h-11 w-full" />
      </div>
    );
  }
  if (!user) {
    return (
      <div className="gutter mx-auto max-w-xl py-10">
        <SectionError error={meQuery.error} onRetry={() => meQuery.refetch()} />
      </div>
    );
  }

  const showDoneButton = wasBlocked === true || !!safeNext(next);

  return (
    <div className="gutter mx-auto max-w-xl py-10 lg:py-14">
      {!blocked && (
        <Link
          href={backHref}
          className="inline-block font-mono text-[11px] uppercase tracking-label text-muted hover:text-text"
        >
          ← {t('back')}
        </Link>
      )}

      {phase === 'done' ? (
        <div className="mt-4 flex flex-col gap-5">
          <p role="status" className="font-mono text-[11px] uppercase tracking-label text-success">
            {t('successTitle')}
          </p>
          <p className="text-[15px] text-muted">{t('successOtherSessions')}</p>
          {showDoneButton ? (
            <Button ref={doneRef} type="button" onClick={() => router.replace(dest)} className="w-full sm:w-auto">
              {tc('done')}
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-6">
              <button
                type="button"
                onClick={() => setPhase('form')}
                className="font-mono text-[11px] uppercase tracking-label text-accent hover:text-text"
              >
                {t('changeAgain')}
              </button>
            </div>
          )}
        </div>
      ) : createMode ? (
        <div className="mt-4 flex flex-col gap-5">
          <h1 ref={h1Ref} tabIndex={-1} className="font-serif text-[30px] leading-[1.1] text-text outline-none lg:text-[38px]">
            {t('createTitle')}
          </h1>
          <p className="text-[15px] text-muted">{t('createBody', { email: user.email })}</p>
          {sendState === 'sent' ? (
            <div className="flex flex-col gap-3">
              <p role="status" className="font-mono text-[11px] uppercase tracking-label text-success">
                {t('createSentTitle')}
              </p>
              <p className="text-sm text-muted">{t('createSentBody')}</p>
              <Button type="button" size="sm" variant="ghost" onClick={sendLink} className="self-start">
                {t('createResend')}
              </Button>
            </div>
          ) : (
            <Button type="button" loading={sendState === 'sending'} onClick={sendLink} className="w-full sm:w-auto">
              {sendState === 'sending' ? t('createSending') : t('createSend')}
            </Button>
          )}
          {/* Claves PROPIAS de la variante B (§33.7 v4.1.2; techlead F2-8): `rateLimited` es la misma
              de la variante A y `resendError` es nueva. Nada prestado de `verifyEmail.*`. */}
          {sendState === 'rateLimited' && (
            <p role="alert" className="font-mono text-xs text-accent">
              {t('rateLimited')}
            </p>
          )}
          {sendState === 'error' && (
            <p role="alert" className="font-mono text-xs text-accent">
              {t('resendError')}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-6">
          {blocked && reason === 'required' && (
            <div ref={bannerRef} tabIndex={-1} className="outline-none">
              <Banner variant="warning" role="alert">
                {tc('requiredNotice')}
              </Banner>
            </div>
          )}
          <div>
            <h1 ref={h1Ref} tabIndex={-1} className="font-serif text-[30px] leading-[1.1] text-text outline-none lg:text-[38px]">
              {blocked ? tc('title') : t('changeTitle')}
            </h1>
            {blocked && <p className="mt-3 text-[15px] text-muted">{tc('body')}</p>}
          </div>
          <PasswordForm
            currentLabel={blocked ? tc('temporaryLabel') : t('current')}
            submitLabel={blocked ? tc('submit') : t('submit')}
            submittingLabel={t('submitting')}
            onSuccess={(res) => {
              // `changePassword()` ya reemplazó tokens y parcheó la sesión local; se sincroniza la
              // query `me` para que ningún guard vuelva a leer la bandera vieja.
              qc.setQueryData(['me'], (prev: UserDTO | undefined) =>
                prev ? { ...prev, mustChangePassword: false, hasPassword: true } : prev,
              );
              void res;
              setPhase('done');
            }}
            onPasswordNotSet={() => setForceCreate(true)}
          />
          {blocked && (
            <button
              type="button"
              onClick={onLogout}
              className="mt-2 self-start font-mono text-[11px] uppercase tracking-label text-muted hover:text-text"
            >
              {tnav('logout')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
