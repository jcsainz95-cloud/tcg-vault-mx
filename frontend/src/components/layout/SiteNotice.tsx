'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { usePathname } from '@/i18n/navigation';
import { LogoTcgHunt } from '@/components/domain/LogoTcgHunt';
import { useMeasurement } from '@/components/consent/measurement-context';
import { SITE_NOTICE_STORAGE_KEY, siteNoticeActive, siteNoticeExcluded } from '@/lib/site-notice';

/**
 * Aviso emergente de la tienda (HECHOS 2026-11-17). Una vez por visitante: se cierra con «Entendido», la X o Esc, y el
 * cierre se recuerda en `localStorage` (con try/catch: si falla, igual se cierra y no vuelve en esa pestaña).
 *
 *  - Espera al banner de cookies (`consent === null` con la medición activa ⇒ aún sin responder): nunca se apilan, y
 *    L-8 / C-F3 (tejas y barra con el banner abierto) no cambian.
 *  - No sale en pago ni confirmación (`site-notice.ts`), ni en admin / proveedores / card-show (otros layouts).
 *  - Diálogo modal accesible: `role="dialog"` + `aria-modal`, nombre y descripción, foco dentro con trampa de Tab, Esc.
 *  - El texto solo existe en el DOM mientras el aviso está abierto (nada oculto para buscadores). Sin IVA ni precios.
 * Los textos llegan por props desde el layout de servidor (la portada solo trae su ámbito de mensajes).
 */
export function SiteNotice({ title, body, dismiss, close }: { title: string; body: string; dismiss: string; close: string }) {
  const pathname = usePathname();
  const m = useMeasurement();
  const [open, setOpen] = useState(false);
  const [decided, setDecided] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);

  const waitingForCookies = m.active && m.consent === null;
  const eligible = siteNoticeActive() && !siteNoticeExcluded(pathname);

  // Decide UNA vez por montaje: ¿ya lo cerró este visitante?
  useEffect(() => {
    if (decided || !eligible || waitingForCookies) return;
    let seen = false;
    try {
      seen = window.localStorage.getItem(SITE_NOTICE_STORAGE_KEY) === '1';
    } catch {
      seen = false;
    }
    setDecided(true);
    if (!seen) {
      previous.current = document.activeElement as HTMLElement | null;
      setOpen(true);
    }
  }, [decided, eligible, waitingForCookies]);

  const closeNotice = useCallback(() => {
    setOpen(false);
    try {
      window.localStorage.setItem(SITE_NOTICE_STORAGE_KEY, '1');
    } catch {
      // Sin almacenamiento: se cierra igual; `decided` evita que reaparezca en esta pestaña.
    }
    previous.current?.focus?.();
  }, []);

  // Si el visitante navega a una pantalla excluida (pago) con el aviso abierto, se cierra sin recordar nada.
  useEffect(() => {
    if (open && !eligible) setOpen(false);
  }, [open, eligible]);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.querySelector<HTMLElement>('[data-notice-dismiss]')?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeNotice();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = dialogRef.current?.querySelectorAll<HTMLElement>('button');
      if (!items || items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, closeNotice]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(26,26,24,.55)] p-4"
      data-testid="site-notice-overlay"
      onClick={closeNotice}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="site-notice-title"
        aria-describedby="site-notice-body"
        data-testid="site-notice"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md border border-border-strong bg-bg px-6 pb-6 pt-8 sm:px-8"
      >
        <button
          type="button"
          onClick={closeNotice}
          aria-label={close}
          className="absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center text-muted hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text"
        >
          <X size={20} aria-hidden />
        </button>
        <LogoTcgHunt variant="mark" size={32} decorative />
        <h2 id="site-notice-title" className="mt-5 font-serif text-[26px] leading-[1.2] text-text">
          {title}
        </h2>
        <p id="site-notice-body" className="mt-3 text-[15px] leading-[1.7] text-muted">
          {body}
        </p>
        <button
          type="button"
          data-notice-dismiss
          onClick={closeNotice}
          className="mt-6 inline-flex h-12 w-full items-center justify-center bg-primary px-6 text-[11px] font-medium uppercase tracking-[0.18em] text-primary-fg hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text"
        >
          {dismiss}
        </button>
      </div>
    </div>
  );
}
