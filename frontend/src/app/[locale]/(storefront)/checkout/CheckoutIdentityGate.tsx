'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';

/** Las tres vías del criterio 46. `none` = el gate está desplegado sin elección. */
export type IdentityMode = 'none' | 'guest' | 'login' | 'register';

export interface CheckoutIdentityGateProps {
  mode: IdentityMode;
  onSelect: (mode: IdentityMode) => void;
  /** id del panel que el padre renderiza debajo (patrón disclosure: aria-controls). */
  panelId: string;
}

const PATHS = [
  { mode: 'guest' as const, key: 'guest', variant: 'primary' as const },
  { mode: 'login' as const, key: 'login', variant: 'secondary' as const },
  { mode: 'register' as const, key: 'register', variant: 'secondary' as const },
];

/**
 * `CheckoutIdentityGate` (DESIGN_SYSTEM §15.2, criterio 46) — bifurcación de identidad
 * INLINE en la parte superior del checkout, en la MISMA ruta `/checkout`.
 *
 * Por qué inline y no modal ni ruta aparte: al no cambiar de ruta, el estado del carrito
 * (y el del formulario de invitado, que vive por encima de este componente) no se desmonta,
 * así que "cambiar de vía no vacía el carrito" se cumple POR CONSTRUCCIÓN, no por una
 * salvaguarda. El botón "atrás" tampoco expulsa del checkout.
 *
 * Igual dignidad por GEOMETRÍA (§15.2): mismo alto, mismo ancho, misma escala y misma área
 * táctil en las tres; la única diferencia es relleno vs. borde (vocabulario normal de
 * primaria/secundaria del sistema). "Continuar como invitado" es la primaria porque es la
 * vía de menor compromiso — es literalmente el objetivo de la feature.
 */
export function CheckoutIdentityGate({ mode, onSelect, panelId }: CheckoutIdentityGateProps) {
  const t = useTranslations('checkout.identity');
  const buttonRefs = useRef<Partial<Record<IdentityMode, HTMLButtonElement | null>>>({});
  const restoreFocus = useRef<IdentityMode | null>(null);

  // "Cambiar" devuelve el foco al botón de la vía que estaba elegida (§15.2).
  useEffect(() => {
    if (mode === 'none' && restoreFocus.current) {
      const previous = restoreFocus.current;
      restoreFocus.current = null;
      buttonRefs.current[previous]?.focus();
    }
  }, [mode]);

  if (mode !== 'none') {
    const chosen = PATHS.find((p) => p.mode === mode);
    return (
      <section aria-labelledby="identity-gate-title" className="border-b border-border py-5">
        <h2 id="identity-gate-title" className="sr-only">
          {t('title')}
        </h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[11px] uppercase tracking-label text-muted">
            {t('chosen')}:{' '}
            <span className="text-text">{chosen ? t(`${chosen.key}.cta`) : ''}</span>
          </p>
          <Button
            variant="ghost"
            size="sm"
            aria-expanded
            aria-controls={panelId}
            onClick={() => {
              restoreFocus.current = mode;
              onSelect('none');
            }}
          >
            {t('change')}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="identity-gate-title" className="border-b border-border pb-8 pt-6">
      <p className="eyebrow">{t('eyebrow')}</p>
      <h2 id="identity-gate-title" className="mt-3 font-serif text-[24px] leading-tight text-text">
        {t('title')}
      </h2>

      <ul className="mt-6 lg:grid lg:grid-cols-3 lg:gap-6">
        {PATHS.map((path) => (
          <li key={path.mode} className="border-t border-border py-5 first:border-t-0 lg:border-t-0 lg:py-0">
            <Button
              ref={(el) => {
                buttonRefs.current[path.mode] = el;
              }}
              variant={path.variant}
              size="lg"
              className="w-full"
              aria-expanded={false}
              aria-controls={panelId}
              onClick={() => onSelect(path.mode)}
            >
              {t(`${path.key}.cta`)}
            </Button>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              {t(`${path.key}.hint`)}
            </p>
          </li>
        ))}
      </ul>

      {/* Siempre visible: ninguna de las tres vías es un callejón sin salida (criterio 46). */}
      <p className="mt-6 font-mono text-[11px] leading-relaxed text-muted">{t('cartKept')}</p>
    </section>
  );
}
