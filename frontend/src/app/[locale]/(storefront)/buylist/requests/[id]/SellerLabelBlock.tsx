'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { downloadSellerLabel, sellerLabelErrorKind } from './seller-label';

/**
 * 💰 rev BSD-1 — **«Tu guía»** del portal del vendedor (DESIGN_SYSTEM §BSD-UX.4b, contrato §BSD.4.4 + BSD-1.1 C-1).
 *
 * ⛔ **Quien lo monta decide con `labelPdfAvailable === true`** (BX5: el servidor dice si hay etiqueta viva); este bloque
 * NO mira `carrier` ni `trackingNumber` para decidir si existe (UX-BSD-4): los usa solo para el texto. Con guía manual el
 * servidor manda `false` y el bloque no existe.
 *
 * Sin la dirección de la tienda (la lleva la etiqueta). El error va bajo el botón en `role="alert"` y el botón vuelve a
 * estar activo; tras `errorUnavailable` se avisa al padre para que relea la solicitud (si `labelPdfAvailable` pasó a
 * `false`, el bloque desaparece solo).
 */
export function SellerLabelBlock({
  sellRequestId,
  carrier,
  trackingNumber,
  onUnavailable,
}: {
  sellRequestId: string;
  carrier: string | null | undefined;
  trackingNumber: string | null | undefined;
  onUnavailable?: () => void;
}) {
  const t = useTranslations('buylist.offer.label');
  const headingId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'unavailable' | 'temporary' | null>(null);

  async function download() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await downloadSellerLabel(sellRequestId);
    } catch (e) {
      const kind = sellerLabelErrorKind(e);
      setError(kind);
      if (kind === 'unavailable') onUnavailable?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={headingId} className="gutter mt-10" data-testid="seller-label-block">
      <h2 id={headingId} className="eyebrow">
        {t('title')}
      </h2>
      <p className="mt-3 max-w-[62ch] text-sm leading-[1.7] text-text">
        {carrier ? t('body', { carrier }) : t('bodyNoCarrier')}
      </p>
      {trackingNumber && (
        <p className="mt-2 select-all font-mono text-[15px] text-text" data-testid="seller-label-tracking">
          {t('tracking', { tracking: trackingNumber })}
        </p>
      )}
      <div className="mt-4">
        <Button loading={busy} onClick={download} data-testid="seller-label-download">
          {busy ? t('downloading') : t('download')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-3 max-w-[62ch] text-sm text-accent" data-testid="seller-label-error">
          {error === 'unavailable' ? t('errorUnavailable') : t('errorTemporary')}
        </p>
      )}
      <p className="mt-3 text-sm text-muted">{t('alsoInEmail')}</p>
    </section>
  );
}

/** El enlace corto del renglón de «Ventas» (§BSD-UX.4b punto 2): el mismo verbo, sin entrar al portal. */
export function SellerLabelLink({ sellRequestId }: { sellRequestId: string }) {
  const t = useTranslations('buylist.offer.label');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'unavailable' | 'temporary' | null>(null);
  return (
    <span className="mt-3 flex flex-col gap-1">
      <button
        type="button"
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await downloadSellerLabel(sellRequestId);
          } catch (e) {
            setError(sellerLabelErrorKind(e));
          } finally {
            setBusy(false);
          }
        }}
        className="self-start border-b border-text pb-1 text-xs font-medium text-text hover:border-accent hover:text-accent disabled:opacity-60"
        data-testid={`seller-label-link-${sellRequestId}`}
      >
        {busy ? t('downloading') : t('downloadShort')}
      </button>
      {error && (
        <span role="alert" className="text-xs text-accent">
          {error === 'unavailable' ? t('errorUnavailable') : t('errorTemporary')}
        </span>
      )}
    </span>
  );
}
