'use client';

import { useTranslations } from 'next-intl';
import { Menu } from 'lucide-react';
import { useRole } from '@/lib/role';
import { LocaleToggle } from '@/components/ui/LocaleToggle';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import type { Role } from '@/types/contract';

export function AdminTopbar({ onMenu }: { onMenu?: () => void }) {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const tnav = useTranslations('nav');
  const { role, setRole, canSwitchRole } = useRole();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-surface px-4">
      <button
        type="button"
        onClick={onMenu}
        aria-label={tnav('menu')}
        className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted hover:bg-surface-2 lg:hidden"
      >
        <Menu size={22} />
      </button>
      <span className="font-semibold">{t('shellTitle')}</span>

      <div className="ml-auto flex items-center gap-3">
        {/* Switcher "Ver como" SOLO en modo mock/demo. En modo real el rol lo dicta
            la sesión (backend = autoridad); mostramos el rol autenticado como texto. */}
        {canSwitchRole ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="hidden text-muted sm:inline">{t('roleSwitch')}</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              aria-label={t('roleLabel')}
              className="h-10 rounded-md border border-border-strong bg-surface px-2 text-sm"
            >
              <option value="super_admin">super_admin</option>
              <option value="vault_operator">vault_operator</option>
            </select>
          </label>
        ) : (
          <span className="text-sm text-muted" aria-label={t('roleLabel')}>
            {role}
          </span>
        )}
        <ThemeToggle />
        <div className="hidden sm:block">
          <LocaleToggle />
        </div>
        <span className="sr-only">{tc('theme')}</span>
      </div>
    </header>
  );
}
