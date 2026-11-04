'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { buttonClassName } from '@/components/ui/button-classes';
import { passwordRouteForRole } from '@/lib/account-routes';
import type { UserDTO } from '@/types/contract';
import { SectionShell } from './SectionShell';

/**
 * f · Contraseña (`#password`, DESIGN_SYSTEM §33.6f): RESUMEN + puerta a la página de contraseña
 * del rol (la ruta `/password` es contrato, §33.5). Con `hasPassword === false` (solo-Google) no
 * hay formulario en ningún sitio: la página explica y manda el enlace de `forgot-password`.
 * §CTA (972): con `accountSetupPending === true` (cuenta nacida en el carrito con solo el correo) la puerta dice
 * «Ponle contraseña a tu cuenta» y la página pide nombre y contraseña sin la actual.
 */
export function PasswordSection({ user }: { user: UserDTO }) {
  const t = useTranslations('account.password');
  const hasPassword = user.hasPassword !== false;
  const setup = user.accountSetupPending === true && user.hasPassword !== true;
  const href = passwordRouteForRole(user.role);
  return (
    <SectionShell id="password" title={t('title')}>
      <p className="text-sm text-muted">{setup ? t('setupSummary') : hasPassword ? t('summaryHas') : t('summaryNone')}</p>
      <Link
        href={href}
        className={buttonClassName({ variant: 'secondary', size: 'sm', className: 'mt-5 w-full sm:w-auto' })}
      >
        {setup ? t('setupTitle') : hasPassword ? t('goChange') : t('goCreate')}
      </Link>
    </SectionShell>
  );
}
