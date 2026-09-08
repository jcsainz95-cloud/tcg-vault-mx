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
      // v1.20: bóvedas de clientes (vista (ii) del master set, `vault_operator+`, lectura).
      { href: '/admin/vaults', key: 'vaults' },
      { href: '/admin/m4', key: 'm4' },
      { href: '/admin/m5', key: 'm5' },
      { href: '/admin/m8', key: 'm8' },
    ],
  },
  {
    groupKey: 'pricing',
    items: [
      { href: '/admin/m2', key: 'm2', superAdminOnly: true },
      // v1.62 (D52 · criterio 184): M2 › Bounties. Entra por la navegación de M2 (§28.1) porque un
      // bounty es una decisión de PRECIO DE COMPRA y su verdad se mide contra la curva, que vive
      // aquí. `super_admin` y solo `super_admin`.
      { href: '/admin/m2/bounties', key: 'm2Bounties', superAdminOnly: true },
    ],
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

const ALL_HREFS = groups.flatMap((g) => g.items.map((i) => i.href));

/**
 * ### Qué entrada se ilumina — **gana la MÁS ESPECÍFICA**, y por eso ya no hace falta `exact`
 *
 * Antes: prefijo simple + una bandera `exact` puesta a mano en el padre que tuviera una hija en el
 * menú. Dos defectos, y el segundo estaba vivo:
 *
 * 1. **`exact` es una lista que hay que acordarse de mantener.** `/admin/m2` la llevaba por su hija
 *    `/admin/m2/bounties` — lo que significa que **cualquier sub-ruta futura de M2** (`/admin/m2/loquesea`)
 *    dejaría de iluminar M2 **en silencio**: el menú diría que no estás en ninguna parte.
 * 2. ⚠️ **`startsWith` sin la barra confunde hermanos**: `'/admin/m10'.startsWith('/admin/m1')` es
 *    `true`, así que estando en **M10** se iluminaban **M1 y M10 a la vez**. *Dos entradas activas no
 *    dicen dónde estás* — que es justo lo que `exact` intentaba evitar en otro sitio.
 *
 * Ahora la regla es una sola y se deduce del propio menú: una entrada se ilumina si la ruta es la
 * suya o cuelga de ella (**con barra**), **salvo que otra entrada del menú sea un prefijo más largo**
 * de esa misma ruta. `/admin` es el único caso exacto por definición: es la raíz de todas.
 */
export function isActiveHref(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === '/admin') return false;
  if (!pathname.startsWith(`${href}/`)) return false;
  return !ALL_HREFS.some(
    (other) =>
      other.length > href.length && (pathname === other || pathname.startsWith(`${other}/`)),
  );
}

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
              const active = isActiveHref(pathname, item.href);
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
