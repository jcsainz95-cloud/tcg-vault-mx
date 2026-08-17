'use client';

import { useTranslations } from 'next-intl';
import { useRole } from '@/lib/role';
import { useRouter } from '@/i18n/navigation';
import { logout as apiLogout } from '@/lib/api';
import { LocaleToggle } from '@/components/ui/LocaleToggle';
import type { Role } from '@/types/contract';

export function AdminTopbar({ onMenu }: { onMenu?: () => void }) {
  const t = useTranslations('admin');
  const tnav = useTranslations('nav');
  const { role, setRole, canSwitchRole } = useRole();
  const router = useRouter();

  // Logout del back-office (P-1): reusa el mismo `logout()` + ruteo al storefront que
  // StorefrontHeader.onLogout. `logout()` limpia access+refresh+user (WS-B).
  async function onLogout() {
    await apiLogout();
    router.push('/');
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border bg-bg px-5 lg:px-10">
      <button
        type="button"
        onClick={onMenu}
        aria-label={tnav('menu')}
        className="inline-flex h-10 w-10 items-center justify-center lg:hidden"
      >
        <span aria-hidden className="flex w-[22px] flex-col gap-[5px]">
          <span className="h-px bg-text" />
          <span className="h-px bg-text" />
        </span>
      </button>
      <span className="text-[13px] font-medium uppercase tracking-label text-text">{t('shellTitle')}</span>

      <div className="ml-auto flex items-center gap-6">
        {/* Switcher "Ver como" SOLO en modo mock/demo. En modo real el rol lo dicta
            la sesión (backend = autoridad); mostramos el rol autenticado como texto. */}
        {canSwitchRole ? (
          <label className="flex items-center gap-2 font-mono text-xs text-muted">
            <span className="hidden sm:inline">{t('roleSwitch')}</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              aria-label={t('roleLabel')}
              // Anillo bermellón (--shadow-focus) en el propio control: outline-none
              // mata el outline global, así que el foco de teclado viaja en la sombra
              // (DESIGN_SYSTEM §8.2, foco SIEMPRE visible), sin doble anillo.
              className="appearance-none bg-transparent font-mono text-xs text-text outline-none focus-visible:shadow-focus"
            >
              <option value="super_admin">super_admin</option>
              <option value="vault_operator">vault_operator</option>
            </select>
            <span aria-hidden className="text-muted">
              ▾
            </span>
          </label>
        ) : (
          <span className="font-mono text-xs text-muted" aria-label={t('roleLabel')}>
            {role}
          </span>
        )}
        <div className="hidden sm:block">
          <LocaleToggle />
        </div>
        <button
          type="button"
          onClick={onLogout}
          // Anillo bermellón (--shadow-focus) en foco de teclado; sombras 0 salvo el foco.
          className="text-[11px] font-medium uppercase tracking-label text-muted hover:text-text focus-visible:shadow-focus"
        >
          {tnav('logout')}
        </button>
      </div>
    </header>
  );
}
