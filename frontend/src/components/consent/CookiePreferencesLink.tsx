'use client';

import { useTranslations } from 'next-intl';
import { useMeasurement } from './measurement-context';

/**
 * DESIGN_SYSTEM MKT2-UX.8 — enlace persistente «Preferencias de cookies». Es un `<button>` con aspecto
 * de enlace (abre la segunda capa; ⛔ no un `<a href="#">`). Con el modo `off` (o `on` sin etiqueta
 * válida) no se pinta, ni un hueco (C-F14).
 *
 *  - `variant="nav"`: en la fila de enlaces del pie, con las clases de su vecino.
 *  - `variant="inline"`: dentro del aviso de privacidad, con el aspecto de los enlaces del cuerpo.
 */
export function CookiePreferencesLink({ variant, className }: { variant: 'nav' | 'inline'; className?: string }) {
  const m = useMeasurement();
  const t = useTranslations('consent');
  if (!m.active) return null;
  const cls =
    variant === 'nav'
      ? (className ?? 'text-text hover:text-accent')
      : (className ?? 'text-accent underline decoration-1 underline-offset-4 hover:text-text');
  return (
    <button
      type="button"
      data-testid={`cookie-preferences-${variant}`}
      className={cls}
      onClick={(e) => m.openPreferences('link', e.currentTarget)}
    >
      {t('footerLink')}
    </button>
  );
}

/**
 * Sitio 2 de MKT2-UX.8: el HUECO del aviso de privacidad, al final del apartado de cookies. El texto
 * del apartado es del abogado; esto solo pone el botón (y nada con el modo `off`).
 */
export function CookiePreferencesNoticeSlot() {
  const m = useMeasurement();
  if (!m.active) return null;
  return (
    <p className="text-sm leading-relaxed text-text/90">
      <CookiePreferencesLink variant="inline" />
    </p>
  );
}
