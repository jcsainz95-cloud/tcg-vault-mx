'use client';

import { useTranslations } from 'next-intl';
import {
  LayoutDashboard,
  Boxes,
  TrendingUp,
  ShoppingBag,
  Truck,
  Repeat2,
  Users,
  DollarSign,
  AlertTriangle,
  BarChart3,
  Settings,
  Lock,
  type LucideIcon,
} from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { useRole } from '@/lib/role';
import { cn } from '@/lib/cn';

interface Item {
  href: string;
  key: string;
  icon: LucideIcon;
  superAdminOnly?: boolean;
}

const groups: { groupKey: string; items: Item[] }[] = [
  {
    groupKey: 'operation',
    items: [
      { href: '/admin', key: 'dashboard', icon: LayoutDashboard },
      { href: '/admin/m1', key: 'm1', icon: Boxes },
      { href: '/admin/m4', key: 'm4', icon: Truck },
      { href: '/admin/m5', key: 'm5', icon: Repeat2 },
      { href: '/admin/m8', key: 'm8', icon: AlertTriangle },
    ],
  },
  {
    groupKey: 'pricing',
    items: [{ href: '/admin/m2', key: 'm2', icon: TrendingUp, superAdminOnly: true }],
  },
  {
    groupKey: 'finance',
    items: [
      { href: '/admin/m3', key: 'm3', icon: ShoppingBag },
      { href: '/admin/m7', key: 'm7', icon: DollarSign, superAdminOnly: true },
      { href: '/admin/m9', key: 'm9', icon: BarChart3, superAdminOnly: true },
    ],
  },
  {
    groupKey: 'administration',
    items: [
      { href: '/admin/m6', key: 'm6', icon: Users, superAdminOnly: true },
      { href: '/admin/m10', key: 'm10', icon: Settings, superAdminOnly: true },
    ],
  },
];

export function AdminSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('admin');
  const pathname = usePathname();
  const { isSuperAdmin } = useRole();

  return (
    <nav className="flex flex-col gap-4 p-3">
      {groups.map((g) => (
        <div key={g.groupKey}>
          <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-subtle">
            {t(`groups.${g.groupKey}`)}
          </p>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((item) => {
              const active = pathname === item.href || (item.href !== '/admin' && pathname.startsWith(item.href));
              const locked = item.superAdminOnly && !isSuperAdmin;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-disabled={locked}
                    className={cn(
                      'flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
                      active
                        ? 'border-l-2 border-primary bg-surface-2 text-text'
                        : 'text-muted hover:bg-surface-2 hover:text-text',
                      locked && 'pointer-events-none opacity-50',
                    )}
                    title={locked ? t('masked') : undefined}
                  >
                    <item.icon size={18} />
                    <span className="flex-1">{t(`modules.${item.key}`)}</span>
                    {locked && <Lock size={14} />}
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
