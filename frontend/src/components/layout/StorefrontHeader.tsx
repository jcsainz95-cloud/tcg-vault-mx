'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { LocaleToggle } from '@/components/ui/LocaleToggle';
import { useSession } from '@/lib/session';
import { useCart } from '@/lib/cart';
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
  const [open, setOpen] = useState(false);
  // Sesión de cliente (reactiva). `ready` evita mismatch de hidratación: mientras
  // sea false pintamos el estado deslogueado, idéntico al render de servidor.
  const { isAuthenticated, ready } = useSession();
  const authed = ready && isAuthenticated;
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

  /**
   * Nav por sesión (P-13), tabla de DESIGN_SYSTEM §33.1 (v1.67, supersede §7.15/§20.1):
   * - Sin sesión: Comprar · Vender · Mi cuenta (→ /login).
   * - Con sesión: Comprar · Vender · Mi bóveda · Compras y ventas · Mi cuenta (→ /account).
   *   **Cinco entradas, ni una más**: salen el nombre (vitrina del nombre inventado, regla 2) y
   *   «Cerrar sesión» (vive en «Mi cuenta», regla 8). «Envíos» sale del menú: los retiros viven en
   *   la pestaña «Retiros» de la bóveda (§33.4) y `nav.vault` se activa también en `/shipments*`.
   * ⭐ «Mi cuenta» ocupa el MISMO hueco con el MISMO rótulo en los dos estados; solo cambia el destino.
   * Como `authed` depende de `ready`, en SSR/hidratación se pinta el nav público —idéntico al render
   * de servidor— y las entradas privadas aparecen al montar.
   */
  const links: { href: string; label: string; match?: string[]; exclude?: string[] }[] = [
    // "Comprar" agrupa Cartas sueltas (/catalog) y Producto sellado (/sellado): activa en ambas.
    { href: '/catalog', label: t('buy'), match: ['/catalog', '/sellado', '/compra'] },
    // Vender: activa en /buylist EXCEPTO el portal de una solicitud (/buylist/requests/*), que es «ventas».
    { href: '/buylist', label: t('buylist'), exclude: ['/buylist/requests'] },
    ...(authed
      ? [
          { href: '/vault', label: t('vault'), match: ['/vault', '/shipments'] },
          { href: '/orders', label: t('ordersAndSales'), match: ['/orders', '/buylist/requests'] },
          { href: '/account', label: t('myAccount') },
        ]
      : [{ href: '/login', label: t('myAccount') }]),
  ];

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
            const active =
              (l.match ?? [l.href]).some((p) => pathname.startsWith(p)) &&
              !(l.exclude ?? []).some((p) => pathname.startsWith(p));
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

          {/* §33.1: sin bloque de perfil (nombre + Cerrar sesión) en el header. «Mi cuenta» vive en
              el nav en los dos estados; el nombre no es rótulo y «Cerrar sesión» está en /account. */}

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
            {/* «Mi cuenta» ya vive en `links` en los dos estados (→ /login | /account); el nombre y
                «Cerrar sesión» se retiran del drawer (§33.1): viven en «Mi cuenta», a un toque. */}
            <div className="py-4">
              <LocaleToggle />
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}
