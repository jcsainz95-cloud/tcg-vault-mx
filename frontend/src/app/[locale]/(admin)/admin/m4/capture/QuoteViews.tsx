'use client';

import { useId } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { formatDateTimeMx, formatMoneyCents } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { AppLocale } from '@/i18n/routing';
import type { LabelOptionsDTO, LabelPurchaseLimit, ShipmentQuoteDTO, ShipmentRateDTO, ShippingPackageDTO } from '@/types/contract';
import { TAG } from '../prep-shared';

/**
 * Paso 2 (opciones) y paso 3 (comprar) de la ventana «Capturar guía» (`DESIGN_SYSTEM §43.3–§43.4`).
 *
 * ⛔ **SK3 — ninguna cifra la calcula esta pantalla:** precio, desglose, IVA, seguro, margen, cobertura,
 * «cobrado al cliente» y vigencia se pintan TAL CUAL del `ShipmentQuoteDTO`. Ni «recomendada», ni
 * «oculta», ni «promoción» se deciden aquí (`recommended`, `hidden`, `isPromo` del servidor).
 */

/** Las tres líneas de una opción (planos 1–2 de §43.3c), reusadas en el resumen del paso 3. */
export function RateLines({ rate, inbound = false }: { rate: ShipmentRateDTO; inbound?: boolean }) {
  const t = useTranslations('admin.m4.tracking.sdx.options');
  const ti = useTranslations('admin.m4.tracking.sdx.inbound');
  const locale = useLocale() as AppLocale;
  const days = rate.days === null ? t('daysNone') : t('days', { days: rate.days });
  // 💰 rev BSD-1 (§BSD-UX.5b): en ENTRADA el origen es el vendedor (recolección = la suya; ⛔ no se agenda) y el destino es
  // la tienda (entrega «en la tienda» o en sucursal). Mismos datos del DTO, otras palabras.
  const pickup = inbound
    ? rate.pickup === true
      ? ti('pickupYes')
      : rate.pickup === false
        ? ti('pickupNo', { carrierLabel: rate.carrierLabel })
        : t('pickupNone')
    : rate.pickup === true
      ? t('pickup')
      : rate.pickup === false
        ? rate.dropoff
          ? t('dropoffAt', { name: rate.dropoff.name })
          : t('dropoffAny', { carrier: rate.carrierLabel })
        : t('pickupNone');
  const chips = [rate.recommended ? t('recommended') : null, rate.isPromo ? t('promo') : null].filter(Boolean) as string[];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-base text-text">
          {rate.carrierLabel} · {rate.serviceName}
        </span>
        <span className="tabular text-lg font-medium text-text">{formatMoneyCents(rate.priceCents, locale)}</span>
      </div>
      {chips.length > 0 && (
        <p className={cn(TAG, 'text-text')} data-testid={`sdx-rate-chips-${rate.rateId}`}>
          {chips.join(' · ')}
        </p>
      )}
      <p className="text-sm text-text">
        {days} · {pickup} ·{' '}
        {rate.deliveryKind === 'home' ? (
          inbound ? ti('deliveryHome') : t('home')
        ) : rate.deliveryKind === 'branch' ? (
          <span className="text-accent">{inbound ? ti('deliveryBranch') : t('branch')}</span>
        ) : (
          t('deliveryNone')
        )}
      </p>
      <p className={cn('tabular text-sm', rate.marginCents < 0 ? 'text-accent' : 'text-text')}>
        {rate.marginCents < 0
          ? inbound
            ? ti('marginNegative', { abs: formatMoneyCents(Math.abs(rate.marginCents), locale) })
            : t('marginNegative', { amount: formatMoneyCents(Math.abs(rate.marginCents), locale) })
          : t('margin', { amount: formatMoneyCents(rate.marginCents, locale) })}
      </p>
      {rate.planType !== null && <p className="font-mono text-[11px] text-muted">{t('plan', { plan: rate.planType })}</p>}
    </div>
  );
}

interface OptionsProps {
  quote: ShipmentQuoteDTO;
  selected: string | null;
  onSelect: (rateId: string) => void;
  showBranch: boolean;
  onToggleBranch: () => void;
  onRequote: () => void;
  /** «Cambiar empaque» (§43.3b): `null` ⇔ no se pinta (lista con error o con un solo activo). */
  packages: ShippingPackageDTO[] | null;
  packagesError: boolean;
  packageOpen: boolean;
  onTogglePackage: () => void;
  onPackage: (code: string) => void;
  pickReasonId: string;
  /** 💰 §43.19.1: `labelOptions.limit` — el operador ve las opciones (le sirven para la guía a mano) pero sabe que no comprará. */
  limit?: LabelPurchaseLimit | null;
  /** 💰 rev BSD-1 (§BSD-UX.5b): modo entrada (banda de tarifa descontada, «en la tienda»). */
  inbound?: boolean;
}

export function OptionsView(p: OptionsProps) {
  const t = useTranslations('admin.m4.tracking.sdx.options');
  const ti = useTranslations('admin.m4.tracking.sdx.inbound');
  const inbound = p.inbound === true;
  const locale = useLocale() as AppLocale;
  const money = (c: number) => formatMoneyCents(c, locale);
  const { quote } = p;
  const visible = quote.rates.filter((r) => !r.hidden);
  const branch = quote.rates.filter((r) => r.hidden);
  const ex = quote.excluded;
  const parts = (
    [
      ['unavailable', ex.unavailable],
      ['noCoverage', ex.noCoverage],
      ['notApplicable', ex.notApplicable],
      ['multipackage', ex.multipackage],
      ['breakdownMismatch', ex.breakdownMismatch],
    ] as const
  ).filter(([, n]) => n > 0);
  const excludedTotal = parts.reduce((a, [, n]) => a + n, 0);
  const pkg = quote.package;
  const activePackages = p.packages?.filter((x) => x.active) ?? [];
  const canChangePackage = !p.packagesError && activePackages.length > 1;

  const row = (r: ShipmentRateDTO) => (
    <label
      key={r.rateId}
      data-testid={`sdx-rate-${r.rateId}`}
      className={cn(
        'flex min-h-[44px] cursor-pointer items-start gap-3 p-3',
        p.selected === r.rateId ? 'border-2 border-text' : 'border border-border',
      )}
    >
      <input
        type="radio"
        name="sdx-rate"
        value={r.rateId}
        checked={p.selected === r.rateId}
        onChange={() => p.onSelect(r.rateId)}
        className="mt-1"
        aria-label={`${r.carrierLabel} · ${r.serviceName}`}
      />
      <div className="min-w-0 flex-1">
        <RateLines rate={r} inbound={inbound} />
      </div>
    </label>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 text-sm text-text">
        {/* 💰 §BSD-UX.5b: la BANDA — lo que se le descuenta al vendedor (`charged.grossCents` = `offerShippingFeeCents`, la
            cifra contra la que el SERVIDOR calcula el margen), arriba y en `text-base`. ⛔ La pantalla no la calcula. */}
        {inbound && (
          <p className="text-base text-text" data-testid="sdx-inbound-fee">
            {ti('feeDeducted', { fee: money(quote.charged.grossCents) })}
          </p>
        )}
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span>
            {t('package', { label: pkg.label, length: pkg.lengthCm, width: pkg.widthCm, height: pkg.heightCm, kg: pkg.weightKg })}
          </span>
          {canChangePackage && (
            <Button size="sm" variant="ghost" aria-expanded={p.packageOpen} onClick={p.onTogglePackage}>
              {t('changePackage')}
            </Button>
          )}
        </div>
        {p.packagesError && <p className="text-xs text-muted">{t('packagesError')}</p>}
        {canChangePackage && p.packageOpen && (
          <Select
            label={t('packageLabel')}
            options={activePackages.map((x) => ({
              value: x.code,
              label: t('packageOption', { label: x.label, length: x.lengthCm, width: x.widthCm, height: x.heightCm, kg: x.weightKg }),
            }))}
            value={pkg.code}
            onChange={(e) => p.onPackage(e.target.value)}
          />
        )}
        <p>{t('insurance', { coverage: money(quote.insurance.coverageCents), cost: money(quote.insurance.costCents) })}</p>
        {inbound ? (
          <p className="text-muted">{ti('boxValue', { value: money(quote.insurance.insuredValueCents) })}</p>
        ) : (
          <>
            <p className="text-muted">{t('insuredValue', { value: money(quote.insurance.insuredValueCents) })}</p>
            <p>{t('charged', { gross: money(quote.charged.grossCents), net: money(quote.charged.netCents) })}</p>
          </>
        )}
        <p className="text-muted">{t('validUntil', { datetime: formatDateTimeMx(quote.expiresAt, locale) })}</p>
        {p.limit && (
          <p className="text-muted" data-testid="sdx-limit-note">
            {t('limitNote', { reason: t(p.limit === 'reissue' ? 'limitReason.reissue' : 'limitReason.dailySpend') })}
          </p>
        )}
      </div>
      {quote.rates.some((r) => r.insuranceSource === 'tier_table') && <p className="text-xs text-muted">{t('tierTableNote')}</p>}
      {!quote.completed && quote.rates.length > 0 && (
        <Banner variant="info" action={<Button size="sm" variant="secondary" onClick={p.onRequote}>{t('requote')}</Button>}>
          {t('incomplete')}
        </Banner>
      )}

      {quote.rates.length === 0 ? (
        <div className="flex flex-col gap-1" data-testid="sdx-options-empty">
          <p className="font-serif text-lg text-text">{t('emptyTitle')}</p>
          <p className="text-sm text-text">{t('emptyBody')}</p>
        </div>
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm text-muted">{t('legend')}</legend>
          {visible.map(row)}
          {branch.length > 0 && (
            <Button size="sm" variant="ghost" className="self-start" aria-expanded={p.showBranch} onClick={p.onToggleBranch}>
              {inbound
                ? p.showBranch
                  ? ti('hideBranch')
                  : ti('showBranch', { count: branch.length })
                : p.showBranch
                  ? t('hideBranch')
                  : t('showBranch', { count: branch.length })}
            </Button>
          )}
          {p.showBranch && branch.map(row)}
        </fieldset>
      )}
      {excludedTotal > 0 && (
        <p className="text-xs text-muted" data-testid="sdx-excluded">
          {t('excluded', { total: excludedTotal, parts: parts.map(([k, n]) => t(`excludedPart.${k}`, { n })).join(' · ') })}
        </p>
      )}
      {quote.rates.some((r) => r.isPromo) && <p className="text-xs text-muted">{t('promoNote')}</p>}
      {/* 💰 §BSD-UX.5b / UX-BSD-6: sin recomendada (ninguna entrega en la tienda) ⇒ ninguna marcada y lo dice. ⛔ La
          pantalla no elige (la preselección es `recommendedRateId`, del servidor). */}
      {inbound && quote.rates.length > 0 && quote.recommendedRateId === null && (
        <p className="text-sm text-text" data-testid="sdx-inbound-no-recommended">
          {ti('noRecommended')}
        </p>
      )}
      {quote.rates.length > 0 && p.selected === null && (
        <p id={p.pickReasonId} className="text-sm text-text">
          {t('pickOne')}
        </p>
      )}
    </div>
  );
}

interface BuyProps {
  rate: ShipmentRateDTO;
  coverageCents: number;
  warnNegative: boolean;
  warnBranch: boolean;
  options: LabelOptionsDTO;
  /** El botón no está (SK4) o el servidor lo bloqueó: qué frase ocupa su sitio. */
  blockedText: string | null;
  isSuperAdmin: boolean;
  /** 💰 rev BSD-1 (§BSD-UX.5c): modo entrada (las dos confirmaciones hablan del vendedor y de la tienda). */
  inbound?: boolean;
}

export function BuyView({ rate, coverageCents, warnNegative, warnBranch, options, blockedText, isSuperAdmin, inbound = false }: BuyProps) {
  const t = useTranslations('admin.m4.tracking.sdx.buy');
  const ti = useTranslations('admin.m4.tracking.sdx.inbound');
  const locale = useLocale() as AppLocale;
  const money = (c: number) => formatMoneyCents(c, locale);
  const b = rate.breakdown;
  const rows: [string, React.ReactNode, number][] = [
    [t('row.amount'), null, b.amountCents],
    ...(b.extraFeesCents !== 0 ? ([[t('row.extra'), null, b.extraFeesCents]] as [string, React.ReactNode, number][]) : []),
    [t('row.iva'), rate.ivaSource === 'computed' ? <span className="text-muted"> {t('row.ivaComputed')}</span> : null, b.ivaCents],
    [t('row.serviceFee'), null, b.serviceFeeCents],
    [t('row.insurance', { coverage: money(coverageCents) }), null, b.insuranceCents],
  ];
  // 💰 §43.19.1: con `limit` el botón no está (SK4) y su sitio lo ocupa la negativa, ⛔ sin cifras (SK11).
  const canBuy = options.canPurchase && !options.limit && blockedText === null;
  const disabledText =
    blockedText ??
    (options.limit
      ? t(options.limit === 'reissue' ? 'limit.reissue' : 'limit.dailySpend')
      : options.purchase === 'disabled'
        ? t('disabled')
        : options.purchase === 'super_admin_only' && !isSuperAdmin
          ? t('superAdminOnly')
          : t('notEnabled'));
  return (
    <div className="flex flex-col gap-4">
      <RateLines rate={rate} inbound={inbound} />
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm" data-testid="sdx-breakdown">
        {rows.map(([label, suffix, cents]) => (
          <div key={label} className="contents">
            <dt className="text-text">
              {label}
              {suffix}
            </dt>
            <dd className="tabular text-right text-text">{money(cents)}</dd>
          </div>
        ))}
        <div className="contents">
          <dt className="border-t border-text pt-1 font-medium text-text">{t('row.total')}</dt>
          <dd className="tabular border-t border-text pt-1 text-right font-medium text-text" data-testid="sdx-total">
            {money(rate.priceCents)}
          </dd>
        </div>
      </dl>
      {warnNegative && (
        <Banner variant="warning" role="status">
          {inbound
            ? ti('confirmNegative', { abs: money(Math.abs(rate.marginCents)) })
            : t('confirmNegative', { amount: money(Math.abs(rate.marginCents)) })}
        </Banner>
      )}
      {warnBranch && (
        <Banner variant="warning" role="status">
          {inbound ? ti('confirmBranch') : t('confirmBranch')}
        </Banner>
      )}
      {canBuy ? (
        <div className="flex flex-col gap-1">
          <p className="text-base text-text" data-testid="sdx-charge">
            {isSuperAdmin ? t('charge', { amount: money(rate.priceCents) }) : t('chargeStore', { amount: money(rate.priceCents) })}
          </p>
          <p className="text-sm text-muted">{t('signature')}</p>
          <p className="text-sm text-muted">{t('cancelWindow')}</p>
        </div>
      ) : disabledText ? (
        <p className="text-sm text-text" data-testid="sdx-cannot-buy">
          {disabledText}
        </p>
      ) : null}
    </div>
  );
}

export function usePickReasonId() {
  return useId();
}
