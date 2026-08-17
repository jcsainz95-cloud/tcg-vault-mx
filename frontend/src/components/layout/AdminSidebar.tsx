'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { useRole } from '@/lib/role';
import { cn } from '@/lib/cn';

interface Item {
  href: string;
  key: string;
  superAdminOnly?: boolean;
}

const groups: { groupKey: string; items: Item[] }[] = [
  {
    groupKey: 'operation',
    items: [
      { href: '/admin', key: 'dashboard' },
      { href: '/admin/m1', key: 'm1' },
      // v1.18: bóvedas de clientes (vista (ii) del master set, `vault_operator+`, lectura).
      { href: '/admin/vaults', key: 'vaults' },
      { href: '/admin/m4', key: 'm4' },
      { href: '/admin/m5', key: 'm5' },
      { href: '/admin/m8', key: 'm8' },
    ],
  },
  {
    groupKey: 'pricing',
    items: [{ href: '/admin/m2', key: 'm2', superAdminOnly: true }],
  },
  {
    groupKey: 'finance',
    items: [
      { href: '/admin/m3', key: 'm3' },
      { href: '/admin/m7', key: 'm7', superAdminOnly: true },
      { href: '/admin/m9', key: 'm9', superAdminOnly: true },
    ],
  },
  {
    groupKey: 'administration',
    items: [
      { href: '/admin/m6', key: 'm6', superAdminOnly: true },
      { href: '/admin/m10', key: 'm10', superAdminOnly: true },
    ],
  },
];

/**
 * 6i — Mismos grupos y módulos M1–M10, sobre tinta.
 * Dirección 5a: fuera los iconos lucide (el código del módulo ya identifica cada
 * entrada) y fuera el relleno del activo, que ahora se marca con la regla
 * bermellón al margen. El candado de súper-admin pasa a ser la palabra SÚPER en
 * mono, como en el diseño.
 */
export function AdminSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('admin');
  const pathname = usePathname();
  const { isSuperAdmin } = useRole();

  return (
    <nav className="flex flex-col gap-6 px-[22px] pb-8 pt-6">
      {groups.map((g) => (
        <div key={g.groupKey}>
          <p className="font-mono text-[10px] font-medium uppercase leading-none tracking-eyebrow text-on-ink-muted">
            {t(`groups.${g.groupKey}`)}
          </p>
          <ul className="mt-3.5 flex flex-col">
            {g.items.map((item) => {
              const active =
                pathname === item.href || (item.href !== '/admin' && pathname.startsWith(item.href));
              const locked = item.superAdminOnly && !isSuperAdmin;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-disabled={locked}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-[44px] items-center justify-between gap-3 py-2.5 text-sm',
                      active
                        ? '-ml-3 border-l-2 border-accent bg-[rgba(244,241,234,.06)] pl-3 text-on-ink'
                        : 'text-on-ink-nav hover:text-on-ink',
                      locked && 'pointer-events-none opacity-60',
                    )}
                    title={locked ? t('masked') : undefined}
                  >
                    <span>{t(`modules.${item.key}`)}</span>
                    {item.superAdminOnly && (
                      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-on-ink-muted">
                        {t('superAdminTag')}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
