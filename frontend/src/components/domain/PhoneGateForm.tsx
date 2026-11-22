'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getMe, listAddresses, logout, updateMe } from '@/lib/api';
import { useCart } from '@/lib/cart';
import { normalizeMxPhone } from '@/lib/phone';
import { useSession } from '@/lib/session';
import { usePathname, useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { BodyPortal } from '@/components/ui/BodyPortal';

/**
 * §CELULAR · variante B (modal sobre la página; `docs/API_CONTRACT_CELULAR.md` §3, HECHOS 2026-11-22).
 *
 * `PhoneGateForm` es la tarjeta; `PhoneGate` es el montaje de layout: pinta la tarjeta sobre CUALQUIER ruta con sesión
 * (storefront, cuenta y panel, también el equipo) cuando `user.phoneRequired === true`. No cambia la URL ni toca el
 * carrito (vive en localStorage): al guardar, `updateMe` sincroniza la sesión y el modal simplemente desaparece, con la
 * página de debajo intacta. El visitante anónimo no ve nada. Único escape: «Cerrar sesión».
 *
 * Fuera de la puerta: las rutas de auth (el login aún está navegando) y la sesión con contraseña temporal pendiente
 * (`PATCH /users/me` responde 403 hasta cambiarla: primero la contraseña). ⛔ El celular no va a medición ni a la URL.
 */
const AUTH_PATH = /^\/(login|register|forgot-password|reset-password|verify-email|account-setup)(\/|$)/;

export function PhoneGate() {
  const { user, ready } = useSession();
  const pathname = usePathname();
  const reread = useRef<string | null>(null);

  // Sesión guardada antes de §CELULAR: sin bandera ⇒ se relee `GET /users/me` UNA vez (exento del 403 de la temporal).
  useEffect(() => {
    if (!ready || !user || user.phoneRequired !== undefined || reread.current === user.id) return;
    reread.current = user.id;
    void getMe().catch(() => undefined);
  }, [ready, user]);

  if (!ready || !user || user.phoneRequired !== true || user.mustChangePassword === true) return null;
  if (AUTH_PATH.test(pathname ?? '')) return null;
  return (
    <BodyPortal>
      <PhoneGateForm />
    </BodyPortal>
  );
}

export function PhoneGateForm() {
  const t = useTranslations('common.phoneGate');
  const router = useRouter();
  const cart = useCart();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const addresses = useQuery({ queryKey: ['addresses'], queryFn: listAddresses, retry: false });

  // Foco inicial en el campo; el fondo queda inerte para lector de pantalla y teclado.
  useEffect(() => {
    inputRef.current?.focus();
    const host = dialogRef.current?.parentElement;
    const others = Array.from(document.body.children).filter((el) => el !== host && el instanceof HTMLElement) as HTMLElement[];
    const prev = others.map((el) => [el, el.inert] as const);
    others.forEach((el) => {
      el.inert = true;
    });
    return () => prev.forEach(([el, was]) => (el.inert = was));
  }, []);

  // Prellenado con el celular de la dirección predeterminada, si es válido y la persona no ha escrito.
  useEffect(() => {
    if (touched || phone !== '') return;
    const list = addresses.data ?? [];
    const src = list.find((a) => a.isDefault) ?? list[0];
    const n = normalizeMxPhone(src?.phone ?? '');
    if (n) setPhone(n);
  }, [addresses.data, touched, phone]);

  const normalized = normalizeMxPhone(phone);

  /** Normaliza al escribir y al pegar (`+52…`, `52…`, guiones, espacios) y topa en 10 dígitos. */
  function onChange(raw: string) {
    setTouched(true);
    setError(null);
    let d = raw.replace(/\D/g, '');
    // Pegado con lada de país (`+52…`, `52…`, `521…`): el mismo helper del servidor la quita.
    if (d.length > 10) d = normalizeMxPhone(raw) ?? d;
    setPhone(d.slice(0, 10));
  }

  // Focus trap: Tab circula dentro de la tarjeta; Esc no cierra (no hay cierre: única salida, «Cerrar sesión»).
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') e.preventDefault();
    if (e.key !== 'Tab') return;
    const f = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('input, button:not([disabled])') ?? []);
    if (f.length === 0) return;
    const first = f[0]!;
    const last = f[f.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!normalized) {
      setError(t('invalid'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // `updateMe` sincroniza la sesión (`phoneRequired:false`): el modal se desmonta y la ruta de debajo queda intacta.
      await updateMe({ phone: normalized });
    } catch {
      setError(t('invalid'));
      setBusy(false);
    }
  }

  async function onLogout() {
    setBusy(true);
    try {
      await logout();
    } finally {
      router.replace('/');
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-[rgba(26,26,24,.55)] p-0 backdrop-blur-sm sm:items-center sm:p-6" data-testid="phone-gate">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="phone-gate-title"
        aria-describedby="phone-gate-body"
        onKeyDown={onKeyDown}
        className="max-h-dvh w-full max-w-md overflow-y-auto border border-text bg-bg p-6 sm:p-8"
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <div>
            <h2 id="phone-gate-title" className="font-serif text-3xl leading-tight text-text">
              {t('title')}
            </h2>
            <p id="phone-gate-body" className="mt-3 text-base leading-relaxed text-muted">
              {t('body')}
            </p>
          </div>
          {cart.count > 0 && (
            <p className="border-l-2 border-accent bg-accent/10 px-3 py-2 text-sm text-text" data-testid="phone-gate-cart">
              {t('cart', { count: cart.count })}
            </p>
          )}
          <div aria-live="polite">
            <Input
              ref={inputRef}
              label={t('label')}
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              prefix="+52"
              value={phone}
              onChange={(e) => onChange(e.target.value)}
              error={error ?? undefined}
            />
          </div>
          <Button type="submit" size="lg" disabled={!normalized} loading={busy}>
            {t('save')}
          </Button>
          <button
            type="button"
            onClick={onLogout}
            disabled={busy}
            className="self-center text-sm text-muted underline underline-offset-4 hover:text-text"
          >
            {t('logout')}
          </button>
        </form>
      </div>
    </div>
  );
}
