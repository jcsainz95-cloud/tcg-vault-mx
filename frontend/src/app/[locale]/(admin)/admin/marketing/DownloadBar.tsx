'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DownloadCloud } from 'lucide-react';
import { asApiError, type BlobResponse } from '@/lib/api-client';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { downloadMarketingWeeklyExcel, exportMarketingScreen, type MarketingPeriodQuery } from '@/lib/marketing-api';
import type { MarketingPrivacy, MarketingScreen } from '@/types/contract';
import type { MktPeriodKind } from './url-state';
import { useReportForbidden } from './forbidden';

/**
 * Descargas del panel (`DESIGN_SYSTEM §MKT-UX.9`; contrato §MKT.E). `fetch` con la sesión en la cabecera + blob +
 * nombre de `Content-Disposition` (`requestBlob`): ⛔ nunca un `<a href>` al API (el JWT no va en una URL y un `400`
 * no deja al dueño mirando un JSON). Una descarga en curso deshabilita las demás. La URL de descarga no se guarda en
 * ningún sitio (⛔ caché de consultas): cada clic la genera al vuelo.
 */

function saveBlob(blob: Blob, filename: string) {
  if (typeof window === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type Job = 'weekly' | 'xlsx' | 'csv';

export function DownloadBar({
  screen,
  period,
  kind,
  privacy,
}: {
  screen: MarketingScreen;
  period: MarketingPeriodQuery | null;
  kind: MktPeriodKind;
  /** Régimen del último payload pintado; `null` mientras no se sabe (cargando) ⇒ no se pinta ningún aviso de régimen. */
  privacy: MarketingPrivacy | null;
}) {
  const t = useTranslations('admin.marketing.download');
  const tState = useTranslations('admin.marketing.state');
  const reportForbidden = useReportForbidden();
  const [busy, setBusy] = useState<Job | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ job: Job; closed: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeId = useId();
  // §MKT2-UX.14 (C-F16): con `exact`, `exactNotice` SUSTITUYE a `helpAlways`; con `small_cells`, al revés; sin saberlo,
  // ninguno. Lo decide el campo del servidor, ⛔ nunca el rol en el navegador. Los botones lo enlazan (`aria-describedby`).
  const notice = privacy === 'exact' ? t('exactNotice') : privacy === 'small_cells' ? t('helpAlways') : null;
  const describedBy = notice ? noticeId : undefined;

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function run(job: Job) {
    if (!period || busy) return;
    setBusy(job);
    setDone(null);
    setFailure(null);
    try {
      const res: BlobResponse =
        job === 'weekly' ? await downloadMarketingWeeklyExcel(period) : await exportMarketingScreen(screen, job, period);
      const name = res.filename ?? `tcghunt_${job === 'weekly' ? 'semana' : screen}.${job === 'csv' ? 'csv' : 'xlsx'}`;
      saveBlob(res.blob, name);
      setDone(t('done', { archivo: name }));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(null), 8000);
    } catch (e) {
      if (!reportForbidden(e)) setFailure({ job, closed: asApiError(e)?.status === 400 });
    } finally {
      setBusy(null);
    }
  }

  const disabled = !period || busy !== null;

  return (
    <div className="flex flex-col gap-3 lg:items-end" data-testid="mkt-downloads">
      <Button
        onClick={() => run('weekly')}
        loading={busy === 'weekly'}
        disabled={disabled}
        className="w-full lg:w-auto"
        aria-describedby={describedBy}
        data-testid="mkt-download-weekly"
      >
        {busy === 'weekly' ? (
          t('preparing')
        ) : (
          <>
            <DownloadCloud size={16} aria-hidden />
            {kind === 'month' ? t('month') : t('week')}
          </>
        )}
      </Button>
      <div role="group" aria-label={t('exportGroup')} className="flex w-full items-center gap-2 lg:w-auto">
        <span className="eyebrow">{t('exportGroup')}</span>
        {(['xlsx', 'csv'] as const).map((f) => (
          <Button
            key={f}
            variant="secondary"
            size="sm"
            onClick={() => run(f)}
            loading={busy === f}
            disabled={disabled}
            className="flex-1 lg:flex-none"
            aria-describedby={describedBy}
            data-testid={`mkt-export-${f}`}
          >
            {t(f)}
          </Button>
        ))}
      </div>
      <p role="status" className="text-xs text-text" data-testid="mkt-download-status">
        {done ?? ''}
      </p>
      {failure && (
        <Banner
          variant="danger"
          role="alert"
          action={
            failure.closed ? undefined : (
              <Button variant="secondary" size="sm" onClick={() => run(failure.job)}>
                {tState('retry')}
              </Button>
            )
          }
        >
          <span data-testid="mkt-download-error">{failure.closed ? t('errorClosed') : t('errorGeneric')}</span>
        </Banner>
      )}
      <div className="flex flex-col gap-0.5 text-xs text-muted lg:text-right">
        {notice && (
          <p id={noticeId} data-testid={privacy === 'exact' ? 'mkt-exact-notice' : 'mkt-help-always'}>
            {notice}
          </p>
        )}
        <p>{t('helpShare')}</p>
      </div>
    </div>
  );
}
