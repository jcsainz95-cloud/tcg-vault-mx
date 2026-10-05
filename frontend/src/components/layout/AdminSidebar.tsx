'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { useRole } from '@/lib/role';
import { cn } from '@/lib/cn';
import { usePickingSummary } from '@/hooks/usePickingSummary';
import type { PickingListSummaryDTO } from '@/types/contract';

export interface Item {
  href: string;
  key: string;
  superAdminOnly?: boolean;
  /**
   * v1.80 (§M4-SHIP.11 · `DESIGN_SYSTEM §37.11b`): el badge del menú es el contador DERIVADO del
   * `summary`. `null` ⇒ sin badge (cero o dato que el rol no recibe). El número ES el aviso.
   */
  badge?: (s: PickingListSummaryDTO) => { count: number; overdue?: boolean } | null;
  /**
   * v4.10 (§37.20 a): prefijos de ruta EXTRA que también iluminan esta entrada (p. ej. un detalle que vive
   * fuera de su ruta). Entran en la MISMA regla de `isActiveHref` («con barra / gana la más específica»).
   */
  activeAlso?: readonly string[];
}

/**
 * §37.2 (P-66 I2) · el menú rotula por NOMBRE, no por código: el M-n sobrevive solo en la ruta
 * (`/admin/m5`) y en la clave i18n (`admin.modules.m5`) — renombrar rutas rompe enlaces guardados.
 * Grupos por lo que se hace (el trabajo diario primero) y, dentro de cada grupo, por frecuencia de
 * uso conocida. «Resumen» va solo arriba, SIN rótulo de grupo (`groupKey: null`).
 *
 * Regla de §37.2a-2: el `h1` de cada página es `t('admin.modules.<key>')` — la MISMA cadena que
 * su entrada del menú, carácter por carácter (candado: `AdminPageTitles.test.tsx`).
 */
const groups: { groupKey: string | null; items: Item[] }[] = [
  {
    groupKey: null,
    items: [{ href: '/admin', key: 'dashboard' }],
  },
  {
    groupKey: 'daily',
    items: [
      { href: '/admin/m5', key: 'm5' },
      { href: '/admin/m3', key: 'm3' },
      // v4.10 (§37.20 · HECHOS 2026-10-02 «Menú del panel: se queda como está; … se JUNTAN en UNA sola pestaña
      // con dos cubetas»): UNA entrada «Reembolsos», en el mismo hueco tras «Ventas», súper-admin y solo él.
      // Badge = SOLO transferencias SPEI pendientes (lo único que espera la mano del dueño), ⛔ no una suma.
      // `manualRefundsPending` es `null` para el operador ⇒ sin badge. Se ilumina también en el detalle
      // `/admin/manual-refunds/:id`, que se queda en su ruta (§37.20 c).
      {
        href: '/admin/refunds',
        key: 'refunds',
        superAdminOnly: true,
        activeAlso: ['/admin/manual-refunds'],
        badge: (s) => (s.manualRefundsPending ? { count: s.manualRefundsPending } : null),
      },
      // v1.80 «Pedidos por preparar»: badge = envíos + bóveda + por reponer (§M4-SHIP.11).
      {
        href: '/admin/m4',
        key: 'm4',
        badge: (s) => {
          const count = s.ship + s.vault + s.toReplace;
          return count > 0 ? { count, overdue: s.toReplaceOverdue > 0 } : null;
        },
      },
    ],
  },
  {
    groupKey: 'stock',
    items: [
      { href: '/admin/m1', key: 'm1' },
      // §diseño §1 (D-1/D-4): Sellado. Ruta `vault_operator+` (secciones i/ii/iii de alta,
      // inventario y cola); el panel de diales (iv) se gatea DENTRO de la vista con SuperAdminOnly.
      // Por eso el nav-item va SIN `superAdminOnly` — a diferencia de Catálogo y precios/Configuración.
      { href: '/admin/m11', key: 'm11' },
      // v1.20: bóvedas de clientes (vista (ii) del master set, `vault_operator+`, lectura).
      { href: '/admin/vaults', key: 'vaults' },
    ],
  },
  {
    groupKey: 'storefront',
    items: [
      { href: '/admin/m2', key: 'm2', superAdminOnly: true },
      // v1.62 (D52 · criterio 184): Bounties cuelga de Catálogo y precios (§28.1) porque un bounty
      // es una decisión de PRECIO DE COMPRA y su verdad se mide contra la curva, que vive ahí.
      // `super_admin` y solo `super_admin`.
      { href: '/admin/m2/bounties', key: 'm2Bounties', superAdminOnly: true },
      // §13 Fase 2 — Meta Battle Decks. Ruta `vault_operator+` (el backend
      // `GET /admin/decks-meta/preview` admite operador): sin `superAdminOnly`, como Sellado.
      { href: '/admin/m12', key: 'm12' },
    ],
  },
  {
    groupKey: 'administration',
    items: [
      { href: '/admin/m7', key: 'm7', superAdminOnly: true },
      { href: '/admin/m9', key: 'm9', superAdminOnly: true },
      { href: '/admin/m6', key: 'm6', superAdminOnly: true },
      { href: '/admin/m10', key: 'm10', superAdminOnly: true },
    ],
  },
];

/** Entradas del menú en orden (para candados y para quien necesite la lista plana). */
export const ADMIN_MENU_ITEMS: readonly Item[] = groups.flatMap((g) => g.items);

/** Todos los prefijos que el menú reclama (rutas propias + `activeAlso`), con la entrada a la que pertenecen. */
const ALL_PREFIXES: readonly { prefix: string; href: string }[] = groups.flatMap((g) =>
  g.items.flatMap((i) => [i.href, ...(i.activeAlso ?? [])].map((prefix) => ({ prefix, href: i.href }))),
);

const matches = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

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
 * suya (o uno de sus `activeAlso`) o cuelga de ella (**con barra**), **salvo que otro prefijo del menú
 * sea más largo** y también case con esa ruta. `/admin` es el único caso exacto por definición: es la
 * raíz de todas.
 */
export function isActiveHref(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === '/admin') return false;
  const own = ALL_PREFIXES.filter((p) => p.href === href && matches(pathname, p.prefix));
  if (own.length === 0) return false;
  const best = Math.max(...own.map((p) => p.prefix.length));
  return !ALL_PREFIXES.some((p) => p.href !== href && p.prefix.length > best && matches(pathname, p.prefix));
}

/**
 * 6i — El menú del panel, sobre tinta.
 * Dirección 5a: fuera los iconos lucide (el NOMBRE identifica cada entrada; §37.2 retiró los
 * códigos M-n) y fuera el relleno del activo, que ahora se marca con la regla
 * bermellón al margen. El candado de súper-admin pasa a ser la palabra SÚPER en
 * mono, como en el diseño.
 */
export function AdminSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('admin');
  const pathname = usePathname();
  const { isSuperAdmin } = useRole();
  const summary = usePickingSummary();

  function badgeFor(item: Item) {
    if (!item.badge || !summary.data) return null;
    if (item.superAdminOnly && !isSuperAdmin) return null;
    return item.badge(summary.data);
  }

  return (
    <nav className="flex flex-col gap-6 px-[22px] pb-8 pt-6">
      {groups.map((g) => (
        <div key={g.groupKey ?? '__summary__'}>
          {g.groupKey && (
            <p className="mb-3.5 font-mono text-[10px] font-medium uppercase leading-none tracking-eyebrow text-on-ink-muted">
              {t(`groups.${g.groupKey}`)}
            </p>
          )}
          <ul className="flex flex-col">
            {g.items.map((item) => {
              const active = isActiveHref(pathname, item.href);
              const locked = item.superAdminOnly && !isSuperAdmin;
              const badge = badgeFor(item);
              const badgeLabel = badge
                ? item.key === 'refunds'
                  ? t('modules.manualRefundsBadge', { count: badge.count })
                  : `${t('modules.m4Badge', { count: badge.count })}${badge.overdue ? ` · ${t('modules.m4BadgeOverdue')}` : ''}`
                : null;
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
                    {badge && badgeLabel && (
                      <span
                        data-testid={`nav-badge-${item.key}`}
                        aria-label={badgeLabel}
                        title={badgeLabel}
                        className={cn(
                          'tabular ml-auto font-mono text-[11px] leading-none',
                          badge.overdue ? 'text-accent' : 'text-on-ink-muted',
                        )}
                      >
                        {badge.count}
                      </span>
                    )}
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
