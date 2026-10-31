'use client';

import { useTranslations } from 'next-intl';
import { PrivacyNoticeLink } from '@/components/legal/PrivacyNoticeLink';
import { useMeasurement } from './measurement-context';
import { usePublishedHeight } from '@/hooks/useStickyBottomBar';

/**
 * DESIGN_SYSTEM MKT-CONV.1 (B1, D-A = A; HECHOS 2026-10-31 «Marketing tanda 2: decisiones del dueño») — primera capa
 * del aviso de cookies como barra inferior DELGADA (≈ 89 px en móvil, ≈ 57 px en escritorio; techos de candado 96/64,
 * L-1 en `e2e/measurement-on.spec.ts`).
 *
 * Sin muro (CK-2): `role="region"`, no diálogo, sin `aria-modal`, sin capa oscura, sin bloqueo de scroll, no roba el
 * foco, `Esc` no responde. «Aceptar» y «Solo lo necesario» con el MISMO peso (L-2: misma clase `CHOICE_CLASS`, borde y
 * fondo de papel; sustituye el «Aceptar» más grande de MKT2-UX.1). «Configurar» es un `<button>` con aspecto de enlace
 * DENTRO de la frase. ⛔ Textos y nombres de botones sin cambio (HECHOS 2026-10-26). Va ENCIMA de la barra de COMPRAR
 * (`bottom: var(--sticky-bottom-h, 0px)`, MKT2-UX.5) y publica su alto en `--consent-banner-h` para que el pie no
 * quede tapado. Solo se monta en rutas medidas.
 *
 * Se coloca en el DOM justo después del skip-link (`ConsentBannerSlot` en el layout del storefront).
 */
export function ConsentBannerSlot() {
  const m = useMeasurement();
  if (!m.bannerVisible) return null;
  return <ConsentBanner />;
}

const BANNER_VAR = '--consent-banner-h';

function ConsentBanner() {
  const t = useTranslations('consent');
  const tp = useTranslations('privacy');
  const m = useMeasurement();
  const ref = usePublishedHeight<HTMLDivElement>(BANNER_VAR);

  return (
    <div
      ref={ref}
      role="region"
      aria-label={t('region')}
      data-testid="consent-banner"
      style={{ bottom: 'var(--sticky-bottom-h, 0px)' }}
      // El inset inferior solo cuenta cuando NO hay barra fija debajo (con ella, `--sticky-bottom-h` > inset ⇒ 4 px).
      className="fixed inset-x-0 z-40 max-h-[60vh] overflow-y-auto border-t border-border-strong bg-surface-2 pb-[max(0.25rem,calc(env(safe-area-inset-bottom)-var(--sticky-bottom-h,0px)))] pt-1 md:py-2"
    >
      <div className="gutter mx-auto flex max-w-7xl flex-col md:flex-row md:items-center md:gap-6">
        <p className="text-[12px] leading-4 text-text md:flex-1 md:text-[13px] md:leading-[18px]">
          {t('text')} <PrivacyNoticeLink variant="inline">{tp('link')}</PrivacyNoticeLink>
          <span aria-hidden> · </span>
          <button
            type="button"
            data-testid="consent-customize"
            onClick={(e) => m.openPreferences('banner', e.currentTarget)}
            // Exento de 24 px (WCAG 2.5.8, en renglón de texto); el `after` amplía el toque a ≈ 32 px sin mover nada.
            className="relative text-text underline underline-offset-4 after:absolute after:-inset-x-1 after:-inset-y-2 after:content-['']"
          >
            {t('customize')}
          </button>
        </p>
        <div className="mt-1 grid grid-cols-2 gap-2 max-[319px]:grid-cols-1 md:mt-0 md:flex md:items-center md:gap-3">
          <button type="button" data-testid="consent-accept" onClick={m.accept} className={CHOICE_CLASS}>
            {t('accept')}
          </button>
          <button type="button" data-testid="consent-necessary" onClick={m.necessaryOnly} className={CHOICE_CLASS}>
            {t('necessary')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** MKT-CONV.1 / L-2: los DOS botones de la primera capa llevan exactamente esta clase (mismo peso visual). */
const CHOICE_CLASS =
  'inline-flex h-11 items-center justify-center border border-text bg-bg px-2 text-center text-[12px] font-semibold uppercase leading-[1.15] tracking-[0.08em] text-text transition-colors hover:bg-surface-2 active:scale-[.98] md:h-10 md:min-w-[8.5rem] md:px-5 md:text-[13px] md:tracking-[0.16em]';
