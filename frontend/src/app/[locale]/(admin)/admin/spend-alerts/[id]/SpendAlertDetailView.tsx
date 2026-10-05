'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getSpendAlert, markSpendAlertsSeen } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import { Link } from '@/i18n/navigation';
import { formatDateTimeMx, formatMoneyCents } from '@/lib/format';
import { PICKING_SUMMARY_KEY } from '@/hooks/usePickingSummary';
import type { AppLocale } from '@/i18n/routing';
import type { SpendAlertCode, SpendAlertDTO, SpendAlertFactValue } from '@/types/contract';
import { FACT_INT, FACT_MONEY, FACT_WHITELIST, joinAnd } from '../alert-text';
import { AlertRef, MailStatus, SeverityTag, useAlertTexts, useOwnerMarks } from '../SpendAlertsView';

const LABEL = 'font-mono text-[11px] uppercase tracking-[0.06em] text-muted';
/** 🔴 de guías: el enlace «Frenar la compra de guías» (§43.19.8). */
const STOP_CODES: readonly SpendAlertCode[] = ['AG-1', 'AG-3', 'AG-4', 'AG-5', 'AG-7', 'AG-8', 'AG-9'];
const CAP_CODES: readonly SpendAlertCode[] = ['AG-2', 'AG-3'];

/**
 * El detalle de un aviso de gasto (`/admin/spend-alerts/[id]`, `DESIGN_SYSTEM §43.19.8`): a donde lleva el correo.
 *
 * - ⛔ Abrirlo NO lo marca visto (GAS-3: «quién y cuándo» lo pone la persona con su clic).
 * - La `<dl>` pinta **solo** las claves de `facts` de la lista blanca, con su rótulo; cualquier otra no se pinta
 *   (UX-GAS-6: ni el nombre ni el teléfono de un cliente aunque el servidor los mandara por error).
 * - Las cifras, tal cual del DTO (GAS-4).
 */
export function SpendAlertDetailView({ id }: { id: string }) {
  const t = useTranslations('admin.spendAlerts');
  const tCarrier = useTranslations('admin.m4.carrierStatus');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const texts = useAlertTexts();
  const ownerMarks = useOwnerMarks();
  const [copied, setCopied] = useState(false);
  const query = useQuery({ queryKey: ['spend-alert', id], queryFn: () => getSpendAlert(id), retry: false });
  const mark = useMutation({
    mutationFn: () => markSpendAlertsSeen([id]),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['spend-alert', id] });
      void qc.invalidateQueries({ queryKey: ['spend-alerts'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: PICKING_SUMMARY_KEY });
    },
  });
  const err = asApiError(query.error);
  const a = query.data;
  const none = t('noData');

  function factValue(key: string, v: SpendAlertFactValue | undefined): React.ReactNode {
    if (v === null || v === undefined) return none;
    if ((FACT_MONEY as readonly string[]).includes(key)) return typeof v === 'number' ? formatMoneyCents(v, locale) : none;
    if ((FACT_INT as readonly string[]).includes(key)) return typeof v === 'number' ? (key === 'pct' ? `${v} %` : String(v)) : none;
    if (key === 'correctionAt') return typeof v === 'string' ? formatDateTimeMx(v, locale) : none;
    if (key === 'changedKeys') return joinAnd(t, (Array.isArray(v) ? v : []).map((k) => (t.has(`field.${k}`) ? t(`field.${k}`) : k)));
    if (key === 'actors') return Array.isArray(v) ? v.join(', ') : none;
    if (key === 'kind') return typeof v === 'string' && t.has(`chargeKind.${v}`) ? t(`chargeKind.${v}`) : t('chargeKind.other');
    // §43.20.1: un valor sin rótulo ⇒ «sin dato» (⛔ nunca el valor crudo).
    if (key === 'cancelKind') return typeof v === 'string' && t.has(`cancelKind.${v}`) ? t(`cancelKind.${v}`) : none;
    if (key === 'status') return typeof v === 'string' && tCarrier.has(v) ? tCarrier(v) : String(v);
    if (key === 'providerReference' && typeof v === 'string') {
      const text = `Pedido ${v}`;
      return (
        <span className="flex flex-wrap items-baseline gap-3">
          <span className="select-all font-mono">{text}</span>
          <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true))}>
            {copied ? t('detail.copied') : t('detail.copy')}
          </Button>
        </span>
      );
    }
    return typeof v === 'string' ? v : none;
  }

  const facts = (al: SpendAlertDTO) => FACT_WHITELIST.filter((k) => k in al.facts && k !== 'cause');

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/spend-alerts" className="font-mono text-[11px] uppercase tracking-label text-muted hover:text-text">
          {t('detail.back')}
        </Link>
      </div>
      {err?.code === 'NOT_FOUND' ? (
        <EmptyState title={t('detail.notFound')} />
      ) : err?.code === 'MONEY_OUT_FORBIDDEN' ? (
        <Banner variant="warning" role="alert">
          {t('forbidden')}
        </Banner>
      ) : (
        <QueryState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => query.refetch()}>
          {a && (
            <article className="flex flex-col gap-5" data-testid="spend-alert-detail">
              <header className="flex flex-col gap-2">
                <h1 className="font-serif text-2xl text-text">{texts.title(a)}</h1>
                <SeverityTag severity={a.severity} muted={!!a.muted} />
                <p className="text-base text-text">{texts.text(a)}</p>
              </header>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm text-text sm:grid-cols-[auto_1fr]" data-testid="spend-alert-facts">
                {facts(a).map((k) => (
                  <div key={k} className="contents">
                    <dt className={LABEL}>{t(`fact.${k}`)}</dt>
                    <dd className={(FACT_MONEY as readonly string[]).includes(k) ? 'tabular' : undefined}>{factValue(k, a.facts[k])}</dd>
                  </div>
                ))}
                <dt className={LABEL}>{t('detail.who')}</dt>
                <dd>{a.subject ? a.subject.name?.trim() || t('personNone') : t('noSubject')}</dd>
                <dt className={LABEL}>{t('detail.ref')}</dt>
                <dd>
                  <AlertRef alert={a} />
                </dd>
                <dt className={LABEL}>{t('detail.first')}</dt>
                <dd className="tabular">{formatDateTimeMx(a.firstOccurredAt, locale)}</dd>
                <dt className={LABEL}>{t('detail.last')}</dt>
                <dd className="tabular">{formatDateTimeMx(a.lastOccurredAt, locale)}</dd>
                <dt className={LABEL}>{t('detail.count')}</dt>
                <dd className="tabular">{a.occurrenceCount}</dd>
                <dt className={LABEL}>{t('detail.mail')}</dt>
                <dd>
                  <MailStatus alert={a} />
                </dd>
                <dt className={LABEL}>{t('detail.seen')}</dt>
                <dd>
                  {a.seen
                    ? t('seenBy', { name: a.seen.by.name?.trim() || t('personNone'), date: formatDateTimeMx(a.seen.at, locale) })
                    : t('unseenTag')}
                </dd>
              </dl>
              <div className="flex flex-wrap items-center gap-3">
                {!a.seen &&
                  (ownerMarks(a) ? (
                    <span className="text-sm text-muted" data-testid="spend-alert-owner-marks">
                      {t('ownerMarks')}
                    </span>
                  ) : (
                    <Button loading={mark.isPending} onClick={() => mark.mutate()}>
                      {t('detail.markSeen')}
                    </Button>
                  ))}
                {a.severity === 'immediate' && STOP_CODES.includes(a.code) && (
                  <Link href="/admin/m10#compra-guias" className="text-sm text-text underline underline-offset-4 hover:text-accent">
                    {t('detail.stopPurchases')}
                  </Link>
                )}
                {CAP_CODES.includes(a.code) && (
                  <Link href="/admin/m10#control-gasto" className="text-sm text-text underline underline-offset-4 hover:text-accent">
                    {t('detail.changeCap')}
                  </Link>
                )}
              </div>
              {mark.isSuccess && mark.data.skipped ? (
                <p role="status" className="text-sm text-text">
                  {t('skipped', { skipped: mark.data.skipped })}
                </p>
              ) : null}
            </article>
          )}
        </QueryState>
      )}
    </div>
  );
}
