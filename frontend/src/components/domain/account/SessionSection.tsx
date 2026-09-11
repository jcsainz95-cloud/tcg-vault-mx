'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { logout as apiLogout } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { SectionShell } from './SectionShell';

/**
 * g · Cerrar sesión (`#session`, DESIGN_SYSTEM §33.6g). Es el ÚNICO «Cerrar sesión» del cliente
 * (sale del header, regla 8). Comportamiento idéntico al anterior: `apiLogout()` y `push('/')`
 * para la tienda; `replace('/login')` para el panel (mismo motivo del parpadeo que `AdminTopbar`).
 * Sin confirmación (no es destructivo ni de dinero, §7.6).
 */
export function SessionSection({ surface }: { surface: 'storefront' | 'admin' }) {
  const t = useTranslations('account.session');
  const tnav = useTranslations('nav');
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onLogout() {
    setBusy(true);
    await apiLogout();
    if (surface === 'admin') router.replace('/login');
    else router.push('/');
  }

  return (
    <SectionShell id="session" title={t('title')}>
      <p className="text-sm text-muted">{t('body')}</p>
      <Button
        type="button"
        variant="secondary"
        loading={busy}
        onClick={onLogout}
        className="mt-5 w-full sm:w-auto"
      >
        {tnav('logout')}
      </Button>
    </SectionShell>
  );
}
