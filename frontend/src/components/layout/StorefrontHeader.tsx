'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { LocaleToggle } from '@/components/ui/LocaleToggle';
import { useSession } from '@/lib/session';
import { useCart } from '@/lib/cart';
import { logout as apiLogout } from '@/lib/api';
import { cn } from '@/lib/cn';
import { LogoTcgHunt } from '@/components/domain/LogoTcgHunt';

/**
 * Marca TCG HUNT en topbar (§17.3): solo-mira 28px + wordmark en `--font-brand` 700,
 * TINTA SÓLIDA (a tamaño de UI el wordmark no lleva degradado; el ".mx" no va en
 * topbar). El texto accesible lo porta el enlace contenedor (`brand.homeAria`).
 */
function Wordmark() {
  const tc = useTranslations('common');
  return (
    <span className="flex items-center gap-3">
      <LogoTcgHunt variant="mark" size={28} decorative />
      <span className="font-brand text-[19px] font-bold uppercase leading-none tracking-[0.04em] text-text">
        {tc('brand.name')}
      </span>
    </span>
  );
}

/** Menú móvil: dos reglas finas, no el icono de hamburguesa genérico. */
function RuleMenuIcon({ open }: { open: boolean }) {
  return (
    <span aria-hidden className="flex w-[22px] flex-col gap-[5px]">
      <span className={cn('h-px bg-text transition-transform', open && 'translate-y-[3px] rotate-[8deg]')} />
      <span className={cn('h-px bg-text transition-transform', open && '-translate-y-[3px] -rotate-[8deg]')} />
    </span>
  );
}

export function StorefrontHeader() {
  const t = useTranslations('nav');
  const tc = useTranslations('common');
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Sesión de cliente (reactiva). `ready` evita mismatch de hidratación: mientras
  // sea false pintamos el estado deslogueado, idéntico al render de servidor.
  const { user, isAuthenticated, ready } = useSession();
  const authed = ready && isAuthenticated;
  const displayName = user?.name || user?.email || '';
  const { count } = useCart();

  // P-28: en el flujo de VENTA (`/buylist`) coexisten DOS carritos distintos —el de COMPRA
  // (este botón del header, `useCart` → /checkout) y el de VENTA/cotización (FAB flotante,
  // `useSellCart` en BuylistView)—. Mostrar ambos con contadores diferentes ("CARRITO 1" vs
  // "5") confunde: se lee como un mismo carrito descuadrado. En la página de Vender ocultamos
  // el carrito de compra para dejar UN SOLO carrito en pantalla (el de venta); el de compra no
  // se pierde (vive en localStorage) y reaparece en el resto de la tienda.
  const onSellFlow = pathname.startsWith('/buylist');

  // TL-C1: expone la ALTURA REAL del header como var CSS `--app-header-h` en el contenedor
  // del layout del storefront (el padre inmediato del header). Los sticky de las vistas
  // (p. ej. la barra de filtros del binder en modo quoter, §18.1) se anclan DEBAJO del
  // header con `lg:top-[var(--app-header-h,0px)]` en lugar de un `top-[72px]` hardcodeado.
  // ResizeObserver cubre los cambios de altura reales (py-4 ↔ lg:py-[22px], wrap del
  // contenido, menú móvil abierto); el fallback `0px` de la var cubre los layouts que no
  // la definen (el binder no-quoter no activa el sticky, así que basta con esto).
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const host = el.parentElement ?? document.documentElement;
    const update = () => host.style.setProperty('--app-header-h', `${el.offsetHeight}px`);
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      host.style.removeProperty('--app-header-h');
    };
  }, []);

  // Nav por sesión (P-13) en el orden del makeover 1a: «Comprar / Vender / Mi cuenta».
  // El público ve Comprar, Vender y Mi cuenta (→ /login); con sesión, "Mi cuenta" se
  // sustituye por las áreas privadas (Mi bóveda / Mis órdenes / Mis retiros) + el bloque
  // de perfil. Como `authed` depende de `ready`, en SSR/hidratación se pinta el nav
  // público —idéntico al render de servidor— y las pestañas privadas aparecen al montar.
  const links: { href: string; label: string; match?: string[] }[] = [
    // "Comprar" agrupa Cartas sueltas (/catalog) y Producto sellado (/sellado): activa en ambas.
    { href: '/catalog', label: t('buy'), match: ['/catalog', '/sellado', '/compra'] },
    { href: '/buylist', label: t('buylist') },
    ...(authed
      ? [
          { href: '/vault', label: t('vault') },
          { href: '/orders', label: t('orders') },
          { href: '/shipments', label: t('shipments') },
        ]
      : [{ href: '/login', label: t('myAccount') }]),
  ];

  async function onLogout() {
    setOpen(false);
    await apiLogout();
    router.push('/');
  }

  return (
    <header ref={headerRef} className="sticky top-0 z-40 border-b border-border bg-bg">
      <div className="mx-auto flex max-w-7xl items-center gap-10 px-5 py-4 sm:px-6 lg:px-8 lg:py-[22px]">
        {/* <lg: SOLO la mira 28px (§17.3), con área táctil de 44px. */}
        <Link
          href="/"
          aria-label={tc('brand.homeAria')}
          className="-ml-2 flex h-11 w-11 items-center justify-center lg:hidden"
        >
          <LogoTcgHunt variant="mark" size={28} decorative />
        </Link>
        <Link href="/" aria-label={tc('brand.homeAria')} className="hidden lg:block">
          <Wordmark />
        </Link>

        <nav className="hidden items-center gap-[26px] lg:flex">
          {links.map((l) => {
            const active = (l.match ?? [l.href]).some((p) => pathname.startsWith(p));
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'pb-1.5 text-[11px] font-medium uppercase leading-none tracking-label transition-colors',
                  // El activo se marca con la regla bermellón, no con relleno.
                  active
                    ? 'border-b border-accent text-text'
                    : 'border-b border-transparent text-muted hover:text-text',
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-5 lg:gap-[22px]">
          <div className="hidden lg:block">
            <LocaleToggle />
          </div>

          {/* Makeover 1a: el acceso anónimo vive en el nav como "Mi cuenta" (→ /login);
              con sesión se conserva el bloque de perfil (nombre + Cerrar sesión). */}
          {authed && (
            <div className="hidden items-center gap-5 lg:flex">
              <span
                className="max-w-[12rem] truncate text-[11px] font-medium uppercase tracking-label text-text"
                title={displayName}
              >
                {displayName}
              </span>
              <button
                type="button"
                onClick={onLogout}
                className="text-[11px] font-medium uppercase tracking-label text-muted hover:text-text"
              >
                {t('logout')}
              </button>
            </div>
          )}

          {/* P-28: oculto en el flujo de venta (ver `onSellFlow`). */}
          {!onSellFlow && (
            <Link
              href="/checkout"
              className="hidden items-center gap-2 border border-text px-3.5 py-2.5 text-[11px] font-medium uppercase tracking-label text-text hover:bg-text hover:text-primary-fg lg:inline-flex"
            >
              {t('cart')}
              <span className="tabular font-mono">{count}</span>
            </Link>
          )}

          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center lg:hidden"
            aria-label={t('menu')}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <RuleMenuIcon open={open} />
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-t border-border px-5 py-2 lg:hidden">
          <div className="flex flex-col">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="border-b border-border py-4 text-sm font-medium uppercase tracking-label text-text"
              >
                {l.label}
              </Link>
            ))}
            {/* P-28: oculto en el flujo de venta (ver `onSellFlow`). */}
            {!onSellFlow && (
              <Link
                href="/checkout"
                onClick={() => setOpen(false)}
                className="flex items-center justify-between border-b border-border py-4 text-sm font-medium uppercase tracking-label text-text"
              >
                {t('cart')}
                <span className="tabular font-mono text-muted">{count}</span>
              </Link>
            )}
            {/* Anónimo: "Mi cuenta" ya vive en `links` (→ /login); no se duplica aquí. */}
            {authed && (
              <>
                <span className="truncate border-b border-border py-4 text-sm text-muted">{displayName}</span>
                <button
                  type="button"
                  onClick={onLogout}
                  className="border-b border-border py-4 text-left text-sm font-medium uppercase tracking-label text-text"
                >
                  {t('logout')}
                </button>
              </>
            )}
            <div className="py-4">
              <LocaleToggle />
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}
