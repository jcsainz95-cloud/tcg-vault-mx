'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { privacyRichTags } from '@/components/legal/PrivacyNoticeLink';
import type { ConsentChoice } from '@/lib/measurement/consent';

/**
 * DESIGN_SYSTEM MKT2-UX.7 — segunda capa «Preferencias de cookies» (respuesta `custom`).
 *
 * Diálogo con foco ATRAPADO (a diferencia del banner, que no lo es), `aria-labelledby`, `Esc`,
 * «Cancelar» y tocar fuera cierran SIN guardar (CK-3 f: no es una respuesta). Los dos interruptores
 * nacen como los da `initial` (sin elección vigente: apagados). Centrado en escritorio, hoja inferior
 * en móvil, radio 0, sobre papel.
 */
export function ConsentPreferencesDialog({
  initial,
  onCancel,
  onSave,
}: {
  initial: ConsentChoice;
  onCancel: () => void;
  onSave: (choice: ConsentChoice) => void;
}) {
  const t = useTranslations('consent.layer');
  const titleId = useId();
  const introId = useId();
  const analyticsDescId = useId();
  const adsDescId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [analytics, setAnalytics] = useState(initial.analytics);
  const [ads, setAds] = useState(initial.ads);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const focusables = Array.from(
        ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      const inside = !!activeEl && ref.current.contains(activeEl);
      if (e.shiftKey && (activeEl === first || !inside || activeEl === titleRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (activeEl === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(26,26,24,.55)] sm:items-center sm:p-4"
      onClick={onCancel}
      data-testid="consent-dialog-scrim"
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={introId}
        data-testid="consent-dialog"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[100dvh] w-full max-w-lg flex-col overflow-y-auto border-t border-border bg-bg p-5 sm:max-h-[90vh] sm:border"
      >
        <h2 ref={titleRef} id={titleId} tabIndex={-1} className="font-mono text-[11px] uppercase tracking-label text-text outline-none">
          {t('title')}
        </h2>
        <p id={introId} className="mt-3 text-[13px] leading-[1.5] text-text">
          {t('intro')}
        </p>

        <div className="mt-4 border-t border-border py-3">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[13px] font-semibold text-text">{t('necessary.title')}</span>
            <span className="font-mono text-[11px] uppercase tracking-label text-text">{t('necessary.always')}</span>
          </div>
          <p className="mt-1 text-[13px] leading-[1.5] text-muted">{t('necessary.body')}</p>
        </div>

        <SwitchRow
          label={t('analytics.title')}
          description={t('analytics.body')}
          descriptionId={analyticsDescId}
          checked={analytics}
          onChange={setAnalytics}
          stateOn={t('stateOn')}
          stateOff={t('stateOff')}
        />
        <SwitchRow
          label={t('ads.title')}
          description={t('ads.body')}
          descriptionId={adsDescId}
          checked={ads}
          onChange={setAds}
          stateOn={t('stateOn')}
          stateOff={t('stateOff')}
        />

        <p className="border-t border-border pt-3 text-[13px] leading-[1.5] text-text">{t.rich('more', privacyRichTags)}</p>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            {t('cancel')}
          </Button>
          <Button variant="primary" onClick={() => onSave({ analytics, ads })}>
            {t('save')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SwitchRow({
  label,
  description,
  descriptionId,
  checked,
  onChange,
  stateOn,
  stateOff,
}: {
  label: string;
  description: string;
  descriptionId: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  stateOn: string;
  stateOff: string;
}) {
  return (
    <div className="border-t border-border py-3">
      <div className="flex items-center justify-between gap-4">
        <span className="text-[13px] font-semibold text-text" aria-hidden>
          {label}
        </span>
        <span className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            aria-describedby={descriptionId}
            onClick={() => onChange(!checked)}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center"
          >
            <span
              aria-hidden
              className={`relative inline-block h-5 w-9 border border-text transition-colors ${checked ? 'bg-text' : 'bg-bg'}`}
            >
              <span
                className={`absolute top-0.5 h-3.5 w-3.5 transition-[left] ${checked ? 'left-[18px] bg-bg' : 'left-0.5 bg-text'}`}
              />
            </span>
          </button>
          <span className="w-24 font-mono text-[11px] uppercase tracking-label text-text" aria-hidden>
            {checked ? stateOn : stateOff}
          </span>
        </span>
      </div>
      <p id={descriptionId} className="mt-1 text-[13px] leading-[1.5] text-muted">
        {description}
      </p>
    </div>
  );
}
