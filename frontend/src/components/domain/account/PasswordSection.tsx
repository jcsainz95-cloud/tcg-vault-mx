'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { passwordRouteForRole } from '@/lib/account-routes';
import type { UserDTO } from '@/types/contract';
import { SectionShell } from './SectionShell';

/**
 * f · Contraseña (`#password`, DESIGN_SYSTEM §33.6f): RESUMEN + puerta a la página de contraseña
 * del rol (la ruta `/password` es contrato, §33.5). Con `hasPassword === false` (solo-Google) no
 * hay formulario en ningún sitio: la página explica y manda el enlace de `forgot-password`.
 */
export function PasswordSection({ user }: { user: UserDTO }) {
  const t = useTranslations('account.password');
  const hasPassword = user.hasPassword !== false;
  const href = passwordRouteForRole(user.role);
  return (
    <SectionShell id="password" title={t('title')}>
      <p className="text-sm text-muted">{hasPassword ? t('summaryHas') : t('summaryNone')}</p>
      <Link
        href={href}
        className="mt-5 inline-flex min-h-[44px] w-full items-center justify-center border border-text px-4 text-[10px] font-medium uppercase tracking-label text-text hover:bg-text hover:text-primary-fg sm:min-h-0 sm:w-auto sm:py-3"
      >
        {hasPassword ? t('goChange') : t('goCreate')}
      </Link>
    </SectionShell>
  );
}
