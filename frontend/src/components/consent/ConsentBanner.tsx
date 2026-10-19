'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { PrivacyNoticeLink } from '@/components/legal/PrivacyNoticeLink';
import { useMeasurement } from './measurement-context';
import { usePublishedHeight } from '@/hooks/useStickyBottomBar';

/**
 * DESIGN_SYSTEM MKT2-UX.3 — primera capa del aviso de cookies.
 *
 * Sin muro (CK-2): `role="region"`, no diálogo, sin `aria-modal`, sin capa oscura, sin bloqueo de
 * scroll, no roba el foco, `Esc` no responde. «Aceptar» grande (decisión del dueño, MKT2-UX.1) y
 * «Solo lo necesario» visible a un toque, ambos `<button>` ≥ 44 px con la misma letra (CK-3).
 * Va ENCIMA de la barra de COMPRAR (`bottom: var(--sticky-bottom-h, 0px)`, MKT2-UX.5) y publica su
 * alto en `--consent-banner-h` para que el pie no quede tapado. Solo se monta en rutas medidas.
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
      className="fixed inset-x-0 z-40 max-h-[60vh] overflow-y-auto border-t border-border-strong bg-surface-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-3 md:py-3"
    >
      <div className="gutter mx-auto flex max-w-7xl flex-col gap-2 md:flex-row md:items-center md:gap-6">
        <p className="text-[13px] leading-[1.5] text-text md:flex-1">
          {t('text')} <PrivacyNoticeLink variant="inline">{tp('link')}</PrivacyNoticeLink>
        </p>
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
          <Button
            size="lg"
            variant="primary"
            data-testid="consent-accept"
            className="w-full px-6 py-0 text-[13px] font-semibold md:w-auto md:min-w-[10rem]"
            onClick={m.accept}
          >
            {t('accept')}
          </Button>
          <button
            type="button"
            data-testid="consent-necessary"
            onClick={m.necessaryOnly}
            className="inline-flex h-11 w-full items-center justify-center border border-text bg-bg px-5 text-[13px] font-semibold uppercase leading-none tracking-[0.16em] text-text transition-colors hover:bg-surface-2 active:scale-[.98] md:w-auto"
          >
            {t('necessary')}
          </button>
          <button
            type="button"
            data-testid="consent-customize"
            onClick={(e) => m.openPreferences('banner', e.currentTarget)}
            className="min-h-9 self-start text-[13px] text-text underline underline-offset-4 md:self-center"
          >
            {t('customize')}
          </button>
        </div>
      </div>
    </div>
  );
}
