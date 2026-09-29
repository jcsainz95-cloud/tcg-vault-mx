'use client';

import { useTranslations } from 'next-intl';
import { CardImage } from '@/components/ui/CardImage';
import { FinishMark } from '@/components/domain/FinishMark';
import { formatDate, formatDateTimeMx, formatMoneyCents } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import type { ReplacementCaseDTO } from '@/types/contract';
import { CustomerNameBlock } from '../vaults/CustomerNameBlock';
import { DASH, LABEL, TAG, useZonedLabel } from './prep-shared';

/**
 * **La tarjeta de un caso «Por reponer»** (`DESIGN_SYSTEM §37.8b`): plazo (plano 0), qué carta e identidad
 * exacta (1), a quién se le debe (2), por qué y desde cuándo (3), dónde está hoy (4), origen del dinero (5),
 * candidatas (6) y —en cerrados— la resolución (7). La misma pieza en la lista y en el detalle.
 *
 * ⛔ `overdue` manda (S1): «Vencido» se pinta solo si el servidor lo dice; `{n}` días es solo para mostrar.
 */
export function ReplacementCaseCard({
  kase,
  locale,
  footer,
  children,
}: {
  kase: ReplacementCaseDTO;
  locale: AppLocale;
  footer?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const t = useTranslations('admin.m4.replace');
  const tp = useTranslations('admin.m4.prep');
  const tCase = useTranslations('status.replacementCase');
  const tReason = useTranslations('status.missingReason');
  const tOrder = useTranslations('status.order');
  const tInv = useTranslations('status.inventory');
  const zoned = useZonedLabel();
  const c = kase;
  const nameId = `case-name-${c.id}`;
  // Días SOLO para mostrar: la diferencia entera hacia abajo entre `dueAt` y ahora. Qué está vencido lo dice `overdue`.
  const dueMs = new Date(c.dueAt).getTime();
  const days = Number.isNaN(dueMs) ? null : Math.floor(Math.abs(dueMs - Date.now()) / (24 * 3600 * 1000));
  const id = c.original.identity;
  const identityBits: string[] = [tp('folio') + ' ' + c.original.folio];

  return (
    <article
      data-testid={`case-${c.id}`}
      data-overdue={c.overdue ? 'true' : 'false'}
      aria-labelledby={nameId}
      className={cn('flex flex-col gap-4 rounded-lg border border-border bg-surface p-4', c.overdue && 'border-l-2 border-l-accent')}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn(TAG, c.status === 'open' ? 'text-muted' : 'text-text')}>{tCase(c.status)}</span>
          <span className={cn(TAG, 'text-muted')}>{c.source === 'withdrawal' ? t('filter.source.withdrawal') : t('filter.source.vault_purchase')}</span>
        </div>
        {c.status === 'open' && (
          <p className="flex flex-col items-start gap-0.5 sm:items-end">
            <span className={cn(TAG, c.overdue ? 'text-accent' : 'text-muted')} data-testid={`case-due-${c.id}`}>
              {c.overdue ? t('due.overdue', { count: days ?? 0 }) : t('due.in', { count: days ?? 0 })}
            </span>
            <time dateTime={c.dueAt} className="text-xs text-muted">
              {t('due.date', { date: formatDate(c.dueAt, locale) || DASH })}
            </time>
          </p>
        )}
      </header>

      {/* Plano 1 · qué carta, con su identidad exacta. */}
      <div className="flex gap-3">
        <CardImage src={c.original.card.imageSmallUrl} alt={c.original.card.name} className="w-16 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p id={nameId} className="font-serif text-lg leading-tight text-text" lang="en">
            {c.original.card.name} <span className="font-mono text-[11px] text-muted">· {c.original.folio}</span>
          </p>
          <p className="text-sm font-semibold text-text" lang="en">
            {c.original.card.setName ?? DASH}
          </p>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <FinishMark finish={c.original.card.finish} band={false} />
            <span className="text-text">{c.original.card.conditionLabel}</span>
          </p>
          <p className={LABEL}>{t('identity')}</p>
          <p className="font-mono text-[11px] text-muted" lang="en">
            {[
              ...identityBits,
              id.productType,
              id.finish,
              id.cardProductId !== null ? t('identityDetail.cardProduct', { id: id.cardProductId }) : null,
              id.rawCondition,
              id.gradingCompany && id.gradeValue ? `${id.gradingCompany} ${id.gradeValue}` : null,
              id.sealedProductId ? t('identityDetail.sealed', { id: id.sealedProductId, condition: id.sealedCondition ?? DASH }) : null,
            ]
              .filter((x): x is string => Boolean(x))
              .join(' · ')}
          </p>
        </div>
      </div>

      {/* Plano 2 · a quién se le debe. */}
      <div className="flex flex-col gap-0.5">
        <span className={LABEL}>{t('owed')}</span>
        <CustomerNameBlock name={c.customer.fullName} email={c.customer.email} testId={`case-customer-${c.id}`} />
      </div>

      {/* Plano 3 · por qué y desde cuándo. */}
      <p className="text-sm text-text">
        {t('openedLine', {
          reason: tReason(c.missingReason),
          source: c.source,
          orderNumber: c.placement?.orderNumber ?? c.origin?.orderNumber ?? DASH,
          name: c.openedBy.name?.trim() || tp('vault.nameMissing.tag'),
          date: formatDateTimeMx(c.openedAt, locale),
        })}
      </p>

      {/* Plano 4 · dónde está la deuda hoy. */}
      <div className="flex flex-col gap-0.5 text-sm text-text">
        <span className={LABEL}>{t('where')}</span>
        <p>
          {c.original.currentLocation.kind === 'assigned' ? (
            <span className="tabular font-mono">{c.original.currentLocation.label}</span>
          ) : (
            <span className="text-accent">{tp('unassigned')}</span>
          )}
          {' · '}
          {tInv.has(c.original.pieceStatus) ? tInv(c.original.pieceStatus) : c.original.pieceStatus}
        </p>
        {c.status === 'open' && <p>{t(`destination.${c.destination}`)}</p>}
        {c.destination === 'drawer' && c.customerDrawers.length > 0 && (
          <p className="font-mono text-[11px] text-muted">
            {c.customerDrawers.map((d) => zoned(d.zone, d.label)).join(' · ')}
          </p>
        )}
      </div>

      {/* Plano 5 · origen del dinero. */}
      <p className="text-sm text-text">
        {c.origin ? (
          <Link href={`/admin/m3/${c.origin.orderId}`} className="underline underline-offset-4 hover:text-accent">
            {t('origin', { orderNumber: c.origin.orderNumber ?? c.origin.orderId, status: tOrder(c.origin.orderStatus) })}
          </Link>
        ) : (
          <span className="text-accent">{t('originNone')}</span>
        )}
      </p>

      {/* Plano 6 · candidatas. */}
      {c.status === 'open' && <p className="tabular text-sm text-text">{t('candidates', { count: c.candidateCount })}</p>}

      {/* Plano 7 · resolución (solo cerrados). */}
      {c.status !== 'open' && (
        <div className="flex flex-col gap-1 border-t border-border pt-3 text-sm text-text">
          <span className={LABEL}>{t('resolution')}</span>
          <p>
            <span className={cn(TAG, 'text-text')}>{tCase(c.status)}</span>{' '}
            {c.resolvedBy && t('resolvedBy', { name: c.resolvedBy.name?.trim() || tp('vault.nameMissing.tag'), date: formatDateTimeMx(c.resolvedAt, locale) })}
            {c.status === 'replaced' && c.replacement && <> · {t('resolvedReplaced', { folio: c.replacement.folio })}</>}
            {c.status === 'found' && <> · {t('resolvedFound')}</>}
          </p>
          {c.status === 'voided' && c.voidNote && <p className="text-muted">{c.voidNote}</p>}
          {c.status === 'refunded' && c.refundCapture && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1" data-testid={`case-captured-${c.id}`}>
              <dt className={LABEL}>{t('captured.amount')}</dt>
              <dd className="tabular">{formatMoneyCents(c.refundCapture.amountCents, locale)}</dd>
              <dt className={LABEL}>{t('captured.reason')}</dt>
              <dd>{c.refundCapture.reason}</dd>
              <dt className={LABEL}>{t('captured.refs')}</dt>
              <dd className="tabular">
                {c.refundCapture.market
                  ? t('captured.refsValue', { paid: formatMoneyCents(c.refundCapture.paidReferenceCents, locale), market: formatMoneyCents(c.refundCapture.market.cents, locale), date: c.refundCapture.market.capturedDate })
                  : t('captured.refsNoMarket', { paid: formatMoneyCents(c.refundCapture.paidReferenceCents, locale) })}
              </dd>
              <dt className={LABEL}>{t('captured.reinforced')}</dt>
              <dd>{c.refundCapture.aboveReferenceConfirmed ? t('captured.yes') : t('captured.no')}</dd>
            </dl>
          )}
        </div>
      )}

      {children}
      {footer && <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">{footer}</div>}
    </article>
  );
}
